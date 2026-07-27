"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupResolveRoutes = void 0;
const AutoMagnetService_js_1 = require("../services/AutoMagnetService.js");
const RealDebridService_js_1 = require("../services/RealDebridService.js");
const RdTorrentCacheService_js_1 = require("../services/RdTorrentCacheService.js");
const CacheService_js_1 = require("../services/CacheService.js");
const StaticResponseService_js_1 = require("../services/StaticResponseService.js");
const logger_js_1 = require("../utils/logger.js");
const statusHelpers_js_1 = require("./statusHelpers.js");
const logger = new logger_js_1.Logger('ResolveRoutes');
const autoMagnetService = new AutoMagnetService_js_1.AutoMagnetService();
const cacheService = new CacheService_js_1.CacheService();
const rdTorrentCacheService = new RdTorrentCacheService_js_1.RdTorrentCacheService();
const CACHE_TTL = 24 * 60 * 60 * 1000;
function createStreamFromStaticResponse(staticResponseService, staticResponse, requestId, season, episode) {
    const informativeStream = staticResponseService.createInformativeStream(staticResponse, requestId);
    let titleSuffix = '';
    if (season !== undefined && episode !== undefined) {
        titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }
    return {
        title: `${informativeStream.title}${titleSuffix}`,
        name: `${informativeStream.name}${titleSuffix}`,
        description: informativeStream.description,
        url: informativeStream.url,
        behaviorHints: { notWebReady: false, bingeGroup: `br-info-${staticResponse}` },
        status: 'pending',
        infoHash: undefined,
        magnet: undefined,
        sources: []
    };
}
function extractMagnetHash(magnet) {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}
async function processMagnetWithTorbox(magnet, apiKey, season, episode, type = 'movie') {
    const magnetHash = extractMagnetHash(magnet);
    if (!magnetHash)
        return { success: false, status: 'error', message: 'Magnet link inválido' };
    const isSeries = type === 'series' || season !== undefined;
    const magnetData = {
        imdbId: 'resolve-' + Date.now(),
        title: isSeries ? `Stream S${season || '?'}E${episode || '?'}` : 'Stream Filme',
        magnet, quality: '1080p', seeds: 50,
        category: isSeries ? 'serie' : 'filme', language: 'pt-BR',
        addedAt: new Date().toISOString(), imdbSeason: season, imdbEpisode: episode
    };
    const torboxService = new RealDebridService_js_1.TorboxService();
    try {
        const torrentInfo = await rdTorrentCacheService.getTorrentId(magnetHash, apiKey, torboxService);
        if (torrentInfo.torrentId) {
            const [streamLinkResult, torrentDetails] = await Promise.all([
                rdTorrentCacheService.getStreamLink(torrentInfo.torrentId, apiKey, season, episode, torboxService),
                torboxService.getTorrentInfo(torrentInfo.torrentId, apiKey)
            ]);
            if (torrentInfo.status !== torrentDetails.download_state) {
                rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, torrentDetails.download_state);
            }
            return {
                success: true,
                status: torrentDetails.download_state,
                streamLink: streamLinkResult.streamLink || undefined,
                message: (0, statusHelpers_js_1.getStatusMessage)(torrentDetails.download_state, Math.round(torrentDetails.progress * 100)),
                torrentId: torrentInfo.torrentId
            };
        }
    }
    catch (err) {
    }
    try {
        const processResult = await autoMagnetService.processTorboxOnClick(magnetData, apiKey);
        return processResult;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        if (/already queued|already exists|already added/i.test(errorMessage)) {
            return {
                success: true,
                status: 'queued',
                message: 'Torrent ja esta na fila do Torbox'
            };
        }
        return {
            success: false,
            status: 'error',
            message: errorMessage
        };
    }
}
const setupResolveRoutes = (app) => {
    app.get('/resolve/torbox/:apiKey/:infoHash/null/:fileIndex/:filename', async (req, res) => {
        const resolveLogger = new logger_js_1.Logger('🔄RESOLVE');
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;
        resolveLogger.info('═══════════════════════════════════════', {});
        resolveLogger.info('🔄 RESOLVE INICIADO', {
            requestId: req._ultraDebugId,
            apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
            apiKeyLength: apiKey?.length || 0,
            infoHash,
            fileIndex,
            filename: filename?.substring(0, 80),
            season,
            episode,
            type,
            client: req.headers['user-agent']?.substring(0, 80),
            origin: req.get('origin'),
            host: req.get('host'),
        });
        const cacheKey = `resolve:torrentio:${apiKey}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get(cacheKey);
        if (cachedDirectLink) {
            resolveLogger.info('✅ RESOLVE CACHE HIT - Redirecionando para link em cache', {
                requestId: req._ultraDebugId,
                cacheKey,
                streamLinkPreview: cachedDirectLink.substring(0, 80) + '...',
            });
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            return res.redirect(302, cachedDirectLink);
        }
        resolveLogger.info('🔄 RESOLVE CACHE MISS - Processando magnet no Torbox', {
            requestId: req._ultraDebugId,
            infoHash,
        });
        let streamResponse = null;
        try {
            if (!apiKey || apiKey.length < 10 || !infoHash || infoHash.length < 40) {
                throw new Error('Parâmetros inválidos');
            }
            const magnetLink = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
            const tbResult = await processMagnetWithTorbox(magnetLink, apiKey, season, episode, type);
            resolveLogger.info('📊 RESULTADO TORBOX', {
                requestId: req._ultraDebugId,
                success: tbResult.success,
                status: tbResult.status,
                hasStreamLink: !!tbResult.streamLink,
                message: tbResult.message?.substring(0, 150),
            });
            if (tbResult.success) {
                if ((tbResult.status === 'ready' || tbResult.status === 'completed' || tbResult.status === 'cached') && tbResult.streamLink) {
                    cacheService.set(cacheKey, tbResult.streamLink, CACHE_TTL);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, tbResult.streamLink);
                }
                const progressStatuses = ['downloading', 'stalled', 'metadl', 'queued', 'checkingresumedata', 'paused', 'uploading', 'checking'];
                const statusLower = tbResult.status?.toLowerCase() || '';
                if (progressStatuses.some(s => statusLower.includes(s))) {
                    const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
                    const response = staticResponseService.getResponseForTorboxStatus(tbResult.status) || StaticResponseService_js_1.StaticResponse.DOWNLOADING;
                    streamResponse = createStreamFromStaticResponse(staticResponseService, response, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus: ${tbResult.status}`;
                }
                else if (['error', 'dead', 'missingfiles'].some(s => statusLower.includes(s))) {
                    const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nDetalhes: ${tbResult.message || tbResult.status}`;
                }
                else {
                    const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus desconhecido: ${tbResult.status}`;
                }
            }
            else {
                const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
                const errorMessage = tbResult.message || 'Falha no Torbox';
                let staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED;
                let extraInfo = '';
                if (errorMessage.includes('infringing')) {
                    staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_INFRINGEMENT;
                    extraInfo = '\nConteúdo bloqueado (direitos autorais)';
                }
                else if (errorMessage.includes('hoster_unavailable')) {
                    staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD;
                    extraInfo = '\nServidor RD indisponível';
                }
                else {
                    logger.error('Erro na resolução', { error: errorMessage, infoHash });
                    resolveLogger.error('❌ ERRO NA RESOLUÇÃO', {
                        requestId: req._ultraDebugId,
                        errorMessage,
                        infoHash,
                    });
                    extraInfo = `\nErro: ${errorMessage}`;
                }
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += extraInfo;
            }
        }
        catch (error) {
            const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Exceção inesperada', { error: errorMessage, infoHash });
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }
        if (!streamResponse) {
            const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }
        return res.json({ streams: [streamResponse] });
    });
    app.get('/resolve/:magnet', async (req, res) => {
        const apiKey = req.query.apiKey;
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;
        let streamResponse = null;
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            if (!apiKey)
                throw new Error('API key obrigatória');
            const tbResult = await processMagnetWithTorbox(magnet, apiKey, season, episode, type);
            if (tbResult.success) {
                if ((tbResult.status === 'ready' || tbResult.status === 'completed' || tbResult.status === 'cached') && tbResult.streamLink) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, tbResult.streamLink);
                }
                const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
                let staticResponse = StaticResponseService_js_1.StaticResponse.DOWNLOADING;
                if (tbResult.status === 'error' || tbResult.status === 'dead')
                    staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD;
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += `\nStatus: ${tbResult.status}`;
            }
            else {
                const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
                const errorMessage = tbResult.message || 'Falha no Torbox';
                let staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED;
                let extraInfo = '';
                if (errorMessage.includes('infringing')) {
                    staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_INFRINGEMENT;
                    extraInfo = '\nConteúdo bloqueado';
                }
                else if (errorMessage.includes('hoster_unavailable')) {
                    staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD;
                    extraInfo = '\nServidor RD indisponível';
                }
                else {
                    logger.error('Erro na resolução', { error: errorMessage });
                    extraInfo = `\nErro: ${errorMessage}`;
                }
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += extraInfo;
            }
        }
        catch (error) {
            const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }
        if (!streamResponse) {
            const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }
        return res.json({ streams: [streamResponse] });
    });
    app.get('/resolve/:magnet/status', async (req, res) => {
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            const apiKey = req.query.apiKey;
            if (!apiKey)
                return res.status(400).json({ success: false, error: 'API key obrigatória' });
            const torboxService = new RealDebridService_js_1.TorboxService();
            const magnetHash = extractMagnetHash(magnet);
            if (!magnetHash)
                return res.status(400).json({ success: false, error: 'Magnet inválido' });
            const existing = await torboxService.findExistingTorrent(magnetHash, apiKey);
            if (!existing?.id)
                return res.json({ success: true, status: 'not_found', progress: 0, downloaded: false, message: 'Não encontrado' });
            const info = await torboxService.getTorrentInfo(String(existing.id), apiKey);
            const ready = info.download_state === 'completed' || info.download_state === 'cached';
            return res.json({ success: true, status: info.download_state, progress: Math.round(info.progress * 100), downloaded: ready, message: (0, statusHelpers_js_1.getStatusMessage)(info.download_state, Math.round(info.progress * 100)), torrentId: existing.id });
        }
        catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Erro' });
        }
    });
    app.get('/resolve/cache/stats', async (req, res) => {
        res.json({ success: true, serviceVersion: '2.0.0', cacheStats: rdTorrentCacheService.getStats() });
    });
};
exports.setupResolveRoutes = setupResolveRoutes;
