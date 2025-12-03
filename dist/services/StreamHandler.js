"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamHandler = void 0;
const RealDebridService_1 = require("./RealDebridService");
const CuratedMagnetService_1 = require("./CuratedMagnetService");
const AutoMagnetService_1 = require("./AutoMagnetService");
const CacheService_1 = require("./CacheService");
const TorrentScraperService_1 = require("./scraper/TorrentScraperService");
const ImdbScraperService_1 = require("./ImdbScraperService");
const logger_1 = require("../utils/logger");
const sequelize_1 = require("sequelize");
const models_1 = require("../database/models");
const qualityDetector_1 = require("../lib/qualityDetector");
const magnetHelper_1 = require("../lib/magnetHelper");
const stringUtils_1 = require("../lib/stringUtils");
const episodeMatcher_1 = require("../lib/episodeMatcher");
const titleFilter_1 = require("../lib/titleFilter");
const streamFormatter_1 = require("../lib/streamFormatter");
const catalogProvider_1 = require("../providers/catalogProvider");
class StreamHandler {
    constructor() {
        this.processingConfig = {
            maxConcurrentTorrents: 3,
            delayBetweenTorrents: 800
        };
        this.scrapingCache = new Map();
        this.scrapingCacheTTL = 6 * 60 * 60 * 1000;
        this.stats = {
            totalRequests: 0,
            servedFromDatabase: 0,
            servedFromCatalog: 0,
            servedFromScraping: 0,
            duplicatesRemoved: 0
        };
        this.rdService = new RealDebridService_1.RealDebridService();
        this.magnetService = new CuratedMagnetService_1.CuratedMagnetService();
        this.autoMagnetService = new AutoMagnetService_1.AutoMagnetService();
        this.cacheService = new CacheService_1.CacheService();
        this.torrentScraper = new TorrentScraperService_1.TorrentScraperService();
        this.imdbScraper = new ImdbScraperService_1.ImdbScraperService();
        this.logger = new logger_1.Logger('StreamHandler');
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        this.episodeMatcher = new episodeMatcher_1.EpisodeMatcher();
        this.titleFilter = new titleFilter_1.TitleFilter();
        this.streamFormatter = new streamFormatter_1.StreamFormatter();
        this.catalogProvider = new catalogProvider_1.CatalogProvider(this.magnetService);
    }
    deduplicateStreamsByInfoHash(streams) {
        const seenHashes = new Set();
        const uniqueStreams = [];
        for (const stream of streams) {
            let infoHash;
            if (stream.infoHash) {
                infoHash = stream.infoHash.toLowerCase();
            }
            else if (stream.sources && stream.sources[0]) {
                const magnetMatch = stream.sources[0].match(/btih:([a-zA-Z0-9]{40})/i);
                if (magnetMatch) {
                    infoHash = magnetMatch[1].toLowerCase();
                }
            }
            if (!infoHash) {
                const fallbackKey = `${stream.title}|${stream.name}`.toLowerCase();
                if (seenHashes.has(fallbackKey)) {
                    this.logger.debug('Stream duplicado ignorado (fallback)', {
                        title: stream.title,
                        reason: 'Duplicata por título/qualidade'
                    });
                    this.stats.duplicatesRemoved++;
                    continue;
                }
                seenHashes.add(fallbackKey);
                uniqueStreams.push(stream);
            }
            else if (seenHashes.has(infoHash)) {
                this.logger.debug('Stream duplicado ignorado', {
                    title: stream.title,
                    infoHash: infoHash.substring(0, 8) + '...',
                    reason: 'Duplicata por infoHash'
                });
                this.stats.duplicatesRemoved++;
                continue;
            }
            else {
                seenHashes.add(infoHash);
                uniqueStreams.push(stream);
            }
        }
        if (streams.length !== uniqueStreams.length) {
            this.logger.info('Deduplicação de streams concluída', {
                antes: streams.length,
                depois: uniqueStreams.length,
                duplicatasRemovidas: streams.length - uniqueStreams.length
            });
        }
        return uniqueStreams;
    }
    async handleStreamRequest(request) {
        const requestId = request.id;
        const requestStartTime = Date.now();
        this.stats.totalRequests++;
        if (!request.apiKey) {
            return { streams: [] };
        }
        try {
            await this.magnetService.waitForInitialization();
            const imdbId = this.extractImdbIdFromRequest(request);
            const dbResult = await this.getStreamsFromDatabase(request);
            if (dbResult.success && dbResult.streams.length > 0) {
                const dedupedStreams = this.deduplicateStreamsByInfoHash(dbResult.streams);
                this.stats.servedFromDatabase++;
                return { streams: dedupedStreams };
            }
            const catalogResult = await this.getStreamsFromCatalog(request);
            if (catalogResult.success && catalogResult.streams.length > 0) {
                const dedupedStreams = this.deduplicateStreamsByInfoHash(catalogResult.streams);
                this.stats.servedFromCatalog++;
                return { streams: dedupedStreams };
            }
            const shouldScrape = await this.shouldAttemptScraping(request);
            if (!shouldScrape) {
                return { streams: [] };
            }
            const scrapingResult = await this.processStreamRequest(request);
            const dedupedScrapingResult = this.deduplicateStreamsByInfoHash(scrapingResult);
            await this.updateScrapingCache(request, dedupedScrapingResult.length > 0);
            this.stats.servedFromScraping += dedupedScrapingResult.length > 0 ? 1 : 0;
            return { streams: dedupedScrapingResult };
        }
        catch (error) {
            this.logger.error('Falha no processamento de stream', {
                requestId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return { streams: [] };
        }
    }
    async getStreamsFromDatabase(request) {
        const startTime = Date.now();
        try {
            let fileEntries = [];
            const imdbId = this.extractImdbIdFromRequest(request);
            if (!imdbId) {
                return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
            }
            if (request.type === 'movie') {
                fileEntries = await this.getImdbIdMovieEntries(imdbId);
            }
            else if (request.type === 'series') {
                const episodeInfo = this.episodeMatcher.extractEpisodeFromMultipleSources(request.id);
                if (episodeInfo.isValid) {
                    fileEntries = await this.getImdbIdSeriesEntries(imdbId, episodeInfo.season, episodeInfo.episode);
                }
            }
            const streams = [];
            for (const fileEntry of fileEntries) {
                const torrent = fileEntry.torrent;
                if (torrent && torrent.infoHash) {
                    const stream = this.convertDatabaseEntryToStream(fileEntry, torrent, request);
                    if (stream) {
                        streams.push(stream);
                    }
                }
            }
            return {
                success: true,
                streams,
                source: 'database',
                processingTime: Date.now() - startTime
            };
        }
        catch (error) {
            return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
        }
    }
    async getImdbIdMovieEntries(imdbId) {
        return models_1.File.findAll({
            where: { imdbId: { [sequelize_1.Op.eq]: imdbId } },
            include: [{
                    model: models_1.Torrent,
                    required: true,
                    where: { seeders: { [sequelize_1.Op.gte]: 5 } }
                }],
            limit: 20,
            order: [[models_1.Torrent, 'seeders', 'DESC']]
        });
    }
    async getImdbIdSeriesEntries(imdbId, season, episode) {
        return models_1.File.findAll({
            where: {
                imdbId: { [sequelize_1.Op.eq]: imdbId },
                imdbSeason: { [sequelize_1.Op.eq]: season },
                imdbEpisode: { [sequelize_1.Op.eq]: episode }
            },
            include: [{
                    model: models_1.Torrent,
                    required: true,
                    where: { seeders: { [sequelize_1.Op.gte]: 5 } }
                }],
            limit: 15,
            order: [[models_1.Torrent, 'seeders', 'DESC']]
        });
    }
    convertDatabaseEntryToStream(fileEntry, torrent, request) {
        try {
            const magnetHash = torrent.infoHash;
            const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
            const magnetLink = `magnet:?xt=urn:btih:${magnetHash}`;
            let titleSuffix = '';
            let season;
            let episode;
            if (request.type === 'series' && fileEntry.imdbSeason && fileEntry.imdbEpisode) {
                season = fileEntry.imdbSeason;
                episode = fileEntry.imdbEpisode;
                titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            }
            const stream = {
                title: torrent.title,
                name: `Brasil RD (${quality})${titleSuffix}`,
                description: `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'pt-BR')}`,
                sources: [magnetLink],
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `br-db-${request.id}`
                },
                status: 'available',
                infoHash: magnetHash,
                magnet: magnetLink,
                url: request.type === 'series' && season !== undefined
                    ? (0, magnetHelper_1.generateLazyResolveUrl)(magnetLink, request.apiKey, 'series', season, episode)
                    : (0, magnetHelper_1.generateLazyResolveUrl)(magnetLink, request.apiKey, 'movie')
            };
            return stream;
        }
        catch (error) {
            return null;
        }
    }
    async getStreamsFromCatalog(request) {
        const startTime = Date.now();
        try {
            const streams = await this.catalogProvider.getStreamsFromCatalog(request);
            return {
                success: true,
                streams,
                source: 'catalog',
                processingTime: Date.now() - startTime
            };
        }
        catch (error) {
            return { success: false, streams: [], source: 'catalog', processingTime: Date.now() - startTime };
        }
    }
    async shouldAttemptScraping(request) {
        const imdbId = this.extractImdbIdFromRequest(request);
        const requestKey = `${imdbId || request.id}:${request.type}`;
        const cacheEntry = this.scrapingCache.get(requestKey);
        if (cacheEntry) {
            const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
            if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2) {
                return false;
            }
            if (timeSinceLastAttempt < 5 * 60 * 1000) {
                return false;
            }
        }
        return true;
    }
    async updateScrapingCache(request, successful) {
        const imdbId = this.extractImdbIdFromRequest(request);
        const requestKey = `${imdbId || request.id}:${request.type}`;
        this.scrapingCache.set(requestKey, {
            lastAttempt: new Date(),
            successful
        });
        this.cleanupOldCache();
    }
    cleanupOldCache() {
        const now = Date.now();
        const toDelete = [];
        for (const [key, entry] of this.scrapingCache.entries()) {
            const age = now - entry.lastAttempt.getTime();
            if (age > this.scrapingCacheTTL * 2) {
                toDelete.push(key);
            }
        }
        for (const key of toDelete) {
            this.scrapingCache.delete(key);
        }
    }
    async processStreamRequest(request) {
        if (request.type === 'series') {
            return await this.processSeriesRequest(request);
        }
        else {
            return await this.processMovieRequest(request);
        }
    }
    async processMovieRequest(request) {
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            return await this.performIntelligentScraping(imdbId, request);
        }
        catch (error) {
            return [];
        }
    }
    async processSeriesRequest(request) {
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            if (!imdbId) {
                return await this.performIntelligentScraping(null, request);
            }
            const episodeInfo = this.episodeMatcher.extractEpisodeFromMultipleSources(request.id);
            if (episodeInfo.isValid) {
                const episodeStream = await this.processSpecificEpisode(imdbId, episodeInfo.season, episodeInfo.episode, request);
                if (episodeStream) {
                    if (Array.isArray(episodeStream)) {
                        return episodeStream;
                    }
                    else {
                        return [episodeStream];
                    }
                }
            }
            return await this.performIntelligentScraping(imdbId, request);
        }
        catch (error) {
            return [];
        }
    }
    async performIntelligentScraping(imdbId, request) {
        try {
            const type = request.type;
            const episodeInfo = this.episodeMatcher.extractEpisodeFromRequest(request.id);
            let searchTitle = null;
            let imdbTitles = null;
            if (imdbId) {
                imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
                if (imdbTitles && imdbTitles.allTitles.length > 0) {
                    searchTitle = imdbTitles.allTitles[0];
                }
            }
            if (!searchTitle) {
                searchTitle = 'Unknown Title';
            }
            let searchQuery = searchTitle;
            if (type === 'series' && episodeInfo.isValid) {
                searchQuery = `${searchTitle} Temporada ${episodeInfo.season}`;
            }
            const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, episodeInfo.isValid ? episodeInfo.season : undefined);
            if (torrentResults.length === 0) {
                return [];
            }
            const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
            const filteredTorrents = await this.filterAndValidateTorrents(deduplicatedTorrents, imdbId, request, episodeInfo, imdbTitles);
            if (filteredTorrents.valid.length === 0) {
                return [];
            }
            await this.saveValidTorrentsToCatalog(filteredTorrents.valid, request, episodeInfo, imdbTitles);
            const streams = await this.processTorrentsWithOptimization(filteredTorrents.valid, request, episodeInfo);
            return this.streamFormatter.sortStreamsByQuality(streams);
        }
        catch (error) {
            return [];
        }
    }
    deduplicateTorrentsByMagnet(torrents) {
        const seenMagnets = new Set();
        const uniqueTorrents = [];
        for (const torrent of torrents) {
            const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(torrent.magnet);
            if (magnetHash) {
                if (seenMagnets.has(magnetHash.toLowerCase())) {
                    continue;
                }
                seenMagnets.add(magnetHash.toLowerCase());
            }
            uniqueTorrents.push(torrent);
        }
        if (torrents.length !== uniqueTorrents.length) {
            this.logger.debug('Torrents deduplicados no scraping', {
                antes: torrents.length,
                depois: uniqueTorrents.length
            });
        }
        return uniqueTorrents;
    }
    async filterAndValidateTorrents(torrents, imdbId, request, episodeInfo, imdbTitles = null) {
        const valid = [];
        const invalid = [];
        if (!imdbId) {
            return { valid: torrents, invalid: [] };
        }
        for (const torrent of torrents) {
            try {
                const titleMatchResult = await this.titleFilter.doTitlesMatch(torrent.title, imdbId, episodeInfo.isValid ? episodeInfo.season : undefined, episodeInfo.isValid ? episodeInfo.episode : undefined);
                if (titleMatchResult.matches) {
                    valid.push(torrent);
                }
                else {
                    invalid.push(torrent);
                }
            }
            catch (error) {
                invalid.push(torrent);
            }
        }
        return { valid, invalid };
    }
    async saveValidTorrentsToCatalog(validTorrents, request, episodeInfo, imdbTitles = null) {
        const imdbId = this.extractImdbIdFromRequest(request);
        if (!imdbId || validTorrents.length === 0) {
            return;
        }
        for (const torrent of validTorrents) {
            try {
                const finalMatchResult = await this.titleFilter.doTitlesMatch(torrent.title, imdbId, episodeInfo.isValid ? episodeInfo.season : undefined, episodeInfo.isValid ? episodeInfo.episode : undefined);
                if (!finalMatchResult.matches) {
                    continue;
                }
                const metadata = this.titleFilter.extractSeriesMetadata(torrent.title);
                const imdbSeason = episodeInfo.isValid ? episodeInfo.season : metadata.season;
                const imdbEpisode = episodeInfo.isValid ? episodeInfo.episode : metadata.episode;
                await this.autoMagnetService.autoAddMagnet(torrent.magnet, torrent.title, imdbId, request.type, torrent.seeders, torrent.quality, torrent.size, imdbSeason, imdbEpisode);
            }
            catch (error) {
            }
        }
    }
    async processTorrentsWithOptimization(torrents, request, episodeInfo) {
        const allStreams = [];
        const batchSize = this.processingConfig.maxConcurrentTorrents;
        for (let i = 0; i < torrents.length; i += batchSize) {
            const batch = torrents.slice(i, i + batchSize);
            const batchPromises = batch.map(async (torrent) => {
                try {
                    return request.type === 'series'
                        ? await this.createSeriesStream(torrent, request, episodeInfo)
                        : await this.createMovieStream(torrent, request);
                }
                catch (error) {
                    return null;
                }
            });
            const batchResults = await Promise.allSettled(batchPromises);
            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value) {
                    const streamResult = result.value;
                    if (Array.isArray(streamResult)) {
                        allStreams.push(...streamResult);
                    }
                    else {
                        allStreams.push(streamResult);
                    }
                }
            }
            if (i + batchSize < torrents.length) {
                await this.delay(this.processingConfig.delayBetweenTorrents);
            }
        }
        return allStreams;
    }
    async createMovieStream(torrent, request) {
        const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
        const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(torrent.magnet);
        return {
            title: `Brasil RD (${quality})`,
            name: `Brasil RD (${quality})`,
            description: `${(0, stringUtils_1.extractCleanMovieTitle)(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`,
            sources: [torrent.magnet],
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-scrape-${request.id}`
            },
            status: 'available',
            infoHash: magnetHash || undefined,
            magnet: torrent.magnet,
            url: (0, magnetHelper_1.generateLazyResolveUrl)(torrent.magnet, request.apiKey, 'movie')
        };
    }
    async createSeriesStream(torrent, request, episodeInfo) {
        const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
        if (episodeInfo.isValid) {
            const episodeTag = `S${episodeInfo.season.toString().padStart(2, '0')}E${episodeInfo.episode.toString().padStart(2, '0')}`;
            const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(torrent.magnet);
            return {
                title: `Brasil RD (${quality}) ${episodeTag}`,
                name: `Brasil RD (${quality}) ${episodeTag}`,
                description: `${(0, stringUtils_1.extractCleanMovieTitle)(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`,
                sources: [torrent.magnet],
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `br-${request.id}-${episodeInfo.season}`
                },
                status: 'available',
                infoHash: magnetHash || undefined,
                magnet: torrent.magnet,
                url: (0, magnetHelper_1.generateLazyResolveUrl)(torrent.magnet, request.apiKey, 'series', episodeInfo.season, episodeInfo.episode)
            };
        }
        else {
            return await this.createMovieStream(torrent, request);
        }
    }
    extractImdbIdFromRequest(request) {
        if (request.imdbId)
            return request.imdbId;
        const imdbMatch = request.id.match(/^(tt\d+)/);
        return imdbMatch ? imdbMatch[1] : null;
    }
    async processSpecificEpisode(imdbId, season, episode, request) {
        try {
            const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
            if (!imdbTitles || imdbTitles.allTitles.length === 0) {
                return null;
            }
            const searchTitle = imdbTitles.allTitles[0];
            const searchQuery = `${searchTitle} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', season);
            if (torrentResults.length === 0) {
                return null;
            }
            const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
            const episodeInfo = { season, episode, isValid: true };
            const filteredTorrents = await this.filterAndValidateTorrents(deduplicatedTorrents, imdbId, request, episodeInfo, imdbTitles);
            if (filteredTorrents.valid.length === 0) {
                return null;
            }
            const bestTorrent = filteredTorrents.valid.reduce((best, current) => current.seeders > best.seeders ? current : best);
            const streamResult = await this.createSeriesStream(bestTorrent, request, episodeInfo);
            if (Array.isArray(streamResult)) {
                return streamResult.length > 0 ? streamResult[0] : null;
            }
            else {
                return streamResult;
            }
        }
        catch (error) {
            return null;
        }
    }
    formatLanguage(language) {
        const langMap = {
            'pt-BR': 'PT-BR',
            'pt-BR,en': 'Dual PT-BR/EN',
            'en': 'EN',
            'dual': 'Dual Audio',
            'pt': 'Português'
        };
        return langMap[language] || language;
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    addCuratedMagnet(magnet) {
        this.magnetService.addMagnet(magnet);
        this.invalidateRelatedCache(magnet.imdbId);
    }
    removeCuratedMagnet(imdbId, magnetLink) {
        const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
        if (removed) {
            this.invalidateRelatedCache(imdbId);
        }
        return removed;
    }
    clearCache() {
        this.cacheService.clear();
        this.scrapingCache.clear();
    }
    invalidateRelatedCache(imdbId) {
        const cachePatterns = [
            `streams:movie:${imdbId}`,
            `streams:series:${imdbId}`,
            `streams:series:${imdbId}:*`
        ];
        for (const pattern of cachePatterns) {
            this.cacheService.delete(pattern);
        }
    }
    getStats() {
        return {
            totalRequests: this.stats.totalRequests,
            servedFromDatabase: this.stats.servedFromDatabase,
            servedFromCatalog: this.stats.servedFromCatalog,
            servedFromScraping: this.stats.servedFromScraping,
            duplicatesRemoved: this.stats.duplicatesRemoved,
            scrapingCacheSize: this.scrapingCache.size
        };
    }
}
exports.StreamHandler = StreamHandler;
