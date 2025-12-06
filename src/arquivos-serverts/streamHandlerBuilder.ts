import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from '../services/StreamHandler';
import { Logger } from '../utils/logger';
import { StreamRequest } from '../types';

const logger = new Logger('StreamHandlerBuilder');

// Version: 3.0.0 - Fix mensagens localhost + otimização
export const createStremioBuilder = (manifest: any) => {
    const builder = new addonBuilder(manifest as any);
    
    logger.info('StreamHandlerBuilder v3.0.0 - Sistema Torrentio-style otimizado');

    // Handler principal
    builder.defineStreamHandler(async (args: any) => {
        const requestStartTime = Date.now();
        
        // Debug inicial
        logger.debug('DEBUG: Args recebidos', {
            type: args.type,
            id: args.id,
            configKeys: args.config ? Object.keys(args.config) : [],
            extraKeys: args.extra ? Object.keys(args.extra) : []
        });

        // Extrai API Key
        let apiKey = null;
        let authSource = 'none';

        // Fonte 1: Sistema Torrentio
        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
            authSource = 'torrentio-route';
            logger.debug('API Key via Torrentio-style', { source: authSource });
        }
        
        // Fonte 2: Stremio padrão
        else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
            authSource = 'stremio-config';
            logger.debug('API Key via config Stremio', { source: authSource });
        }
        
        // Fonte 3: Legacy
        else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
            authSource = 'legacy-extra';
            logger.debug('API Key via extra', { source: authSource });
        }
        
        // Fonte 4: Query teste
        else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
            authSource = 'test-query';
            logger.debug('API Key via query', { source: authSource });
        }

        // Validação API Key
        if (!apiKey) {
            // URL dinâmica baseada no ambiente
            const baseUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
                ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                : process.env.NODE_ENV === 'production' 
                    ? 'https://brasil-rd-addon.up.railway.app'
                    : 'http://localhost:7000';
            
            const stremioUrl = baseUrl.replace('https://', '').replace('http://', '');
            
            logger.warn('Falha autenticação', {
                type: args.type,
                id: args.id,
                reason: 'API Key não fornecida'
            });
            
            return { streams: [] };
        }

        // Log seguro
        const safeApiKey = apiKey.length > 8 
            ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
            : '***';
        
        logger.debug('Autenticação OK', {
            type: args.type,
            id: args.id,
            source: authSource,
            keyPreview: safeApiKey
        });

        // Cria request
        const streamRequest: StreamRequest = {
            type: args.type as 'movie' | 'series',
            id: args.id,
            title: '',
            apiKey: apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };

        logger.debug('Stream request criado', {
            type: streamRequest.type,
            id: streamRequest.id
        });

        try {
            // Processa
            const streamHandler = new StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;

            logger.info('Streams processados', {
                streamsCount: result.streams.length,
                processingTime: `${processingTime}ms`,
                authSource: authSource
            });

            // Log resultados
            if (result.streams.length > 0) {
                logger.debug('Streams disponíveis', {
                    count: result.streams.length
                });
            } else {
                logger.warn('Nenhum stream retornado', {
                    id: args.id
                });
            }

            return result;

        } catch (error) {
            const errorTime = Date.now() - requestStartTime;
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';

            logger.error('Erro processamento', {
                error: errorMsg,
                type: args.type,
                id: args.id,
                processingTime: `${errorTime}ms`
            });

            return { streams: [] };
        }
    });

    return builder;
};

export const getStremioRouter = (builder: any) => {
    return getRouter(builder.getInterface());
};

// Log inicial
logger.info('StreamHandlerBuilder v3.0.0 pronto - Fix mensagens localhost');