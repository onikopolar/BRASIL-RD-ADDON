import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from '../services/StreamHandler';
import { Logger } from '../utils/logger';
import { StreamRequest } from '../types';

const logger = new Logger('StreamHandlerBuilder');

export const createStremioBuilder = (manifest: any) => {
    const builder = new addonBuilder(manifest as any);

    // Handler principal de streams
    builder.defineStreamHandler(async (args: any) => {
        const requestStartTime = Date.now();
        const config = args.config;

        if (!config || !config.apiKey) {
            logger.warn('Requisição sem API key', {
                type: args.type,
                id: args.id
            });
            return { streams: [] };
        }

        logger.debug('ID recebido', {
            id: args.id,
            type: args.type,
            hasColon: args.id.includes(':'),
            colonCount: (args.id.match(/:/g) || []).length
        });

        const streamRequest: StreamRequest = {
            type: args.type as 'movie' | 'series',
            id: args.id,
            title: '',
            apiKey: config.apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };

        logger.debug('Detalhes da requisição', {
            type: args.type,
            id: args.id,
            isSeries: args.type === 'series',
            hasSeasonEpisodeFormat: args.type === 'series' && /tt\d+:\d+:\d+/.test(args.id),
        });

        try {
            const streamHandler = new StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;

            logger.info('Streams processados', {
                requestId: args.id,
                streamsCount: result.streams.length,
                processingTime: processingTime + 'ms',
            });

            if (result.streams.length > 0) {
                logger.debug('Streams encontrados', {
                    streamNames: result.streams.map(s => s.name)
                });
            }

            if (result.streams.length < 3) {
                logger.warn('Poucos streams encontrados', {
                    requestId: args.id,
                    streamsFound: result.streams.length,
                    type: args.type,
                    id: args.id
                });
            }

            logger.debug('Streams retornados', { 
                requestId: args.id, 
                streamCount: result.streams.length 
            });
            
            return result;

        } catch (error) {
            const errorTime = Date.now() - requestStartTime;

            logger.error('Falha no processamento de streams', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                request: { type: args.type, id: args.id },
                processingTime: errorTime + 'ms'
            });

            return { streams: [] };
        }
    });

    return builder;
};

export const getStremioRouter = (builder: any) => {
    return getRouter(builder.getInterface());
};