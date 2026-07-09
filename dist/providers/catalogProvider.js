"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogProvider = void 0;
const qualityDetector_1 = require("../lib/qualityDetector");
const streamFormatter_1 = require("../lib/streamFormatter");
const magnetHelper_1 = require("../lib/magnetHelper");
const logger_1 = require("../utils/logger");
const MetadataExtractor_1 = require("../lib/title-filter/MetadataExtractor");
const repository_1 = require("../lib/repository");
const TorrentScraperService_1 = require("../services/scraper/TorrentScraperService");
const ImdbScraperService_1 = require("../services/ImdbScraperService");
const titleFilter_1 = require("../lib/titleFilter");
const AutoMagnetService_1 = require("../services/AutoMagnetService");
const MetricsService_1 = require("../services/MetricsService");
class CatalogProvider {
    constructor(magnetService) {
        this.magnetService = magnetService;
        this.streamCache = new Map();
        this.STREAM_TTL = 24 * 60 * 60 * 1000;
        this.STREAM_EMPTY_TTL = 10 * 1000;
        this.CACHE_KEY_SEPARATOR = '|';
        this.scrapingCache = new Map();
        this.scrapingCacheTTL = 6 * 60 * 60 * 1000;
        this.tmdbDataCache = new Map();
        this.TMDB_CACHE_TTL = 5 * 60 * 1000;
        this.logger = new logger_1.Logger('CatalogProvider');
        this.qualityDetector = qualityDetector_1.QualityDetector.getInstance();
        this.streamFormatter = streamFormatter_1.StreamFormatter.getInstance();
        this.metadataExtractor = MetadataExtractor_1.MetadataExtractor.getInstance();
        this.torrentScraper = new TorrentScraperService_1.TorrentScraperService();
        this.imdbScraper = ImdbScraperService_1.ImdbScraperService.getInstance();
        this.titleFilter = titleFilter_1.TitleFilter.getInstance();
        this.autoMagnetService = new AutoMagnetService_1.AutoMagnetService();
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
        uniqueStreams.forEach(s => MetricsService_1.metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
        if (uniqueStreams.length === 0) {
            const shouldScrape = await this.shouldAttemptScraping(request);
            if (!shouldScrape) {
                this.saveToCache(cacheKey, []);
                return [];
            }
            this.logger.debug(`🚀 Iniciando scraping para ${request.imdbId || request.id}`);
            const scraped = await this.performIntelligentScraping(request, season, episode);
            const scrapedUnique = this.removeDuplicatesByInfoHash(scraped);
            scrapedUnique.forEach(s => MetricsService_1.metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
            await this.updateScrapingCache(request, scrapedUnique.length > 0);
            this.saveToCache(cacheKey, scrapedUnique);
            return scrapedUnique;
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
        let searchQuery = '';
        let seasonYear = null;
        if (imdbId) {
            const tmdb = await this.getTmdbSearchData(imdbId, finalSeason);
            if (tmdb) {
                searchQuery = tmdb.searchTitle;
                seasonYear = tmdb.seasonYear;
            }
        }
        if (!searchQuery) {
            this.logger.warn('Sem título para scraping', { imdbId });
            return [];
        }
        if (type === 'series' && finalSeason) {
            searchQuery = `${searchQuery} Temporada ${finalSeason}`;
        }
        const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, finalSeason, seasonYear ?? undefined, imdbId || undefined);
        if (!torrentResults.length)
            return [];
        const uniqueTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
        const { valid, invalid } = await this.filterAndValidateTorrents(uniqueTorrents, imdbId, request, finalSeason, finalEpisode, (await this.getTmdbSearchData(imdbId, finalSeason)).imdbTitles);
        if (valid.length === 0)
            return [];
        const hasExactEpisode = finalEpisode !== undefined && valid.some(t => /s\d+e\d+/i.test(t.title) && this.extractEpisodeNumber(t.title) === finalEpisode);
        const hasCompletePack = valid.some(t => /temporada completa|season pack|pack/i.test(t.title));
        let episodeToSave = finalEpisode;
        if (!hasExactEpisode && hasCompletePack && finalSeason) {
            episodeToSave = null;
        }
        await this.saveValidTorrentsToCatalog(valid, request, finalSeason, episodeToSave, (await this.getTmdbSearchData(imdbId, finalSeason)).imdbTitles, !hasExactEpisode && hasCompletePack);
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
        const valid = [];
        const invalid = [];
        for (const torrent of torrents) {
            try {
                const matchResult = await this.titleFilter.doTitlesMatch(torrent.title, imdbId, season, episode);
                if (matchResult.matches) {
                    valid.push(torrent);
                }
                else {
                    if (season && /temporada completa|season pack|pack/i.test(torrent.title)) {
                        valid.push(torrent);
                    }
                    else {
                        invalid.push(torrent);
                    }
                }
            }
            catch {
                invalid.push(torrent);
            }
        }
        return { valid, invalid };
    }
    async saveValidTorrentsToCatalog(torrents, request, season, episode, imdbTitles = null, isPackFallback = false) {
        const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
        if (!imdbId || torrents.length === 0)
            return;
        for (const torrent of torrents) {
            try {
                const episodeValue = isPackFallback ? null : episode;
                await this.autoMagnetService.autoAddMagnet(torrent.magnet, torrent.title, imdbId, request.type, torrent.seeders, torrent.quality, torrent.size, season, episodeValue);
            }
            catch (error) {
                this.logger.error('Erro ao salvar magnet', { title: torrent.title.substring(0, 60), error: error instanceof Error ? error.message : 'Erro' });
            }
        }
    }
    async processTorrentsWithOptimization(torrents, request, season, episode) {
        const streams = [];
        const batchSize = 3;
        for (let i = 0; i < torrents.length; i += batchSize) {
            const batch = torrents.slice(i, i + batchSize);
            const batchPromises = batch.map(async (torrent) => {
                try {
                    return this.streamFormatter.createMultipleQualityStreams(torrent, request, null, request.type === 'series' ? 'series' : 'movie', season, episode, false);
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
            if (i + batchSize < torrents.length)
                await new Promise(resolve => setTimeout(resolve, 800));
        }
        return streams;
    }
    generateCacheKey(request, season, episode) {
        return `${request.imdbId || request.id}|${request.type}|${season ?? ''}|${episode ?? ''}`;
    }
    getFromCache(key) {
        const entry = this.streamCache.get(key);
        if (!entry) {
            MetricsService_1.metricsService.recordCacheMiss();
            return null;
        }
        const now = Date.now();
        const ttl = entry.isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
        if (now - entry.timestamp > ttl) {
            this.streamCache.delete(key);
            MetricsService_1.metricsService.recordCacheMiss();
            return null;
        }
        MetricsService_1.metricsService.recordCacheHit();
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
        const entry = this.scrapingCache.get(key);
        if (!entry)
            return true;
        const elapsed = Date.now() - entry.lastAttempt.getTime();
        if (!entry.successful && elapsed < this.scrapingCacheTTL / 2)
            return false;
        if (elapsed < 5 * 60 * 1000)
            return false;
        return true;
    }
    async updateScrapingCache(request, successful) {
        const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
        this.scrapingCache.set(key, { lastAttempt: new Date(), successful });
        for (const [k, v] of this.scrapingCache.entries()) {
            if (Date.now() - v.lastAttempt.getTime() > this.scrapingCacheTTL * 2)
                this.scrapingCache.delete(k);
        }
    }
    async getStreamsFromDatabase(request, season, episode) {
        const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
        if (!imdbId)
            return [];
        const finalSeason = season ?? request.season;
        const finalEpisode = episode ?? request.episode;
        let entries = [];
        if (request.type === 'movie') {
            entries = await (0, repository_1.getImdbIdMovieEntries)(imdbId);
        }
        else if (request.type === 'series' && finalSeason !== undefined) {
            entries = await (0, repository_1.getImdbIdSeriesEntries)(imdbId, finalSeason, finalEpisode);
        }
        if (!entries.length)
            return [];
        const torrentData = await this.processDatabaseTorrents(entries, request, finalSeason, finalEpisode);
        const sorted = this.sortTorrentsByQuality(torrentData);
        return this.createStreamsFromDbTorrents(sorted, request, finalSeason, finalEpisode);
    }
    async processDatabaseTorrents(entries, request, season, episode) {
        const map = new Map();
        for (const entry of entries) {
            const torrent = entry.Torrent;
            const magnet = torrent.magnetLink || '';
            const hash = (0, magnetHelper_1.extractHashFromMagnet)(magnet);
            if (!hash)
                continue;
            const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
            const quality = this.qualityDetector.extractBestQuality(torrent.title) || 'HD';
            map.set(hash, {
                torrent, metadata, quality,
                qualityScore: this.getQualityScore(quality),
                seeds: torrent.seeders || 50,
                size: this.formatSize(torrent.size || 0),
                language: torrent.languages || 'PT-BR',
                magnet, magnetHash: hash, title: torrent.title,
                requestType: request.type, season, episode
            });
        }
        return Array.from(map.values());
    }
    async createStreamsFromDbTorrents(torrents, request, season, episode) {
        const streams = [];
        for (const t of torrents) {
            const formatted = {
                title: t.title, magnet: t.magnet, seeders: t.seeds,
                size: t.size, quality: t.quality, language: t.language
            };
            const streamArrays = this.streamFormatter.createMultipleQualityStreams(formatted, request, null, t.requestType, season, episode, undefined, 0);
            streams.push(...streamArrays);
        }
        return streams;
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
            const streamArrays = this.streamFormatter.createMultipleQualityStreams(formatted, request, null, request.type === 'series' ? 'series' : 'movie', season ?? magnet.season, episode ?? magnet.episode, undefined, 0);
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
    deduplicateTorrentsByMagnet(torrents) {
        const seen = new Set();
        const unique = [];
        for (const t of torrents) {
            const hash = (0, magnetHelper_1.extractHashFromMagnet)(t.magnet);
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
            scrapingCacheSize: this.scrapingCache.size,
            tmdbCacheSize: this.tmdbDataCache.size
        };
    }
}
exports.CatalogProvider = CatalogProvider;
