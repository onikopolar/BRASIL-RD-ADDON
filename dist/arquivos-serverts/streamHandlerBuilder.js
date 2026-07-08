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
        let apiKey = null;
        if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
        }
        else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
        }
        else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
        }
        else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
        }
        else if (args.config?.rd_key) {
            apiKey = args.config.rd_key;
        }
        else if (args.extra?.rd_key) {
            apiKey = args.extra.rd_key;
        }
        if (!apiKey) {
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
            }
        };
        try {
            const streamHandler = StreamHandler_1.StreamHandler.getInstance();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            return result;
        }
        catch (error) {
            logger.error('Erro no processamento de streams', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
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
