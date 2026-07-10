"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStremioRouter = exports.createStremioBuilder = void 0;
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_js_1 = require("../services/StreamHandler.js");
const logger_js_1 = require("../utils/logger.js");
const logger = new logger_js_1.Logger('StreamHandlerBuilder');
const createStremioBuilder = (manifest) => {
    const builder = new stremio_addon_sdk_1.addonBuilder(manifest);
    builder.defineStreamHandler(async (args) => {
        const sdkLogger = new logger_js_1.Logger('SDK-STREAM');
        sdkLogger.info('═══════════════════════════════════════', {});
        sdkLogger.info(' STREMIO SDK chamou defineStreamHandler', {
            type: args.type,
            id: args.id,
            title: args.title,
            hasConfig: !!args.config,
            configKeys: args.config ? Object.keys(args.config) : [],
            hasExtra: !!args.extra,
            hasQuery: !!args.query,
            argsFull: {
                type: args.type,
                id: args.id,
                title: args.title?.substring(0, 80),
                config: args.config ? {
                    torbox: args.config.torbox ? '***PRESENT***' : undefined,
                    realdebrid: args.config.realdebrid ? '***PRESENT***' : undefined,
                    apiKey: args.config.apiKey ? '***PRESENT***' : undefined,
                    rd_key: args.config.rd_key ? '***PRESENT***' : undefined,
                    quality: args.config.quality,
                    language: args.config.language,
                } : 'NO CONFIG',
                extra: args.extra ? Object.keys(args.extra) : 'NO EXTRA',
            },
        });
        let apiKey = null;
        let apiKeySource = 'none';
        if (args.config?.torbox) {
            apiKey = args.config.torbox;
            apiKeySource = 'config.torbox';
        }
        else if (args.config?.realdebrid) {
            apiKey = args.config.realdebrid;
            apiKeySource = 'config.realdebrid';
        }
        else if (args.config?.apiKey) {
            apiKey = args.config.apiKey;
            apiKeySource = 'config.apiKey';
        }
        else if (args.extra?.apiKey) {
            apiKey = args.extra.apiKey;
            apiKeySource = 'extra.apiKey';
        }
        else if (args.query?.apiKey) {
            apiKey = args.query.apiKey;
            apiKeySource = 'query.apiKey';
        }
        else if (args.config?.rd_key) {
            apiKey = args.config.rd_key;
            apiKeySource = 'config.rd_key';
        }
        else if (args.extra?.rd_key) {
            apiKey = args.extra.rd_key;
            apiKeySource = 'extra.rd_key';
        }
        sdkLogger.info(' API Key source', {
            source: apiKeySource,
            found: !!apiKey,
            apiKeyLength: apiKey?.length || 0,
            apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        });
        if (!apiKey) {
            sdkLogger.warn(' NENHUMA API Key encontrada - retornando streams vazio', {
                reason: 'Usuário pode não ter configurado a API Key no Stremio',
                availableConfigKeys: args.config ? Object.keys(args.config) : [],
            });
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
            const streamHandler = StreamHandler_js_1.StreamHandler.getInstance();
            const result = await streamHandler.handleStreamRequest(streamRequest);
            sdkLogger.info(' SDK STREAM HANDLER retornou', {
                totalStreams: result.streams?.length || 0,
                streamPreviews: result.streams?.slice(0, 3).map((s) => ({
                    title: s.title?.substring(0, 50),
                    hasUrl: !!s.url,
                })),
            });
            return result;
        }
        catch (error) {
            sdkLogger.error(' ERRO FATAL no SDK StreamHandler', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
                type: streamRequest.type,
                id: streamRequest.id,
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
