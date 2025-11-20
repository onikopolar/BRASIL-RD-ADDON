"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const StreamHandler_1 = require("./services/StreamHandler");
const logger_1 = require("./utils/logger");
const http = __importStar(require("http"));
const url = __importStar(require("url"));
const logger = new logger_1.Logger('LazyLoadingServer');
const streamHandler = new StreamHandler_1.StreamHandler();
const port = 7002;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || '', true);
    const pathname = parsedUrl.pathname || '';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    try {
        if (pathname.startsWith('/lazy-load/')) {
            await handleLazyLoadingRequest(req, res);
            return;
        }
        else if (pathname.startsWith('/debug/magnets/')) {
            await handleDebugRequest(req, res);
            return;
        }
        else if (pathname.startsWith('/stats')) {
            await handleStatsRequest(req, res);
            return;
        }
        else if (pathname.startsWith('/clear-cache')) {
            await handleClearCacheRequest(req, res);
            return;
        }
        else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
                message: 'Servidor Lazy Loading - Brasil RD',
                version: '1.0.0',
                port: port,
                endpoints: {
                    lazyLoading: '/lazy-load/{requestId}/{magnetHash}',
                    debug: '/debug/magnets/{requestId}',
                    stats: '/stats',
                    clearCache: '/clear-cache'
                }
            }));
        }
    }
    catch (error) {
        logger.error('Erro no servidor lazy loading', {
            error: error instanceof Error ? error.message : 'Unknown error',
            url: req.url
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
    }
});
async function handleLazyLoadingRequest(req, res) {
    try {
        const urlParts = req.url.split('/');
        const requestId = urlParts[2];
        const fullMagnetHash = urlParts[3];
        const magnetHash = fullMagnetHash.split('?')[0];
        const parsedUrl = url.parse(req.url || '', true);
        const apiKey = parsedUrl.query.apiKey ||
            req.headers.authorization?.replace('Bearer ', '');
        logger.info('Processando lazy loading', {
            requestId,
            magnetHash,
            apiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'missing'
        });
        if (!apiKey) {
            logger.error('API key nao fornecida para lazy loading');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API key required' }));
            return;
        }
        const result = await streamHandler.handleLazyLoadingClick(requestId, magnetHash, apiKey);
        if (result && result.streamUrl) {
            logger.info('Lazy loading bem-sucedido', {
                requestId,
                magnetHash,
                redirectTo: result.streamUrl.substring(0, 100) + '...'
            });
            res.writeHead(302, {
                'Location': result.streamUrl
            });
            res.end();
        }
        else {
            logger.error('Lazy loading falhou - stream nao encontrada');
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Stream not found' }));
        }
    }
    catch (error) {
        logger.error('Erro no lazy loading', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Lazy loading failed' }));
    }
}
async function handleDebugRequest(req, res) {
    try {
        const urlParts = req.url.split('/');
        const requestId = urlParts[3];
        const parsedUrl = url.parse(req.url || '', true);
        const apiKey = parsedUrl.query.apiKey ||
            req.headers.authorization?.replace('Bearer ', '');
        if (!apiKey) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'API key required' }));
            return;
        }
        const streamType = (requestId.includes(':') ? 'series' : 'movie');
        const request = {
            type: streamType,
            id: requestId,
            title: '',
            apiKey: apiKey,
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
        const magnets = await streamHandler.getAvailableMagnets(request);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            requestId,
            magnetCount: magnets.length,
            magnets: magnets.map(m => ({
                title: m.title,
                quality: m.quality,
                provider: m.provider,
                magnetHash: streamHandler.extractHashFromMagnet(m.magnet),
                magnet: m.magnet.substring(0, 100) + '...'
            }))
        }));
    }
    catch (error) {
        logger.error('Debug endpoint error', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Debug failed' }));
    }
}
async function handleStatsRequest(req, res) {
    try {
        const stats = streamHandler.getStats();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            cache: {
                size: stats.cache.size,
                keys: stats.cache.keys.length
            },
            magnets: stats.magnets,
            scrapedMagnetsCache: stats.scrapedMagnetsCache,
            lazyLoadingStreams: stats.lazyLoadingStreams,
            timestamp: new Date().toISOString()
        }));
    }
    catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Stats failed' }));
    }
}
async function handleClearCacheRequest(req, res) {
    try {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
        }
        streamHandler.clearCache();
        logger.info('Cache limpo via endpoint');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, message: 'Cache cleared' }));
    }
    catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Clear cache failed' }));
    }
}
server.listen(port, () => {
    logger.info('Servidor Lazy Loading iniciado', {
        port: port,
        endpoints: {
            lazyLoading: `http://localhost:${port}/lazy-load/{requestId}/{magnetHash}`,
            debug: `http://localhost:${port}/debug/magnets/{requestId}`,
            stats: `http://localhost:${port}/stats`,
            clearCache: `http://localhost:${port}/clear-cache`
        }
    });
    console.log('=========================================');
    console.log('SERVIDOR LAZY LOADING - BRASIL RD');
    console.log('=========================================');
    console.log(`Porta: ${port}`);
    console.log(`Lazy Loading: http://localhost:${port}/lazy-load/{requestId}/{magnetHash}`);
    console.log(`Debug: http://localhost:${port}/debug/magnets/{requestId}`);
    console.log(`Estatisticas: http://localhost:${port}/stats`);
    console.log(`Limpar Cache: http://localhost:${port}/clear-cache (POST)`);
    console.log('');
    console.log('Status: Pronto para processar lazy loading');
    console.log('Aguardando requisicoes de streams...');
});
process.on('SIGINT', () => {
    logger.info('Encerrando servidor lazy loading...');
    server.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    logger.info('Servidor lazy loading finalizado');
    server.close();
    process.exit(0);
});
