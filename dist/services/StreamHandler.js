"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamHandler = void 0;
const RealDebridService_1 = require("./RealDebridService");
const CuratedMagnetService_1 = require("./CuratedMagnetService");
const AutoMagnetService_1 = require("./AutoMagnetService");
const CacheService_1 = require("./CacheService");
const logger_1 = require("../utils/logger");
const sequelize_1 = require("sequelize");
const models_1 = require("../database/models");
const qualityDetector_1 = require("../lib/qualityDetector");
const magnetHelper_1 = require("../lib/magnetHelper");
const titleFilter_1 = require("../lib/titleFilter");
const streamFormatter_1 = require("../lib/streamFormatter");
const catalogProvider_1 = require("../providers/catalogProvider");
const StaticResponseService_1 = require("./StaticResponseService");
const StreamStatusException_1 = require("./StreamStatusException");
class StreamHandler {
    constructor(baseUrl) {
        this.scrapingCache = new Map();
        this.scrapingCacheTTL = 6 * 60 * 60 * 1000;
        this.stats = {
            totalRequests: 0,
            servedFromDatabase: 0,
            servedFromCatalog: 0,
            servedFromScraping: 0,
            duplicatesRemoved: 0,
            servedInformativeStreams: 0
        };
        this.torboxService = new RealDebridService_1.TorboxService(baseUrl);
        this.magnetService = new CuratedMagnetService_1.CuratedMagnetService();
        this.autoMagnetService = new AutoMagnetService_1.AutoMagnetService();
        this.cacheService = new CacheService_1.CacheService();
        this.logger = new logger_1.Logger('StreamHandler');
        this.staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
        this.qualityDetector = qualityDetector_1.QualityDetector.getInstance();
        this.titleFilter = titleFilter_1.TitleFilter.getInstance();
        this.streamFormatter = streamFormatter_1.StreamFormatter.getInstance();
        this.catalogProvider = new catalogProvider_1.CatalogProvider(this.magnetService);
    }
    static getInstance(baseUrl) {
        if (!StreamHandler.instance) {
            StreamHandler.instance = new StreamHandler(baseUrl);
        }
        if (baseUrl && StreamHandler.instance.staticResponseService.getBaseUrl() !== baseUrl) {
            StreamHandler.instance.setStaticResponseBaseUrl(baseUrl);
        }
        return StreamHandler.instance;
    }
    async initialize() {
        await this.magnetService.waitForInitialization();
    }
    setStaticResponseBaseUrl(baseUrl) {
        this.staticResponseService.setBaseUrl(baseUrl);
        this.torboxService.setStaticResponseBaseUrl(baseUrl);
    }
    deduplicateStreamsByInfoHash(streams) {
        const seenCombinations = new Set();
        const uniqueStreams = [];
        for (const stream of streams) {
            const infoHash = stream.infoHash?.toLowerCase();
            let quality = 'unknown';
            if (stream.behaviorHints?.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            }
            else if (stream.title) {
                const qualityMatch = stream.title.match(/\((\d+p|4K|HD|SD|2160p|1080p|720p|480p)\)/i);
                if (qualityMatch) {
                    quality = qualityMatch[1].toLowerCase();
                }
            }
            const uniqueKey = infoHash ? `${infoHash}_${quality}` : (stream.title || `stream_${Math.random()}`);
            if (seenCombinations.has(uniqueKey)) {
                this.stats.duplicatesRemoved++;
                continue;
            }
            seenCombinations.add(uniqueKey);
            uniqueStreams.push(stream);
        }
        return uniqueStreams;
    }
    async handleStreamRequest(request) {
        const requestId = request.id;
        this.stats.totalRequests++;
        if (!request.apiKey)
            return { streams: [] };
        try {
            await this.magnetService.waitForInitialization();
            const dbResult = await this.getStreamsFromDatabase(request);
            if (dbResult.success && dbResult.streams.length > 0) {
                this.stats.servedFromDatabase++;
                return { streams: this.deduplicateStreamsByInfoHash(dbResult.streams) };
            }
            const catalogResult = await this.getStreamsFromCatalog(request);
            if (catalogResult.success && catalogResult.streams.length > 0) {
                this.stats.servedFromCatalog++;
                return { streams: this.deduplicateStreamsByInfoHash(catalogResult.streams) };
            }
            const shouldScrape = await this.shouldAttemptScraping(request);
            if (!shouldScrape) {
                const informativeStream = this.createInformativeStreamIfNoContent(request);
                return { streams: informativeStream ? [informativeStream] : [] };
            }
            try {
                const scrapedStreams = await this.performScrapingThroughCatalog(request);
                const deduped = this.deduplicateStreamsByInfoHash(scrapedStreams);
                await this.updateScrapingCache(request, deduped.length > 0);
                if (deduped.length > 0)
                    this.stats.servedFromScraping++;
                return { streams: deduped };
            }
            catch (error) {
                if (error instanceof StreamStatusException_1.StreamStatusException) {
                    const informativeStream = this.createInformativeStreamFromException(error, requestId);
                    this.stats.servedInformativeStreams++;
                    return { streams: [informativeStream] };
                }
                throw error;
            }
        }
        catch (error) {
            this.logger.error('Falha no processamento', {
                requestId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            if (error instanceof StreamStatusException_1.StreamStatusException) {
                const informativeStream = this.createInformativeStreamFromException(error, requestId);
                this.stats.servedInformativeStreams++;
                return { streams: [informativeStream] };
            }
            const errorStream = this.staticResponseService.createInformativeStream(StaticResponseService_1.StaticResponse.FAILED_UNEXPECTED, requestId);
            return { streams: [this.convertToStreamFormat(errorStream)] };
        }
    }
    async performScrapingThroughCatalog(request) {
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
            let season;
            let episode;
            if (seasonMatch) {
                season = parseInt(seasonMatch[1]);
                episode = parseInt(seasonMatch[2]);
            }
            const catalogRequest = {
                id: request.id,
                type: request.type,
                imdbId: imdbId,
                apiKey: request.apiKey,
                season: season,
                episode: episode,
                config: request.config || {
                    quality: 'Todas as Qualidades',
                    language: 'pt-BR',
                    streamType: 'direct',
                    maxResults: '25'
                }
            };
            const streams = await this.catalogProvider.getStreamsFromCatalog(catalogRequest);
            return streams;
        }
        catch (error) {
            this.logger.error('Erro no scraping via CatalogProvider', {
                requestId: request.id,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
    }
    createInformativeStreamFromException(exception, requestId) {
        const informativeStream = this.staticResponseService.createInformativeStream(exception.staticResponse, requestId);
        return this.convertToStreamFormat(informativeStream);
    }
    createInformativeStreamIfNoContent(request) {
        const imdbId = this.extractImdbIdFromRequest(request);
        if (imdbId || request.type === 'series') {
            const informativeStream = this.staticResponseService.createInformativeStream(StaticResponseService_1.StaticResponse.DOWNLOADING, request.id);
            return this.convertToStreamFormat(informativeStream);
        }
        return null;
    }
    convertToStreamFormat(informativeStream) {
        const infoHash = `info-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        return {
            title: informativeStream.title || 'Brasil RD - Informacao',
            name: informativeStream.name || 'Brasil RD - Mensagem Informativa',
            description: informativeStream.description || 'Mensagem informativa do addon Brasil RD',
            url: informativeStream.url || 'data:text/plain,Brasil%20RD%20-%20Mensagem%20informativa',
            behaviorHints: { notWebReady: true, bingeGroup: 'br-info' },
            status: 'available',
            infoHash: infoHash,
            magnet: `brasilrd://info/${infoHash}`,
            sources: [`brasilrd://info/${infoHash}`]
        };
    }
    async getStreamsFromDatabase(request) {
        const startTime = Date.now();
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            if (!imdbId)
                return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
            let fileEntries = [];
            if (request.type === 'movie') {
                fileEntries = await this.getImdbIdMovieEntries(imdbId);
            }
            else if (request.type === 'series') {
                const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
                if (seasonMatch) {
                    const season = parseInt(seasonMatch[1]);
                    const episode = parseInt(seasonMatch[2]);
                    fileEntries = await this.getImdbIdSeriesEntries(imdbId, season, episode);
                }
            }
            const streams = [];
            for (const fileEntry of fileEntries) {
                const torrent = fileEntry.torrent;
                if (torrent && torrent.infoHash) {
                    const stream = this.convertDatabaseEntryToStream(fileEntry, torrent, request);
                    if (stream)
                        streams.push(stream);
                }
            }
            return { success: true, streams, source: 'database', processingTime: Date.now() - startTime };
        }
        catch (error) {
            this.logger.error('Erro na busca no banco', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: Date.now() - startTime
            });
            return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
        }
    }
    async getImdbIdMovieEntries(imdbId) {
        return models_1.File.findAll({
            where: { imdbId: { [sequelize_1.Op.eq]: imdbId } },
            include: [{ model: models_1.Torrent, required: true, where: { seeders: { [sequelize_1.Op.gte]: 5 } } }],
            limit: 20,
            order: [[models_1.Torrent, 'seeders', 'DESC']]
        });
    }
    async getImdbIdSeriesEntries(imdbId, season, episode) {
        const specificEpisodeEntries = await models_1.File.findAll({
            where: {
                imdbId: { [sequelize_1.Op.eq]: imdbId },
                imdbSeason: { [sequelize_1.Op.eq]: season },
                imdbEpisode: { [sequelize_1.Op.eq]: episode }
            },
            include: [{ model: models_1.Torrent, required: true, where: { seeders: { [sequelize_1.Op.gte]: 5 } } }],
            limit: 15,
            order: [[models_1.Torrent, 'seeders', 'DESC']]
        });
        if (specificEpisodeEntries.length > 0) {
            return specificEpisodeEntries;
        }
        const completePackEntries = await models_1.File.findAll({
            where: {
                imdbId: { [sequelize_1.Op.eq]: imdbId },
                imdbSeason: { [sequelize_1.Op.eq]: season },
                imdbEpisode: { [sequelize_1.Op.eq]: null }
            },
            include: [{ model: models_1.Torrent, required: true, where: { seeders: { [sequelize_1.Op.gte]: 5 } } }],
            limit: 15,
            order: [[models_1.Torrent, 'seeders', 'DESC']]
        });
        return completePackEntries;
    }
    convertDatabaseEntryToStream(fileEntry, torrent, request) {
        try {
            const magnetHash = torrent.infoHash;
            const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
            const magnetLink = `magnet:?xt=urn:btih:${magnetHash}`;
            let titleSuffix = '';
            let season;
            let episode;
            if (request.type === 'series') {
                const match = request.id.match(/tt\d+:(\d+):(\d+)/);
                if (match) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                    titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
                }
            }
            const filename = fileEntry.title || 'video.mkv';
            const fileIndex = fileEntry.fileIndex || 0;
            let finalFileIndex = fileIndex;
            if (fileEntry.imdbEpisode === null && episode !== undefined && season !== undefined) {
                finalFileIndex = episode - 1;
                this.logger.warn('Ajuste de fileIndex para pack completo', {
                    infoHash: magnetHash,
                    season,
                    episode,
                    originalIndex: fileIndex,
                    adjustedIndex: finalFileIndex
                });
            }
            const stream = {
                title: torrent.title,
                name: `Brasil RD (${quality})${titleSuffix}`,
                description: `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'}`,
                sources: [magnetLink],
                behaviorHints: { notWebReady: false, bingeGroup: `br-db-${request.id}` },
                status: 'available',
                infoHash: magnetHash,
                magnet: magnetLink,
                url: (0, magnetHelper_1.generateLazyResolveUrl)(magnetLink, request.apiKey, filename, finalFileIndex, request.type, season, episode)
            };
            return stream;
        }
        catch (error) {
            this.logger.error('Erro ao converter entrada do banco para stream', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async getStreamsFromCatalog(request) {
        const startTime = Date.now();
        try {
            const streams = await this.catalogProvider.getStreamsFromCatalog(request);
            return { success: true, streams, source: 'catalog', processingTime: Date.now() - startTime };
        }
        catch (error) {
            return { success: false, streams: [], source: 'catalog', processingTime: Date.now() - startTime };
        }
    }
    async shouldAttemptScraping(request) {
        const imdbId = this.extractImdbIdFromRequest(request);
        const requestKey = `${imdbId || request.id}:${request.type}`;
        const cacheEntry = this.scrapingCache.get(requestKey);
        if (!cacheEntry)
            return true;
        const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
        if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2)
            return false;
        if (timeSinceLastAttempt < 5 * 60 * 1000)
            return false;
        return true;
    }
    async updateScrapingCache(request, successful) {
        const imdbId = this.extractImdbIdFromRequest(request);
        const requestKey = `${imdbId || request.id}:${request.type}`;
        this.scrapingCache.set(requestKey, { lastAttempt: new Date(), successful });
        this.cleanupOldCache();
    }
    cleanupOldCache() {
        const now = Date.now();
        for (const [key, entry] of this.scrapingCache.entries()) {
            if (now - entry.lastAttempt.getTime() > this.scrapingCacheTTL * 2) {
                this.scrapingCache.delete(key);
            }
        }
    }
    extractImdbIdFromRequest(request) {
        if (request.imdbId)
            return request.imdbId;
        const imdbMatch = request.id.match(/^(tt\d+)/);
        return imdbMatch ? imdbMatch[1] : null;
    }
    addCuratedMagnet(magnet) {
        this.magnetService.addMagnet(magnet);
        this.invalidateRelatedCache(magnet.imdbId);
    }
    removeCuratedMagnet(imdbId, magnetLink) {
        const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
        if (removed)
            this.invalidateRelatedCache(imdbId);
        return removed;
    }
    clearCache() {
        this.cacheService.clear();
        this.scrapingCache.clear();
        this.catalogProvider.clearTmdbCache();
    }
    invalidateRelatedCache(imdbId) {
        const cachePatterns = [
            `streams:movie:${imdbId}`,
            `streams:series:${imdbId}`,
            `streams:series:${imdbId}:*`
        ];
        for (const pattern of cachePatterns)
            this.cacheService.delete(pattern);
    }
    getStats() {
        return {
            totalRequests: this.stats.totalRequests,
            servedFromDatabase: this.stats.servedFromDatabase,
            servedFromCatalog: this.stats.servedFromCatalog,
            servedFromScraping: this.stats.servedFromScraping,
            servedInformativeStreams: this.stats.servedInformativeStreams,
            duplicatesRemoved: this.stats.duplicatesRemoved,
            scrapingCacheSize: this.scrapingCache.size
        };
    }
}
exports.StreamHandler = StreamHandler;
