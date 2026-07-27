"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogProvider = void 0;
const qualityDetector_js_1 = require("../lib/qualityDetector.js");
const streamFormatter_js_1 = require("../lib/streamFormatter.js");
const magnetHelper_js_1 = require("../lib/magnetHelper.js");
const logger_js_1 = require("../utils/logger.js");
const MetadataExtractor_js_1 = require("../lib/title-filter/MetadataExtractor.js");
const TorrentScraperService_js_1 = require("../services/scraper/TorrentScraperService.js");
const ImdbScraperService_js_1 = require("../services/ImdbScraperService.js");
const titleFilter_js_1 = require("../lib/titleFilter.js");
const AutoMagnetService_js_1 = require("../services/AutoMagnetService.js");
const MetricsService_js_1 = require("../services/MetricsService.js");
const TorrentioService_js_1 = require("../services/TorrentioService.js");
class CatalogProvider {
    constructor(magnetService) {
        this.magnetService = magnetService;
        this.streamCache = new Map();
        this.STREAM_TTL = 24 * 60 * 60 * 1000;
        this.STREAM_EMPTY_TTL = 10 * 1000;
        this.CACHE_KEY_SEPARATOR = '|';
        this.inFlightScraping = new Set();
        this.tmdbDataCache = new Map();
        this.TMDB_CACHE_TTL = 5 * 60 * 1000;
        this.logger = new logger_js_1.Logger('CatalogProvider');
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.streamFormatter = streamFormatter_js_1.StreamFormatter.getInstance();
        this.metadataExtractor = MetadataExtractor_js_1.MetadataExtractor.getInstance();
        this.torrentScraper = new TorrentScraperService_js_1.TorrentScraperService();
        this.imdbScraper = ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.titleFilter = titleFilter_js_1.TitleFilter.getInstance();
        this.autoMagnetService = new AutoMagnetService_js_1.AutoMagnetService();
        this.torrentioService = new TorrentioService_js_1.TorrentioService();
    }
    async getTmdbSearchData(imdbId, season) {
        const cacheKey = season !== undefined ? `${imdbId}:s${season}` : imdbId;
        const cached = this.tmdbDataCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.TMDB_CACHE_TTL)
            return cached.data;
        let imdbTitles = null;
        let searchTitle = '';
        let seasonYear = null;
        let mediaType = null;
        try {
            imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
            if (imdbTitles?.allTitles.length) {
                searchTitle = imdbTitles.allTitles[0];
                seasonYear = imdbTitles.year || null;
                mediaType = imdbTitles.mediaType || null;
            }
        }
        catch (error) {
            this.logger.warn('Erro ao obter dados TMDB', { imdbId, season, error: error instanceof Error ? error.message : 'Erro' });
        }
        const data = { searchTitle, imdbTitles, seasonYear, mediaType };
        this.tmdbDataCache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
    }
    async getSeasonYear(imdbId, season) {
        const tmdb = await this.getTmdbSearchData(imdbId, season);
        return tmdb.seasonYear;
    }
    async getStreamsFromCatalog(request) {
        const startTime = Date.now();
        const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
        const cacheKey = this.generateCacheKey(request, season, episode);
        const cached = this.getFromCache(cacheKey);
        if (cached !== null)
            return cached;
        let allStreams = [];
        const jsonStreams = await this.getStreamsFromJson(request, season, episode);
        allStreams.push(...jsonStreams);
        const uniqueStreams = this.removeDuplicatesByInfoHash(allStreams);
        uniqueStreams.forEach(s => MetricsService_js_1.metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
        if (uniqueStreams.length === 0) {
            const shouldScrape = await this.shouldAttemptScraping(request);
            if (!shouldScrape) {
                this.saveToCache(cacheKey, []);
                return [];
            }
            this.markScrapingStart(request);
            try {
                this.logger.debug(` Iniciando scraping para ${request.imdbId || request.id}`);
                const scraped = await this.performIntelligentScraping(request, season, episode);
                const scrapedUnique = this.removeDuplicatesByInfoHash(scraped);
                scrapedUnique.forEach(s => MetricsService_js_1.metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
                this.saveToCache(cacheKey, scrapedUnique);
                return scrapedUnique;
            }
            finally {
                this.markScrapingEnd(request);
            }
        }
        this.saveToCache(cacheKey, uniqueStreams);
        return uniqueStreams;
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
        let searchQuery = tmdb.searchTitle;
        const seasonYear = tmdb.seasonYear;
        if (type === 'series' && finalSeason) {
            searchQuery = `${searchQuery} Temporada ${finalSeason}`;
        }
        const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, finalSeason, seasonYear ?? undefined, imdbId || undefined);
        if (!torrentResults.length)
            return [];
        const uniqueTorrents = await this.deduplicateTorrentsByMagnet(torrentResults);
        const { valid, invalid } = await this.filterAndValidateTorrents(uniqueTorrents, imdbId, request, finalSeason, finalEpisode, tmdb.imdbTitles);
        if (valid.length === 0) {
            this.logger.debug('🔒 Torrentio fallback BLOQUEADO — apenas scrapers BR', { imdbId });
        }
        if (valid.length === 0)
            return [];
        const hasExactEpisode = finalEpisode !== undefined && valid.some(t => /s\d+e\d+/i.test(t.title) && this.extractEpisodeNumber(t.title) === finalEpisode);
        const hasCompletePack = valid.some(t => /\b(?:temporada completa|season pack|complete pack)\b/i.test(t.title));
        let episodeToSave = finalEpisode;
        if (!hasExactEpisode && hasCompletePack && finalSeason) {
            episodeToSave = null;
        }
        await this.saveValidTorrentsToCatalog(valid, request, finalSeason, episodeToSave, tmdb.imdbTitles, !hasExactEpisode && hasCompletePack);
        const streams = await this.processTorrentsWithOptimization(valid, request, finalSeason, finalEpisode);
        return this.streamFormatter.sortStreamsByQuality(streams);
    }
    extractEpisodeNumber(title) {
        const match = title.match(/e(\d+)/i);
        return match ? parseInt(match[1]) : null;
    }
    async filterAndValidateTorrents(torrents, imdbId, request, season, episode, imdbTitles = null) {
        if (!imdbId)
            return { valid: torrents, invalid: [] };
        const ptTorrents = torrents.filter(t => this.titleFilter.conteudoEmPortugues(t.title));
        const dadosMagnets = await Promise.all(ptTorrents.map(t => (0, magnetHelper_js_1.analisarMagnet)(t.magnet).catch(() => null)));
        const results = await Promise.allSettled(ptTorrents.map((t, i) => {
            const nomeCanonico = dadosMagnets[i]?.nome;
            const tituloParaValidar = nomeCanonico || t.title;
            return this.titleFilter.titulosCombinam(tituloParaValidar, imdbId, season, episode);
        }));
        const valid = [];
        const invalid = torrents.filter(t => !ptTorrents.includes(t));
        const completePackRe = /\b(?:temporada completa|season pack|complete pack)\b/i;
        results.forEach((result, i) => {
            const torrent = ptTorrents[i];
            if (result.status === 'fulfilled' && result.value.matches) {
                valid.push(torrent);
            }
            else if (season && completePackRe.test(torrent.title)) {
                valid.push(torrent);
            }
            else {
                invalid.push(torrent);
            }
        });
        return { valid, invalid };
    }
    async saveValidTorrentsToCatalog(torrents, request, season, episode, imdbTitles = null, isPackFallback = false) {
        const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
        if (!imdbId || torrents.length === 0)
            return;
        this.logger.debug('🔒 DB BLOQUEADO (teste) — saveValidTorrentsToCatalog ignorado', { count: torrents.length, imdbId });
    }
    async processTorrentsWithOptimization(torrents, request, season, episode) {
        const streams = [];
        const batchSize = 5;
        for (let i = 0; i < torrents.length; i += batchSize) {
            const batch = torrents.slice(i, i + batchSize);
            const batchPromises = batch.map(async (torrent) => {
                try {
                    return await this.streamFormatter.createMultipleQualityStreams(torrent, request, null, request.type === 'series' ? 'series' : 'movie', season, episode, false);
                }
                catch {
                    return [];
                }
            });
            const results = await Promise.allSettled(batchPromises);
            for (const r of results) {
                if (r.status === 'fulfilled')
                    streams.push(...r.value);
            }
        }
        return streams;
    }
    generateCacheKey(request, season, episode) {
        return `${request.imdbId || request.id}|${request.type}|${season ?? ''}|${episode ?? ''}`;
    }
    getFromCache(key) {
        const entry = this.streamCache.get(key);
        if (!entry) {
            MetricsService_js_1.metricsService.recordCacheMiss();
            return null;
        }
        const now = Date.now();
        const ttl = entry.isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
        if (now - entry.timestamp > ttl) {
            this.streamCache.delete(key);
            MetricsService_js_1.metricsService.recordCacheMiss();
            return null;
        }
        MetricsService_js_1.metricsService.recordCacheHit();
        return entry.streams;
    }
    saveToCache(key, streams) {
        this.streamCache.set(key, { streams, timestamp: Date.now(), isEmpty: streams.length === 0 });
        if (this.streamCache.size > 10000)
            this.cleanupOldCache();
    }
    cleanupOldCache() {
        const now = Date.now();
        for (const [key, entry] of this.streamCache.entries()) {
            if (now - entry.timestamp > 7 * 24 * 60 * 60 * 1000)
                this.streamCache.delete(key);
        }
    }
    async shouldAttemptScraping(request) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        if (this.inFlightScraping.has(key)) {
            this.logger.debug(' Scraping já em andamento, aguardando...', { key });
            return false;
        }
        return true;
    }
    markScrapingStart(request) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        this.inFlightScraping.add(key);
    }
    markScrapingEnd(request) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        this.inFlightScraping.delete(key);
    }
    async getStreamsFromJson(request, season, episode) {
        const curated = this.magnetService.searchMagnets(request);
        if (!curated.length)
            return [];
        const streams = [];
        for (const magnet of curated) {
            const formatted = {
                title: magnet.title, magnet: magnet.magnet || '',
                seeders: magnet.seeds || 0, size: magnet.size || 'N/A',
                quality: magnet.quality || 'HD', language: magnet.language || 'PT-BR'
            };
            const streamArrays = await this.streamFormatter.createMultipleQualityStreams(formatted, request, null, request.type === 'series' ? 'series' : 'movie', season ?? magnet.season, episode ?? magnet.episode, undefined, 0);
            streams.push(...streamArrays);
        }
        return streams;
    }
    removeDuplicatesByInfoHash(streams) {
        const seen = new Set();
        const unique = [];
        for (const s of streams) {
            const hash = s.infoHash || s.url || s.title || Math.random().toString();
            const quality = this.extractStreamQuality(s);
            const key = `${hash}|${quality}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            unique.push(s);
        }
        return unique;
    }
    extractStreamQuality(stream) {
        return stream.behaviorHints?.streamQuality ||
            this.qualityDetector.extractBestQuality(stream.title || '') ||
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
        const m = id.match(/^(tt\d+)/);
        return m ? m[1] : null;
    }
    sortTorrentsByQuality(torrents) {
        return torrents.sort((a, b) => b.qualityScore - a.qualityScore || b.seeds - a.seeds);
    }
    getQualityScore(quality) {
        const scores = { '2160p': 100, '4k': 100, '1080p': 80, '720p': 60, 'HD': 40, 'SD': 20 };
        return scores[quality] || 30;
    }
    formatSize(bytes) {
        if (bytes < 1024 * 1024)
            return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024)
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
    async deduplicateTorrentsByMagnet(torrents) {
        const seen = new Set();
        const unique = [];
        for (const t of torrents) {
            const hash = (await (0, magnetHelper_js_1.analisarMagnet)(t.magnet))?.infoHash;
            if (hash && seen.has(hash.toLowerCase()))
                continue;
            if (hash)
                seen.add(hash.toLowerCase());
            unique.push(t);
        }
        return unique;
    }
    clearTmdbCache() { this.tmdbDataCache.clear(); }
    getStats() {
        return {
            cacheSize: this.streamCache.size,
            inFlightScraping: this.inFlightScraping.size,
            tmdbCacheSize: this.tmdbDataCache.size
        };
    }
}
exports.CatalogProvider = CatalogProvider;
