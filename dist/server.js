"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const logger = new logger_1.Logger('Main');
const streamHandler = new StreamHandler_1.StreamHandler();
const manifest = {
    id: 'org.brasilrd.addon',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte completo ao Real-Debrid',
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',
    resources: ['stream'],
    types: ['movie', 'series'],
    catalogs: [],
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb'],
    behaviorHints: {
        configurable: true,
        configurationRequired: true,
        adult: false,
        p2p: true
    },
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Configuração Real-Debrid - Obtenha sua chave API (real-debrid.com/apitoken)',
            required: true,
            placeholder: 'Site: real-debrid.com/apitoken - Cole a chave aqui'
        }
    ]
};
const builder = new stremio_addon_sdk_1.addonBuilder(manifest);
builder.defineStreamHandler(async (args) => {
    const requestStartTime = Date.now();
    const config = args.config;
    if (!config || !config.apiKey) {
        logger.warn('Requisição de stream sem API key configurada', {
            type: args.type,
            id: args.id
        });
        return { streams: [] };
    }
    const streamRequest = {
        type: args.type,
        id: args.id,
        title: '',
        apiKey: config.apiKey,
        config: {
            quality: 'Todas as Qualidades',
            maxResults: '15 streams',
            language: 'pt-BR',
            enableAggressiveSearch: true,
            minSeeders: 2,
            requireExactMatch: false,
            maxConcurrentTorrents: 8
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
            processingTime: processingTime + 'ms',
        });
        if (result.streams.length > 0) {
            logger.debug('Nomes dos streams encontrados', {
                streamNames: result.streams.map(s => s.name)
            });
        }
        if (result.streams.length < 5) {
            logger.warn('Poucos streams encontrados', {
                requestId: args.id,
                streamsFound: result.streams.length,
                type: args.type,
                id: args.id
            });
        }
        return result;
    }
    catch (error) {
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
(0, stremio_addon_sdk_1.serveHTTP)(addonInterface, {
    port: port,
    cacheMaxAge: 600
});
logger.info('Brasil RD Addon iniciado', {
    port: port,
    configurable: true,
    environment: process.env.NODE_ENV || 'development'
});
console.log('=== BRASIL RD ADDON ===');
console.log(`Addon rodando: http://localhost:${port}/manifest.json`);
console.log(`Interface de config: http://localhost:${port}/configure`);
console.log('');
console.log('CONFIGURAÇÃO:');
console.log('- 15 streams por requisição');
console.log('- Todas as qualidades automaticamente');
console.log('- Busca otimizada por conteúdo');
console.log('');
console.log('PLATAFORMAS SUPORTADAS:');
console.log('- Desktop (Windows, macOS, Linux)');
console.log('- Mobile (Android, iOS)');
console.log('- TV (Android TV, Smart TVs)');
