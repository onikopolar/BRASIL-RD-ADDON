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
logger.info('Brasil RD Server v4.5.2 iniciando - Correção de rate limit e proxy');
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
        if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('Rota Torrentio interceptada', {
                path: req.path.substring(0, 80),
                ip: req.clientInfo?.ip || req.ip || 'Desconhecido'
            });
        }
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
        logger.info('Conectando ao banco de dados');
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await models_1.sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado', {
            tabelas: ['torrents', 'files', 'subtitles'],
            ambiente: process.env.NODE_ENV || 'producao'
        });
        await models_1.sequelize.authenticate();
        logger.info('Conexão com banco de dados validada');
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
app.get('/configure', (req, res) => {
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Pagina de configuracao acessada', { ip: clientIp });
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end((0, configureTemplate_1.configureTemplate)(manifest_1.manifest));
});
app.get('/realdebrid=:apiKey/manifest.json', rateLimit_1.torrentioRateLimiter, (req, res) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Manifesto Torrentio solicitado', {
        apiKeyPreview: safeKey,
        ip: clientIp
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest_1.manifest);
});
app.get('/realdebrid=:apiKey/stream/:type/:id.json', rateLimit_1.torrentioRateLimiter, async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');
    const startTime = Date.now();
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    logger.debug('Rota Torrentio Stream iniciada', {
        apiKeyPreview: safeKey,
        type: type,
        id: decodedId.substring(0, 30),
        ip: clientIp,
        formato: 'v1.4.0'
    });
    try {
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key invalida', { length: apiKey?.length, ip: clientIp });
            return res.json({ streams: [] });
        }
        const { StreamHandler } = await Promise.resolve().then(() => __importStar(require('./services/StreamHandler')));
        const streamHandler = new StreamHandler();
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
            if (stream.behaviorHints && stream.behaviorHints.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            }
            else if (stream.title) {
                if (stream.title.includes('1080p') || stream.title.includes('1080')) {
                    quality = '1080p';
                }
                else if (stream.title.includes('720p') || stream.title.includes('720')) {
                    quality = '720p';
                }
                else if (stream.title.includes('2160p') || stream.title.includes('4K')) {
                    quality = '2160p';
                }
                else if (stream.title.includes('HD')) {
                    quality = 'HD';
                }
            }
            MetricsService_1.metricsService.recordStreamReturned(type, quality);
        });
        logger.info('Rota Torrentio Stream finalizada', {
            streamsCount: result.streams.length,
            id: decodedId.substring(0, 20),
            ip: clientIp,
            duration: Date.now() - startTime,
            formato: 'v1.4.0_compativel'
        });
        return res.json(result);
    }
    catch (error) {
        logger.error('Erro na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            ip: clientIp,
            duration: Date.now() - startTime
        });
        return res.json({ streams: [] });
    }
});
app.use((req, res, next) => {
    if (req._torrentioHandled) {
        if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('Rota Torrentio - pulando Stremio Router');
        }
        return next('route');
    }
    next();
});
async function startServer() {
    try {
        logger.info('Iniciando servidor v4.5.2');
        await initializeDatabase();
        logger.debug('Configurando rotas customizadas');
        (0, basicRoutes_1.setupBasicRoutes)(app, manifest_1.manifest);
        (0, resolveRoutes_1.setupResolveRoutes)(app);
        (0, staticRoutes_1.setupStaticRoutes)(app);
        logger.debug('Inicializando sistema Stremio SDK');
        const builder = (0, streamHandlerBuilder_1.createStremioBuilder)(manifest_1.manifest);
        const stremioRouter = (0, streamHandlerBuilder_1.getStremioRouter)(builder);
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        (0, serverFunctions_1.createServer)(app, port);
        logger.info('Servidor Brasil RD v4.5.2 inicializado com sucesso', {
            porta: port,
            ambiente: process.env.NODE_ENV || 'producao',
            recursos: [
                'FIX CORS para Stremio Web',
                'Formato de streams corrigido v1.4.0',
                'Rate Limit corrigido com trust proxy',
                'Sistema de Métricas',
                'Integração Real-Debrid',
                'Rotas Torrentio estilo /realdebrid=APIKEY',
                'Banco de dados SQLite'
            ],
            endpoints: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json',
                'GET /configure',
                'GET /metrics'
            ],
            nota: 'Rate limit corrigido com trust proxy para Railway'
        });
    }
    catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}
startServer();
logger.info('Server.ts v4.5.2 carregado - Correção de rate limit e proxy aplicada');
