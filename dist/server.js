"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
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
const logger = new logger_1.Logger('Main');
const cacheService = new CacheService_1.CacheService();
const app = (0, express_1.default)();
logger.info('Brasil RD Server v4.4.1 iniciando - Correção de métricas de qualidade');
app.use((req, res, next) => {
    if (req.path.includes('/realdebrid=')) {
        logger.debug('INTERCEPTOR: Rota Torrentio detectada', {
            path: req.path,
            method: req.method,
            originalUrl: req.originalUrl
        });
        req._torrentioHandled = true;
    }
    next();
});
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use((0, clientInfo_1.clientInfoMiddleware)());
app.use(MetricsService_1.metricsService.httpMetricsMiddleware());
app.use((0, rateLimit_1.createRateLimiter)());
app.get('/metrics', MetricsService_1.metricsService.metricsRoute());
const videosPath = path_1.default.join(__dirname, 'videos');
app.use('/videos', express_1.default.static(videosPath));
app.use('/static/videos', express_1.default.static(videosPath));
logger.debug('Vídeos estáticos configurados');
async function initializeDatabase() {
    try {
        logger.info('Iniciando conexão com banco de dados...');
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await models_1.sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado', {
            tables: ['torrents', 'files', 'subtitles']
        });
        await models_1.sequelize.authenticate();
        logger.info('Conexão com banco de dados estabelecida');
    }
    catch (error) {
        logger.error('Falha na conexão com banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando operação sem banco de dados');
        }
        else {
            throw error;
        }
    }
}
const cacheMaxAge = 600;
app.use((req, res, next) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public`);
    }
    next();
});
app.get('/configure', (req, res) => {
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Página de configuração acessada', {
        ip: clientIp,
        userAgent: req.clientInfo?.browser || 'Desconhecido'
    });
    res.setHeader('content-type', 'text/html');
    res.end((0, configureTemplate_1.configureTemplate)(manifest_1.manifest));
});
app.get('/realdebrid=:apiKey/manifest.json', rateLimit_1.torrentioRateLimiter, (req, res) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Rota Manifest Torrentio acessada', {
        apiKey: safeKey,
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido',
        os: req.clientInfo?.os || 'Desconhecido',
        device: req.clientInfo?.deviceType || 'desktop'
    });
    res.json(manifest_1.manifest);
});
app.get('/realdebrid=:apiKey/stream/:type/:id.json', rateLimit_1.torrentioRateLimiter, async (req, res) => {
    const startTime = Date.now();
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    const { apiKey, type, id } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    logger.debug('Rota Torrentio Stream iniciada', {
        apiKey: safeKey,
        type,
        id,
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido',
        os: req.clientInfo?.os || 'Desconhecido',
        device: req.clientInfo?.deviceType || 'desktop',
        isBot: req.clientInfo?.isBot || false
    });
    try {
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key inválida rejeitada', { ip: clientIp });
            return res.json({ streams: [] });
        }
        const { StreamHandler } = await Promise.resolve().then(() => __importStar(require('./services/StreamHandler')));
        const streamHandler = new StreamHandler();
        const streamRequest = {
            type: type,
            id: decodeURIComponent(id),
            apiKey: apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };
        const result = await streamHandler.handleStreamRequest(streamRequest);
        result.streams.forEach(stream => {
            let quality = 'unknown';
            if (stream.behaviorHints && stream.behaviorHints.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            }
            else if (stream.name) {
                if (stream.name.includes('1080p') || stream.name.includes('1080')) {
                    quality = '1080p';
                }
                else if (stream.name.includes('720p') || stream.name.includes('720')) {
                    quality = '720p';
                }
                else if (stream.name.includes('2160p') || stream.name.includes('4K')) {
                    quality = '2160p';
                }
                else if (stream.name.includes('HD')) {
                    quality = 'HD';
                }
            }
            MetricsService_1.metricsService.recordStreamReturned(type, quality);
        });
        logger.info('Rota Torrentio Stream finalizada', {
            streamsCount: result.streams.length,
            id: id,
            ip: clientIp,
            deviceType: req.clientInfo?.deviceType || 'desktop',
            isBot: req.clientInfo?.isBot || false,
            requestTime: startTime,
            duration: Date.now() - startTime
        });
        return res.json(result);
    }
    catch (error) {
        logger.error('Erro na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            ip: clientIp,
            id: req.params?.id || 'Desconhecido',
            duration: Date.now() - startTime
        });
        return res.json({ streams: [] });
    }
});
app.use((req, res, next) => {
    if (req._torrentioHandled) {
        logger.debug('Rota já tratada pelo Torrentio - pulando Stremio Router');
        return next('route');
    }
    next();
});
async function startServer() {
    try {
        logger.info('Iniciando servidor v4.4.1...');
        await initializeDatabase();
        logger.debug('Configurando rotas customizadas');
        (0, basicRoutes_1.setupBasicRoutes)(app, manifest_1.manifest);
        (0, resolveRoutes_1.setupResolveRoutes)(app);
        (0, staticRoutes_1.setupStaticRoutes)(app);
        logger.debug('Configurando sistema Stremio');
        const builder = (0, streamHandlerBuilder_1.createStremioBuilder)(manifest_1.manifest);
        const stremioRouter = (0, streamHandlerBuilder_1.getStremioRouter)(builder);
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        (0, serverFunctions_1.createServer)(app, port);
        logger.info('Servidor v4.4.1 inicializado com sucesso', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Web Auth System',
                'Database Support',
                'Caching System',
                'Torrentio Route Fix',
                'Client Info Tracking',
                'IP Detection',
                'User Agent Parsing',
                'Rate Limiting Inteligente',
                'Sistema de Métricas Completo'
            ],
            rotasTorrentio: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json'
            ],
            endpointsMonitoramento: [
                'GET /metrics - Métricas Prometheus',
                'GET /configure - Página configuração'
            ],
            configurePage: 'GET /configure',
            rateLimits: {
                global: '300 req/15min (desktop), 200 req/15min (mobile), 50 req/15min (bot)',
                torrentio: '500 req/15min',
                excluded: ['/configure', '/', '/metrics']
            },
            metricsEnabled: MetricsService_1.metricsService.isReady()
        });
    }
    catch (error) {
        logger.error('Falha na inicialização do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}
startServer();
logger.debug('Server.ts v4.4.1 exportado - Correção de extração de qualidade para métricas');
