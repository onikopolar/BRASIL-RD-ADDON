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
import { clientInfoMiddleware } from './middlewares/clientInfo';
import { createRateLimiter, torrentioRateLimiter } from './middlewares/rateLimit';
import { metricsService } from './services/MetricsService';
import { StreamHandler } from './services/StreamHandler';

const logger = new Logger('Main');
const cacheService = new CacheService();
const app = express();

app.set('trust proxy', 1);

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());
app.use(clientInfoMiddleware());
app.use(metricsService.httpMetricsMiddleware());
app.use(createRateLimiter());

app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        req._torrentioHandled = true;
    }
    next();
});

app.get('/metrics', metricsService.metricsRoute());

const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

async function initializeDatabase() {
    try {
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        await sequelize.authenticate();
    } catch (error) {
        logger.error('Falha no banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV !== 'production') {
            throw error;
        }
    }
}

const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public, must-revalidate`);
        res.setHeader('Pragma', 'no-cache');
    }
    if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    next();
});

app.get('/configure', (req: any, res: any) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(configureTemplate(manifest));
});

app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

app.get('/realdebrid=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);

    try {
        if (!apiKey || apiKey.length < 10) {
            return res.json({ streams: [] });
        }

        const streamHandler = StreamHandler.getInstance();
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

        const result = await streamHandler.handleStreamRequest(streamRequest);

        result.streams.forEach((stream: any) => {
            let quality = 'unknown';
            if (stream.behaviorHints?.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.title) {
                if (stream.title.includes('1080p') || stream.title.includes('1080')) quality = '1080p';
                else if (stream.title.includes('720p') || stream.title.includes('720')) quality = '720p';
                else if (stream.title.includes('2160p') || stream.title.includes('4K')) quality = '2160p';
                else if (stream.title.includes('HD')) quality = 'HD';
            }
            metricsService.recordStreamReturned(type, quality);
        });

        return res.json(result);
    } catch (error) {
        logger.error('Erro na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        return res.json({ streams: [] });
    }
});

app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        return next('route');
    }
    next();
});

async function startServer() {
    try {
        await initializeDatabase();

        // Inicializa o StreamHandler como singleton e carrega dependencias
        const streamHandler = StreamHandler.getInstance();
        await streamHandler.initialize();

        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);

        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        app.use(stremioRouter);

        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
    } catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

startServer();