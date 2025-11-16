import * as dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

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
    
    // NO Railway, use APENAS a PORT fornecida
    const port = parseInt(process.env.PORT || '8080');

    try {
        logger.info('Iniciando servidor Stremio no Railway', {
            port: port
        });

        // Servir addon Stremio com configuração para arquivos estáticos
        await serveHTTP(addonInterface, { 
            port: port,
            cacheMaxAge: 0,
            static: path.join(process.cwd(), 'public')  // Serve arquivos estáticos
        });

        logger.info('Addon Stremio iniciado com sucesso no Railway', {
            port: port,
            uiUrl: `https://brasil-rd-addon.up.railway.app`,
            manifestUrl: `https://brasil-rd-addon.up.railway.app/manifest.json`
        });

    } catch (error: any) {
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

export default builder.getInterface();