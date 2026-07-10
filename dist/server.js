"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dns_1 = __importDefault(require("dns"));
dns_1.default.setServers(['8.8.8.8', '1.1.1.1']);
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const models_js_1 = require("./database/models.js");
const manifest_js_1 = require("./arquivos-serverts/manifest.js");
const configureTemplate_js_1 = require("./arquivos-serverts/configureTemplate.js");
const streamHandlerBuilder_js_1 = require("./arquivos-serverts/streamHandlerBuilder.js");
const basicRoutes_js_1 = require("./arquivos-serverts/basicRoutes.js");
const resolveRoutes_js_1 = require("./arquivos-serverts/resolveRoutes.js");
const staticRoutes_js_1 = require("./arquivos-serverts/staticRoutes.js");
const serverFunctions_js_1 = require("./arquivos-serverts/serverFunctions.js");
const CacheService_js_1 = require("./services/CacheService.js");
const logger_js_1 = require("./utils/logger.js");
const clientInfo_js_1 = require("./middlewares/clientInfo.js");
const rateLimit_js_1 = require("./middlewares/rateLimit.js");
const MetricsService_js_1 = require("./services/MetricsService.js");
const ultraDebug_js_1 = require("./middlewares/ultraDebug.js");
const logger = new logger_js_1.Logger('Main');
const cacheService = new CacheService_js_1.CacheService();
const app = (0, express_1.default)();
app.set('trust proxy', 1);
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));
app.use(express_1.default.json());
app.use((0, ultraDebug_js_1.ultraDebugMiddleware)());
app.use((0, clientInfo_js_1.clientInfoMiddleware)());
app.use(MetricsService_js_1.metricsService.httpMetricsMiddleware());
app.use((0, rateLimit_js_1.createRateLimiter)());
app.use((req, res, next) => {
    if (req.path.includes('/realdebrid=')) {
        req._torrentioHandled = true;
    }
    next();
});
app.get('/metrics', MetricsService_js_1.metricsService.metricsRoute());
const videosPath = path_1.default.join(__dirname, 'videos');
app.use('/videos', express_1.default.static(videosPath));
app.use('/static/videos', express_1.default.static(videosPath));
async function initializeDatabase() {
    try {
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await models_js_1.sequelize.sync(syncOptions);
        await models_js_1.sequelize.authenticate();
    }
    catch (error) {
        logger.error('Falha no banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados em produção');
        }
        else {
            throw error;
        }
    }
}
const cacheMaxAge = 600;
app.use((req, res, next) => {
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
app.get('/configure', (0, ultraDebug_js_1.configureDebugMiddleware)(), (req, res) => {
    const ultraLogger = new logger_js_1.Logger('CONFIGURE');
    ultraLogger.info(' Servindo página de configuração HTML', {
        requestId: req._ultraDebugId,
        manifestVersion: manifest_js_1.manifest.version,
        manifestId: manifest_js_1.manifest.id,
        host: req.get('host'),
        protocol: req.protocol,
    });
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end((0, configureTemplate_js_1.configureTemplate)(manifest_js_1.manifest));
});
app.get('/torbox=:apiKey/manifest.json', rateLimit_js_1.torrentioRateLimiter, (0, ultraDebug_js_1.manifestDebugMiddleware)(), (req, res) => {
    const ultraLogger = new logger_js_1.Logger('TORBOX-MANIFEST');
    const apiKey = req.params.apiKey;
    ultraLogger.info(' MANIFEST via TORBOX solicitado', {
        requestId: req._ultraDebugId,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        apiKeyLength: apiKey?.length || 0,
        manifestId: manifest_js_1.manifest.id,
        manifestVersion: manifest_js_1.manifest.version,
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent')?.substring(0, 80),
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest_js_1.manifest);
});
app.get('/realdebrid=:apiKey/manifest.json', rateLimit_js_1.torrentioRateLimiter, (0, ultraDebug_js_1.manifestDebugMiddleware)(), (req, res) => {
    const ultraLogger = new logger_js_1.Logger('RD-MANIFEST');
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
    res.json(manifest_js_1.manifest);
});
app.get('/torbox=:apiKey/stream/:type/:id.json', rateLimit_js_1.torrentioRateLimiter, async (req, res) => {
    const ultraLogger = new logger_js_1.Logger('STREAM-TORBOX');
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
        clientInfo: req._clientInfo,
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
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host');
        if (host) {
            streamHandler.setStaticResponseBaseUrl(`${protocol}://${host}`);
        }
        const streamRequest = {
            type: type,
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
            streamPreviews: result.streams?.slice(0, 5).map((s) => ({
                title: s.title?.substring(0, 60),
                quality: s.behaviorHints?.streamQuality || 'unknown',
                hasUrl: !!s.url,
            })),
        });
        result.streams.forEach((stream) => {
            let quality = 'unknown';
            if (stream.behaviorHints?.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            }
            else if (stream.title) {
                if (stream.title.includes('1080p') || stream.title.includes('1080'))
                    quality = '1080p';
                else if (stream.title.includes('720p') || stream.title.includes('720'))
                    quality = '720p';
                else if (stream.title.includes('2160p') || stream.title.includes('4K'))
                    quality = '2160p';
                else if (stream.title.includes('HD'))
                    quality = 'HD';
            }
            MetricsService_js_1.metricsService.recordStreamReturned(type, quality);
        });
        return res.json(result);
    }
    catch (error) {
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
app.use((req, res, next) => {
    if (req._torrentioHandled) {
        return next('route');
    }
    next();
});
app.use((req, res, next) => {
    const sdkLogger = new logger_js_1.Logger('SDK-Router');
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
        const startupLogger = new logger_js_1.Logger('Startup');
        startupLogger.info(`BRASIL RD Addon starting on port ${process.env.PORT || 7000}`);
        await initializeDatabase();
        (0, basicRoutes_js_1.setupBasicRoutes)(app, manifest_js_1.manifest);
        (0, resolveRoutes_js_1.setupResolveRoutes)(app);
        (0, staticRoutes_js_1.setupStaticRoutes)(app);
        const builder = (0, streamHandlerBuilder_js_1.createStremioBuilder)(manifest_js_1.manifest);
        const stremioRouter = (0, streamHandlerBuilder_js_1.getStremioRouter)(builder);
        app.use((req, res, next) => {
            if (req.path === '/manifest.json' || req.path === '/manifest') {
                const manifestLogger = new logger_js_1.Logger('MANIFEST-SDK');
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
                    id: manifest_js_1.manifest.id,
                    version: manifest_js_1.manifest.version,
                    name: manifest_js_1.manifest.name,
                    configurationRequired: manifest_js_1.manifest.behaviorHints?.configurationRequired,
                    configurable: manifest_js_1.manifest.behaviorHints?.configurable,
                    resources: manifest_js_1.manifest.resources,
                    types: manifest_js_1.manifest.types,
                });
                manifestLogger.info('═══════════════════════════════════════', {});
            }
            next();
        });
        app.use(stremioRouter);
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        (0, serverFunctions_js_1.createServer)(app, port);
    }
    catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}
startServer();
