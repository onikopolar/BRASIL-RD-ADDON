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
                torbox: true,
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
        const authLogger = new logger_1.Logger('🔐AUTH');
        authLogger.info('═══════════════════════════════════════', {});
        authLogger.info('🔐 SOLICITAÇÃO DE AUTENTICAÇÃO WEB', {
            requestId: req._ultraDebugId,
            ip: req.ip,
            hasBody: !!req.body,
            bodyKeys: req.body ? Object.keys(req.body) : [],
            contentType: req.get('content-type'),
            origin: req.get('origin'),
            userAgent: req.get('user-agent')?.substring(0, 100),
        });
        try {
            const { apiKey } = req.body;
            if (!apiKey || typeof apiKey !== 'string') {
                authLogger.warn('❌ AUTENTICAÇÃO REJEITADA - API Key inválida', {
                    requestId: req._ultraDebugId,
                    ip: req.ip,
                    apiKeyPresent: !!apiKey,
                    apiKeyType: typeof apiKey,
                    reason: !apiKey ? 'API Key ausente no body' : `Tipo inválido: ${typeof apiKey}`,
                });
                return res.status(400).json({
                    success: false,
                    error: 'API Key é obrigatória e deve ser uma string'
                });
            }
            authLogger.info('🔑 API Key recebida para validação', {
                requestId: req._ultraDebugId,
                apiKeyLength: apiKey.length,
                apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4),
            });
            authLogger.debug('🌐 Enviando validação para api.torbox.app...', {
                requestId: req._ultraDebugId,
                endpoint: 'https://api.torbox.app/v1/api/user/me',
            });
            const tbResponse = await fetch('https://api.torbox.app/v1/api/user/me', {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });
            authLogger.info('📥 Resposta do Torbox recebida', {
                requestId: req._ultraDebugId,
                status: tbResponse.status,
                ok: tbResponse.ok,
                statusText: tbResponse.statusText,
            });
            if (!tbResponse.ok) {
                let torboxErrorBody = '';
                try {
                    torboxErrorBody = await tbResponse.text();
                    torboxErrorBody = torboxErrorBody.substring(0, 200);
                }
                catch { }
                authLogger.warn('❌ AUTENTICAÇÃO REJEITADA PELO TORBOX', {
                    requestId: req._ultraDebugId,
                    ip: req.ip,
                    torboxStatus: tbResponse.status,
                    torboxStatusText: tbResponse.statusText,
                    torboxErrorBody,
                    reason: tbResponse.status === 401 ? 'API Key inválida/expirada' :
                        tbResponse.status === 403 ? 'Acesso proibido (API Key bloqueada?)' :
                            tbResponse.status === 429 ? 'Rate limit excedido no Torbox' :
                                `Status HTTP ${tbResponse.status}`,
                });
                return res.status(401).json({
                    success: false,
                    error: 'API Key inválida ou expirada. Verifique no Torbox.'
                });
            }
            const timestamp = Date.now();
            const token = Buffer.from(`${timestamp}:${apiKey.substring(0, 10)}:${req.ip}`).toString('base64');
            authLogger.info('✅ AUTENTICAÇÃO WEB BEM-SUCEDIDA!', {
                requestId: req._ultraDebugId,
                ip: req.ip,
                tokenPreview: token.substring(0, 20) + '...',
                apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4),
                tokenLength: token.length,
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
            authLogger.error('💥 ERRO FATAL na autenticação Web', {
                requestId: req._ultraDebugId,
                ip: req.ip,
                error: errorMsg,
                stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
                cause: error instanceof Error ? error.cause : undefined,
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
