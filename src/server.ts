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

// Version: 3.0.0 - Fix rota Torrentio para Stremio Web
logger.info('Brasil RD Server v3.0.0 iniciando - Fix rota Torrentio');

// Configuração do Express
app.use(cors());
app.use(express.json());

// Servir vídeos informativos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

logger.debug('Vídeos estáticos configurados');

// Inicialização do Banco de Dados
async function initializeDatabase() {
    try {
        logger.info('Iniciando banco de dados...');
        
        const syncOptions = process.env.NODE_ENV === 'development' 
            ? { alter: true }
            : {};
            
        await sequelize.sync(syncOptions);
        
        logger.info('Banco sincronizado', {
            tables: ['torrents', 'files', 'subtitles'],
            env: process.env.NODE_ENV || 'production'
        });
        
        await sequelize.authenticate();
        logger.info('Conexão BD estabelecida');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha BD', { error: errorMessage });
        
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem BD - funcionalidades limitadas');
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

// Rota configuração HTML
app.get('/configure', (req: any, res: any) => {
    logger.debug('Página configuração solicitada', { ip: req.ip });
    res.setHeader('content-type', 'text/html');
    res.end(configureTemplate(manifest));
});

// ROTA TORRENTIO FIX - Deve vir ANTES do Stremio Router
app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req: any, res: any) => {
    try {
        const { apiKey, type, id } = req.params;
        
        // Log seguro
        const safeApiKey = apiKey.length > 8 
            ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
            : '***';
        
        logger.debug('Rota Torrentio chamada', {
            apiKey: safeApiKey,
            type,
            id,
            ip: req.ip
        });
        
        // Validação básica
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key inválida na rota Torrentio');
            return res.json({ streams: [] });
        }
        
        // Importa StreamHandler dinamicamente para evitar circular dependency
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
        
        // Processa stream
        const result = await streamHandler.handleStreamRequest(streamRequest);
        
        logger.info('Streams retornados via rota Torrentio', {
            streamsCount: result.streams.length
        });
        
        res.json(result);
        
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Erro rota Torrentio', { error: errorMsg });
        res.json({ streams: [] });
    }
});

// Função principal
async function startServer() {
    try {
        logger.info('Iniciando servidor v3.0.0...');
        
        // 1. Banco de dados
        await initializeDatabase();
        
        // 2. Rotas customizadas PRIMEIRO
        logger.debug('Configurando rotas customizadas');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        
        // 3. Sistema Stremio
        logger.debug('Configurando sistema Stremio');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        
        // 4. Aplica rotas Stremio
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');
        
        // 5. Inicia servidor
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        logger.info('Servidor v3.0.0 inicializado', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Web Auth System',
                'Database Support',
                'Caching System',
                'Torrentio Route Fix'
            ],
            torrentioRoute: 'GET /realdebrid=:apiKey/stream/:type/:id.json',
            configurePage: 'GET /configure'
        });
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha inicialização', { error: errorMessage });
        process.exit(1);
    }
}

// Inicia aplicação
startServer();

logger.debug('Server.ts v3.0.0 exportado - Rota Torrentio adicionada');