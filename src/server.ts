import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { addonBuilder, getRouter } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';
import configRouter from './routes/config';
import realdebridRouter from './routes/realdebrid';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Criar app Express
const app = express();

// Middlewares
app.use(cors({
    origin: [
        'https://app.strem.io',
        'https://web.stremio.com',
        'stremio://'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Rotas da API para configuração (mantemos para validação)
app.use('/api', configRouter);
app.use('/api/realdebrid', realdebridRouter);

// Rota principal para a UI
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Rota de saúde
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rota dinâmica do manifesto que aceita parâmetros
app.get('/manifest.json', (req, res) => {
    const { apiKey } = req.query;
    
    const manifest = {
        id: 'com.brasil-rd',
        version: '1.0.0',
        name: 'Brasil RD',
        description: 'Addon profissional brasileiro com Real-Debrid e magnet links curados',
        logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
        resources: ['stream'],
        types: ['movie', 'series'],
        catalogs: [],
        idPrefixes: ['tt'],
        // Adiciona comportamento configurável
        behaviorHints: {
            configurable: true,
            configurationRequired: !apiKey // Requer configuração se não tiver API key
        }
    };

    logger.info('Manifesto servido', { 
        hasApiKey: !!apiKey,
        clientIp: req.ip
    });

    res.json(manifest);
});

// Builder do Addon Stremio
const builder = new addonBuilder({
    id: 'com.brasil-rd',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon profissional brasileiro com Real-Debrid e magnet links curados',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt']
});

// Handler de streams DINÂMICO - usa API key da query string
builder.defineStreamHandler(async (args: any): Promise<{ streams: any[] }> => {
    const { apiKey } = args.config || {};
    
    const request: StreamRequest = {
        type: args.type,
        id: args.id,
        title: args.name || args.title,
        apiKey: apiKey // Passa a API key para o stream handler
    };

    logger.info('Received stream request', { 
        type: args.type, 
        id: args.id,
        hasApiKey: !!apiKey
    });

    try {
        // Se não tem API key, retorna vazio
        if (!apiKey) {
            logger.warn('Stream request sem API key');
            return { streams: [] };
        }

        const result = await streamHandler.handleStreamRequest(request);
        logger.info('Stream response prepared', {
            requestId: request.id,
            streamsCount: result.streams.length,
            hasApiKey: true
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

// Obter a interface do addon
const addonInterface = builder.getInterface();

// Usar o router do Stremio SDK para as rotas do addon
const addonRouter = getRouter(addonInterface);
app.use(addonRouter);

// Inicialização do servidor
async function main(): Promise<void> {
    const port = parseInt(process.env.PORT || '8080');

    try {
        logger.info('Iniciando servidor Brasil RD', { port });

        // Iniciar servidor Express
        app.listen(port, '0.0.0.0', () => {
            logger.info('Servidor iniciado com sucesso', { 
                port,
                uiUrl: `http://0.0.0.0:${port}`,
                manifestUrl: `https://brasil-rd-addon.up.railway.app/manifest.json`
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