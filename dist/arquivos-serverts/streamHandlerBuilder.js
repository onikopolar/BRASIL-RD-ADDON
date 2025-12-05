"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStremioRouter = exports.createStremioBuilder = void 0;
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("../services/StreamHandler");
const logger_1 = require("../utils/logger");
const logger = new logger_1.Logger('StreamHandlerBuilder');
const createStremioBuilder = (manifest) => {
    const builder = new stremio_addon_sdk_1.addonBuilder(manifest);
    builder.defineStreamHandler(async (args) => {
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
        const streamRequest = {
            type: args.type,
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
            const streamHandler = new StreamHandler_1.StreamHandler();
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
        }
        catch (error) {
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
exports.createStremioBuilder = createStremioBuilder;
const getStremioRouter = (builder) => {
    return (0, stremio_addon_sdk_1.getRouter)(builder.getInterface());
};
exports.getStremioRouter = getStremioRouter;
