import express from 'express';
import cors from 'cors';
import path from 'path';
import { sequelize } from './database/models';
import { manifest } from './arquivos-serverts/manifest';
import { configureTemplate } from './arquivos-serverts/configureTemplate';
import { createStremioBuilder, getStremioRouter } from './arquivos-serverts/streamHandlerBuilder';
import { setupBasicRoutes } from './arquivos-serverts/basicRoutes';
import { setupResolveRoutes } from './arquivos-serverts/resolveRoutes';
import { setupStaticRoutes } from './arquivos-serverts/staticRoutes';
import { createServer } from './arquivos-serverts/serverFunctions';
import { CacheService } from './services/CacheService';
import { Logger } from './utils/logger';

const logger = new Logger('Main');
const cacheService = new CacheService();
const app = express();

// Version: 4.1.0 - FIX: Headers CORS aplicados em todas as rotas Torrentio
logger.info('Brasil RD Server v4.1.0 iniciando - Fix CORS para Stremio Web');

// 1. CONFIGURAÇÃO CORS PRINCIPAL (deve vir antes de qualquer rota)
// Configuração robusta para permitir acesso do Stremio Web
app.use(cors({
    origin: '*', // Permite acesso de qualquer origem, incluindo web.stremio.com
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());

// 2. INTERCEPTOR APENAS PARA LOG (NÃO bloqueia o fluxo do CORS)
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        logger.debug('LOGGER CORS: Rota Torrentio detectada', {
            path: req.path,
            method: req.method,
            originalUrl: req.originalUrl,
            hasCorsHeader: res.get('Access-Control-Allow-Origin') || 'não definido'
        });
    }
    next(); // SEMPRE continua para o próximo middleware
});

// Vídeos estáticos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

logger.debug('Serviço de vídeos estáticos configurado');

// Banco de dados
async function initializeDatabase() {
    try {
        logger.info('Iniciando conexão com banco de dados...');
        
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        
        logger.info('Banco de dados sincronizado com sucesso', {
            tabelas: ['torrents', 'files', 'subtitles'],
            ambiente: process.env.NODE_ENV
        });
        
        await sequelize.authenticate();
        logger.info('Conexão com banco de dados validada');
        
    } catch (error) {
        logger.error('Falha na inicialização do banco de dados', { 
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            stack: error instanceof Error ? error.stack?.substring(0, 200) : 'não disponível'
        });
        
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando operação sem banco de dados no modo produção');
        } else {
            throw error;
        }
    }
}

