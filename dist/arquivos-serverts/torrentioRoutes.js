"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupTorrentioRoutes = void 0;
const logger_1 = require("../utils/logger");
const StreamHandler_1 = require("../services/StreamHandler");
const logger = new logger_1.Logger('TorrentioRoutes');
const setupTorrentioRoutes = (app) => {
    logger.info('TorrentioRoutes v1.0.0 configurado - Suporte a formato Torrentio');
    app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req, res) => {
        try {
            const { apiKey, type, id } = req.params;
            const safeApiKey = apiKey.length > 8
                ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
                : '***';
            logger.debug('Rota Torrentio acessada', {
                apiKey: safeApiKey,
                type,
                id,
                ip: req.ip
            });
            if (!apiKey || apiKey.length < 10) {
                logger.warn('API Key inválida na rota Torrentio', {
                    type,
                    id,
                    apiKeyLength: apiKey?.length || 0
                });
                return res.json({ streams: [] });
            }
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
            const streamHandler = new StreamHandler_1.StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            logger.info('Streams retornados via rota Torrentio', {
                type,
                id,
                streamsCount: result.streams.length,
                ip: req.ip
            });
            res.json(result);
        }
        catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Erro na rota Torrentio', {
                error: errorMsg,
                params: req.params
            });
            res.json({ streams: [] });
        }
    });
};
exports.setupTorrentioRoutes = setupTorrentioRoutes;
