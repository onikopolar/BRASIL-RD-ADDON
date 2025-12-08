import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from '../services/StreamHandler';
import { Logger } from '../utils/logger';
import { StreamRequest } from '../types';

const logger = new Logger('StreamHandlerBuilder');

// Version: 3.1.0 - FIX: Consolidação da busca da API Key para compatibilidade Web/Mobile
export const createStremioBuilder = (manifest: any) => {
    const builder = new addonBuilder(manifest as any);
    
    logger.info('StreamHandlerBuilder v3.1.0 iniciado - Fix compatibilidade Web/Mobile');

    // Handler principal
    builder.defineStreamHandler(async (args: any) => {
        const requestStartTime = Date.now();
        
        // DEBUG CRÍTICO: Log completo dos args recebidos
        logger.debug('DEBUG COMPLETO - Args recebidos:', {
            type: args.type,
            id: args.id,
            config: args.config || {},
            extra: args.extra || {},
            query: args.query || {},
            configKeys: args.config ? Object.keys(args.config) : [],
            extraKeys: args.extra ? Object.keys(args.extra) : [],
            queryKeys: args.query ? Object.keys(args.query) : []
        });

        // CONSOLIDAÇÃO DA API KEY: Busca em todas as fontes possíveis
        let apiKey = null;
        let authSource = 'none';

        // Sistema unificado de busca - ordem de prioridade
        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
            authSource = 'config.realdebrid';
        } else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
            authSource = 'config.apiKey';
        } else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
            authSource = 'extra.apiKey';
        } else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
            authSource = 'query.apiKey';
        } else if (args.config?.rd_key) {
            apiKey = args.config.rd_key;
            authSource = 'config.rd_key';
        } else if (args.extra?.rd_key) {
            apiKey = args.extra.rd_key;
            authSource = 'extra.rd_key';
        }

        // Log da fonte identificada
        if (apiKey) {
            const safeApiKey = apiKey.length > 8 
                ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
                : '***';
            
            logger.debug('API Key identificada:', {
                source: authSource,
                keyPreview: safeApiKey,
                configEnviado: !!args.config,
                extraEnviado: !!args.extra
            });
        } else {
            logger.warn('NENHUMA API Key encontrada em nenhuma fonte:', {
                configKeys: args.config ? Object.keys(args.config) : [],
                extraKeys: args.extra ? Object.keys(args.extra) : [],
                queryKeys: args.query ? Object.keys(args.query) : []
            });
        }

        // Validação da API Key
        if (!apiKey) {
            logger.error('FALHA DE AUTENTICAÇÃO: API Key não fornecida em nenhum formato conhecido');
            
            // Retorna array vazio sem mensagem de configuração
            return { streams: [] };
        }

        // Cria request para o StreamHandler
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
            },
            authSource: authSource
        };

        logger.debug('StreamRequest criado:', {
            type: streamRequest.type,
            id: streamRequest.id,
            authSource: streamRequest.authSource
        });

        try {
            // Processa a requisição
            const streamHandler = new StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;

            // Log dos resultados
            if (result.streams.length > 0) {
                logger.info('SUCESSO: Streams encontrados:', {
                    count: result.streams.length,
                    processingTime: `${processingTime}ms`,
                    type: args.type,
                    id: args.id,
                    authSource: authSource
                });
                
                // Debug adicional dos primeiros streams
                if (result.streams.length > 0) {
                    const sampleStreams = result.streams.slice(0, 2).map((s: any) => ({
                        title: s.title,
                        urlLength: s.url?.length || 0
                    }));
                    logger.debug('Amostra de streams:', sampleStreams);
                }
            } else {
                logger.warn('AVISO: Nenhum stream retornado:', {
                    processingTime: `${processingTime}ms`,
                    type: args.type,
                    id: args.id,
                    authSource: authSource
                });
            }

            return result;

        } catch (error) {
            const errorTime = Date.now() - requestStartTime;
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            const errorStack = error instanceof Error ? error.stack : '';

            logger.error('ERRO NO PROCESSAMENTO:', {
                error: errorMsg,
                type: args.type,
                id: args.id,
                processingTime: `${errorTime}ms`,
                authSource: authSource,
                stack: errorStack ? errorStack.substring(0, 200) : '' // Primeiros 200 chars do stack se existir
            });

            // Retorna array vazio em caso de erro
            return { streams: [] };
        }
    });

    return builder;
};

export const getStremioRouter = (builder: any) => {
    return getRouter(builder.getInterface());
};

// Log inicial do módulo
logger.info('StreamHandlerBuilder v3.1.0 carregado - Fix: Busca unificada de API Key para Web/Mobile/TV');