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
            logger.warn('Requisição de stream sem API key configurada', {
                type: args.type,
                id: args.id
            });
            return { streams: [] };
        }
        logger.info('DEBUG - Formato do ID recebido', {
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
        logger.info('DEBUG - Formato do ID para séries', {
            type: args.type,
            id: args.id,
            isSeries: args.type === 'series',
            hasSeasonEpisodeFormat: args.type === 'series' && /tt\d+:\d+:\d+/.test(args.id),
            colonCount: (args.id.match(/:/g) || []).length
        });
        try {
            const streamHandler = new StreamHandler_1.StreamHandler();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            const processingTime = Date.now() - requestStartTime;
            logger.info('Streams processados com sucesso', {
                requestId: args.id,
                streamsCount: result.streams.length,
                processingTime: processingTime + 'ms',
            });
            if (result.streams.length > 0) {
                logger.debug('Nomes dos streams encontrados', {
                    streamNames: result.streams.map(s => s.name)
                });
            }
            if (result.streams.length < 5) {
                logger.warn('Poucos streams encontrados', {
                    requestId: args.id,
                    streamsFound: result.streams.length,
                    type: args.type,
                    id: args.id
                });
            }
            logger.info("DEBUG - Streams sendo retornados para o cliente:", {
                requestId: args.id,
                streamCount: result.streams.length,
                streamTitles: result.streams.map(s => s.title),
                streamSources: result.streams.map(s => s.sources),
                streamNames: result.streams.map(s => s.name)
            });
            return result;
        }
        catch (error) {
            const errorTime = Date.now() - requestStartTime;
            logger.error('Falha no processamento de streams', {
                error: error instanceof Error ? error.message : 'Unknown error',
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
