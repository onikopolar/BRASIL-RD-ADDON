import { addonBuilder, serveHTTP } from 'stremio-addon-sdk';
import { StreamHandler } from './services/StreamHandler';
import { Logger } from './utils/logger';
import { StreamRequest } from './types';

const logger = new Logger('Main');
const streamHandler = new StreamHandler();

// Manifest simplificado - QUALIDADE FIXA
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
        // REMOVIDA a opção de qualidade - AGORA É FIXO
    ]
};

const builder = new addonBuilder(manifest as any);

// Handler principal de streams OTIMIZADO - QUALIDADE FIXA
builder.defineStreamHandler(async (args: any) => {
    const requestStartTime = Date.now();
    
    const config = args.config;
    
    if (!config || !config.apiKey) {
        logger.warn('Requisição de stream sem API key configurada', {
            type: args.type,
            id: args.id
        });
        return { streams: [] };
    }

    // CONFIGURAÇÃO OTIMIZADA - QUALIDADE FIXA "Todas as Qualidades"
    const streamRequest: StreamRequest = {
        type: args.type as 'movie' | 'series',
        id: args.id,
        title: '',
        apiKey: config.apiKey,
        config: {
            quality: 'Todas as Qualidades', // FIXO - SEMPRE TODAS AS QUALIDADES
            maxResults: '15 streams', // FIXO 15 STREAMS
            language: 'pt-BR',
            // Configurações de otimização
            enableAggressiveSearch: true,
            minSeeders: 2,
            requireExactMatch: false,
            maxConcurrentTorrents: 8
        }
    };

    logger.info('Processando requisição de stream - TODAS QUALIDADES', {
        type: args.type,
        id: args.id,
        quality: 'Todas as Qualidades (FIXO)',
        apiKey: config.apiKey.substring(0, 8) + '...',
        maxStreams: 15
    });

    try {
        const result = await streamHandler.handleStreamRequest(streamRequest);
        
        const processingTime = Date.now() - requestStartTime;

        // Log detalhado dos resultados por qualidade
        const qualityBreakdown = result.streams.reduce((acc: any, stream) => {
            let quality = 'Unknown';
            if (stream.name?.includes('4K')) quality = '4K';
            else if (stream.name?.includes('1080')) quality = '1080p';
            else if (stream.name?.includes('720')) quality = '720p';
            else if (stream.name?.includes('480')) quality = '480p';
            else quality = 'SD';
            
            acc[quality] = (acc[quality] || 0) + 1;
            return acc;
        }, {});

        logger.info('Streams processados com sucesso - TODAS QUALIDADES', {
            requestId: args.id,
            streamsCount: result.streams.length,
            targetStreams: 15,
            processingTime: processingTime + 'ms',
            qualityDistribution: qualityBreakdown,
            qualitySummary: `4K: ${qualityBreakdown['4K'] || 0}, 1080p: ${qualityBreakdown['1080p'] || 0}, 720p: ${qualityBreakdown['720p'] || 0}, 480p: ${qualityBreakdown['480p'] || 0}, SD: ${qualityBreakdown['SD'] || 0}`
        });

        // Se encontrou poucos streams, adicionar log de warning
        if (result.streams.length < 5) {
            logger.warn('Poucos streams encontrados', {
                requestId: args.id,
                streamsFound: result.streams.length,
                targetStreams: 15,
                type: args.type,
                id: args.id,
                qualityDistribution: qualityBreakdown
            });
        }

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
    cacheMaxAge: 600
});

logger.info('Brasil RD Addon - CONFIGURAÇÃO FIXA', {
    port: port,
    configurable: true,
    environment: process.env.NODE_ENV || 'development',
    fixedSettings: {
        quality: 'Todas as Qualidades',
        maxStreams: 15,
        language: 'pt-BR',
        minSeeders: 2
    }
});

console.log('=== BRASIL RD ADDON - CONFIGURAÇÃO FIXA ===');
console.log(`Addon rodando: http://localhost:${port}/manifest.json`);
console.log(`Interface de config: http://localhost:${port}/configure`);
console.log('');
console.log('CONFIGURAÇÃO FIXA OTIMIZADA:');
console.log(' Todas as Qualidades (automático)');
console.log(' 15 streams por requisição');
console.log(' Busca agressiva por 4K, 1080p, 720p, 480p, SD');
console.log(' Mínimo de 2 seeders para mais opções');
console.log(' Processamento concorrente otimizado');
console.log('');
console.log('VANTAGENS:');
console.log('- Usuário sempre tem todas as opções de qualidade');
console.log('- StreamHandler organiza automaticamente por qualidade');
console.log('- Melhor experiência sem necessidade de configuração');
console.log('- Cobertura máxima de conteúdos disponíveis');
console.log('');
console.log('PLATAFORMAS SUPORTADAS:');
console.log('- Desktop (Windows, macOS, Linux)');
console.log('- Mobile (Android, iOS)');
console.log('- TV (Android TV, Smart TVs)');