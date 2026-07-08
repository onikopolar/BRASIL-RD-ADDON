import { Router } from 'express';
import { Logger } from '../utils/logger';
import { StreamHandler } from '../services/StreamHandler';

const logger = new Logger('TorrentioRoutes');

export const setupTorrentioRoutes = (app: any) => {
    app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req: any, res: any) => {
        try {
            const { apiKey, type, id } = req.params;
            if (!apiKey || apiKey.length < 10) {
                return res.json({ streams: [] });
            }

            const streamRequest = {
                type: type as 'movie' | 'series',
                id: decodeURIComponent(id),
                apiKey: apiKey,
                config: {
                    quality: 'Todas as Qualidades',
                    language: 'pt-BR',
                    streamType: 'direct',
                    maxResults: '25'
                }
            };

            const streamHandler = StreamHandler.getInstance();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            res.json(result);
        } catch (error) {
            logger.error('Erro na rota Torrentio', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            res.json({ streams: [] });
        }
    });
};