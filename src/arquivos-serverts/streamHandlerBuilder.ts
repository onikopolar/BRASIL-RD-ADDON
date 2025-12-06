import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from '../services/StreamHandler';
import { Logger } from '../utils/logger';
import { StreamRequest } from '../types';

const logger = new Logger('StreamHandlerBuilder');

// Version: 2.3.0 - Suporte a sistema Torrentio (realdebrid=API_KEY na URL)
export const createStremioBuilder = (manifest: any) => {
    const builder = new addonBuilder(manifest as any);
    
    logger.info('StreamHandlerBuilder v2.3.0 - Sistema Torrentio-style');

    // Handler principal de streams
    builder.defineStreamHandler(async (args: any) => {
        const requestStartTime = Date.now();
        
        // Log completo para debug
        logger.debug('Request recebido', {
            type: args.type,
            id: args.id,
            hasConfig: !!args.config,
            hasExtra: !!args.extra
        });

        // SISTEMA TORRENTIO-STYLE: Extrai API Key de múltiplas fontes
        let apiKey = null;
        let authSource = 'none';

        // FONTE 1: Sistema Torrentio (realdebrid=API_KEY na rota)
        // Quando addon é instalado via: stremio://host/realdebrid=API_KEY/manifest.json
        // O Stremio SDK converte para args.config.realdebrid
        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
            authSource = 'torrentio-route';
            logger.debug('API Key encontrada via rota Torrentio-style', { source: authSource });
        }
        
        // FONTE 2: Sistema padrão Stremio (apiKey no config)
        else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
            authSource = 'stremio-config';
            logger.debug('API Key encontrada via config Stremio', { source: authSource });
        }
        
        // FONTE 3: Sistema antigo (extra)
        else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
            authSource = 'legacy-extra';
            logger.debug('API Key encontrada via extra (legacy)', { source: authSource });
        }
        
        // FONTE 4: Query parameter para testes
        else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
            authSource = 'test-query';
            logger.debug('API Key via query parameter (teste)', { source: authSource });
        }

        // VALIDAÇÃO: Se não encontrou API Key
        if (!apiKey) {
            logger.warn('Falha de autenticação', {
                type: args.type,
                id: args.id,
                reason: 'API Key não fornecida',
                suggestions: [
                    'Use: stremio://localhost:7000/realdebrid=SUA_API_KEY/manifest.json',
                    'Configure via: http://localhost:7000/configure'
                ]
            });
            return { streams: [] };
        }

        // Log seguro da API Key
        const safeApiKey = apiKey.length > 8 
            ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
            : '***';
        
        logger.debug('Autenticação OK', {
            type: args.type,
            id: args.id,
            source: authSource,
            keyPreview: safeApiKey
        });

        // Cria requisição de stream
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
            // Processa a requisição
            const streamHandler = new StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;

            logger.info('Streams processados', {
                requestId: args.id,
                streamsCount: result.streams.length,
                processingTime: `${processingTime}ms`,
                authSource: authSource
            });

            // Log de resultados
            if (result.streams.length > 0) {
                logger.debug('Streams disponíveis', {
                    count: result.streams.length,
                    samples: result.streams.slice(0, 2).map(s => s.name)
                });
            } else {
                logger.warn('Nenhum stream retornado', {
                    requestId: args.id,
                    type: args.type
                });
            }

            return result;

        } catch (error) {
            const errorTime = Date.now() - requestStartTime;
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';

            logger.error('Erro no processamento', {
                error: errorMsg,
                request: { type: args.type, id: args.id },
                authSource: authSource,
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
logger.info('StreamHandlerBuilder v2.3.0 pronto - Sistema Torrentio-style ativo');