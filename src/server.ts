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

// Rota do manifesto Stremio
app.get('/manifest.json', (req, res) => {
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
    
    // Porta base - Railway define a PORT, senão usa 7000
    const basePort = process.env.PORT ? parseInt(process.env.PORT) : 7000;

    try {
        logger.info('Iniciando servidor unificado', {
            port: basePort
        });

        // Iniciar servidor Express primeiro
        const expressServer = app.listen(basePort, '0.0.0.0', () => {
            logger.info('Servidor web iniciado com sucesso', { 
                port: basePort,
                uiUrl: `http://localhost:${basePort}`,
                manifestUrl: `http://localhost:${basePort}/manifest.json`
            });
        });

        // Aguardar um pouco para garantir que o Express esteja rodando
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Servir addon Stremio na MESMA porta usando o mesmo servidor
        await serveHTTP(addonInterface, { 
            port: basePort,
            cacheMaxAge: 0
        });

        logger.info('Addon Stremio integrado com sucesso', {
            port: basePort
        });

    } catch (error: any) {
        if (error.code === 'EADDRINUSE') {
            logger.error('Porta principal esta em uso', {
                port: basePort,
                error: 'Tentando portas alternativas'
            });
            
            // Tentar com portas alternativas sequenciais
            let alternativePort = basePort + 1;
            let maxAttempts = 10;
            let serverStarted = false;
            
            while (maxAttempts > 0 && !serverStarted) {
                try {
                    logger.info('Tentando porta alternativa', { port: alternativePort });
                    
                    // Iniciar servidor Express na porta alternativa
                    const expressServer = app.listen(alternativePort, '0.0.0.0', () => {
                        logger.info('Servidor web iniciado na porta alternativa', { 
                            port: alternativePort,
                            uiUrl: `http://localhost:${alternativePort}`,
                            manifestUrl: `http://localhost:${alternativePort}/manifest.json`
                        });
                    });

                    // Aguardar um pouco para garantir que o Express esteja rodando
                    await new Promise(resolve => setTimeout(resolve, 1000));

                    // Servir addon Stremio na mesma porta alternativa
                    await serveHTTP(addonInterface, { 
                        port: alternativePort,
                        cacheMaxAge: 0
                    });

                    logger.info('Addon Stremio integrado com sucesso na porta alternativa', {
                        port: alternativePort
                    });

                    serverStarted = true;
                    
                } catch (altError: any) {
                    if (altError.code === 'EADDRINUSE') {
                        logger.warn('Porta alternativa também está em uso', {
                            port: alternativePort
                        });
                        alternativePort++;
                        maxAttempts--;
                    } else {
                        logger.error('Erro inesperado ao tentar porta alternativa', {
                            port: alternativePort,
                            error: altError.message
                        });
                        throw altError;
                    }
                }
            }
            
            if (!serverStarted) {
                logger.error('Todas as portas alternativas estao em uso. Nenhuma porta disponivel.');
                process.exit(1);
            }
            
        } else {
            logger.error('Falha ao iniciar addon', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            process.exit(1);
        }
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