"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupTorrentioRoutes = void 0;
const logger_js_1 = require("../utils/logger.js");
const StreamHandler_js_1 = require("../services/StreamHandler.js");
const logger = new logger_js_1.Logger('TorrentioRoutes');
const setupTorrentioRoutes = (app) => {
    app.get('/torbox=:apiKey/stream/:type/:id.json', async (req, res) => {
        try {
            const { apiKey, type, id } = req.params;
            if (!apiKey || apiKey.length < 10) {
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
            const streamHandler = StreamHandler_js_1.StreamHandler.getInstance();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            res.json(result);
        }
        catch (error) {
            logger.error('Erro na rota Torrentio', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            res.json({ streams: [] });
        }
    });
    app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req, res) => {
        try {
            const { apiKey, type, id } = req.params;
            if (!apiKey || apiKey.length < 10) {
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
            const streamHandler = StreamHandler_js_1.StreamHandler.getInstance();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            res.json(result);
        }
        catch (error) {
            logger.error('Erro na rota Torrentio', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            res.json({ streams: [] });
        }
    });
};
exports.setupTorrentioRoutes = setupTorrentioRoutes;
