import * as dotenv from 'dotenv';
dotenv.config();

import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types/index';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Builder do Addon Stremio com sistema de configuração oficial do SDK
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
builder.defineStreamHandler(async (args: any): Promise<{ streams: any[] }> => {
    const apiKey = args.config?.apiKey; // Configuração vinda do formulário do SDK
    
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
    } catch (error) {
        logger.error('Stream handler error', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request: { type: request.type, id: request.id }
        });
        return { streams: [] };
    }
});

// Inicialização do servidor usando serveHTTP do SDK
async function main(): Promise<void> {
    const port = parseInt(process.env.PORT || '8080');

    try {
        logger.info('Iniciando Brasil RD Addon com SDK oficial', { port });

        const addonInterface = builder.getInterface();

        // Usar serveHTTP do SDK que fornece instalação automática
        await serveHTTP(addonInterface, { 
            port: port,
            static: 'public', // Serve nossa pasta public como estática
            cacheMaxAge: 0 // Desativa cache para desenvolvimento
        });

        logger.info('Brasil RD Addon iniciado com sucesso usando SDK oficial', {
            port,
            installUrl: `stremio://http://localhost:${port}/manifest.json`
        });

    } catch (error: any) {
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

export default builder.getInterface();