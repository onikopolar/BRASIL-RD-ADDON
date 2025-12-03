"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupBasicRoutes = void 0;
const CacheService_1 = require("../services/CacheService");
const logger_1 = require("../utils/logger");
const logger = new logger_1.Logger('Routes');
const cacheService = new CacheService_1.CacheService();
const setupBasicRoutes = (app, manifest) => {
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            service: 'Brasil RD Addon',
            mode: 'torrentio-like-dev',
            version: manifest.version,
            features: {
                cache: true,
                lazyStreams: true,
                realDebrid: true,
                optimizations: true
            }
        });
    });
    app.delete('/cache', (req, res) => {
        cacheService.clear();
        logger.info('Cache limpo manualmente');
        res.json({
            success: true,
            message: 'Cache limpo'
        });
    });
    app.get('/cache/status', (req, res) => {
        res.json({
            status: 'CacheService em uso',
            ttl: 24 * 60 * 60 * 1000 + 'ms',
            feature: 'Cache distribuído por chave'
        });
    });
    app.get('/', (req, res) => {
        res.redirect('/configure');
    });
};
exports.setupBasicRoutes = setupBasicRoutes;
