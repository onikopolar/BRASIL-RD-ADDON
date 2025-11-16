import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Criar app Express
const app = express();

// Middlewares
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Rota principal para nossa UI personalizada
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Rota de configuração personalizada
app.get('/configure', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Builder do Addon Stremio
const builder = new addonBuilder({
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
builder.defineStreamHandler(async (args: any): Promise<{ streams: any[] }> => {
    const apiKey = args.config?.apiKey;
    
    const request: StreamRequest = {
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
    } catch (error) {
        logger.error('Stream handler error', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request: { type: request.type, id: request.id }
        });
        return { streams: [] };
    }
});

// Obter a interface do addon e usar o router do SDK
const addonInterface = builder.getInterface();
const addonRouter = getRouter(addonInterface);
app.use(addonRouter);

// Inicialização do servidor
async function main(): Promise<void> {
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

    } catch (error: any) {
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

export default builder.getInterface();