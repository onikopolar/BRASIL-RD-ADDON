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
const logger = new logger_1.Logger('Main');
const cacheService = new CacheService_1.CacheService();
const app = (0, express_1.default)();
logger.info('Brasil RD Server v2.2.0 iniciando - Fix ordem rotas Web Auth');
const CACHE_TTL = 24 * 60 * 60 * 1000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const videosPath = path_1.default.join(__dirname, 'videos');
app.use('/videos', express_1.default.static(videosPath));
app.use('/static/videos', express_1.default.static(videosPath));
logger.debug('Vídeos estáticos configurados', {
    path: videosPath,
    endpoints: ['/videos/*.mp4', '/static/videos/*.mp4']
});
async function initializeDatabase() {
    try {
        logger.info('Iniciando sincronização do banco de dados...');
        const syncOptions = process.env.NODE_ENV === 'development'
            ? { alter: true }
            : {};
        await models_1.sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado', {
            tables: ['torrents', 'files', 'subtitles'],
            environment: process.env.NODE_ENV || 'production'
        });
        await models_1.sequelize.authenticate();
        logger.info('Conexão com banco de dados estabelecida');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha na inicialização do banco de dados', {
            error: errorMessage
        });
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados - funcionalidades limitadas');
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
    logger.debug('Página de configuração solicitada', { ip: req.ip });
    res.setHeader('content-type', 'text/html');
    res.end((0, configureTemplate_1.configureTemplate)(manifest_1.manifest));
});
async function startServer() {
    try {
        logger.info('Iniciando servidor Brasil RD v2.2.0...');
        await initializeDatabase();
        logger.debug('Configurando rotas customizadas (antes do Stremio Router)');
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
        logger.info('Servidor Brasil RD v2.2.0 inicializado com sucesso', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Web Auth System',
                'Database Support',
                'Caching System'
            ],
            criticalFix: 'Ordem das rotas corrigida - Web Auth agora funciona',
            webAuthEndpoint: 'POST /api/auth',
            configurePage: 'GET /configure'
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha na inicialização do servidor', {
            error: errorMessage
        });
        process.exit(1);
    }
}
startServer();
logger.debug('Server.ts v2.2.0 exportado - Fix ordem rotas aplicado');
