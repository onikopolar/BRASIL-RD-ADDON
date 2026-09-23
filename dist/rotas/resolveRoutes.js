"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupResolveRoutes = void 0;
const magnetHelper_js_1 = require("../magnet/magnetHelper.js");
const RealDebridService_js_1 = require("../debrid/RealDebridService.js");
const RdTorrentCacheService_js_1 = require("../debrid/RdTorrentCacheService.js");
const CacheService_js_1 = require("../debrid/CacheService.js");
const StaticResponseService_js_1 = require("../stream/StaticResponseService.js");
const logger_js_1 = require("../utils/logger.js");
const statusHelpers_js_1 = require("./statusHelpers.js");
const StreamHandler_js_1 = require("../stream/StreamHandler.js");
const models_js_1 = require("../database/models.js");
function sendStatusVideo(res, resolveLogger, requestId, videoUrl) {
    const filename = videoUrl.split('/').pop() || 'downloading_v2.mp4';
    resolveLogger.info('🎬 ENVIANDO vídeo de status DIRETO (redirect)', { requestId, filename });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.redirect(302, `/static/videos/${filename}`);
}
const logger = new logger_js_1.Logger('ResolveRoutes');
const cacheService = new CacheService_js_1.CacheService();
const rdTorrentCacheService = new RdTorrentCacheService_js_1.RdTorrentCacheService();
const torboxService = RealDebridService_js_1.TorboxService.getInstance();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const resolveLogger = new logger_js_1.Logger('🔄RESOLVE');
const emVoo = new Map();
const titlesCache = new Map();
const episodeTitlesCache = new Map();
const pendingTorrentCache = new Map();
const PENDING_TTL_MS = 5 * 60 * 1000;
const DB_TITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
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
function createStatusStreamForTorboxResult(baseUrl, tbResult, requestId, season, episode) {
    const staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
    let staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED;
    let extraInfo = '';
    if (tbResult.success) {
        const readyStatuses = ['ready', 'completed', 'cached', 'uploading', 'seeding'];
        if (readyStatuses.some(s => (tbResult.status || '').toLowerCase().includes(s)) && tbResult.streamLink) {
            return null;
        }
        const progressStatuses = ['downloading', 'stalled', 'metadl', 'queued', 'checkingresumedata', 'paused', 'checking'];
        const statusLower = tbResult.status?.toLowerCase() || '';
        if (progressStatuses.some(s => statusLower.includes(s))) {
            staticResponse = StaticResponseService_js_1.StaticResponse.DOWNLOADING;
        }
        else if (['error', 'dead', 'missingfiles'].some(s => statusLower.includes(s))) {
            staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD;
        }
        else {
            staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED;
            extraInfo = `\nStatus desconhecido: ${tbResult.status}`;
        }
    }
    else {
        const errorMessage = tbResult.message || 'Falha no Torbox';
        if (errorMessage.includes('infringing')) {
            staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_INFRINGEMENT;
            extraInfo = '\nConteúdo bloqueado (direitos autorais)';
        }
        else if (errorMessage.includes('hoster_unavailable')) {
            staticResponse = StaticResponseService_js_1.StaticResponse.FAILED_DOWNLOAD;
            extraInfo = '\nServidor RD indisponível';
        }
        else {
            logger.error('Erro na resolução', { error: errorMessage });
            extraInfo = `\nErro: ${errorMessage}`;
        }
    }
    const stream = createStreamFromStaticResponse(staticResponseService, staticResponse, requestId, season, episode);
    stream.description += extraInfo;
    return stream;
}
async function gravarSeeders(infoHash, seeds) {
    if (seeds === undefined || seeds === null)
        return;
    try {
        await models_js_1.Torrent.update({ seeders: seeds }, { where: { infoHash: infoHash.toLowerCase() } });
        resolveLogger.debug('SEEDERS_GRAVADOS', { infoHash: infoHash.substring(0, 16), seeds });
    }
    catch {
    }
}
async function getEnrichedTitlesForHash(infoHash, externalImdbId, externalSeason) {
    const cached = titlesCache.get(infoHash);
    if (cached !== undefined) {
        const cachedEpisodes = episodeTitlesCache.get(infoHash);
        resolveLogger.info('💾 TÍTULOS DO CACHE LOCAL (memória)', { infoHash, titles: cached.join(', '), episodeTitles: cachedEpisodes?.length || 0 });
        return { titles: cached.length > 0 ? cached : undefined, episodeTitles: cachedEpisodes };
    }
    try {
        let imdbId = externalImdbId;
        let season = externalSeason;
        if (!imdbId) {
            const torrent = await models_js_1.Torrent.findOne({
                where: { infoHash: infoHash.toLowerCase() },
                attributes: ['imdbId', 'imdbSeason'],
                raw: true
            });
            if (torrent?.imdbId) {
                imdbId = torrent.imdbId;
                season = torrent.imdbSeason ?? undefined;
                resolveLogger.info('📋 imdbId obtido do banco Torrent', { infoHash, imdbId, season });
            }
            else {
                titlesCache.set(infoHash, []);
                episodeTitlesCache.set(infoHash, null);
                return { titles: undefined, episodeTitles: undefined };
            }
        }
        else {
            resolveLogger.info('🎯 imdbId recebido da URL de resolução', { infoHash, imdbId, season });
        }
        const seasonKey = season ?? 0;
        const cachedTitle = await models_js_1.ImdbTitleCache.findOne({
            where: { imdbId, season: seasonKey },
            attributes: ['titlesPt', 'titlesEn', 'year', 'episodeTitles', 'updatedAt'],
            raw: true
        });
        if (cachedTitle) {
            const ageMs = Date.now() - new Date(cachedTitle.updatedAt).getTime();
            const needsEpisodeTitles = season !== undefined;
            const hasEpisodeTitles = cachedTitle.episodeTitles ? true : false;
            if (ageMs < DB_TITLE_CACHE_TTL_MS && (!needsEpisodeTitles || hasEpisodeTitles)) {
                const titlesPtArr = Array.isArray(cachedTitle.titlesPt) ? cachedTitle.titlesPt : [];
                const titlesEnArr = Array.isArray(cachedTitle.titlesEn) ? cachedTitle.titlesEn : [];
                const year = cachedTitle.year;
                const allTitles = [...titlesPtArr, ...titlesEnArr];
                const enriched = year ? allTitles.map(t => `${t} ${year}`) : allTitles;
                titlesCache.set(infoHash, enriched);
                const episodeTitlesCached = cachedTitle.episodeTitles;
                episodeTitlesCache.set(infoHash, episodeTitlesCached);
                resolveLogger.info('🗄️ TÍTULOS DO BANCO (cache DB)', {
                    infoHash,
                    imdbId,
                    season: seasonKey,
                    titles: enriched.join(', '),
                    age: `${Math.round(ageMs / 3600000)}h`
                });
                return { titles: enriched.length > 0 ? enriched : undefined, episodeTitles: episodeTitlesCached };
            }
            else {
                resolveLogger.info('⏳ Cache DB expirado, atualizando da API...', { imdbId, season: seasonKey });
            }
        }
        const streamHandler = StreamHandler_js_1.StreamHandler.getInstance();
        const tmdbData = await streamHandler.catalog.getTmdbSearchData(imdbId, season);
        const titles = tmdbData.imdbTitles?.allTitles || [];
        const year = tmdbData.imdbTitles?.year;
        resolveLogger.debug('🔎 EPISODE_TITLES_FLOW', { imdbId, season, episodeTitles: tmdbData.imdbTitles?.episodeTitles, hasEpisodes: !!tmdbData.imdbTitles?.episodeTitles });
        if (titles.length === 0) {
            await models_js_1.ImdbTitleCache.upsert({
                imdbId,
                season: seasonKey,
                titlesPt: [],
                titlesEn: [],
                year: year ?? null,
                updatedAt: new Date()
            });
            titlesCache.set(infoHash, []);
            return { titles: undefined, episodeTitles: undefined };
        }
        const enriched = year ? titles.map(t => `${t} ${year}`) : titles;
        const episodeTitles = tmdbData.imdbTitles?.episodeTitles || null;
        titlesCache.set(infoHash, enriched);
        await models_js_1.ImdbTitleCache.upsert({
            imdbId,
            season: seasonKey,
            titlesPt: titles,
            titlesEn: titles,
            year: year ?? null,
            episodeTitles: episodeTitles,
            updatedAt: new Date()
        });
        episodeTitlesCache.set(infoHash, episodeTitles);
        resolveLogger.info('🌐 TÍTULOS DA API (TMDB) salvos no banco', {
            infoHash,
            imdbId,
            season: seasonKey,
            titles: enriched.join(', ')
        });
        return { titles: enriched, episodeTitles };
    }
    catch (error) {
        resolveLogger.error('❌ Erro ao obter títulos enriquecidos', {
            infoHash,
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        titlesCache.set(infoHash, []);
        return { titles: undefined, episodeTitles: undefined };
    }
}
async function processMagnetWithTorbox(magnet, apiKey, infoHash, season, episode, type = 'movie', quality, titles, episodeTitles) {
    try {
        const hashKey = infoHash.toLowerCase();
        const pending = pendingTorrentCache.get(hashKey);
        if (pending && Date.now() - pending.timestamp < PENDING_TTL_MS) {
            resolveLogger.info('⏳ Torrent em processamento recente (cache local)', {
                infoHash: hashKey,
                status: pending.status,
                torrentId: pending.torrentId,
            });
            return {
                success: true,
                status: pending.status,
                torrentId: pending.torrentId,
                message: 'Torrent está em processamento',
            };
        }
        if (titles && titles.length > 0) {
            torboxService.setTitlesForHash(infoHash, titles);
        }
        const resultado = await torboxService.processTorrent(magnet, apiKey);
        if (!resultado.added) {
            return { success: false, status: 'error', message: 'Falha ao processar magnet' };
        }
        const torrentId = resultado.torrentId;
        if (!torrentId) {
            return { success: false, status: 'error', message: 'Falha ao processar magnet' };
        }
        const status = resultado.status;
        const ready = resultado.ready;
        if (!ready) {
            pendingTorrentCache.set(hashKey, {
                timestamp: Date.now(),
                status,
                torrentId,
            });
            return {
                success: true,
                status,
                torrentId,
                message: 'Torrent na fila do Torbox, aguardando processamento',
            };
        }
        const info = resultado.info ?? await torboxService.getTorrentInfo(torrentId, apiKey);
        void gravarSeeders(infoHash, info.seeds);
        let streamLink;
        if (titles && titles.length > 0) {
            const link = await torboxService.getStreamLinkForTorrent(torrentId, apiKey, season, episode, quality, info, titles, episodeTitles);
            streamLink = link || undefined;
        }
        else {
            const linkResult = await rdTorrentCacheService.getStreamLink(torrentId, apiKey, season, episode, torboxService, quality, info);
            streamLink = linkResult.streamLink || undefined;
        }
        return {
            success: true,
            status,
            streamLink,
            torrentId,
            message: (0, statusHelpers_js_1.getStatusMessage)(status, Math.round(info.progress * 100)),
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        if (/already queued|already exists|already added/i.test(errorMessage)) {
            pendingTorrentCache.set(infoHash.toLowerCase(), {
                timestamp: Date.now(),
                status: 'downloading',
            });
            return { success: true, status: 'downloading', message: 'Torrent já está na fila do Torbox' };
        }
        return { success: false, status: 'error', message: errorMessage };
    }
}
const setupResolveRoutes = (app) => {
    app.get('/resolve/torbox/:apiKey/:infoHash/:seasonEpisode/:fileIndex/:filename', async (req, res) => {
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        let season;
        let episode;
        const seasonEpisodeParam = req.params.seasonEpisode;
        if (seasonEpisodeParam && seasonEpisodeParam !== 'null' && seasonEpisodeParam !== 'movie') {
            const match = seasonEpisodeParam.match(/^s(\d+)e(\d+)$/i);
            if (match) {
                season = parseInt(match[1]);
                episode = parseInt(match[2]);
            }
        }
        if (season === undefined) {
            season = req.query.season ? parseInt(req.query.season) : undefined;
        }
        if (episode === undefined) {
            episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        }
        const quality = req.query.quality;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        const imdbId = req.query.imdbId;
        const magnetFromUrl = typeof req.query.magnet === 'string' ? req.query.magnet : undefined;
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        if (req.method === 'HEAD') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Type', 'video/mp4');
            return res.status(200).end();
        }
        const cacheKey = `resolve:torrentio:${apiKey.substring(0, 8)}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get(cacheKey);
        if (cachedDirectLink) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.redirect(302, cachedDirectLink);
        }
        const dedupKey = `${apiKey.substring(0, 8)}:${infoHash}:${season || 'all'}:${episode || 'all'}`;
        let promiseEmVoo = emVoo.get(dedupKey);
        if (!promiseEmVoo) {
            promiseEmVoo = (async () => {
                try {
                    resolveLogger.info('🔄 RESOLVE CACHE MISS - Processando magnet no Torbox', {
                        requestId: req._ultraDebugId,
                        infoHash,
                    });
                    if (!apiKey || apiKey.length < 10 || !infoHash || infoHash.length < 40) {
                        throw new Error('Parâmetros inválidos');
                    }
                    const magnetLink = magnetFromUrl || `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
                    const enrichedTitles = await getEnrichedTitlesForHash(infoHash, imdbId, season);
                    const titles = enrichedTitles.titles;
                    const episodeTitles = enrichedTitles.episodeTitles;
                    if (titles) {
                        resolveLogger.info('🔤 Títulos obtidos para seleção de arquivo', {
                            infoHash,
                            titles: titles.join(', '),
                        });
                    }
                    return await processMagnetWithTorbox(magnetLink, apiKey, infoHash, season, episode, type, quality, titles, episodeTitles);
                }
                finally {
                    emVoo.delete(dedupKey);
                }
            })();
            emVoo.set(dedupKey, promiseEmVoo);
        }
        else {
            resolveLogger.info('🔄 RESOLVE DEDUP - Aguardando requisição em voo', {
                requestId: req._ultraDebugId,
                infoHash,
            });
        }
        let streamResponse = null;
        try {
            const tbResult = await promiseEmVoo;
            resolveLogger.info('📊 RESULTADO TORBOX', {
                requestId: req._ultraDebugId,
                success: tbResult.success,
                status: tbResult.status,
                hasStreamLink: !!tbResult.streamLink,
                message: tbResult.message?.substring(0, 150),
            });
            if (tbResult.success && tbResult.streamLink) {
                cacheService.set(cacheKey, tbResult.streamLink, CACHE_TTL);
                res.setHeader('Access-Control-Allow-Origin', '*');
                return res.redirect(302, tbResult.streamLink);
            }
            streamResponse = createStatusStreamForTorboxResult(baseUrl, tbResult, `resolve-${Date.now()}`, season, episode);
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
        return sendStatusVideo(res, resolveLogger, req._ultraDebugId, streamResponse.url);
    });
    app.get('/resolve/:magnet', async (req, res) => {
        const apiKey = req.query.apiKey;
        const season = req.query.season ? parseInt(req.query.season) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode) : undefined;
        const type = req.query.type || (season !== undefined ? 'series' : 'movie');
        const imdbId = req.query.imdbId;
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;
        let streamResponse = null;
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            if (!apiKey)
                throw new Error('API key obrigatória');
            const magnetHash = (await (0, magnetHelper_js_1.analisarMagnet)(magnet))?.infoHash;
            if (!magnetHash)
                throw new Error('Magnet inválido');
            const enrichedTitles = await getEnrichedTitlesForHash(magnetHash, imdbId, season);
            const titles = enrichedTitles.titles;
            const episodeTitles = enrichedTitles.episodeTitles;
            const tbResult = await processMagnetWithTorbox(magnet, apiKey, magnetHash, season, episode, type, undefined, titles, episodeTitles);
            if (tbResult.success && tbResult.streamLink) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                return res.redirect(302, tbResult.streamLink);
            }
            streamResponse = createStatusStreamForTorboxResult(baseUrl, tbResult, `resolve-${Date.now()}`, season, episode);
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
        return sendStatusVideo(res, logger, req._ultraDebugId, streamResponse.url);
    });
    app.get('/resolve/:magnet/status', async (req, res) => {
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            const apiKey = req.query.apiKey;
            if (!apiKey)
                return res.status(400).json({ success: false, error: 'API key obrigatória' });
            const magnetHash = (await (0, magnetHelper_js_1.analisarMagnet)(magnet))?.infoHash;
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
