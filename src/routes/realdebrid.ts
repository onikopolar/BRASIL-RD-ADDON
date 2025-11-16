import { Router, Request, Response } from 'express';
import axios from 'axios';
import { Logger } from '../utils/logger';

const router = Router();
const logger = new Logger('RealDebridAPI');

interface ValidateRequest {
    apiKey: string;
}

interface ValidateResponse {
    valid: boolean;
    user?: {
        id: number;
        username: string;
        email: string;
        points: number;
        locale: string;
        avatar: string;
        type: string;
        premium: number;
        expiration: string;
    };
    error?: string;
}

// Cache simples para evitar múltiplas validações da mesma key
const validationCache = new Map<string, { valid: boolean; user: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Função para limpar cache expirado
function cleanupCache(): void {
    const now = Date.now();
    for (const [key, value] of validationCache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            validationCache.delete(key);
        }
    }
}

// Rota para validar API key do Real-Debrid
router.post('/validate', async (req: Request, res: Response) => {
    try {
        const { apiKey }: ValidateRequest = req.body;

        if (!apiKey) {
            return res.status(400).json({ 
                valid: false, 
                error: 'API key é obrigatória' 
            });
        }

        // Limpar cache expirado
        cleanupCache();

        // Verificar cache
        const cached = validationCache.get(apiKey);
        if (cached) {
            logger.info('Retornando validação do cache', {
                cached: true,
                username: cached.user?.username
            });
            return res.json({
                valid: cached.valid,
                user: cached.user
            });
        }

        logger.info('Validando API key do Real-Debrid', {
            keyLength: apiKey.length,
            keyPrefix: apiKey.substring(0, 8) + '...'
        });

        // Fazer requisição para a API do Real-Debrid
        const response = await axios.get('https://api.real-debrid.com/rest/1.0/user', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Brasil-RD-Addon/1.0.0'
            },
            timeout: 15000, // 15 segundos de timeout
            validateStatus: (status) => status < 500 // Não lançar erro para 4xx
        });

        // Verificar resposta da API
        if (response.status === 200 && response.data) {
            const userData = {
                id: response.data.id,
                username: response.data.username,
                email: response.data.email,
                points: response.data.points,
                locale: response.data.locale,
                avatar: response.data.avatar,
                type: response.data.type,
                premium: response.data.premium,
                expiration: response.data.expiration
            };

            logger.info('API key validada com sucesso', {
                userId: userData.id,
                username: userData.username,
                premium: userData.premium,
                expiration: userData.expiration
            });

            const result: ValidateResponse = {
                valid: true,
                user: userData
            };

            // Salvar no cache
            validationCache.set(apiKey, {
                valid: true,
                user: userData,
                timestamp: Date.now()
            });

            res.json(result);

        } else if (response.status === 401) {
            logger.warn('Token inválido ou expirado', {
                status: response.status
            });
            
            const result: ValidateResponse = {
                valid: false,
                error: 'Token expirado ou inválido'
            };

            // Cache negativo por 1 minuto
            validationCache.set(apiKey, {
                valid: false,
                user: null,
                timestamp: Date.now()
            });

            res.status(401).json(result);

        } else if (response.status === 403) {
            logger.warn('Conta bloqueada ou sem permissões', {
                status: response.status
            });
            
            const result: ValidateResponse = {
                valid: false,
                error: 'Conta bloqueada ou sem permissões'
            };
            res.status(403).json(result);

        } else {
            logger.warn('Resposta inesperada da API Real-Debrid', {
                status: response.status,
                data: response.data
            });
            
            const result: ValidateResponse = {
                valid: false,
                error: `Erro na API Real-Debrid: ${response.status}`
            };
            res.status(400).json(result);
        }

    } catch (error: any) {
        logger.error('Erro na validação da API Real-Debrid', {
            error: error.message,
            code: error.code,
            status: error.response?.status,
            url: error.config?.url
        });

        if (error.code === 'ECONNABORTED') {
            res.status(408).json({ 
                valid: false, 
                error: 'Timeout na conexão com Real-Debrid' 
            });
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            res.status(503).json({ 
                valid: false, 
                error: 'Servidor Real-Debrid indisponível' 
            });
        } else {
            res.status(500).json({ 
                valid: false, 
                error: 'Erro de conexão com Real-Debrid' 
            });
        }
    }
});

// Rota de saúde para Real-Debrid API
router.get('/health', async (req: Request, res: Response) => {
    try {
        // Teste básico de conectividade
        await axios.get('https://api.real-debrid.com', {
            timeout: 5000
        });
        
        res.json({ 
            status: 'ok', 
            service: 'Real-Debrid API',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({ 
            status: 'error', 
            service: 'Real-Debrid API',
            error: 'Servidor indisponível'
        });
    }
});

export default router;
