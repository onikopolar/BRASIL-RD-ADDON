import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';
import configRouter from './routes/config';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();
const app = express();

// Middlewares
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Rotas da API de configuração
app.use('/api', configRouter);

// Rota principal para a UI
app.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Rota de saúde
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

// Handler de streams
builder.defineStreamHandler(async (args: any): Promise<{ streams: any[] }> => {
    const request: StreamRequest = {
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
    } catch (error) {
        logger.error('Stream handler error', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request
        });
        return { streams: [] };
    }
});

// Inicialização do servidor
async function main(): Promise<void> {
    const addonInterface = builder.getInterface();
    
    // Porta configurada para ambiente Railway
    const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;

    try {
        // Iniciar servidor Express
        const expressServer = app.listen(port, '0.0.0.0', () => {
            logger.info('Brasil RD Addon started successfully', { 
                port,
                uiUrl: `http://localhost:${port}`,
                manifestUrl: `http://localhost:${port}/manifest.json`
            });
        });

        // Configurar timeout para evitar conflitos de porta
        expressServer.setTimeout(30000);

        // Servir addon Stremio
        await serveHTTP(addonInterface, { 
            port,
            cacheMaxAge: 0
        });

    } catch (error) {
        if ((error as any).code === 'EADDRINUSE') {
            logger.error('Porta ja esta em uso', {
                port,
                error: 'Tente usar uma porta diferente ou aguarde a liberacao da porta atual'
            });
        } else {
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

export default builder.getInterface();