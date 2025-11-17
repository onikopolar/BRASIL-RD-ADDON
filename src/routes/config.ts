import { Router, Request, Response } from 'express';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Logger } from '../utils/logger';

const router = Router();
const logger = new Logger('ConfigAPI');

interface ConfigRequest {
    apiKey: string;
    timestamp: string;
}

interface ConfigResponse {
    success: boolean;
    message?: string;
    error?: string;
}

export class ConfigManager {
    private envPath: string;

    constructor() {
        this.envPath = path.join(process.cwd(), '.env');
    }

    async updateApiKey(apiKey: string): Promise<{success: boolean; error?: string}> {
        try {
            let envContent = '';
            
            // Ler arquivo .env atual se existir
            if (await fs.pathExists(this.envPath)) {
                envContent = await fs.readFile(this.envPath, 'utf8');
            }

            // Atualizar ou adicionar REAL_DEBRID_API_KEY
            if (envContent.includes('REAL_DEBRID_API_KEY=')) {
                envContent = envContent.replace(
                    /REAL_DEBRID_API_KEY=.*/,
                    `REAL_DEBRID_API_KEY=${apiKey}`
                );
            } else {
                envContent += `\nREAL_DEBRID_API_KEY=${apiKey}\n`;
            }

            // Garantir que outras configurações essenciais existam
            if (!envContent.includes('NODE_ENV=')) {
                envContent += 'NODE_ENV=production\n';
            }
            
            if (!envContent.includes('PORT=')) {
                envContent += 'PORT=7000\n';
            }

            await fs.writeFile(this.envPath, envContent);
            logger.info('API key atualizada com sucesso');
            
            return { success: true };
        } catch (error) {
            const errorMsg = `Erro ao atualizar API key: ${error instanceof Error ? error.message : 'Erro desconhecido'}`;
            logger.error(errorMsg);
            return { success: false, error: errorMsg };
        }
    }

    async getCurrentConfig(): Promise<{apiKey?: string}> {
        try {
            if (!await fs.pathExists(this.envPath)) {
                return {};
            }

            const envContent = await fs.readFile(this.envPath, 'utf8');
            const apiKeyMatch = envContent.match(/REAL_DEBRID_API_KEY=(.*)/);
            
            return {
                apiKey: apiKeyMatch ? apiKeyMatch[1] : undefined
            };
        } catch (error) {
            logger.error('Erro ao ler configuração atual');
            return {};
        }
    }
}

const configManager = new ConfigManager();

// Rota para obter configuração atual
router.get('/config', async (req: Request, res: Response) => {
    try {
        const config = await configManager.getCurrentConfig();
        res.json(config);
    } catch (error) {
        logger.error('Erro no GET /config:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para salvar nova configuração
router.post('/config', async (req: Request, res: Response) => {
    try {
        const { apiKey }: ConfigRequest = req.body;

        if (!apiKey) {
            return res.status(400).json({ error: 'Chave API é obrigatória' });
        }

        const result = await configManager.updateApiKey(apiKey);

        if (result.success) {
            const response: ConfigResponse = {
                success: true,
                message: 'Configuração atualizada com sucesso'
            };
            res.json(response);
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        logger.error('Erro no POST /config:', error);
        res.status(500).json({ error: 'Erro interno do servidor' });
    }
});

// Rota para gerar URL personalizada Torrentio-style
router.get('/generate-url', (req: Request, res: Response) => {
    const { apiKey } = req.query;
    
    if (!apiKey) {
        return res.status(400).json({ error: 'API key é obrigatória' });
    }

    // Gerar URL personalizada como o Torrentio
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const personalizedUrl = `${baseUrl}/manifest.json?apiKey=${encodeURIComponent(apiKey as string)}`;
    
    logger.info('URL personalizada gerada', {
        baseUrl,
        hasApiKey: !!apiKey
    });

    res.json({
        success: true,
        url: personalizedUrl,
        installUrl: personalizedUrl,
        message: 'Use esta URL para instalar o addon já configurado'
    });
});

// Rota de saúde para verificar se servidor está ativo
router.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export default router;