"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupResolveRoutes = void 0;
const AutoMagnetService_1 = require("../services/AutoMagnetService");
const RealDebridService_1 = require("../services/RealDebridService");
const RdTorrentCacheService_1 = require("../services/RdTorrentCacheService");
const CacheService_1 = require("../services/CacheService");
const StaticResponseService_1 = require("../services/StaticResponseService");
const logger_1 = require("../utils/logger");
const statusHelpers_1 = require("./statusHelpers");
const logger = new logger_1.Logger('ResolveRoutes');
const autoMagnetService = new AutoMagnetService_1.AutoMagnetService();
const cacheService = new CacheService_1.CacheService();
const rdTorrentCacheService = new RdTorrentCacheService_1.RdTorrentCacheService();
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
async function processMagnetWithRealDebrid(magnet, apiKey, season, episode, type = 'movie') {
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
    const rdService = new RealDebridService_1.RealDebridService();
    try {
        const torrentInfo = await rdTorrentCacheService.getTorrentId(magnetHash, apiKey, rdService);
        if (torrentInfo.torrentId) {
            const streamLinkResult = await rdTorrentCacheService.getStreamLink(torrentInfo.torrentId, apiKey, season, episode, rdService);
            const torrentDetails = await rdService.getTorrentInfo(torrentInfo.torrentId, apiKey);
            if (torrentInfo.status !== torrentDetails.status) {
                rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, torrentDetails.status);
            }
            return {
                success: true,
                status: torrentDetails.status,
                streamLink: streamLinkResult.streamLink || undefined,
                message: (0, statusHelpers_1.getStatusMessage)(torrentDetails.status, torrentDetails.progress),
                torrentId: torrentInfo.torrentId
            };
        }
    }
    catch (err) {
    }
    try {
        const processResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);
        return processResult;
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        return {
            success: false,
            status: 'error',
            message: errorMessage
        };
    }
}
const setupResolveRoutes = (app) => {
    app.get('/resolve/realdebrid/:apiKey/:infoHash/null/:fileIndex/:filename', async (req, res) => {
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        logger.info('Resolução iniciada', {
            apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4),
            infoHash, season, episode, type,
            client: req.headers['user-agent']?.substring(0, 60)
        });
        const cacheKey = `resolve:torrentio:${apiKey}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get(cacheKey);
        if (cachedDirectLink) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            return res.redirect(302, cachedDirectLink);
        }
        let streamResponse = null;
        try {
            if (!apiKey || apiKey.length < 10 || !infoHash || infoHash.length < 40) {
                throw new Error('Parâmetros inválidos');
            }
            const magnetLink = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
            const rdResult = await processMagnetWithRealDebrid(magnetLink, apiKey, season, episode, type);
            if (rdResult.success) {
                if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                    cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, rdResult.streamLink);
                }
                if (['downloading', 'queued', 'magnet_conversion'].includes(rdResult.status)) {
                    const baseUrl = 'http://localhost:7000';
                    const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                    const response = staticResponseService.getResponseForRealDebridStatus(rdResult.status) || StaticResponseService_1.StaticResponse.DOWNLOADING;
                    streamResponse = createStreamFromStaticResponse(staticResponseService, response, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus: ${rdResult.status}`;
                }
                else if (['error', 'dead'].includes(rdResult.status)) {
                    const baseUrl = 'http://localhost:7000';
                    const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nDetalhes: ${rdResult.message || rdResult.status}`;
                }
                else {
                    const baseUrl = 'http://localhost:7000';
                    const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus desconhecido: ${rdResult.status}`;
                }
            }
            else {
                const baseUrl = 'http://localhost:7000';
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const errorMessage = rdResult.message || 'Falha no Real-Debrid';
                let staticResponse = StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED;
                let extraInfo = '';
                if (errorMessage.includes('infringing')) {
                    staticResponse = StaticResponseService_1.StaticResponse.FAILED_INFRINGEMENT;
                    extraInfo = '\nConteúdo bloqueado (direitos autorais)';
                }
                else if (errorMessage.includes('hoster_unavailable')) {
                    staticResponse = StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD;
                    extraInfo = '\nServidor RD indisponível';
                }
                else {
                    logger.error('Erro na resolução', { error: errorMessage, infoHash });
                    extraInfo = `\nErro: ${errorMessage}`;
                }
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += extraInfo;
            }
        }
        catch (error) {
            const baseUrl = 'http://localhost:7000';
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Exceção inesperada', { error: errorMessage, infoHash });
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }
        if (!streamResponse) {
            const baseUrl = 'http://localhost:7000';
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }
        return res.json({ streams: [streamResponse] });
    });
    app.get('/resolve/:magnet', async (req, res) => {
        const apiKey = req.query.apiKey;
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        let streamResponse = null;
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            if (!apiKey)
                throw new Error('API key obrigatória');
            const rdResult = await processMagnetWithRealDebrid(magnet, apiKey, season, episode, type);
            if (rdResult.success) {
                if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, rdResult.streamLink);
                }
                const baseUrl = 'http://localhost:7000';
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                let staticResponse = StaticResponseService_1.StaticResponse.DOWNLOADING;
                if (rdResult.status === 'error' || rdResult.status === 'dead')
                    staticResponse = StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD;
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += `\nStatus: ${rdResult.status}`;
            }
            else {
                const baseUrl = 'http://localhost:7000';
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const errorMessage = rdResult.message || 'Falha no Real-Debrid';
                let staticResponse = StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED;
                let extraInfo = '';
                if (errorMessage.includes('infringing')) {
                    staticResponse = StaticResponseService_1.StaticResponse.FAILED_INFRINGEMENT;
                    extraInfo = '\nConteúdo bloqueado';
                }
                else if (errorMessage.includes('hoster_unavailable')) {
                    staticResponse = StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD;
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
            const baseUrl = 'http://localhost:7000';
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }
        if (!streamResponse) {
            const baseUrl = 'http://localhost:7000';
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }
        return res.json({ streams: [streamResponse] });
    });
    app.get('/resolve/:magnet/status', async (req, res) => {
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            const apiKey = req.query.apiKey;
            if (!apiKey)
                return res.status(400).json({ success: false, error: 'API key obrigatória' });
            const rdService = new RealDebridService_1.RealDebridService();
            const magnetHash = extractMagnetHash(magnet);
            if (!magnetHash)
                return res.status(400).json({ success: false, error: 'Magnet inválido' });
            const existing = await rdService.findExistingTorrent(magnetHash, apiKey);
            if (!existing?.id)
                return res.json({ success: true, status: 'not_found', progress: 0, downloaded: false, message: 'Não encontrado' });
            const info = await rdService.getTorrentInfo(existing.id, apiKey);
            return res.json({ success: true, status: info.status, progress: Math.round(info.progress), downloaded: info.status === 'downloaded', message: (0, statusHelpers_1.getStatusMessage)(info.status, info.progress), torrentId: existing.id });
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
