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
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const logger = new logger_1.Logger('Main');
const streamHandler = new StreamHandler_1.StreamHandler();
// Criar app Express
const app = (0, express_1.default)();
// Middlewares
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public')));
// Rota principal para nossa UI personalizada
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(process.cwd(), 'public/index.html'));
});
// Rota de configuração personalizada
app.get('/configure', (req, res) => {
    res.sendFile(path_1.default.join(process.cwd(), 'public/index.html'));
});
// Builder do Addon Stremio
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
// Handler de streams
builder.defineStreamHandler(async (args) => {
    const apiKey = args.config?.apiKey;
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
        if (!apiKey) {
            logger.warn('Stream request sem API key');
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
// Obter a interface do addon e usar o router do SDK
const addonInterface = builder.getInterface();
const addonRouter = (0, stremio_addon_sdk_1.getRouter)(addonInterface);
app.use(addonRouter);
// Inicialização do servidor
async function main() {
    const port = parseInt(process.env.PORT || '8080');
    try {
        logger.info('Iniciando Brasil RD Addon com UI personalizada', { port });
        // Iniciar servidor Express
        app.listen(port, '0.0.0.0', () => {
            logger.info('Servidor iniciado com sucesso', {
                port,
                uiUrl: `http://0.0.0.0:${port}`,
                installUrl: `stremio://http://localhost:${port}/manifest.json`
            });
        });
    }
    catch (error) {
        logger.error('Falha crítica ao iniciar servidor', {
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