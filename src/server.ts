import * as dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import path from 'path';
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';
import configRouter from './routes/config';
import realdebridRouter from './routes/realdebrid';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();
const app = express();

// Middlewares
app.use(express.json());
app.use(express.static(path.join(process.cwd(), 'public')));

// Rotas da API
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
        await serveHTTP(addonInterface, { 
            port: stremioPort,
            cacheMaxAge: 0
        });

        logger.info('Addon Stremio iniciado com sucesso', {
            stremioPort: stremioPort
        });

    } catch (error) {
        if ((error as any).code === 'EADDRINUSE') {
            logger.error('Porta ja esta em uso', {
                port: (error as any).port,
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