// Middleware de cache otimizado
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    // Adiciona headers de cache apenas se não existirem
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public, must-revalidate`);
        res.setHeader('Pragma', 'no-cache');
    }
    
    // Headers CORS adicionais para garantir compatibilidade
    if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    
    next();
});

// Rota de configuração do addon
app.get('/configure', (req: any, res: any) => {
    logger.debug('Requisição para página de configuração recebida', { 
        ip: req.ip,
        userAgent: req.get('User-Agent')?.substring(0, 50) || 'desconhecido'
    });
    
    // Garante headers CORS para esta rota também
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.end(configureTemplate(manifest));
});

// ROTA TORRENTIO 1: Manifesto dinâmico
app.get('/realdebrid=:apiKey/manifest.json', (req: any, res: any) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.length > 8 
        ? apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)
        : '***';
    
    logger.debug('Manifesto Torrentio solicitado', { 
        apiKeyPreview: safeKey,
        clientOrigin: req.get('Origin') || 'direct'
    });
    
    // HEADERS CORS EXPLÍCITOS PARA ESTA ROTA
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    
    res.json(manifest);
});

// ROTA TORRENTIO 2: Streams (ROTA MAIS IMPORTANTE - FIX CORS APLICADO)
app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req: any, res: any) => {
    // HEADERS CORS DEFINIDOS NO INÍCIO DA ROTA (CRÍTICO)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
    
    try {
        const { apiKey, type, id } = req.params;
        const decodedId = decodeURIComponent(id);
        const safeKey = apiKey.length > 8 
            ? apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)
            : '***';
        
        logger.debug('Rota Torrentio Stream iniciada - FIX CORS ATIVO', {
            apiKeyPreview: safeKey,
            type: type,
            id: decodedId,
            clientOrigin: req.get('Origin') || 'direct',
            hasCorsHeaders: true
        });
        
        // Validação básica da API Key
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key do Real-Debrid inválida ou muito curta', { length: apiKey?.length });
            return res.json({ streams: [] });
        }
        
        // Importação dinâmica do StreamHandler
        const { StreamHandler } = await import('./services/StreamHandler');
        const streamHandler = new StreamHandler();
        
        // Cria objeto de request para o handler
        const streamRequest = {
            type: type as 'movie' | 'series',
            id: decodedId,
            apiKey: apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };
        
        // Processa a requisição de streams
        const result = await streamHandler.handleStreamRequest(streamRequest);
        
        logger.info('Rota Torrentio Stream finalizada com sucesso', {
            streamsCount: result.streams.length,
            id: decodedId,
            type: type,
            statusCors: 'headers aplicados'
        });
        
        // Resposta FINAL com streams
        return res.json(result);
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido no servidor';
        const errorStack = error instanceof Error ? error.stack?.substring(0, 150) : 'não disponível';
        
        logger.error('Erro crítico na rota Torrentio Stream', {
            error: errorMsg,
            stackPreview: errorStack,
            endpoint: '/stream/:type/:id.json'
        });
        
        // Retorna array vazio em caso de erro, mas COM HEADERS CORS
        return res.json({ streams: [] });
    }
});

// Middleware OPTIONS para requisições preflight CORS
app.options('*', (req: any, res: any) => {
    logger.debug('Requisição preflight OPTIONS recebida', {
        origin: req.get('Origin'),
        method: req.get('Access-Control-Request-Method')
    });
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 horas
    
    res.status(204).end();
});

// Configuração do sistema Stremio (para rotas não-Torrentio)
async function startServer() {
    try {
        logger.info('Inicialização do servidor v4.1.0 em andamento...');
        
        // 1. Inicializa banco de dados
        await initializeDatabase();
        
        // 2. Configura rotas customizadas básicas
        logger.debug('Configurando rotas customizadas do sistema');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        
        // 3. Sistema Stremio oficial (apenas para rotas padrão)
        logger.debug('Inicializando sistema Stremio Addon SDK');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        
        // 4. Aplica router do Stremio em todas as outras rotas
        app.use(stremioRouter);
        logger.debug('Router do Stremio SDK configurado para rotas padrão');
        
        // 5. Inicia servidor HTTP/HTTPS
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        // Log de inicialização completa
        logger.info('Servidor Brasil RD v4.1.0 inicializado com sucesso', {
            porta: port,
            ambiente: process.env.NODE_ENV || 'desenvolvimento',
            recursosAtivos: [
                'Sistema Stremio Addon completo',
                'Integração Real-Debrid funcional',
                'Rotas Torrentio estilo /realdebrid=APIKEY',
                'Sistema de cache avançado',
                'Banco de dados SQLite',
                'FIX CORS para Stremio Web (v4.1.0)'
            ],
            endpointsPrincipais: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json',
                'GET /configure',
                'TODAS rotas Stremio SDK padrão'
            ],
            notaFixa: 'Headers CORS aplicados em TODAS as rotas Torrentio para compatibilidade Web'
        });
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro de inicialização desconhecido';
        
        logger.error('Falha crítica na inicialização do servidor', {
            error: errorMsg,
            stack: error instanceof Error ? error.stack?.substring(0, 200) : 'não disponível',
            motivo: 'Verifique configurações de banco, porta ou variáveis de ambiente'
        });
        
        process.exit(1);
    }
}

// Inicia o servidor
startServer();

// Log final do módulo
logger.info('Módulo server.ts v4.1.0 carregado - FIX CORS para compatibilidade Stremio Web aplicado');