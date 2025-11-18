"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const stremio_addon_sdk_1 = require("stremio-addon-sdk");
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const logger = new logger_1.Logger('Main');
const streamHandler = new StreamHandler_1.StreamHandler();
// Manifest ADAPTADO - Estratégia de texto avançada
const manifest = {
    id: 'org.brasilrd.addon',
    version: '1.0.0',
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte completo ao Real-Debrid - Obtenha sua chave API em: real-debrid.com/apitoken',
    // Elementos visuais otimizados para mobile/TV
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',
    // Resources focados no essencial - APENAS streams
    resources: ['stream'],
    types: ['movie', 'series'],
    // SEM catalogs - foco total em streams
    catalogs: [],
    // Suporte amplo a identificadores
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb'],
    // Behavior hints otimizados
    behaviorHints: {
        configurable: true,
        configurationRequired: true,
        adult: false,
        p2p: true
    },
    // CONFIGURAÇÃO ADAPTADA - Estratégia de texto avançada
    config: [
        {
            key: 'apiKey',
            type: 'text',
            // ESTRATÉGIA: Texto que simula link visualmente
            title: 'Configuração Real-Debrid - Obtenha sua chave API (real-debrid.com/apitoken)',
            required: true,
            placeholder: 'Site: real-debrid.com/apitoken - Cole a chave aqui'
        },
        {
            key: 'videoQuality',
            type: 'select',
            title: 'Qualidade de Vídeo Preferida',
            required: false,
            options: ['Todas as Qualidades', '4K Ultra HD', '1080p Full HD', '720p HD'],
            default: 'Todas as Qualidades'
        }
    ]
};
const builder = new stremio_addon_sdk_1.addonBuilder(manifest);
// Handler principal de streams - MANTIDO ORIGINAL
builder.defineStreamHandler(async (args) => {
    const requestStartTime = Date.now();
    // Validação robusta de configuração
    const config = args.config;
    if (!config || !config.apiKey) {
        logger.warn('Requisição de stream sem API key configurada', {
            type: args.type,
            id: args.id,
            platform: 'multi-platform'
        });
        return { streams: [] };
    }
    const streamRequest = {
        type: args.type,
        id: args.id,
        title: '',
        apiKey: config.apiKey,
        config: {
            quality: config.videoQuality || 'Todas as Qualidades',
            maxResults: '3 streams',
            language: 'pt-BR'
        }
    };
    logger.info('Processando requisição de stream', {
        type: args.type,
        id: args.id,
        platform: 'multi-platform',
        apiKey: config.apiKey.substring(0, 8) + '...',
        quality: config.videoQuality || 'Todas as Qualidades'
    });
    try {
        const result = await streamHandler.handleStreamRequest(streamRequest);
        const processingTime = Date.now() - requestStartTime;
        logger.info('Streams processados com sucesso', {
            requestId: args.id,
            streamsCount: result.streams.length,
            processingTime: processingTime + 'ms',
            platform: 'multi-platform',
            qualityPreference: config.videoQuality || 'Todas as Qualidades'
        });
        return result;
    }
    catch (error) {
        const errorTime = Date.now() - requestStartTime;
        logger.error('Falha no processamento de streams', {
            error: error instanceof Error ? error.message : 'Unknown error',
            request: { type: args.type, id: args.id },
            processingTime: errorTime + 'ms',
            platform: 'multi-platform'
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
logger.info('Brasil RD Addon - Texto Adaptado', {
    port: port,
    configurable: true,
    environment: process.env.NODE_ENV || 'development',
    platforms: ['desktop', 'mobile', 'tv']
});
console.log('=== BRASIL RD ADDON - TEXTO ADAPTADO ===');
console.log(`Addon rodando: http://localhost:${port}/manifest.json`);
console.log('');
console.log('ESTRATÉGIA DE TEXTO IMPLEMENTADA:');
console.log('1. Title: "Configuração Real-Debrid - Obtenha sua chave API (real-debrid.com/apitoken)"');
console.log('2. Description: "Obtenha sua chave API em: real-debrid.com/apitoken"');
console.log('3. Placeholder: "Site: real-debrid.com/apitoken - Cole a chave aqui"');
console.log('');
console.log('VISUALIZAÇÃO SIMULADA:');
console.log('Configuração Real-Debrid - Obtenha sua chave API (real-debrid.com/apitoken)');
console.log('[ Site: real-debrid.com/apitoken - Cole a chave aqui ________ ]');
console.log('');
console.log('PLATAFORMAS SUPORTADAS:');
console.log('- Desktop (Windows, macOS, Linux)');
console.log('- Mobile (Android, iOS)');
console.log('- TV (Android TV, Smart TVs)');
//# sourceMappingURL=server.js.map