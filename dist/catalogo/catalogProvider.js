"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogProvider = void 0;
const qualityDetector_js_1 = require("../lib/qualityDetector.js");
const streamFormatter_js_1 = require("../stream/streamFormatter.js");
const magnetHelper_js_1 = require("../magnet/magnetHelper.js");
const logger_js_1 = require("../utils/logger.js");
const TorrentScraperService_js_1 = require("../services/scraper/TorrentScraperService.js");
const ImdbScraperService_js_1 = require("../catalogo/ImdbScraperService.js");
const titleFilter_js_1 = require("../titulos/titleFilter.js");
const AutoMagnetService_js_1 = require("../debrid/AutoMagnetService.js");
const MetricsService_js_1 = require("../catalogo/MetricsService.js");
const TechnicalWords_js_1 = require("../titulos/TechnicalWords.js");
const LEGENDADO_REGEX = new RegExp('\\b(' + TechnicalWords_js_1.INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b', 'i');
class CatalogProvider {
    constructor() {
        this.streamCache = new Map();
        this.STREAM_TTL = 6 * 60 * 60 * 1000;
        this.STREAM_EMPTY_TTL = 10 * 1000;
        this.MAX_STREAM_CACHE_SIZE = 5000;
        this.inFlightScraping = new Set();
        this.cleanupTimer = null;
        this.CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;
        this.logger = new logger_js_1.Logger('CatalogProvider');
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.streamFormatter = streamFormatter_js_1.StreamFormatter.getInstance();
        this.torrentScraper = new TorrentScraperService_js_1.TorrentScraperService();
        this.imdbScraper = ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.titleFilter = titleFilter_js_1.TitleFilter.getInstance();
        this.autoMagnetService = new AutoMagnetService_js_1.AutoMagnetService();
        this.startCacheCleanup();
    }
    startCacheCleanup() {
        if (this.cleanupTimer)
            return;
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of this.streamCache.entries()) {
                const ttl = entry.isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
                if (now - entry.timestamp > ttl) {
                    this.streamCache.delete(key);
                }
            }
        }, this.CACHE_CLEANUP_INTERVAL);
        this.cleanupTimer.unref?.();
    }
    getFromMap(map, key, ttl) {
        const entry = map.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.timestamp > ttl) {
            map.delete(key);
            return null;
        }
        return entry.data;
    }
    setToMap(map, key, data, maxSize) {
        if (map.size >= maxSize) {
            const firstKey = map.keys().next().value;
            if (firstKey)
                map.delete(firstKey);
        }
        map.set(key, { data, timestamp: Date.now() });
    }
    async getTmdbSearchData(imdbId, season) {
        let imdbTitles = null;
        let searchTitle = '';
        let seasonYear = null;
        let mediaType = null;
        try {
            imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
            if (imdbTitles?.allTitles.length) {
                searchTitle = imdbTitles.allTitles[imdbTitles.allTitles.length - 1] || imdbTitles.allTitles[0];
                seasonYear = imdbTitles.year || null;
                mediaType = imdbTitles.mediaType || null;
            }
        }
        catch (error) {
            this.logger.warn('Erro ao obter dados TMDB', { imdbId, season, error: error instanceof Error ? error.message : 'Erro' });
        }
        return { searchTitle, imdbTitles, seasonYear, mediaType };
    }
    async getSeasonYear(imdbId, season) {
        const tmdb = await this.getTmdbSearchData(imdbId, season);
        return tmdb.seasonYear;
    }
    async getStreamsFromCatalog(request) {
        const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
        const cacheKey = this.generateCacheKey(request, season, episode);
        const cached = this.getFromCache(cacheKey);
        if (cached !== null) {
            this.logger.debug('CATALOG_CACHE_HIT', { cacheKey, totalStreams: cached.length });
            return this.streamFormatter.sortStreamsByQuality(cached);
        }
        this.logger.debug('CATALOG_START', {
            cacheKey,
            temCache: false,
            request: { id: request.id, imdbId: request.imdbId, type: request.type }
        });
        let uniqueStreams = [];
        if (uniqueStreams.length === 0) {
            const shouldScrape = await this.shouldAttemptScraping(request);
            if (!shouldScrape) {
                this.saveToCache(cacheKey, []);
                return [];
            }
            this.markScrapingStart(request);
            try {
                const scraped = await this.performIntelligentScraping(request, season, episode);
                uniqueStreams = this.removeDuplicatesByInfoHash(scraped);
            }
            finally {
                this.markScrapingEnd(request);
            }
        }
        const sorted = this.streamFormatter.sortStreamsByQuality(uniqueStreams);
        sorted.forEach(s => MetricsService_js_1.metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
        this.logger.info('📋 Catálogo', {
            imdbId: request.imdbId || request.id,
            season,
            episode,
            total: sorted.length,
            qualidades: [...new Set(sorted.map(s => this.extractStreamQuality(s)))],
        });
        this.saveToCache(cacheKey, sorted);
        return sorted;
    }
    async performIntelligentScraping(request, season, episode) {
        const type = request.type;
        const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
        const finalSeason = season ?? (match ? parseInt(match[1]) : undefined);
        const finalEpisode = episode ?? (match ? parseInt(match[2]) : undefined);
        const tmdb = imdbId ? await this.getTmdbSearchData(imdbId, finalSeason) : null;
        if (!tmdb || !tmdb.searchTitle) {
            this.logger.warn('Sem título para scraping', { imdbId });
            return [];
        }
        const mediaTypeEfetivo = type === 'movie' ? 'movie' :
            type === 'series' ? 'series' :
                (tmdb.mediaType === 'movie' || tmdb.mediaType === 'tv') ? tmdb.mediaType :
                    undefined;
        if (finalSeason !== undefined && tmdb.imdbTitles?.episodeTitles) {
            const lista = tmdb.imdbTitles.episodeTitles;
            const statusEp = lista.length === 0 ? 'VAZIO' : `${lista.length} eps`;
            const epAlvo = finalEpisode !== undefined ? lista.find(e => e.episodeNumber === finalEpisode) : undefined;
            this.logger.info('🎯 Episódio alvo (scraping)', {
                alvo: finalEpisode !== undefined ? `${finalSeason}x${finalEpisode}` : `S${finalSeason}`,
                episodeTitles: statusEp,
                namePt: epAlvo?.namePt || '-',
                nameEn: epAlvo?.nameEn || '-',
            });
        }
        let searchQuery = tmdb.searchTitle;
        if (type === 'series' && finalSeason) {
            searchQuery = `${searchQuery} Temporada ${finalSeason}`;
        }
        const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, finalSeason, tmdb.seasonYear ?? undefined, imdbId || undefined, mediaTypeEfetivo);
        this.logarResumo('PÓS-SCRAPER', torrentResults);
        await this.enrichTorrentsWithMagnetData(torrentResults);
        this.logarResumo('PÓS-ENRICH', torrentResults);
        const imdbConfirmados = torrentResults.filter(t => t.imdbConfirmed);
        if (imdbConfirmados.length > 0) {
            const porProvider = new Map();
            for (const t of imdbConfirmados) {
                porProvider.set(t.provider, (porProvider.get(t.provider) || 0) + 1);
            }
            const resumo = [...porProvider.entries()].map(([p, n]) => `${p}=${n}`).join(', ');
            this.logger.debug(`IMDB_CONFIRMADOS | total=${imdbConfirmados.length} | ${resumo}`);
        }
        const uniqueTorrents = await this.deduplicateTorrentsByMagnet(torrentResults);
        const { valid, invalid } = await this.filterAndValidateTorrents(uniqueTorrents, imdbId, request, finalSeason, finalEpisode, tmdb.imdbTitles, mediaTypeEfetivo);
        if (valid.length === 0) {
            this.logger.info('📋 Scraping: todos torrents filtrados — 0 válidos', {
                imdbId, season: finalSeason, episode: finalEpisode,
                totalScraped: uniqueTorrents.length, totalInvalid: invalid.length
            });
            return [];
        }
        const hasExactEpisode = finalEpisode !== undefined && valid.some(t => /s\d+e\d+/i.test(t.title) && this.extractEpisodeNumber(t.title) === finalEpisode);
        const hasCompletePack = valid.some(t => /\b(?:temporada completa|season pack|complete pack)\b/i.test(t.title) ||
            (() => {
                const r = (0, TechnicalWords_js_1.extrairRangeEpisodios)(t.canonicalName || t.title);
                return r !== null && r.seasonStart > 0 && r.episodeStart === 0 && r.episodeEnd === 0 && (0, TechnicalWords_js_1.temporadaAlvoNoRange)(r, finalSeason);
            })());
        let episodeToSave = finalEpisode;
        if (!hasExactEpisode && hasCompletePack && finalSeason) {
            episodeToSave = null;
        }
        await this.saveValidTorrentsToCatalog(valid, request, finalSeason, episodeToSave, tmdb.imdbTitles, !hasExactEpisode && hasCompletePack);
        return this.processTorrentsWithOptimization(valid, request, finalSeason, finalEpisode);
    }
    logarResumo(prefixo, torrents) {
        if (torrents.length === 0) {
            this.logger.debug(`${prefixo} | total=0`);
            return;
        }
        const porProvider = new Map();
        for (const t of torrents) {
            porProvider.set(t.provider, (porProvider.get(t.provider) || 0) + 1);
        }
        const resumo = [...porProvider.entries()]
            .map(([p, n]) => `${p}=${n}`)
            .join(', ');
        this.logger.debug(`${prefixo} | total=${torrents.length} | ${resumo}`);
    }
    extractEpisodeNumber(title) {
        const match = title.match(/e(\d+)/i);
        return match ? parseInt(match[1]) : null;
    }
    async enrichTorrentsWithMagnetData(torrents) {
        const needData = torrents.filter(t => !t.infoHash || !t.canonicalName);
        if (needData.length === 0)
            return;
        const results = await Promise.all(needData.map(t => (0, magnetHelper_js_1.analisarMagnet)(t.magnet).catch(() => null)));
        let atualizados = 0;
        needData.forEach((t, i) => {
            const r = results[i];
            if (r?.nome)
                t.canonicalName = r.nome;
            if (r?.infoHash)
                t.infoHash = r.infoHash.toLowerCase();
            if (r?.nome || r?.infoHash)
                atualizados++;
        });
        this.logger.debug(`ENRICH | precisavam=${needData.length} atualizados=${atualizados} total=${torrents.length}`);
    }
    async deduplicateTorrentsByMagnet(torrents) {
        const seen = new Set();
        const unique = [];
        let removidos = 0;
        for (const t of torrents) {
            const hash = t.infoHash;
            const chave = hash ? hash.toLowerCase() : (t.title || t.canonicalName || '').toLowerCase().trim();
            if (seen.has(chave)) {
                removidos++;
                continue;
            }
            seen.add(chave);
            unique.push(t);
        }
        this.logger.debug(`DEDUP | entrada=${torrents.length} saida=${unique.length} removidos=${removidos}`);
        return unique;
    }
    mencionaTituloTmdb(texto, imdbTitles) {
        if (!texto || !imdbTitles)
            return false;
        const palavras = (0, TechnicalWords_js_1.normalizarTexto)(texto).split(' ').filter(p => p.length > 3);
        if (palavras.length === 0)
            return false;
        const palavrasTmdb = new Set(imdbTitles.allTitles
            .flatMap(t => (0, TechnicalWords_js_1.normalizarTexto)(t).split(' '))
            .filter(p => p.length > 3));
        return palavras.some(p => palavrasTmdb.has(p));
    }
    escolherTituloParaValidar(original, title, htmlTitle, canonicalName, isCollection, imdbTitles) {
        if (isCollection) {
            if (this.mencionaTituloTmdb(htmlTitle, imdbTitles))
                return htmlTitle;
            if (this.mencionaTituloTmdb(canonicalName, imdbTitles))
                return canonicalName;
            if (htmlTitle && (0, TechnicalWords_js_1.normalizarTexto)(htmlTitle).length > 0)
                return htmlTitle;
            if (canonicalName && (0, TechnicalWords_js_1.normalizarTexto)(canonicalName).length > 0)
                return canonicalName;
        }
        if (original && (0, TechnicalWords_js_1.normalizarTexto)(original).length > 0)
            return original;
        return title || '';
    }
    async filterAndValidateTorrents(torrents, imdbId, request, season, episode, imdbTitles = null, mediaType) {
        if (!imdbId)
            return { valid: torrents, invalid: [] };
        const naoLegendado = torrents.filter(t => !(t.language && LEGENDADO_REGEX.test(t.language)));
        const results = await Promise.allSettled(naoLegendado.map(async (t) => {
            const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(t.originalTitle || t.title, mediaType);
            if (isCollection &&
                !this.mencionaTituloTmdb(t.htmlTitle, imdbTitles) &&
                !this.mencionaTituloTmdb(t.canonicalName, imdbTitles)) {
                const tituloExibicao = t.originalTitle || t.title;
                t.canonicalName = tituloExibicao;
                this.logger.info('🎯 ACEITO (pack de coleção sem título)', {
                    imdbId,
                    torrent: tituloExibicao.substring(0, 70),
                    provider: t.provider,
                    infoHash: t.infoHash?.substring(0, 12) || 'N/A',
                });
                return {
                    torrent: t,
                    result: { matches: true, similarity: 0.8, reason: 'Pack de coleção sem título' },
                };
            }
            const tituloParaValidar = this.escolherTituloParaValidar(t.originalTitle, t.title, t.htmlTitle, t.canonicalName, isCollection, imdbTitles);
            const tituloParaIdioma = t.title || t.originalTitle || '';
            this.logger.debug(`TITLEFILTER_IN | "${(tituloParaValidar || t.title).substring(0, 60)}" | ` +
                `isCollection=${isCollection} | ano=${t.year ?? '-'} years=[${t.years?.join(',') ?? '-'}] ` +
                `imdbConfirmed=${t.imdbConfirmed ?? false} provider=${t.provider}`);
            const result = await this.titleFilter.titulosCombinam(tituloParaValidar, imdbId, season, episode, tituloParaIdioma, t.year, imdbTitles, t.htmlTitle, t.episode, t.imdbConfirmed, t.years);
            return { torrent: t, result };
        }));
        const valid = [];
        const invalid = [];
        results.forEach((res, i) => {
            if (res.status === 'fulfilled') {
                const { torrent, result } = res.value;
                if (result.matches) {
                    if (result.reason !== 'Pack de coleção sem título') {
                        this.logger.info('🎯 ACEITO', {
                            imdbId,
                            alvo: `S${season ?? '?'}E${episode ?? '?'}`,
                            torrent: (torrent.canonicalName || torrent.title).substring(0, 70),
                            provider: torrent.provider,
                            infoHash: torrent.infoHash?.substring(0, 12) || 'N/A'
                        });
                    }
                    valid.push(torrent);
                }
                else {
                    invalid.push(torrent);
                }
            }
            else {
                invalid.push(naoLegendado[i]);
            }
        });
        if (invalid.length > 0) {
            const razoes = {};
            results.forEach((res) => {
                if (res.status === 'fulfilled' && !res.value.result.matches) {
                    const motivo = res.value.result.reason?.split('|')[0]?.trim() || 'desconhecido';
                    razoes[motivo] = (razoes[motivo] || 0) + 1;
                }
                else if (res.status === 'rejected') {
                    razoes['erro interno'] = (razoes['erro interno'] || 0) + 1;
                }
            });
            const topRazoes = Object.entries(razoes).sort((a, b) => b[1] - a[1]).slice(0, 5)
                .map(([k, v]) => `${v}x ${k}`).join(' | ');
            this.logger.info('📋 Rejeitados', {
                imdbId,
                alvo: `S${season ?? '?'}E${episode ?? '?'}`,
                total: invalid.length,
                motivos: topRazoes,
                aceitos: valid.length,
                scraped: torrents.length,
                lendario: torrents.length - naoLegendado.length,
            });
        }
        return { valid, invalid };
    }
    async saveValidTorrentsToCatalog(torrents, request, season, episode, imdbTitles = null, isPackFallback = false) {
        if (process.env.SKIP_DB_WRITE === 'true')
            return;
        const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
        if (!imdbId || torrents.length === 0)
            return;
        const batchSize = 5;
        for (let i = 0; i < torrents.length; i += batchSize) {
            const batch = torrents.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(async (torrent) => {
                try {
                    const episodeValue = isPackFallback ? null : episode;
                    await this.autoMagnetService.autoAddMagnet(torrent.magnet, torrent.title || torrent.canonicalName || '', imdbId, request.type, torrent.seeders, torrent.quality, torrent.size, season, episodeValue, torrent.infoHash, torrent.provider, torrent.originalTitle, torrent.htmlTitle);
                }
                catch (error) {
                    this.logger.error('Erro ao salvar magnet', { title: torrent.title.substring(0, 60), error: error instanceof Error ? error.message : 'Erro' });
                }
            }));
        }
    }
    async processInBatches(items, processItem, batchSize = 5) {
        const streams = [];
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(processItem));
            for (const r of results) {
                if (r.status === 'fulfilled')
                    streams.push(...r.value);
            }
        }
        return streams;
    }
    async processTorrentsWithOptimization(torrents, request, season, episode) {
        return this.processInBatches(torrents, async (torrent) => {
            return await this.streamFormatter.createMultipleQualityStreams(torrent, request, null, request.type === 'series' ? 'series' : 'movie', season, episode, false);
        });
    }
    generateCacheKey(request, season, episode) {
        return `${request.imdbId || request.id}|${request.type}|${season ?? ''}|${episode ?? ''}`;
    }
    getFromCache(key) {
        const cached = this.getFromMap(this.streamCache, key, this.STREAM_TTL);
        if (cached !== null) {
            MetricsService_js_1.metricsService.recordCacheHit();
            return cached;
        }
        MetricsService_js_1.metricsService.recordCacheMiss();
        return null;
    }
    saveToCache(key, streams) {
        const isEmpty = streams.length === 0;
        this.setToMap(this.streamCache, key, streams, this.MAX_STREAM_CACHE_SIZE);
        const entry = this.streamCache.get(key);
        if (entry) {
            entry.isEmpty = isEmpty;
        }
    }
    async shouldAttemptScraping(request) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        return !this.inFlightScraping.has(key);
    }
    markScrapingStart(request) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        this.inFlightScraping.add(key);
    }
    markScrapingEnd(request) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        this.inFlightScraping.delete(key);
    }
    removeDuplicatesByInfoHash(streams) {
        const seen = new Set();
        const unique = [];
        for (const s of streams) {
            let hash = (s.infoHash || '').toLowerCase();
            if (!hash && s.url) {
                const m = s.url.match(/\/resolve\/torbox\/[^/]+\/([a-z0-9]+)/i);
                if (m)
                    hash = m[1].toLowerCase();
            }
            if (!hash)
                hash = (s.title || s.name || 'unknown').toLowerCase();
            let quality = s.behaviorHints?.streamQuality || '';
            if (!quality && s.name) {
                const qm = s.name.match(/\b(\d{3,4}p|4k|uhd|hd|sd)\b/i);
                if (qm)
                    quality = qm[1].toLowerCase();
            }
            if (!quality && s.title) {
                quality = this.qualityDetector.extractBestQuality(s.title) || 'unknown';
            }
            if (!quality)
                quality = 'unknown';
            const key = `${hash}_${quality}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            unique.push(s);
        }
        return unique;
    }
    extractStreamQuality(stream) {
        return stream.behaviorHints?.streamQuality ||
            this.qualityDetector.extractBestQuality(stream.name || stream.title || '') ||
            'unknown';
    }
    extractSeasonEpisodeFromRequest(request) {
        let season = request.season;
        let episode = request.episode;
        if (!season && request.type === 'series' && request.id) {
            const m = request.id.match(/tt\d+:(\d+):(\d+)/);
            if (m) {
                season = parseInt(m[1]);
                episode = parseInt(m[2]);
            }
        }
        return { season, episode };
    }
    extractBaseImdbId(id) {
        const m = id.match(/^tt\d+/);
        return m ? m[0] : null;
    }
    clearTmdbCache() {
        ImdbScraperService_js_1.ImdbScraperService.clearGlobalCache();
    }
    getStats() {
        return {
            cacheSize: this.streamCache.size,
            inFlightScraping: this.inFlightScraping.size,
        };
    }
}
exports.CatalogProvider = CatalogProvider;
