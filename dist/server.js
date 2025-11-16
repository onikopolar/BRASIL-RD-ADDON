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
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const logger = new logger_1.Logger('Main');
const streamHandler = new StreamHandler_1.StreamHandler();
// Builder do Addon Stremio com sistema de configuração oficial do SDK
const builder = new stremio_addon_sdk_1.addonBuilder({
    id: 'com.brasil-rd',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon profissional brasileiro com Real-Debrid e magnet links curados',
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt'],
    // Sistema de configuração oficial do SDK
    behaviorHints: {
        configurable: true,
        configurationRequired: true
    },
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave API do Real-Debrid',
            required: 'true'
        }
    ]
});
// Handler de streams usando sistema de configuração oficial do SDK
builder.defineStreamHandler(async (args) => {
    const apiKey = args.config?.apiKey; // Configuração vinda do formulário do SDK
    const request = {
        type: args.type,
        id: args.id,
        title: args.name || args.title,
        apiKey: apiKey
    };
    logger.info('Received stream request', {
        type: args.type,
        id: args.id,
        hasApiKey: !!apiKey
    });
    try {
        // Se não tem API key, retorna vazio
        if (!apiKey) {
            logger.warn('Stream request sem API key - usuário precisa configurar o addon');
            return { streams: [] };
        }
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
            request: { type: request.type, id: request.id }
        });
        return { streams: [] };
    }
});
// Inicialização do servidor usando serveHTTP do SDK
async function main() {
    const port = parseInt(process.env.PORT || '8080');
    try {
        logger.info('Iniciando Brasil RD Addon com SDK oficial', { port });
        const addonInterface = builder.getInterface();
        // Usar serveHTTP do SDK que fornece instalação automática
        await (0, stremio_addon_sdk_1.serveHTTP)(addonInterface, {
            port: port,
            static: 'public', // Serve nossa pasta public como estática
            cacheMaxAge: 0 // Desativa cache para desenvolvimento
        });
        logger.info('Brasil RD Addon iniciado com sucesso usando SDK oficial', {
            port,
            installUrl: `stremio://http://localhost:${port}/manifest.json`
        });
    }
    catch (error) {
        logger.error('Falha crítica ao iniciar servidor com SDK', {
            error: error.message,
            code: error.code
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