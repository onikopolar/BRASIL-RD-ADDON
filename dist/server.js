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
logger.info('Brasil RD Server v4.5.0 iniciando - CORS, Métricas e Rate Limit integrados');
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
        logger.debug('LOGGER CORS/TORRENTIO: Rota detectada', {
            path: req.path,
            clientOrigin: req.get('Origin') || 'direct',
            ip: req.clientInfo?.ip || req.ip || 'Desconhecido',
            hasCorsHeader: res.get('Access-Control-Allow-Origin') || 'não definido'
        });
        req._torrentioHandled = true;
    }
    next();
});
app.get('/metrics', MetricsService_1.metricsService.metricsRoute());
const videosPath = path_1.default.join(__dirname, 'videos');
app.use('/videos', express_1.default.static(videosPath));
app.use('/static/videos', express_1.default.static(videosPath));
logger.debug('Serviço de vídeos estáticos configurado');
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
            logger.warn('Continuando operação sem banco de dados no modo produção');
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
    logger.debug('Página de configuração acessada', {
        ip: clientIp,
        userAgent: req.clientInfo?.browser || 'Desconhecido'
    });
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
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido'
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
    logger.debug('Rota Torrentio Stream iniciada - CORS ATIVO', {
        apiKeyPreview: safeKey,
        type: type,
        id: decodedId,
        ip: clientIp,
        clientOrigin: req.get('Origin') || 'direct',
        hasCorsHeaders: true
    });
    try {
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key do Real-Debrid inválida', { length: apiKey?.length, ip: clientIp });
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
        logger.info('Rota Torrentio Stream finalizada com sucesso', {
            streamsCount: result.streams.length,
            id: decodedId,
            ip: clientIp,
            statusCors: 'headers aplicados',
            duration: Date.now() - startTime
        });
        return res.json(result);
    }
    catch (error) {
        logger.error('Erro crítico na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            ip: clientIp,
            duration: Date.now() - startTime
        });
        return res.json({ streams: [] });
    }
});
app.options('*', (req, res) => {
    logger.debug('Requisição preflight OPTIONS recebida', {
        origin: req.get('Origin'),
        method: req.get('Access-Control-Request-Method')
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
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
        logger.info('Inicialização do servidor v4.5.0 em andamento...');
        await initializeDatabase();
        logger.debug('Configurando rotas customizadas do sistema');
        (0, basicRoutes_1.setupBasicRoutes)(app, manifest_1.manifest);
        (0, resolveRoutes_1.setupResolveRoutes)(app);
        (0, staticRoutes_1.setupStaticRoutes)(app);
        logger.debug('Inicializando sistema Stremio Addon SDK');
        const builder = (0, streamHandlerBuilder_1.createStremioBuilder)(manifest_1.manifest);
        const stremioRouter = (0, streamHandlerBuilder_1.getStremioRouter)(builder);
        app.use(stremioRouter);
        logger.debug('Router do Stremio SDK configurado para rotas padrão');
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        (0, serverFunctions_1.createServer)(app, port);
        logger.info('Servidor Brasil RD v4.5.0 inicializado com sucesso', {
            port,
            features: [
                'FIX CORS para Stremio Web (v4.1.0)',
                'Rate Limiting Inteligente (v4.4.1)',
                'Sistema de Métricas Completo (v4.4.1)',
                'Client Info Tracking (v4.4.1)',
                'Integração Real-Debrid',
                'Rotas Torrentio estilo /realdebrid=APIKEY',
                'Banco de dados SQLite'
            ],
            endpointsPrincipais: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json',
                'GET /configure',
                'GET /metrics',
                'TODAS rotas Stremio SDK padrão'
            ],
            notaFixa: 'Headers CORS e rota OPTIONS aplicados para compatibilidade total com Stremio Web'
        });
    }
    catch (error) {
        logger.error('Falha crítica na inicialização do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}
startServer();
logger.info('Módulo server.ts v4.5.0 carregado - CORS, Métricas e Rate Limit integrados');
