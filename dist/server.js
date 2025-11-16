"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const path_1 = __importDefault(require("path"));
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const logger = new logger_1.Logger('Main');
const streamHandler = new StreamHandler_1.StreamHandler();
// Builder do Addon Stremio
const builder = new stremio_addon_sdk_1.addonBuilder({
    id: 'com.brasil-rd',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon profissional brasileiro com Real-Debrid e magnet links curados',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt']
});
// Handler de streams
builder.defineStreamHandler(async (args) => {
    const request = {
        type: args.type,
        id: args.id,
        title: args.name || args.title
    };
    logger.info('Received stream request', {
        type: args.type,
        id: args.id,
        fullArgs: JSON.stringify(args)
    });
    try {
        const result = await streamHandler.handleStreamRequest(request);
        logger.info('Stream response prepared', {
            requestId: request.id,
            streamsCount: result.streams.length
        });
        return result;
    }
    catch (error) {
        logger.error('Stream handler error', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request
        });
        return { streams: [] };
    }
});
// Inicialização do servidor
async function main() {
    const addonInterface = builder.getInterface();
    // NO Railway, use APENAS a PORT fornecida
    const port = parseInt(process.env.PORT || '8080');
    try {
        logger.info('Iniciando servidor Stremio no Railway', {
            port: port
        });
        // Servir addon Stremio com configuração para arquivos estáticos
        await (0, stremio_addon_sdk_1.serveHTTP)(addonInterface, {
            port: port,
            cacheMaxAge: 0,
            static: path_1.default.join(process.cwd(), 'public') // Serve arquivos estáticos
        });
        logger.info('Addon Stremio iniciado com sucesso no Railway', {
            port: port,
            uiUrl: `https://brasil-rd-addon.up.railway.app`,
            manifestUrl: `https://brasil-rd-addon.up.railway.app/manifest.json`
        });
    }
    catch (error) {
        logger.error('Falha crítica ao iniciar servidor no Railway', {
            error: error.message,
            code: error.code,
            port: port
        });
        process.exit(1);
    }
}
// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Encerrando Brasil RD Addon');
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.info('Encerrando Brasil RD Addon');
    process.exit(0);
});
// Iniciar aplicação
if (require.main === module) {
    main().catch(error => {
        logger.error('Erro fatal durante a inicializacao', error);
        process.exit(1);
    });
}
exports.default = builder.getInterface();
//# sourceMappingURL=server.js.map