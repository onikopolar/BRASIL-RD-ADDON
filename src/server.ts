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

// Version: 4.0.0 - Fix completo rota Torrentio + interceptor
logger.info('Brasil RD Server v4.0.0 iniciando - Fix completo');

// Interceptor para capturar rotas Torrentio ANTES de tudo
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        logger.debug('INTERCEPTOR: Rota Torrentio detectada', {
            path: req.path,
            method: req.method,
            originalUrl: req.originalUrl
        });
        
        // Marca que esta requisição já foi tratada
        req._torrentioHandled = true;
    }
    next();
});

// Configuração Express
app.use(cors());
app.use(express.json());

// Vídeos estáticos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

logger.debug('Vídeos estáticos OK');

// Banco de dados
async function initializeDatabase() {
    try {
        logger.info('Iniciando BD...');
        
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        
        logger.info('BD sincronizado', {
            tables: ['torrents', 'files', 'subtitles']
        });
        
        await sequelize.authenticate();
        logger.info('Conexão BD OK');
        
    } catch (error) {
        logger.error('Falha BD', { 
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem BD');
        } else {
            throw error;
        }
    }
}

// Middleware cache
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public`);
    }
    next();
});

// Rota configuração
app.get('/configure', (req: any, res: any) => {
    logger.debug('Página configuração', { ip: req.ip });
    res.setHeader('content-type', 'text/html');
    res.end(configureTemplate(manifest));
});

// ROTA 1: Manifest Torrentio
app.get('/realdebrid=:apiKey/manifest.json', (req: any, res: any) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    
    logger.debug('Rota Manifest Torrentio', { apiKey: safeKey });
    res.json(manifest);
});

// ROTA 2: Stream Torrentio (MAIS IMPORTANTE)
app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req: any, res: any) => {
    try {
        const { apiKey, type, id } = req.params;
        const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
        
        logger.debug('ROTA TORRENTIO STREAM INICIADA', {
            apiKey: safeKey,
            type,
            id,
            ip: req.ip
        });
        
        // Valida API Key
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key inválida');
            return res.json({ streams: [] });
        }
        
        // Import dinâmico
        const { StreamHandler } = await import('./services/StreamHandler');
        const streamHandler = new StreamHandler();
        
        // Cria request
        const streamRequest = {
            type: type as 'movie' | 'series',
            id: decodeURIComponent(id),
            apiKey: apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };
        
        // Processa
        const result = await streamHandler.handleStreamRequest(streamRequest);
        
        logger.info('ROTA TORRENTIO STREAM FINALIZADA', {
            streamsCount: result.streams.length,
            id: id
        });
        
        // Resposta FINAL - não passa para outras rotas
        return res.json(result);
        
    } catch (error) {
        logger.error('Erro rota Torrentio', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        return res.json({ streams: [] });
    }
});

// Middleware para pular Stremio Router se rota já tratada
app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        logger.debug('Rota já tratada pelo Torrentio - pulando Stremio Router');
        return next('route'); // Pula para próxima rota, não executa Stremio Router
    }
    next();
});

// Função principal
async function startServer() {
    try {
        logger.info('Iniciando servidor v4.0.0...');
        
        // 1. BD
        await initializeDatabase();
        
        // 2. Rotas customizadas
        logger.debug('Configurando rotas customizadas');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        
        // 3. Sistema Stremio (SÓ para rotas NÃO Torrentio)
        logger.debug('Configurando sistema Stremio');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        
        // 4. Aplica Stremio Router
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');
        
        // 5. Inicia servidor
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        logger.info('Servidor v4.0.0 inicializado', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Web Auth System',
                'Database Support',
                'Caching System',
                'Torrentio Route Fix COMPLETO'
            ],
            rotasTorrentio: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json'
            ],
            configurePage: 'GET /configure'
        });
        
    } catch (error) {
        logger.error('Falha inicialização', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

// Inicia
startServer();

logger.debug('Server.ts v4.0.0 exportado - Fix completo aplicado');