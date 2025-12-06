"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupBasicRoutes = void 0;
const CacheService_1 = require("../services/CacheService");
const logger_1 = require("../utils/logger");
const logger = new logger_1.Logger('Routes');
const cacheService = new CacheService_1.CacheService();
const setupBasicRoutes = (app, manifest) => {
    logger.info('BasicRoutes v2.1.0 configurado - Suporte Web Auth');
    app.get('/health', (req, res) => {
        logger.debug('Health check solicitado', { ip: req.ip });
        res.json({
            status: 'ok',
            service: 'Brasil RD Addon',
            mode: 'torrentio-like-dev',
            version: manifest.version,
            features: {
                cache: true,
                lazyStreams: true,
                realDebrid: true,
                optimizations: true,
                webAuth: true
            }
        });
    });
    app.delete('/cache', (req, res) => {
        logger.info('Cache limpo manualmente', { ip: req.ip });
        cacheService.clear();
        res.json({
            success: true,
            message: 'Cache limpo'
        });
    });
    app.get('/cache/status', (req, res) => {
        logger.debug('Status cache solicitado', { ip: req.ip });
        res.json({
            status: 'CacheService em uso',
            ttl: '24 horas',
            feature: 'Cache distribuído por chave',
            size: 'Dinâmico'
        });
    });
    app.post('/api/auth', async (req, res) => {
        logger.debug('Autenticação Web solicitada', {
            ip: req.ip,
            hasBody: !!req.body
        });
        try {
            const { apiKey } = req.body;
            if (!apiKey || typeof apiKey !== 'string') {
                logger.warn('Autenticação Web falhou - API Key inválida', {
                    ip: req.ip,
                    apiKeyType: typeof apiKey
                });
                return res.status(400).json({
                    success: false,
                    error: 'API Key é obrigatória e deve ser uma string'
                });
            }
            logger.debug('Validando API Key com Real-Debrid', {
                ip: req.ip,
                apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)
            });
            const rdResponse = await fetch('https://api.real-debrid.com/rest/1.0/user', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            if (!rdResponse.ok) {
                logger.warn('Autenticação Web falhou - API Key rejeitada pelo Real-Debrid', {
                    ip: req.ip,
                    status: rdResponse.status
                });
                return res.status(401).json({
                    success: false,
                    error: 'API Key inválida ou expirada. Verifique no Real-Debrid.'
                });
            }
            const timestamp = Date.now();
            const token = Buffer.from(`${timestamp}:${apiKey.substring(0, 10)}:${req.ip}`).toString('base64');
            logger.info('Autenticação Web bem-sucedida', {
                ip: req.ip,
                tokenPreview: token.substring(0, 20) + '...',
                apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)
            });
            res.json({
                success: true,
                token: token,
                expiresIn: '24h',
                message: 'Autenticação Web configurada com sucesso!',
                instructions: 'Token salvo automaticamente para uso no Stremio Web'
            });
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Erro na autenticação Web', {
                ip: req.ip,
                error: errorMsg,
                stack: error instanceof Error ? error.stack : undefined
            });
            res.status(500).json({
                success: false,
                error: 'Erro interno no servidor',
                details: process.env.NODE_ENV === 'development' ? errorMsg : 'Contate o administrador'
            });
        }
    });
    app.get('/', (req, res) => {
        logger.debug('Redirecionando raiz para /configure', { ip: req.ip });
        res.redirect('/configure');
    });
    app.get('/api/info', (req, res) => {
        logger.debug('Info API solicitada', { ip: req.ip });
        res.json({
            name: 'Brasil RD API',
            version: '2.1.0',
            purpose: 'Autenticação Web para Stremio Web',
            endpoints: {
                auth: 'POST /api/auth',
                health: 'GET /health',
                cache: 'GET /cache/status, DELETE /cache'
            },
            note: 'Esta API suporta autenticação via token para Stremio Web'
        });
    });
};
exports.setupBasicRoutes = setupBasicRoutes;
logger.info('BasicRoutes v2.1.0 exportado - Sistema Web Auth pronto');
