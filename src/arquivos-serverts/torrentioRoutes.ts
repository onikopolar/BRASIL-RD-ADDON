import { Router } from 'express';
import { Logger } from '../utils/logger';
import { StreamHandler } from '../services/StreamHandler';

const logger = new Logger('TorrentioRoutes');

export const setupTorrentioRoutes = (app: any) => {
    logger.info('TorrentioRoutes v1.0.0 configurado - Suporte a formato Torrentio');
    
    // Rota especial Torrentio-style: /realdebrid=API_KEY/stream/type/id.json
    app.get('/realdebrid=:apiKey/stream/:type/:id.json', async (req: any, res: any) => {
        try {
            const { apiKey, type, id } = req.params;
            
            // Log seguro da API Key
            const safeApiKey = apiKey.length > 8 
                ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
                : '***';
            
            logger.debug('Rota Torrentio acessada', {
                apiKey: safeApiKey,
                type,
                id,
                ip: req.ip
            });
            
            // Validação básica
            if (!apiKey || apiKey.length < 10) {
                logger.warn('API Key inválida na rota Torrentio', {
                    type,
                    id,
                    apiKeyLength: apiKey?.length || 0
                });
                return res.json({ streams: [] });
            }
            
            // Cria request
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
            
            // Processa stream
            const streamHandler = new StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            
            logger.info('Streams retornados via rota Torrentio', {
                type,
                id,
                streamsCount: result.streams.length,
                ip: req.ip
            });
            
            res.json(result);
            
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Erro na rota Torrentio', {
                error: errorMsg,
                params: req.params
            });
            res.json({ streams: [] });
        }
    });
};