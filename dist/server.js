"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const models_1 = require("./database/models");
const manifest_1 = require("./arquivos-serverts/manifest");
const configureTemplate_1 = require("./arquivos-serverts/configureTemplate");
const streamHandlerBuilder_1 = require("./arquivos-serverts/streamHandlerBuilder");
const basicRoutes_1 = require("./arquivos-serverts/basicRoutes");
const resolveRoutes_1 = require("./arquivos-serverts/resolveRoutes");
const serverFunctions_1 = require("./arquivos-serverts/serverFunctions");
const CacheService_1 = require("./services/CacheService");
const logger_1 = require("./utils/logger");
const logger = new logger_1.Logger('Main');
const cacheService = new CacheService_1.CacheService();
const app = (0, express_1.default)();
const CACHE_TTL = 24 * 60 * 60 * 1000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
async function initializeDatabase() {
    try {
        logger.info('Iniciando sincronização do banco de dados...');
        const syncOptions = process.env.NODE_ENV === 'development'
            ? { alter: true }
            : {};
        await models_1.sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado com sucesso', {
            tables: ['torrents', 'files', 'subtitles'],
            options: syncOptions,
            environment: process.env.NODE_ENV || 'production'
        });
        await models_1.sequelize.authenticate();
        logger.info('Conexão com banco de dados estabelecida');
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha crítica na inicialização do banco de dados', {
            error: errorMessage,
            action: 'Verifique as credenciais do banco e se o PostgreSQL está rodando'
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
    res.setHeader('content-type', 'text/html');
    res.end((0, configureTemplate_1.configureTemplate)(manifest_1.manifest));
});
async function startServer() {
    try {
        await initializeDatabase();
        const builder = (0, streamHandlerBuilder_1.createStremioBuilder)(manifest_1.manifest);
        const stremioRouter = (0, streamHandlerBuilder_1.getStremioRouter)(builder);
        app.use(stremioRouter);
        (0, basicRoutes_1.setupBasicRoutes)(app, manifest_1.manifest);
        (0, resolveRoutes_1.setupResolveRoutes)(app);
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        (0, serverFunctions_1.createServer)(app, port);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha na inicialização do servidor', {
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined
        });
        process.exit(1);
    }
}
startServer();
