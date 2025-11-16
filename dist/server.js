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
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const config_1 = __importDefault(require("./routes/config"));
const realdebrid_1 = __importDefault(require("./routes/realdebrid"));
const logger = new logger_1.Logger('Main');
const streamHandler = new StreamHandler_1.StreamHandler();
const app = (0, express_1.default)();
// Middlewares
app.use((0, cors_1.default)({
    origin: [
        'https://app.strem.io',
        'https://web.stremio.com',
        'stremio://'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));
app.use(express_1.default.json());
app.use(express_1.default.static(path_1.default.join(process.cwd(), 'public')));
// Rotas da API
app.use('/api', config_1.default);
app.use('/api/realdebrid', realdebrid_1.default);
// Rota principal para a UI
app.get('/', (req, res) => {
    res.sendFile(path_1.default.join(process.cwd(), 'public/index.html'));
});
// Rota de saúde
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// Rota do manifesto Stremio
app.get('/manifest.json', (req, res) => {
    res.sendFile(path_1.default.join(process.cwd(), 'public/manifest.json'));
});
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
    // Portas diferentes para Express e Stremio SDK
    const webPort = process.env.PORT ? parseInt(process.env.PORT) : 8080;
    const stremioPort = webPort + 1;
    try {
        logger.info('Iniciando servidores', {
            webPort: webPort,
            stremioPort: stremioPort
        });
        // Iniciar servidor Express primeiro
        const expressServer = app.listen(webPort, '0.0.0.0', () => {
            logger.info('Servidor web iniciado com sucesso', {
                port: webPort,
                uiUrl: `http://localhost:${webPort}`,
                manifestUrl: `http://localhost:${webPort}/manifest.json`
            });
        });
        // Aguardar um pouco para garantir que o Express esteja rodando
        await new Promise(resolve => setTimeout(resolve, 1000));
        // Servir addon Stremio em porta diferente
        await (0, stremio_addon_sdk_1.serveHTTP)(addonInterface, {
            port: stremioPort,
            cacheMaxAge: 0
        });
        logger.info('Addon Stremio iniciado com sucesso', {
            stremioPort: stremioPort
        });
    }
    catch (error) {
        if (error.code === 'EADDRINUSE') {
            logger.error('Porta ja esta em uso', {
                port: error.port,
                error: 'Tente usar uma porta diferente'
            });
            // Tentar com portas alternativas
            const alternativePort = 3000;
            logger.info('Tentando porta alternativa', { port: alternativePort });
            const expressServer = app.listen(alternativePort, '0.0.0.0', () => {
                logger.info('Servidor web iniciado na porta alternativa', {
                    port: alternativePort
                });
            });
        }
        else {
            logger.error('Falha ao iniciar addon', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
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