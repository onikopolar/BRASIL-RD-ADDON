import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from '../services/StreamHandler';
import { Logger } from '../utils/logger';
import { StreamRequest } from '../types';

const logger = new Logger('StreamHandlerBuilder');

export const createStremioBuilder = (manifest: any) => {
    const builder = new addonBuilder(manifest as any);

    builder.defineStreamHandler(async (args: any) => {
        // Consolidação da API Key
        let apiKey = null;

        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
        } else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
        } else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
        } else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
        } else if (args.config?.rd_key) {
            apiKey = args.config.rd_key;
        } else if (args.extra?.rd_key) {
            apiKey = args.extra.rd_key;
        }

        if (!apiKey) {
            return { streams: [] };
        }

        const streamRequest: StreamRequest = {
            type: args.type as 'movie' | 'series',
            id: args.id,
            title: args.title || '',
            apiKey: apiKey,
            config: {
                quality: args.config?.quality || 'Todas as Qualidades',
                language: args.config?.language || 'pt-BR',
                streamType: args.config?.streamType || 'direct',
                maxResults: args.config?.maxResults || '25'
            }
        };

        try {
            const streamHandler = StreamHandler.getInstance();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            return result;
        } catch (error) {
            logger.error('Erro no processamento de streams', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return { streams: [] };
        }
    });

    return builder;
};

export const getStremioRouter = (builder: any) => {
    return getRouter(builder.getInterface());
};