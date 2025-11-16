import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import path from 'path';
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';
import configRouter from './routes/config';
import realdebridRouter from './routes/realdebrid';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Servidor Express para a interface web
const webApp = express();

// Middlewares para a interface web
webApp.use(cors({
    origin: [
        'https://app.strem.io',
        'https://web.stremio.com',
        'stremio://'
    ],
    methods: ['GET', 'POST', 'OPTIONS'],
    credentials: true
}));
webApp.use(express.json());
webApp.use(express.static(path.join(process.cwd(), 'public')));

// Rotas da API para a interface web
webApp.use('/api', configRouter);
webApp.use('/api/realdebrid', realdebridRouter);

// Rota principal para a UI
webApp.get('/', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/index.html'));
});

// Rota de saúde
webApp.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Rota do manifesto Stremio - IMPORTANTE: deve estar na mesma porta do addon
webApp.get('/manifest.json', (req, res) => {
    res.sendFile(path.join(process.cwd(), 'public/manifest.json'));
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
    
    // Porta principal para o addon Stremio (usada pelo Railway)
    const addonPort = parseInt(process.env.PORT || '8080');
    
    // Porta alternativa para a interface web (addonPort + 1)
    const webPort = addonPort + 1;

    try {
        logger.info('Iniciando servidores', {
            addonPort: addonPort,
            webPort: webPort
        });

        // Iniciar servidor da interface web na porta alternativa
        const webServer = webApp.listen(webPort, '0.0.0.0', () => {
            logger.info('Interface web iniciada com sucesso', { 
                port: webPort,
                uiUrl: `http://0.0.0.0:${webPort}`,
                manifestUrl: `https://brasil-rd-addon.up.railway.app/manifest.json`
            });
        });

        // Aguardar um pouco para garantir que a interface web esteja rodando
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Servir addon Stremio na porta principal (Railway)
        await serveHTTP(addonInterface, { 
            port: addonPort,
            cacheMaxAge: 0
        });

        logger.info('Addon Stremio iniciado com sucesso', {
            port: addonPort
        });

    } catch (error: any) {
        logger.error('Falha crítica ao iniciar servidores', {
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