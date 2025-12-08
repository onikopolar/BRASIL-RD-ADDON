"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStremioRouter = exports.createStremioBuilder = void 0;
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("../services/StreamHandler");
const logger_1 = require("../utils/logger");
const logger = new logger_1.Logger('StreamHandlerBuilder');
const createStremioBuilder = (manifest) => {
    const builder = new stremio_addon_sdk_1.addonBuilder(manifest);
    logger.info('StreamHandlerBuilder v3.1.0 iniciado - Fix compatibilidade Web/Mobile');
    builder.defineStreamHandler(async (args) => {
        const requestStartTime = Date.now();
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
        let apiKey = null;
        let authSource = 'none';
        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
            authSource = 'config.realdebrid';
        }
        else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
            authSource = 'config.apiKey';
        }
        else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
            authSource = 'extra.apiKey';
        }
        else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
            authSource = 'query.apiKey';
        }
        else if (args.config?.rd_key) {
            apiKey = args.config.rd_key;
            authSource = 'config.rd_key';
        }
        else if (args.extra?.rd_key) {
            apiKey = args.extra.rd_key;
            authSource = 'extra.rd_key';
        }
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
        }
        else {
            logger.warn('NENHUMA API Key encontrada em nenhuma fonte:', {
                configKeys: args.config ? Object.keys(args.config) : [],
                extraKeys: args.extra ? Object.keys(args.extra) : [],
                queryKeys: args.query ? Object.keys(args.query) : []
            });
        }
        if (!apiKey) {
            logger.error('FALHA DE AUTENTICAÇÃO: API Key não fornecida em nenhum formato conhecido');
            return { streams: [] };
        }
        const streamRequest = {
            type: args.type,
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
            const streamHandler = new StreamHandler_1.StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;
            if (result.streams.length > 0) {
                logger.info('SUCESSO: Streams encontrados:', {
                    count: result.streams.length,
                    processingTime: `${processingTime}ms`,
                    type: args.type,
                    id: args.id,
                    authSource: authSource
                });
                if (result.streams.length > 0) {
                    const sampleStreams = result.streams.slice(0, 2).map((s) => ({
                        title: s.title,
                        urlLength: s.url?.length || 0
                    }));
                    logger.debug('Amostra de streams:', sampleStreams);
                }
            }
            else {
                logger.warn('AVISO: Nenhum stream retornado:', {
                    processingTime: `${processingTime}ms`,
                    type: args.type,
                    id: args.id,
                    authSource: authSource
                });
            }
            return result;
        }
        catch (error) {
            const errorTime = Date.now() - requestStartTime;
            const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
            const errorStack = error instanceof Error ? error.stack : '';
            logger.error('ERRO NO PROCESSAMENTO:', {
                error: errorMsg,
                type: args.type,
                id: args.id,
                processingTime: `${errorTime}ms`,
                authSource: authSource,
                stack: errorStack ? errorStack.substring(0, 200) : ''
            });
            return { streams: [] };
        }
    });
    return builder;
};
exports.createStremioBuilder = createStremioBuilder;
const getStremioRouter = (builder) => {
    return (0, stremio_addon_sdk_1.getRouter)(builder.getInterface());
};
exports.getStremioRouter = getStremioRouter;
logger.info('StreamHandlerBuilder v3.1.0 carregado - Fix: Busca unificada de API Key para Web/Mobile/TV');
