import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Manifest com configuração integrada do Stremio
const manifest = {
    id: 'org.brasilrd.addon',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte completo ao Real-Debrid',
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
            title: 'Chave API Real-Debrid (Obtenha ela aqui: https://real-debrid.com/apitoken',
            required: true,
            placeholder: 'Obtenha em: real-debrid.com/apitoken - Cole a chave aqui'
        }
    ]
};

const builder = new addonBuilder(manifest as any);

// Extender o tipo args para incluir config
builder.defineStreamHandler(async (args: any) => {
    const requestStartTime = Date.now();
    
    // Get configuration from args
    const config = args.config;
    
    if (!config || !config.apiKey) {
        logger.warn('Requisição de stream sem API key configurada do Real-Debrid');
        return { streams: [] };
    }

    const streamRequest: StreamRequest = {
        type: args.type as 'movie' | 'series',
        id: args.id,
        title: '',
        apiKey: config.apiKey,
        config: {
            quality: 'Todas as Qualidades',
            maxResults: '50 streams'
        }
    };

    logger.info('Processando requisição de stream', {
        type: args.type,
        id: args.id,
        apiKey: config.apiKey.substring(0, 8) + '...'
    });

    try {
        const result = await streamHandler.handleStreamRequest(streamRequest);
        
        const processingTime = Date.now() - requestStartTime;
        
        logger.info('Streams processados com sucesso', {
            requestId: args.id,
            streamsCount: result.streams.length,
            processingTime: processingTime + 'ms'
        });

        return result;
        
    } catch (error) {
        const errorTime = Date.now() - requestStartTime;
        
        logger.error('Falha no processamento de streams', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request: { type: args.type, id: args.id },
            processingTime: errorTime + 'ms'
        });
        
        return { streams: [] };
    }
});

const addonInterface = builder.getInterface();

const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;

serveHTTP(addonInterface, { 
    port: port,
    cacheMaxAge: 300
});

logger.info('Brasil RD Addon inicializado com configuração integrada', {
    port: port,
    configurable: true,
    environment: process.env.NODE_ENV || 'development'
});

console.log('=== BRASIL RD ADDON ===');
console.log(`Addon rodando: http://localhost:${port}/manifest.json`);
console.log('');
console.log('PARA INSTALAR NO STREMIO:');
console.log('1. Abra o Stremio');
console.log('2. Clique no ícone de addons (quebra-cabeça)');
console.log('3. Clique em "Community Addons"');
console.log('4. Cole a URL: http://localhost:' + port + '/manifest.json');
console.log('5. O Stremio mostrará a tela de configuração automaticamente');