"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStremioRouter = exports.createStremioBuilder = void 0;
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("../services/StreamHandler");
const logger_1 = require("../utils/logger");
const logger = new logger_1.Logger('StreamHandlerBuilder');
const createStremioBuilder = (manifest) => {
    const builder = new stremio_addon_sdk_1.addonBuilder(manifest);
    logger.info('StreamHandlerBuilder v2.3.0 - Sistema Torrentio-style');
    builder.defineStreamHandler(async (args) => {
        const requestStartTime = Date.now();
        logger.debug('Request recebido', {
            type: args.type,
            id: args.id,
            hasConfig: !!args.config,
            hasExtra: !!args.extra
        });
        let apiKey = null;
        let authSource = 'none';
        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
            authSource = 'torrentio-route';
            logger.debug('API Key encontrada via rota Torrentio-style', { source: authSource });
        }
        else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
            authSource = 'stremio-config';
            logger.debug('API Key encontrada via config Stremio', { source: authSource });
        }
        else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
            authSource = 'legacy-extra';
            logger.debug('API Key encontrada via extra (legacy)', { source: authSource });
        }
        else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
            authSource = 'test-query';
            logger.debug('API Key via query parameter (teste)', { source: authSource });
        }
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
        const safeApiKey = apiKey.length > 8
            ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
            : '***';
        logger.debug('Autenticação OK', {
            type: args.type,
            id: args.id,
            source: authSource,
            keyPreview: safeApiKey
        });
        const streamRequest = {
            type: args.type,
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
            const streamHandler = new StreamHandler_1.StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;
            logger.info('Streams processados', {
                requestId: args.id,
                streamsCount: result.streams.length,
                processingTime: `${processingTime}ms`,
                authSource: authSource
            });
            if (result.streams.length > 0) {
                logger.debug('Streams disponíveis', {
                    count: result.streams.length,
                    samples: result.streams.slice(0, 2).map(s => s.name)
                });
            }
            else {
                logger.warn('Nenhum stream retornado', {
                    requestId: args.id,
                    type: args.type
                });
            }
            return result;
        }
        catch (error) {
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
exports.createStremioBuilder = createStremioBuilder;
const getStremioRouter = (builder) => {
    return (0, stremio_addon_sdk_1.getRouter)(builder.getInterface());
};
exports.getStremioRouter = getStremioRouter;
logger.info('StreamHandlerBuilder v2.3.0 pronto - Sistema Torrentio-style ativo');
