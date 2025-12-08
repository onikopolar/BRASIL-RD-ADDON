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
const VERSION = '1.4.0';
function createProxyUrl(baseUrl, targetUrl) {
    const encodedUrl = encodeURIComponent(targetUrl);
    return `${baseUrl}/proxy/${encodedUrl}`;
}
function isVideoFile(url) {
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg', '.ts', '.m2ts'];
    const urlLower = url.toLowerCase();
    return videoExtensions.some(ext => urlLower.includes(ext));
}
function createStreamFromStaticResponse(staticResponseService, staticResponse, requestId, season, episode) {
    const informativeStream = staticResponseService.createInformativeStream(staticResponse, requestId);
    let titleSuffix = '';
    if (season !== undefined && episode !== undefined) {
        titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }
    const stream = {
        title: `${informativeStream.title}${titleSuffix}`,
        name: `${informativeStream.name}${titleSuffix}`,
        description: informativeStream.description,
        url: informativeStream.url,
        behaviorHints: {
            notWebReady: false,
            bingeGroup: `br-info-${staticResponse}`
        },
        status: 'pending',
        infoHash: undefined,
        magnet: undefined,
        sources: []
    };
    logger.debug('Stream informativo criado', {
        staticResponse,
        requestId,
        hasSeasonEpisode: season !== undefined
    });
    return stream;
}
function extractMagnetHash(magnet) {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}
async function processMagnetWithRealDebrid(magnet, apiKey, season, episode, type = 'movie') {
    const magnetHash = extractMagnetHash(magnet);
    if (!magnetHash) {
        return {
            success: false,
            status: 'error',
            message: 'Magnet link invalido - sem info hash'
        };
    }
    const isSeries = type === 'series' || season !== undefined;
    const magnetTitle = isSeries
        ? `Stream S${season || '?'}E${episode || '?'}`
        : 'Stream Filme';
    const magnetData = {
        imdbId: 'resolve-' + Date.now(),
        title: magnetTitle,
        magnet: magnet,
        quality: '1080p',
        seeds: 50,
        category: isSeries ? 'serie' : 'filme',
        language: 'pt-BR',
        addedAt: new Date().toISOString(),
        imdbSeason: season,
        imdbEpisode: episode
    };
    let rdResult;
    const rdService = new RealDebridService_1.RealDebridService();
    const torrentInfo = await rdTorrentCacheService.getTorrentId(magnetHash, apiKey, rdService);
    if (torrentInfo.fromCache) {
        logger.debug('Cache de torrent HIT - Camada 1', {
            magnetHash,
            torrentId: torrentInfo.torrentId,
            status: torrentInfo.status
        });
    }
    if (torrentInfo.torrentId) {
        const streamLinkResult = await rdTorrentCacheService.getStreamLink(torrentInfo.torrentId, apiKey, season, episode, rdService);
        if (streamLinkResult.fromCache) {
            logger.debug('Cache de stream link HIT - Camada 2', {
                torrentId: torrentInfo.torrentId,
                season,
                episode
            });
        }
        const torrentDetails = await rdService.getTorrentInfo(torrentInfo.torrentId, apiKey);
        if (torrentInfo.status !== torrentDetails.status) {
            rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, torrentDetails.status);
        }
        rdResult = {
            success: true,
            status: torrentDetails.status,
            streamLink: streamLinkResult.streamLink || undefined,
            message: (0, statusHelpers_1.getStatusMessage)(torrentDetails.status, torrentDetails.progress),
            torrentId: torrentInfo.torrentId
        };
        logger.debug('Resultado do cache inteligente', {
            magnetHash,
            torrentId: torrentInfo.torrentId,
            status: torrentDetails.status,
            hasStreamLink: !!streamLinkResult.streamLink,
            fromCacheLevel: streamLinkResult.fromCache ? '2' : '1'
        });
    }
    else {
        logger.debug('Torrent nao encontrado, processando normalmente', { magnetHash });
        const processResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);
        rdResult = processResult;
        if (processResult.success && processResult.torrentId) {
            const torrentId = processResult.torrentId;
            rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, processResult.status);
            logger.debug('Novo torrent salvo no cache', {
                magnetHash,
                torrentId,
                status: processResult.status
            });
        }
    }
    return rdResult;
}
const setupResolveRoutes = (app) => {
    app.get('/proxy/:encodedUrl', async (req, res) => {
        const startTime = Date.now();
        const targetUrl = decodeURIComponent(req.params.encodedUrl);
        logger.debug('Proxy CORS iniciado', {
            targetUrlPreview: targetUrl.substring(0, 80),
            method: req.method
        });
        if (!targetUrl.includes('real-debrid.com') && !targetUrl.includes('realdebrid.com')) {
            logger.warn('URL de proxy nao autorizada', {
                targetUrl: targetUrl.substring(0, 100)
            });
            return res.status(400).json({ error: 'URL nao permitida' });
        }
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Origin');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
        if (req.method === 'OPTIONS') {
            logger.debug('Preflight OPTIONS respondido', { duration: Date.now() - startTime });
            return res.status(200).end();
        }
        try {
            const headers = {};
            const rangeHeader = req.get('Range');
            if (rangeHeader)
                headers['Range'] = rangeHeader;
            const proxyResponse = await fetch(targetUrl, { headers });
            if (!proxyResponse.ok) {
                logger.warn('Resposta do Real-Debrid nao OK', {
                    status: proxyResponse.status,
                    targetUrl: targetUrl.substring(0, 80)
                });
                return res.status(proxyResponse.status).end();
            }
            const contentType = proxyResponse.headers.get('Content-Type');
            const contentLength = proxyResponse.headers.get('Content-Length');
            const contentRange = proxyResponse.headers.get('Content-Range');
            const contentDisposition = proxyResponse.headers.get('Content-Disposition');
            const isVideo = isVideoFile(targetUrl);
            const isForceDownload = contentType && contentType.includes('force-download');
            const isAttachment = contentDisposition && contentDisposition.includes('attachment');
            if (isVideo || isForceDownload) {
                res.setHeader('Content-Type', 'video/mp4');
                logger.debug('Content-Type ajustado para video/mp4', {
                    originalContentType: contentType,
                    motivo: isVideo ? 'arquivo_video' : 'force_download'
                });
            }
            else if (contentType) {
                res.setHeader('Content-Type', contentType);
            }
            else {
                res.setHeader('Content-Type', 'video/mp4');
            }
            if (isAttachment) {
                logger.debug('Content-Disposition attachment removido', {
                    originalDisposition: contentDisposition
                });
            }
            else if (contentDisposition) {
                res.setHeader('Content-Disposition', contentDisposition);
            }
            if (contentLength)
                res.setHeader('Content-Length', contentLength);
            if (contentRange)
                res.setHeader('Content-Range', contentRange);
            res.setHeader('Accept-Ranges', proxyResponse.headers.get('Accept-Ranges') || 'bytes');
            res.status(proxyResponse.status);
            logger.debug('Proxy configurado para reproducao', {
                originalContentType: contentType,
                finalContentType: res.getHeader('Content-Type'),
                originalDisposition: contentDisposition,
                finalDisposition: res.getHeader('Content-Disposition') || 'removido_attachment',
                contentLength,
                hasRange: !!rangeHeader,
                duration: Date.now() - startTime
            });
            if (proxyResponse.body) {
                const reader = proxyResponse.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    res.write(value);
                }
            }
            res.end();
            logger.debug('Proxy streaming finalizado', {
                targetUrl: targetUrl.substring(0, 60),
                duration: Date.now() - startTime
            });
        }
        catch (error) {
            logger.error('Erro no proxy CORS', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                targetUrl: targetUrl.substring(0, 60),
                duration: Date.now() - startTime
            });
            res.status(500).json({ error: 'Falha no proxy' });
        }
    });
    app.get('/resolve/realdebrid/:apiKey/:infoHash/null/:fileIndex/:filename', async (req, res) => {
        const startTime = Date.now();
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        logger.info('Rota Torrentio format iniciada', {
            apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4),
            infoHash,
            fileIndex,
            filename,
            season,
            episode,
            type,
            formato: 'torrentio_v1.4.0'
        });
        const cacheKey = `resolve:torrentio:${apiKey}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get(cacheKey);
        if (cachedDirectLink) {
            logger.info('Cache HIT - Rota Torrentio', {
                cacheKey: cacheKey.substring(0, 60) + '...',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, cachedDirectLink);
            return res.redirect(302, proxyUrl);
        }
        try {
            if (!apiKey || apiKey.length < 10) {
                logger.warn('API Key invalida', {
                    length: apiKey?.length,
                    infoHash
                });
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid invalida'
                });
            }
            if (!infoHash || infoHash.length < 40) {
                logger.warn('Info hash invalido', {
                    infoHash,
                    length: infoHash?.length
                });
                return res.status(400).json({
                    success: false,
                    error: 'Info hash invalido'
                });
            }
            const magnetLink = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
            logger.debug('Magnet construido', {
                magnetPreview: magnetLink.substring(0, 80),
                infoHash,
                season,
                episode
            });
            const rdResult = await processMagnetWithRealDebrid(magnetLink, apiKey, season, episode, type);
            logger.info('Resultado Real-Debrid recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                success: rdResult.success,
                torrentId: rdResult.torrentId || 'none',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }
            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                logger.info('Stream direto disponivel - Usando proxy CORS', {
                    season,
                    episode,
                    type,
                    isSeries: type === 'series' ? 'SIM' : 'NAO',
                    duration: `${Date.now() - startTime}ms`
                });
                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, rdResult.streamLink);
                return res.redirect(302, proxyUrl);
            }
            else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                logger.info('Retornando stream informativo - Download em progresso', {
                    status: rdResult.status,
                    season,
                    episode,
                    type,
                    duration: `${Date.now() - startTime}ms`
                });
                const requestId = `resolve-downloading-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const staticResponse = staticResponseService.getResponseForRealDebridStatus(rdResult.status);
                const responseToUse = staticResponse || StaticResponseService_1.StaticResponse.DOWNLOADING;
                const stream = createStreamFromStaticResponse(staticResponseService, responseToUse, requestId, season, episode);
                stream.description += `\nStatus: ${rdResult.status}`;
                return res.json({ streams: [stream] });
            }
            else if (rdResult.status === 'error' || rdResult.status === 'dead') {
                logger.warn('Erro no Real-Debrid', {
                    status: rdResult.status,
                    message: rdResult.message
                });
                const staticResponse = StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD;
                const requestId = `resolve-error-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const stream = createStreamFromStaticResponse(staticResponseService, staticResponse, requestId, season, episode);
                if (rdResult.message) {
                    stream.description += `\n\nDetalhes: ${rdResult.message}`;
                }
                return res.json({ streams: [stream] });
            }
            else {
                logger.error('Status nao reconhecido', {
                    status: rdResult.status,
                    streamLinkPresent: !!rdResult.streamLink,
                    season,
                    episode,
                    type
                });
                const requestId = `resolve-unknown-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const stream = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, requestId, season, episode);
                stream.description += `\n\nStatus desconhecido: ${rdResult.status}`;
                return res.json({ streams: [stream] });
            }
        }
        catch (error) {
            logger.error('Erro na resolucao Torrentio format', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                infoHash,
                fileIndex,
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            const requestId = `resolve-catch-${Date.now()}`;
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const stream = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, requestId, season, episode);
            if (error instanceof Error) {
                stream.description += `\n\nErro: ${error.message}`;
            }
            return res.json({ streams: [stream] });
        }
    });
    app.get('/resolve/:magnet', async (req, res) => {
        const startTime = Date.now();
        const encodedMagnet = req.params.magnet;
        const apiKey = req.query.apiKey;
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        const cacheKey = `resolve:${encodedMagnet}:${apiKey}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get(cacheKey);
        if (cachedDirectLink) {
            logger.info('Cache HIT - Camada 3', {
                cacheKey: cacheKey.substring(0, 50) + '...',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, cachedDirectLink);
            return res.redirect(302, proxyUrl);
        }
        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            const magnetHash = extractMagnetHash(magnet);
            logger.info('Resolvendo magnet', {
                magnetHash: magnetHash?.substring(0, 16) || 'unknown',
                apiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'none',
                season,
                episode,
                type
            });
            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid é obrigatória'
                });
            }
            const rdResult = await processMagnetWithRealDebrid(magnet, apiKey, season, episode, type);
            logger.info('Resultado RD recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                success: rdResult.success,
                torrentId: rdResult.torrentId || 'none',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }
            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                logger.info('Stream instantaneo disponivel - Usando proxy', {
                    season,
                    episode,
                    type,
                    isSeries: type === 'series' ? 'SIM' : 'NAO',
                    duration: `${Date.now() - startTime}ms`
                });
                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, rdResult.streamLink);
                return res.redirect(302, proxyUrl);
            }
            else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                logger.info('Retornando stream informativo (download em progresso)', {
                    status: rdResult.status,
                    season,
                    episode,
                    type,
                    duration: `${Date.now() - startTime}ms`
                });
                const requestId = `resolve-downloading-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const staticResponse = staticResponseService.getResponseForRealDebridStatus(rdResult.status);
                const responseToUse = staticResponse || StaticResponseService_1.StaticResponse.DOWNLOADING;
                const stream = createStreamFromStaticResponse(staticResponseService, responseToUse, requestId, season, episode);
                stream.description += `\nStatus: ${rdResult.status}`;
                return res.json({ streams: [stream] });
            }
            else if (rdResult.status === 'error' || rdResult.status === 'dead') {
                logger.warn('Erro no Real-Debrid', {
                    status: rdResult.status,
                    message: rdResult.message,
                    duration: `${Date.now() - startTime}ms`
                });
                const staticResponse = StaticResponseService_1.StaticResponse.FAILED_DOWNLOAD;
                const requestId = `resolve-error-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const stream = createStreamFromStaticResponse(staticResponseService, staticResponse, requestId, season, episode);
                if (rdResult.message) {
                    stream.description += `\n\nDetalhes: ${rdResult.message}`;
                }
                return res.json({ streams: [stream] });
            }
            else {
                logger.error('Status nao reconhecido', {
                    status: rdResult.status,
                    streamLinkPresent: !!rdResult.streamLink,
                    season,
                    episode,
                    type,
                    duration: `${Date.now() - startTime}ms`
                });
                const requestId = `resolve-unknown-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
                const stream = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, requestId, season, episode);
                stream.description += `\n\nStatus desconhecido: ${rdResult.status}`;
                return res.json({ streams: [stream] });
            }
        }
        catch (error) {
            logger.error('Erro na resolucao', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                encodedMagnet: encodedMagnet.substring(0, 50) + '...',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            const requestId = `resolve-catch-${Date.now()}`;
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
            const stream = createStreamFromStaticResponse(staticResponseService, StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, requestId, season, episode);
            if (error instanceof Error) {
                stream.description += `\n\nErro: ${error.message}`;
            }
            return res.json({ streams: [stream] });
        }
    });
    app.get('/resolve/:magnet/status', async (req, res) => {
        const startTime = Date.now();
        const encodedMagnet = req.params.magnet;
        const apiKey = req.query.apiKey;
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid é obrigatoria'
                });
            }
            const rdService = new RealDebridService_1.RealDebridService();
            const magnetHash = magnet.match(/btih:([a-zA-Z0-9]+)/i)?.[1];
            if (!magnetHash) {
                return res.status(400).json({
                    success: false,
                    error: 'Magnet link invalido'
                });
            }
            const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
            if (existingTorrent && existingTorrent.id) {
                const torrentInfo = await rdService.getTorrentInfo(existingTorrent.id, apiKey);
                logger.debug('Status do torrent obtido', {
                    magnetHash: magnetHash.substring(0, 16),
                    status: torrentInfo.status,
                    progress: torrentInfo.progress,
                    duration: `${Date.now() - startTime}ms`
                });
                return res.json({
                    success: true,
                    status: torrentInfo.status,
                    progress: Math.round(torrentInfo.progress),
                    downloaded: torrentInfo.status === 'downloaded',
                    message: (0, statusHelpers_1.getStatusMessage)(torrentInfo.status, torrentInfo.progress),
                    torrentId: existingTorrent.id,
                    isSeries: season !== undefined,
                    targetSeason: season,
                    targetEpisode: episode
                });
            }
            else {
                logger.debug('Torrent nao encontrado no RD', {
                    magnetHash: magnetHash?.substring(0, 16),
                    duration: `${Date.now() - startTime}ms`
                });
                return res.json({
                    success: true,
                    status: 'not_found',
                    progress: 0,
                    downloaded: false,
                    message: 'Torrent nao encontrado no Real-Debrid',
                    isSeries: season !== undefined,
                    targetSeason: season,
                    targetEpisode: episode
                });
            }
        }
        catch (error) {
            logger.error('Erro status', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                season,
                episode,
                duration: `${Date.now() - startTime}ms`
            });
            res.status(500).json({
                success: false,
                error: 'Falha: ' + (error instanceof Error ? error.message : 'Erro desconhecido'),
                isSeries: season !== undefined,
                targetSeason: season,
                targetEpisode: episode
            });
        }
    });
    app.get('/resolve/cache/stats', async (req, res) => {
        try {
            const cacheStats = rdTorrentCacheService.getStats();
            res.json({
                success: true,
                serviceVersion: VERSION,
                cacheStats: cacheStats
            });
        }
        catch (error) {
            logger.error('Erro obtendo estatisticas do cache', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            res.status(500).json({
                success: false,
                error: 'Falha ao obter estatisticas do cache'
            });
        }
    });
    logger.info(`ResolveRoutes v${VERSION} - Fix Content-Disposition para reproducao web`, {
        mudancas: [
            'Proxy remove Content-Disposition: attachment',
            'Content-Type force-download convertido para video/mp4',
            'Headers ajustados para permitir reproducao no navegador',
            'Logs detalhados sobre ajuste de headers'
        ],
        analise_problema: 'Real-Debrid sempre retorna Content-Disposition: attachment forçando download',
        solucao: 'Proxy remove attachment e ajusta Content-Type para video/mp4',
        compatibilidade: 'Stremio Web agora reproduz videos corretamente',
        rotas: [
            'GET /proxy/:encodedUrl - Proxy CORS com headers otimizados',
            'GET /resolve/realdebrid/:apiKey/:infoHash/null/:fileIndex/:filename - Rota Torrentio',
            'GET /resolve/:magnet - Rota original (base64)',
            'GET /resolve/:magnet/status - Status do torrent',
            'GET /resolve/cache/stats - Estatisticas do cache'
        ]
    });
};
exports.setupResolveRoutes = setupResolveRoutes;
