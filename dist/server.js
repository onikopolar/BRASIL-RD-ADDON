"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const models_1 = require("./database/models");
const manifest_1 = require("./arquivos-serverts/manifest");
const configureTemplate_1 = require("./arquivos-serverts/configureTemplate");
const streamHandlerBuilder_1 = require("./arquivos-serverts/streamHandlerBuilder");
const basicRoutes_1 = require("./arquivos-serverts/basicRoutes");
const resolveRoutes_1 = require("./arquivos-serverts/resolveRoutes");
const staticRoutes_1 = require("./arquivos-serverts/staticRoutes");
const serverFunctions_1 = require("./arquivos-serverts/serverFunctions");
const CacheService_1 = require("./services/CacheService");
const logger_1 = require("./utils/logger");
const clientInfo_1 = require("./middlewares/clientInfo");
const rateLimit_1 = require("./middlewares/rateLimit");
const MetricsService_1 = require("./services/MetricsService");
const StreamHandler_1 = require("./services/StreamHandler");
const logger = new logger_1.Logger('Main');
const cacheService = new CacheService_1.CacheService();
const app = (0, express_1.default)();
app.set('trust proxy', 1);
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));
app.use(express_1.default.json());
app.use((0, clientInfo_1.clientInfoMiddleware)());
app.use(MetricsService_1.metricsService.httpMetricsMiddleware());
app.use((0, rateLimit_1.createRateLimiter)());
app.use((req, res, next) => {
    if (req.path.includes('/realdebrid=')) {
        req._torrentioHandled = true;
    }
    next();
});
app.get('/metrics', MetricsService_1.metricsService.metricsRoute());
const videosPath = path_1.default.join(__dirname, 'videos');
app.use('/videos', express_1.default.static(videosPath));
app.use('/static/videos', express_1.default.static(videosPath));
async function initializeDatabase() {
    try {
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await models_1.sequelize.sync(syncOptions);
        await models_1.sequelize.authenticate();
    }
    catch (error) {
        logger.error('Falha no banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV !== 'production') {
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
app.get('/configure', (req, res) => {
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end((0, configureTemplate_1.configureTemplate)(manifest_1.manifest));
});
app.get('/realdebrid=:apiKey/manifest.json', rateLimit_1.torrentioRateLimiter, (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest_1.manifest);
});
app.get('/realdebrid=:apiKey/stream/:type/:id.json', rateLimit_1.torrentioRateLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    try {
        if (!apiKey || apiKey.length < 10) {
            return res.json({ streams: [] });
        }
        const streamHandler = StreamHandler_1.StreamHandler.getInstance();
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
            MetricsService_1.metricsService.recordStreamReturned(type, quality);
        });
        return res.json(result);
    }
    catch (error) {
        logger.error('Erro na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
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
async function startServer() {
    try {
        await initializeDatabase();
        const streamHandler = StreamHandler_1.StreamHandler.getInstance();
        await streamHandler.initialize();
        (0, basicRoutes_1.setupBasicRoutes)(app, manifest_1.manifest);
        (0, resolveRoutes_1.setupResolveRoutes)(app);
        (0, staticRoutes_1.setupStaticRoutes)(app);
        const builder = (0, streamHandlerBuilder_1.createStremioBuilder)(manifest_1.manifest);
        const stremioRouter = (0, streamHandlerBuilder_1.getStremioRouter)(builder);
        app.use(stremioRouter);
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        (0, serverFunctions_1.createServer)(app, port);
    }
    catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}
startServer();
