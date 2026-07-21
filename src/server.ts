import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import express from 'express';
import cors from 'cors';
import path from 'path';
import { sequelize } from './database/models.js';
import { manifest } from './arquivos-serverts/manifest.js';
import { configureTemplate } from './arquivos-serverts/configureTemplate.js';
import { createStremioBuilder, getStremioRouter } from './arquivos-serverts/streamHandlerBuilder.js';
import { setupBasicRoutes } from './arquivos-serverts/basicRoutes.js';
import { setupResolveRoutes } from './arquivos-serverts/resolveRoutes.js';
import { setupStaticRoutes } from './arquivos-serverts/staticRoutes.js';
import { createServer } from './arquivos-serverts/serverFunctions.js';
import { CacheService } from './services/CacheService.js';
import { Logger } from './utils/logger.js';
import { clientInfoMiddleware } from './middlewares/clientInfo.js';
import { createRateLimiter, torrentioRateLimiter } from './middlewares/rateLimit.js';
import { metricsService } from './services/MetricsService.js';
import { ultraDebugMiddleware, manifestDebugMiddleware, configureDebugMiddleware } from './middlewares/ultraDebug.js';

const logger = new Logger('Main');
const cacheService = new CacheService();
const app = express();

app.set('trust proxy', 1);

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());
app.use(ultraDebugMiddleware());
app.use(clientInfoMiddleware());
app.use(metricsService.httpMetricsMiddleware());
app.use(createRateLimiter());

// Interceptor Torrentio
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
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados em produção');
        } else {
            throw error;
        }
    }
}

// Cache middleware
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

// Configure
app.get('/configure', configureDebugMiddleware(), (req: any, res: any) => {
    const ultraLogger = new Logger('CONFIGURE');
    ultraLogger.info(' Servindo página de configuração HTML', {
        requestId: req._ultraDebugId,
        manifestVersion: manifest.version,
        manifestId: manifest.id,
        host: req.get('host'),
        protocol: req.protocol,
    });
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(configureTemplate(manifest));
});

// ROTA TORRENTIO 1: /torbox=APIKEY/manifest.json
app.get('/torbox=:apiKey/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    const ultraLogger = new Logger('TORBOX-MANIFEST');
    const apiKey = req.params.apiKey;
    ultraLogger.info(' MANIFEST via TORBOX solicitado', {
        requestId: req._ultraDebugId,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        apiKeyLength: apiKey?.length || 0,
        manifestId: manifest.id,
        manifestVersion: manifest.version,
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent')?.substring(0, 80),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// Compatibilidade: /realdebrid=APIKEY/manifest.json
app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    const ultraLogger = new Logger('RD-MANIFEST');
    const apiKey = req.params.apiKey;
    ultraLogger.info(' MANIFEST via REALDEBRID solicitado', {
        requestId: req._ultraDebugId,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        apiKeyLength: apiKey?.length || 0,
        host: req.get('host'),
        origin: req.get('origin'),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// ROTA TORRENTIO 2: /torbox=APIKEY/stream/:type/:id.json
app.get('/torbox=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    const ultraLogger = new Logger('STREAM-TORBOX');
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const requestId = req._ultraDebugId || 'no-id';

    ultraLogger.info('═══════════════════════════════════════', {});
    ultraLogger.info(' STREAM SOLICITADO (Torbox route)', {
        requestId,
        type,
        id: decodedId,
        apiKeyPresent: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent')?.substring(0, 100),
        clientInfo: (req as any)._clientInfo,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    try {
        if (!apiKey || apiKey.length < 10) {
            ultraLogger.warn(' API Key inválida ou ausente para stream', {
                requestId,
                apiKeyLength: apiKey?.length || 0,
                reason: !apiKey ? 'API Key ausente' : 'API Key muito curta (< 10 chars)',
            });
            return res.json({ streams: [] });
        }

        const { StreamHandler } = await import('./services/StreamHandler.js');
        const streamHandler = StreamHandler.getInstance();

        // Define URL base a partir do host da requisicao (para URLs absolutas nos videos)
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host');
        if (host) {
            streamHandler.setStaticResponseBaseUrl(`${protocol}://${host}`);
        }

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

        ultraLogger.info(' STREAM RESULT retornado', {
            requestId,
            totalStreams: result.streams?.length || 0,
            streamPreviews: result.streams?.slice(0, 5).map((s: any) => ({
                title: s.title?.substring(0, 60),
                quality: s.behaviorHints?.streamQuality || 'unknown',
                hasUrl: !!s.url,
            })),
        });

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
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        ultraLogger.error(' ERRO FATAL na rota Torrentio Stream', {
            requestId,
            error: errorMsg,
            stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
            type,
            id: decodedId,
        });
        return res.json({ streams: [] });
    }
});

// Pula Stremio Router se rota já tratada
app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        return next('route');
    }
    next();
});

// LOGGER para rotas do Stremio SDK
app.use((req: any, res: any, next: any) => {
    const sdkLogger = new Logger('SDK-Router');
    // Só loga rotas que o SDK vai processar (manifest, stream, configure)
    const sdkPaths = ['/manifest.json', '/stream/', '/configure'];
    const isSdkPath = sdkPaths.some(p => req.path === p || req.path.startsWith(p));
    if (isSdkPath) {
        sdkLogger.info(' Rota caiu no Stremio SDK Router', {
            requestId: req._ultraDebugId,
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl?.substring(0, 200),
            query: req.query,
            params: req.params,
        });
    }
    next();
});

async function startServer() {
    try {
        const startupLogger = new Logger('Startup');
        startupLogger.info(`BRASIL RD Addon starting on port ${process.env.PORT || 7000}`);

        await initializeDatabase();

        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);

        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);

        // INTERCEPTOR para /manifest.json do SDK
        app.use((req: any, res: any, next: any) => {
            if (req.path === '/manifest.json' || req.path === '/manifest') {
                const manifestLogger = new Logger('MANIFEST-SDK');
                manifestLogger.info('═══════════════════════════════════════', {});
                manifestLogger.info(' STREMIO PEDIU MANIFEST (via SDK router)', {
                    requestId: req._ultraDebugId,
                    method: req.method,
                    host: req.get('host'),
                    origin: req.get('origin'),
                    userAgent: req.get('user-agent')?.substring(0, 100),
                    stremioAddonCollection: req.get('stremio-addon-collection'),
                    protocol: req.protocol,
                    fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
                });
                manifestLogger.info(' Respondendo com manifest:', {
                    id: manifest.id,
                    version: manifest.version,
                    name: manifest.name,
                    configurationRequired: manifest.behaviorHints?.configurationRequired,
                    configurable: manifest.behaviorHints?.configurable,
                    resources: manifest.resources,
                    types: manifest.types,
                });
                manifestLogger.info('═══════════════════════════════════════', {});
            }
            next();
        });

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