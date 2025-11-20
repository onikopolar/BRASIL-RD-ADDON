"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamHandler = void 0;
const RealDebridService_1 = require("./RealDebridService");
const CuratedMagnetService_1 = require("./CuratedMagnetService");
const CacheService_1 = require("./CacheService");
const TorrentScraperService_1 = require("./TorrentScraperService");
const ImdbScraperService_1 = require("./ImdbScraperService");
const logger_1 = require("../utils/logger");
class QualityDetector {
    constructor() {
        this.qualityPatterns = [
            { pattern: /\.2160p\./i, quality: '2160p', confidence: 100 },
            { pattern: /\.4k\./i, quality: '2160p', confidence: 100 },
            { pattern: /\b2160p\b/i, quality: '2160p', confidence: 98 },
            { pattern: /\b4k\b/i, quality: '2160p', confidence: 98 },
            { pattern: /2160p/i, quality: '2160p', confidence: 95 },
            { pattern: /4k/i, quality: '2160p', confidence: 95 },
            { pattern: /\buhd\b/i, quality: '2160p', confidence: 90 },
            { pattern: /\bultra.hd\b/i, quality: '2160p', confidence: 90 },
            { pattern: /\.1080p\./i, quality: '1080p', confidence: 100 },
            { pattern: /\b1080p\b/i, quality: '1080p', confidence: 98 },
            { pattern: /1080p/i, quality: '1080p', confidence: 95 },
            { pattern: /\bfhd\b/i, quality: '1080p', confidence: 90 },
            { pattern: /\bfull.hd\b/i, quality: '1080p', confidence: 90 },
            { pattern: /\.720p\./i, quality: '720p', confidence: 100 },
            { pattern: /\b720p\b/i, quality: '720p', confidence: 98 },
            { pattern: /720p/i, quality: '720p', confidence: 95 },
            { pattern: /\bhd.rip\b/i, quality: '720p', confidence: 85 },
            { pattern: /\.hd\./i, quality: 'HD', confidence: 90 },
            { pattern: /\bhd\b/i, quality: 'HD', confidence: 80 },
            { pattern: /\bhigh.def\b/i, quality: 'HD', confidence: 80 },
            { pattern: /\.web-dl\./i, quality: '1080p', confidence: 95 },
            { pattern: /\.bluray\./i, quality: '1080p', confidence: 90 },
            { pattern: /\.blu-ray\./i, quality: '1080p', confidence: 90 },
            { pattern: /\.remux\./i, quality: '2160p', confidence: 95 },
            { pattern: /\.webrip\./i, quality: '1080p', confidence: 85 },
            { pattern: /\.hdtv\./i, quality: '720p', confidence: 80 },
            { pattern: /\.brrip\./i, quality: '1080p', confidence: 85 },
            { pattern: /\.bdrip\./i, quality: '1080p', confidence: 85 }
        ];
        this.exactPatterns = [
            { pattern: /\b2160p\b/i, quality: '2160p' },
            { pattern: /\b4k\b/i, quality: '2160p' },
            { pattern: /\b1080p\b/i, quality: '1080p' },
            { pattern: /\b720p\b/i, quality: '720p' },
            { pattern: /\bhd\b/i, quality: 'HD' }
        ];
        this.allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
    }
    extractQuality(title) {
        const cleanTitle = title.toLowerCase();
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(cleanTitle) && confidence >= 95) {
                return quality;
            }
        }
        for (const { pattern, quality } of this.exactPatterns) {
            if (pattern.test(cleanTitle)) {
                return quality;
            }
        }
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(cleanTitle) && confidence >= 80) {
                return quality;
            }
        }
        return this.inferQualityFromContext(cleanTitle);
    }
    inferQualityFromContext(titleLower) {
        if (titleLower.includes('remux') || titleLower.includes('web-dl')) {
            return '1080p';
        }
        if (titleLower.includes('bluray') || titleLower.includes('blu-ray')) {
            return '1080p';
        }
        if (titleLower.includes('hdtv')) {
            return '720p';
        }
        return 'HD';
    }
    extractQualityFromFilename(filename) {
        return this.extractQuality(filename);
    }
    extractQualityFromStreamName(name) {
        if (!name)
            return 'HD';
        return this.extractQuality(name);
    }
    isValidQuality(quality) {
        return this.allowedQualities.has(quality);
    }
}
class StreamHandler {
    constructor() {
        this.processingConfig = {
            maxConcurrentTorrents: 2,
            delayBetweenTorrents: 1000,
            allowPendingStreams: true,
            maxPendingStreams: 8,
            cacheTTL: {
                downloaded: 86400000,
                downloading: 300000,
                error: 120000
            }
        };
        this.qualityPriority = {
            '2160p': 5,
            '1080p': 4,
            '720p': 3,
            'HD': 2
        };
        this.videoExtensions = [
            '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
            '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
        ];
        this.episodePatterns = [
            /(\d+)x(\d+)/i,
            /s(\d+)e(\d+)/i,
            /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
            /ep[\s\._-]?(\d+)/i,
            /(\d+)(?:\s*-\s*|\s*)(\d+)/,
            /^(\d+)$/
        ];
        this.promotionalKeywords = [
            'promo', '1xbet', 'bet', 'propaganda', 'publicidade', 'advertisement',
            'sample', 'trailer', 'teaser', 'preview', 'torrentdosfilmes'
        ];
        this.torrentCache = new Map();
        this.seasonCache = new Map();
        this.torrentCacheTTL = 60 * 60 * 1000;
        this.downloadTimeout = 30 * 60 * 1000;
        this.downloadPollInterval = 5000;
        this.rdService = new RealDebridService_1.RealDebridService();
        this.magnetService = new CuratedMagnetService_1.CuratedMagnetService();
        this.cacheService = new CacheService_1.CacheService();
        this.torrentScraper = new TorrentScraperService_1.TorrentScraperService();
        this.imdbScraper = new ImdbScraperService_1.ImdbScraperService();
        this.qualityDetector = new QualityDetector();
        this.logger = new logger_1.Logger('StreamHandler');
        this.logger.info('StreamHandler initialized with lazy loading support', {
            processingConfig: this.processingConfig,
            qualityDetection: '100% igual ao TorrentScraperService'
        });
    }
    async handleStreamRequest(request) {
        const requestId = request.id;
        const cacheKey = this.generateCacheKey(request);
        if (!request.apiKey) {
            this.logger.warn('Stream request sem API key', { requestId });
            return { streams: [] };
        }
        try {
            const cachedStreams = this.cacheService.get(cacheKey);
            if (cachedStreams && cachedStreams.length > 0) {
                const allDownloaded = cachedStreams.every(stream => stream.status === 'downloaded');
                if (allDownloaded) {
                    const qualities = cachedStreams.map(s => this.qualityDetector.extractQualityFromStreamName(s.name));
                    this.logger.debug('Returning cached downloaded streams', {
                        requestId,
                        cacheKey,
                        streamCount: cachedStreams.length,
                        qualities
                    });
                    return { streams: cachedStreams };
                }
                else {
                    this.logger.debug('Invalidating cache with non-downloaded streams', {
                        requestId,
                        cacheKey,
                        statuses: cachedStreams.map(s => s.status)
                    });
                    this.cacheService.delete(cacheKey);
                }
            }
            let streams = await this.processStreamRequest(request);
            streams = this.applyMobileCompatibilityFilter(streams);
            this.logger.debug('DEBUG - URLs sendo retornadas para o cliente:', {
                requestId,
                streamCount: streams.length,
                urls: streams.map(s => ({
                    url: s.url,
                    title: s.title,
                    status: s.status
                }))
            });
            if (streams.length > 0) {
                const cacheTTL = this.calculateDynamicCacheTTL(streams);
                this.cacheService.set(cacheKey, streams, cacheTTL);
                const qualities = streams.map(s => this.qualityDetector.extractQualityFromStreamName(s.name));
                this.logger.info('Cached new mobile-compatible streams', {
                    requestId,
                    cacheKey,
                    streamCount: streams.length,
                    cacheTTL: `${cacheTTL / 60000}min`,
                    qualities,
                    statuses: streams.map(s => s.status)
                });
            }
            return { streams };
        }
        catch (error) {
            this.logger.error('Stream request processing failed', {
                requestId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return { streams: [] };
        }
    }
    applyMobileCompatibilityFilter(streams) {
        return streams.filter(stream => {
            if (!stream.url || !stream.url.startsWith('http')) {
                return false;
            }
            if (stream.status !== 'downloaded' && stream.status !== 'ready' && stream.status !== 'pending') {
                return false;
            }
            const quality = this.qualityDetector.extractQualityFromStreamName(stream.name);
            if (!this.qualityDetector.isValidQuality(quality)) {
                return false;
            }
            return true;
        }).map(stream => {
            stream.behaviorHints = {
                ...stream.behaviorHints,
                notWebReady: false
            };
            if (stream.name) {
                const currentQuality = this.qualityDetector.extractQualityFromStreamName(stream.name);
                if (!stream.name.match(/(2160p|1080p|720p|HD)/i)) {
                    stream.name = `Brasil RD | ${currentQuality.toUpperCase()}`;
                }
            }
            return stream;
        });
    }
    calculateDynamicCacheTTL(streams) {
        if (streams.length === 0) {
            return this.processingConfig.cacheTTL.error;
        }
        if (streams.every(stream => stream.status === 'downloaded')) {
            return this.processingConfig.cacheTTL.downloaded;
        }
        return this.processingConfig.cacheTTL.error;
    }
    async processStreamRequest(request) {
        if (request.type === 'series') {
            return await this.processSeriesRequest(request);
        }
        else {
            return await this.processMovieRequest(request);
        }
    }
    async processSeriesRequest(request) {
        const curatedMagnets = this.magnetService.searchMagnets(request);
        if (curatedMagnets.length > 0) {
            this.logger.debug('Processing curated magnets for series', {
                requestId: request.id,
                magnetCount: curatedMagnets.length
            });
            return await this.processCuratedMagnets(curatedMagnets, request);
        }
        return await this.processSeriesScraping(request);
    }
    async processMovieRequest(request) {
        const curatedMagnets = this.magnetService.searchMagnets(request);
        if (curatedMagnets.length > 0) {
            this.logger.debug('Processing curated magnets for movie', {
                requestId: request.id,
                magnetCount: curatedMagnets.length
            });
            return await this.processCuratedMagnets(curatedMagnets, request);
        }
        return await this.processMovieScraping(request);
    }
    async processSeriesScraping(request) {
        const requestEpisode = this.extractEpisodeFromRequest(request.id);
        try {
            const title = await this.fetchTitleFromImdb(request);
            if (!title) {
                this.logger.debug('No title found from IMDB for series scraping', { requestId: request.id });
                return await this.fallbackToRegularScraping(title || request.id, request);
            }
            const imdbId = this.extractImdbIdFromRequest(request);
            if (!imdbId) {
                this.logger.debug('No IMDB ID found, falling back to regular scraping', { requestId: request.id });
                return await this.fallbackToRegularScraping(title, request);
            }
            if (requestEpisode.isValid) {
                this.logger.debug('Processing specific episode from season', {
                    requestId: request.id,
                    season: requestEpisode.season,
                    episode: requestEpisode.episode
                });
                const seasonStream = await this.processEpisodeFromSeason(imdbId, requestEpisode.season, requestEpisode.episode, title, request.id, request.apiKey);
                if (seasonStream) {
                    return [seasonStream];
                }
            }
            this.logger.debug('Falling back to regular scraping for series', { requestId: request.id });
            return await this.fallbackToRegularScraping(title, request);
        }
        catch (error) {
            this.logger.error('Series scraping processing error', {
                requestId: request.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    async processMovieScraping(request) {
        try {
            const title = await this.fetchTitleFromImdb(request);
            if (!title) {
                this.logger.debug('No title found from IMDB for movie scraping', { requestId: request.id });
                return await this.fallbackToRegularScraping(request.id, request);
            }
            return await this.fallbackToRegularScraping(title, request);
        }
        catch (error) {
            this.logger.error('Movie scraping processing error', {
                requestId: request.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    async fallbackToRegularScraping(title, request) {
        const type = request.type === "series" ? "series" : "movie";
        const requestEpisode = this.extractEpisodeFromRequest(request.id);
        let searchQuery = title;
        if (type === 'series' && requestEpisode.isValid) {
            searchQuery = `${title} Temporada ${requestEpisode.season}`;
        }
        this.logger.debug('Performing regular scraping', {
            requestId: request.id,
            searchQuery,
            type,
            season: requestEpisode.isValid ? requestEpisode.season : 'N/A'
        });
        const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, requestEpisode.isValid ? requestEpisode.season : undefined);
        if (torrentResults.length === 0) {
            this.logger.debug('No torrent results found from scraping', { requestId: request.id });
            return [];
        }
        const streams = await this.processTorrentsWithRateLimit(torrentResults, request);
        const streamQualities = streams.map(s => this.qualityDetector.extractQualityFromStreamName(s.name));
        this.logger.info('Completed torrent processing', {
            requestId: request.id,
            totalStreams: streams.length,
            qualities: streamQualities,
            statuses: streams.map(s => s.status)
        });
        return this.sortStreamsByQuality(streams);
    }
    async processTorrentsWithRateLimit(torrents, request) {
        const allStreams = [];
        for (let i = 0; i < torrents.length; i += this.processingConfig.maxConcurrentTorrents) {
            const batch = torrents.slice(i, i + this.processingConfig.maxConcurrentTorrents);
            this.logger.debug('Processing torrent batch', {
                requestId: request.id,
                batchIndex: Math.floor(i / this.processingConfig.maxConcurrentTorrents) + 1,
                batchSize: batch.length,
                qualities: batch.map(t => t.quality)
            });
            const batchPromises = batch.map(async (torrent) => {
                try {
                    const streamResult = await this.processScrapedTorrentLazy(torrent, request);
                    if (streamResult) {
                        return streamResult;
                    }
                }
                catch (error) {
                    this.logger.error('Torrent processing failed in batch', {
                        requestId: request.id,
                        title: torrent.title,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
                return null;
            });
            const batchResults = await Promise.allSettled(batchPromises);
            batchResults.forEach((result) => {
                if (result.status === 'fulfilled' && result.value !== null) {
                    const streams = Array.isArray(result.value) ? result.value : [result.value];
                    allStreams.push(...streams);
                }
            });
            if (i + this.processingConfig.maxConcurrentTorrents < torrents.length) {
                await this.delay(this.processingConfig.delayBetweenTorrents);
            }
        }
        return allStreams;
    }
    generateLazyResolveUrl(magnet, apiKey) {
        const encodedMagnet = Buffer.from(magnet).toString('base64');
        const domain = process.env.RAILWAY_STATIC_URL || 'brasil-rd-addon.up.railway.app';
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        return `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${apiKey}`;
    }
    async analyzeTorrentFilesLazy(magnet) {
        return [{
                id: 0,
                path: 'video_file.mp4',
                bytes: 1024 * 1024 * 1024
            }];
    }
    async processScrapedTorrentLazy(torrent, request) {
        const requestId = request.id;
        try {
            const videoFiles = await this.analyzeTorrentFilesLazy(torrent.magnet);
            if (videoFiles.length === 0) {
                this.logger.debug('No video files found in torrent analysis', { requestId, title: torrent.title });
                return null;
            }
            const cleanVideoFiles = this.filterPromotionalFiles(videoFiles);
            if (cleanVideoFiles.length === 0) {
                this.logger.debug('No valid video files after promotional filter', { requestId });
                return null;
            }
            if (request.type === 'series') {
                return await this.processSeriesTorrentLazy(torrent, request, cleanVideoFiles);
            }
            else {
                return await this.processMovieTorrentLazy(torrent, request, cleanVideoFiles);
            }
        }
        catch (error) {
            this.logger.error('Lazy torrent processing failed', {
                requestId,
                title: torrent.title,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null;
        }
    }
    async processMovieTorrentLazy(torrent, request, cleanVideoFiles) {
        if (cleanVideoFiles.length === 0) {
            return null;
        }
        try {
            const lazyUrl = this.generateLazyResolveUrl(torrent.magnet, request.apiKey);
            const fileQuality = this.qualityDetector.extractQualityFromFilename(torrent.title) || torrent.quality || 'HD';
            const stream = {
                title: `${torrent.title} [${torrent.provider}] [LAZY]`,
                url: lazyUrl,
                name: `Brasil RD | ${fileQuality.toUpperCase()}`,
                description: `Clique para carregar via Real-Debrid | ${torrent.language}`,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `br-lazy-${request.id}`,
                    filename: this.sanitizeFilename(torrent.title)
                },
                magnet: torrent.magnet,
                isPending: true,
                status: 'pending'
            };
            return stream;
        }
        catch (error) {
            this.logger.error('Lazy movie torrent processing failed', {
                requestId: request.id,
                title: torrent.title,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null;
        }
    }
    async processSeriesTorrentLazy(torrent, request, cleanVideoFiles) {
        const requestEpisode = this.extractEpisodeFromRequest(request.id);
        const streams = [];
        if (requestEpisode.isValid) {
            if (cleanVideoFiles.length === 0) {
                this.logger.debug('No files found for specific episode', {
                    requestId: request.id,
                    season: requestEpisode.season,
                    episode: requestEpisode.episode
                });
                return null;
            }
            const validStreams = [];
            for (const file of cleanVideoFiles) {
                try {
                    const lazyUrl = this.generateLazyResolveUrl(torrent.magnet, request.apiKey);
                    const fileQuality = this.qualityDetector.extractQualityFromFilename(torrent.title);
                    const stream = this.createSeriesStreamLazy(torrent, request, lazyUrl, torrent.title, requestEpisode.season, requestEpisode.episode, fileQuality);
                    validStreams.push(stream);
                }
                catch (error) {
                    continue;
                }
            }
            return validStreams.length > 0 ? validStreams : null;
        }
        else {
            if (cleanVideoFiles.length === 0) {
                this.logger.debug('No main file found for series torrent', { requestId: request.id });
                return null;
            }
            try {
                const lazyUrl = this.generateLazyResolveUrl(torrent.magnet, request.apiKey);
                const fileQuality = this.qualityDetector.extractQualityFromFilename(torrent.title);
                const stream = this.createSeriesStreamLazy(torrent, request, lazyUrl, torrent.title, 1, 1, fileQuality);
                streams.push(stream);
            }
            catch (error) {
                return null;
            }
        }
        return streams.length > 0 ? streams : null;
    }
    createSeriesStreamLazy(torrent, request, streamUrl, filePath, season, episode, quality) {
        const detectedQuality = this.qualityDetector.extractQuality(filePath);
        const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
        return {
            title: `${torrent.title} [${torrent.provider}] ${episodeTag} [LAZY]`,
            url: streamUrl,
            name: `Brasil RD | ${detectedQuality.toUpperCase()} | ${episodeTag}`,
            description: `Clique para carregar via Real-Debrid | ${torrent.language} | ${episodeTag}`,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-lazy-${request.id}-${season}`,
                filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
            },
            magnet: torrent.magnet,
            isPending: true,
            status: 'pending'
        };
    }
    extractSeasonFromTitle(title) {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i
        ];
        for (const pattern of patterns) {
            const match = title.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }
    extractImdbIdFromRequest(request) {
        if (request.imdbId) {
            return request.imdbId;
        }
        const imdbMatch = request.id.match(/^(tt\d+)/);
        return imdbMatch ? imdbMatch[1] : null;
    }
    getSeasonCacheKey(imdbId, season) {
        return `season:${imdbId}:${season}`;
    }
    async getOrAddSeasonTorrent(imdbId, season, title, apiKey) {
        const cacheKey = this.getSeasonCacheKey(imdbId, season);
        const cached = this.seasonCache.get(cacheKey);
        if (cached && (Date.now() - cached.addedAt) < this.torrentCacheTTL) {
            this.logger.debug('Returning cached season torrent', { imdbId, season, cacheKey });
            return { torrentId: cached.torrentId, files: cached.files };
        }
        this.logger.debug('Fetching new season torrent', { imdbId, season, title });
        const searchQuery = `${title} Temporada ${season}`;
        const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', season);
        if (torrentResults.length === 0) {
            this.logger.debug('No torrent results found for season', { imdbId, season, searchQuery });
            return null;
        }
        const bestTorrent = torrentResults[0];
        const magnetHash = this.extractHashFromMagnet(bestTorrent.magnet);
        if (!magnetHash) {
            this.logger.debug('Invalid magnet hash for season torrent', { imdbId, season });
            return null;
        }
        const processResult = await this.rdService.processTorrent(bestTorrent.magnet, apiKey);
        if (!processResult.added || !processResult.torrentId) {
            this.logger.debug('Failed to process season torrent', { imdbId, season });
            return null;
        }
        const torrentId = processResult.torrentId;
        const torrentInfo = await this.rdService.getTorrentInfo(torrentId, apiKey);
        if (processResult.ready) {
            const videoFiles = this.filterAndSortVideoFiles(torrentInfo.files || []);
            if (videoFiles.length === 0) {
                this.logger.debug('No video files found in season torrent', { imdbId, season, torrentId });
                return null;
            }
            const seasonData = {
                torrentId,
                files: videoFiles,
                addedAt: Date.now(),
                magnetHash
            };
            this.seasonCache.set(cacheKey, seasonData);
            this.logger.debug('Cached season torrent data', { imdbId, season, cacheKey, fileCount: videoFiles.length });
            return { torrentId, files: seasonData.files };
        }
        return null;
    }
    async processEpisodeFromSeason(imdbId, season, episode, title, requestId, apiKey) {
        const seasonData = await this.getOrAddSeasonTorrent(imdbId, season, title, apiKey);
        if (!seasonData) {
            return null;
        }
        const { torrentId, files } = seasonData;
        const videoFiles = this.filterAndSortVideoFiles(files);
        const targetFile = this.findEpisodeFile(videoFiles, season, episode);
        if (!targetFile) {
            this.logger.debug('Target episode file not found in season', {
                requestId,
                season,
                episode,
                availableFiles: videoFiles.map(f => f.path)
            });
            return null;
        }
        try {
            const streamLink = await this.rdService.getStreamLinkForFile(torrentId, targetFile.id, apiKey);
            if (!streamLink) {
                this.logger.debug('No stream link available for episode file', { requestId, torrentId, fileId: targetFile.id });
                return null;
            }
            const fileQuality = this.qualityDetector.extractQualityFromFilename(targetFile.path);
            const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            const stream = {
                title: `${title} ${episodeTag}`,
                url: streamLink,
                name: `Brasil RD | ${fileQuality.toUpperCase()} | ${episodeTag}`,
                description: `Conteúdo via temporada completa | ${episodeTag}`,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `br-season-${imdbId}-${season}`,
                    filename: this.sanitizeFilename(`${title} ${episodeTag}`)
                },
                torrentId: torrentId,
                status: 'downloaded'
            };
            this.logger.debug('Successfully created stream from season episode', {
                requestId,
                season,
                episode,
                quality: fileQuality
            });
            return stream;
        }
        catch (error) {
            this.logger.error('Season episode processing error', {
                requestId,
                imdbId,
                season,
                episode,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null;
        }
    }
    async processCuratedMagnets(magnets, request) {
        const qualityGroups = this.groupMagnetsByQuality(magnets);
        const bestMagnets = this.selectBestFromEachQualityGroup(qualityGroups);
        const streams = [];
        for (const magnet of bestMagnets) {
            const stream = this.processMagnetLazy(magnet, request);
            if (stream) {
                streams.push(stream);
                this.logger.debug('Created lazy stream for quality', {
                    requestId: request.id,
                    magnetTitle: magnet.title,
                    quality: magnet.quality
                });
            }
        }
        this.logger.info('Processed multiple quality streams', {
            requestId: request.id,
            totalQualities: streams.length,
            qualities: streams.map(s => this.qualityDetector.extractQualityFromStreamName(s.name))
        });
        return this.sortStreamsByQuality(streams);
    }
    groupMagnetsByQuality(magnets) {
        const groups = new Map();
        const allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
        for (const quality of allowedQualities) {
            groups.set(quality, []);
        }
        for (const magnet of magnets) {
            const quality = this.qualityDetector.extractQualityFromFilename(magnet.title);
            if (allowedQualities.has(quality)) {
                groups.get(quality).push(magnet);
            }
        }
        return groups;
    }
    selectBestFromEachQualityGroup(qualityGroups) {
        const bestMagnets = [];
        const qualityOrder = ['2160p', '1080p', '720p', 'HD'];
        for (const quality of qualityOrder) {
            const group = qualityGroups.get(quality);
            if (group && group.length > 0) {
                const bestInQuality = group.sort((a, b) => {
                    const aScore = a.title.length;
                    const bScore = b.title.length;
                    return bScore - aScore;
                })[0];
                bestMagnets.push(bestInQuality);
                this.logger.debug('Selected best magnet for quality', {
                    quality,
                    magnetTitle: bestInQuality.title,
                    alternatives: group.length
                });
            }
        }
        return bestMagnets;
    }
    createLazyStream(title, name, description, magnet, apiKey, quality, behaviorHints) {
        const encodedMagnet = Buffer.from(magnet).toString('base64');
        const resolveUrl = `http://localhost:7000/resolve/${encodedMagnet}?apiKey=${apiKey}`;
        return {
            title: title,
            url: resolveUrl,
            name: name,
            description: description,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-lazy-${Date.now()}`,
                filename: this.sanitizeFilename(title),
                ...behaviorHints
            },
            magnet: magnet,
            isPending: true,
            status: 'pending'
        };
    }
    processMagnetLazy(magnet, request) {
        const magnetHash = this.extractHashFromMagnet(magnet.magnet);
        if (!magnetHash) {
            this.logger.debug('Invalid magnet hash', { requestId: request.id, magnetTitle: magnet.title });
            return null;
        }
        const quality = this.qualityDetector.extractQualityFromFilename(magnet.title);
        return this.createLazyStream(magnet.title, `Brasil RD | ${quality.toUpperCase()} | ON-DEMAND BR`, `Conteúdo curado | ${magnet.language} | Clique para carregar`, magnet.magnet, request.apiKey, quality);
    }
    extractEpisodeFromRequest(requestId) {
        const defaultResult = { season: 1, episode: 1, isValid: false };
        if (!requestId || typeof requestId !== 'string') {
            return defaultResult;
        }
        const match = requestId.match(/tt\d+:(\d+):(\d+)/);
        if (!match) {
            return defaultResult;
        }
        const season = parseInt(match[1]);
        const episode = parseInt(match[2]);
        if (isNaN(season) || isNaN(episode) || season < 1 || episode < 1) {
            return defaultResult;
        }
        return {
            season,
            episode,
            isValid: true
        };
    }
    findEpisodeFile(files, targetSeason, targetEpisode) {
        for (const file of files) {
            const episodeInfo = this.extractEpisodeInfo(file.path);
            if (episodeInfo.season === targetSeason && episodeInfo.episode === targetEpisode) {
                return file;
            }
        }
        return null;
    }
    filterAndSortVideoFiles(files) {
        const videoFiles = files.filter(file => {
            const filename = file.path.toLowerCase();
            return this.videoExtensions.some(ext => filename.endsWith(ext));
        });
        const cleanVideoFiles = this.filterPromotionalFiles(videoFiles);
        return this.sortFilesByEpisode(cleanVideoFiles);
    }
    generateStreamTitle(magnet) {
        const qualityTag = `[${magnet.quality.toUpperCase()}]`;
        const curatedTag = '[BR-CURATED]';
        const seedTag = magnet.seeds > 10 ? `[${magnet.seeds} seeds]` : '';
        const languageTag = magnet.language === 'pt-BR' ? '[PT-BR]' : `[${magnet.language.toUpperCase()}]`;
        return `${magnet.title} ${qualityTag} ${languageTag} ${curatedTag} ${seedTag}`.trim().replace(/\s+/g, ' ');
    }
    generateEpisodeStreamTitle(magnet, season, episode) {
        const baseTitle = this.generateStreamTitle(magnet);
        const episodeTag = `[S${season}E${episode}]`;
        return `${baseTitle} ${episodeTag}`.trim();
    }
    extractHashFromMagnet(magnet) {
        const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }
    generateCacheKey(request) {
        return `streams:${request.type}:${request.id}`;
    }
    sortStreamsByQuality(streams) {
        return streams.sort((a, b) => {
            const scoreA = this.calculateQualityScore(a.name || '');
            const scoreB = this.calculateQualityScore(b.name || '');
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }
            return (a.name || '').localeCompare(b.name || '');
        });
    }
    calculateQualityScore(name) {
        if (!name)
            return 0;
        const quality = this.qualityDetector.extractQualityFromStreamName(name);
        return this.qualityPriority[quality] || 0;
    }
    sanitizeFilename(filename) {
        return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
    }
    extractEpisodeInfo(filename) {
        for (const pattern of this.episodePatterns) {
            const match = filename.match(pattern);
            if (match) {
                let season = 1;
                let episode = 0;
                if (pattern.source.includes('x') || pattern.source.includes('s\\d+e')) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source.includes('ep')) {
                    episode = parseInt(match[1]);
                }
                else if (pattern.source === '^(\\d+)$') {
                    episode = parseInt(match[1]);
                }
                else if (match.length >= 3) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                if (!isNaN(season) && !isNaN(episode) && season > 0 && episode > 0) {
                    return {
                        season,
                        episode,
                        rawMatch: match[0]
                    };
                }
            }
        }
        const fallbackMatch = filename.match(/\d+/);
        const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
        return {
            season: 1,
            episode: fallbackNumber,
            rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown'
        };
    }
    compareEpisodeInfo(a, b) {
        if (a.season !== b.season) {
            return a.season - b.season;
        }
        if (a.episode !== b.episode) {
            return a.episode - b.episode;
        }
        return 0;
    }
    filterPromotionalFiles(files) {
        return files.filter(file => {
            const filename = file.path.toLowerCase();
            return !this.promotionalKeywords.some(keyword => filename.includes(keyword));
        });
    }
    identifyMainFile(files) {
        return files.length > 0 ? files[0] : null;
    }
    async fetchTitleFromImdb(request) {
        const imdbId = this.extractImdbIdFromRequest(request);
        if (!imdbId) {
            return null;
        }
        try {
            const title = await this.imdbScraper.getTitleFromImdbId(imdbId);
            if (title) {
                this.logger.debug('Retrieved title from IMDB', { imdbId, title });
                return title;
            }
        }
        catch (error) {
            this.logger.error('IMDB title fetch error', {
                imdbId,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
        return null;
    }
    sortFilesByEpisode(files) {
        const filesWithEpisodeInfo = files.map(file => ({
            file,
            episodeInfo: this.extractEpisodeInfo(file.path)
        }));
        return filesWithEpisodeInfo
            .sort((a, b) => this.compareEpisodeInfo(a.episodeInfo, b.episodeInfo))
            .map(item => item.file);
    }
    addCuratedMagnet(magnet) {
        this.magnetService.addMagnet(magnet);
        this.invalidateRelatedCache(magnet.imdbId);
        this.logger.info('Added curated magnet and invalidated cache', { imdbId: magnet.imdbId, title: magnet.title });
    }
    removeCuratedMagnet(imdbId, magnetLink) {
        const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
        if (removed) {
            this.invalidateRelatedCache(imdbId);
            this.logger.info('Removed curated magnet and invalidated cache', { imdbId, magnetLink });
        }
        return removed;
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
        const seasonCacheKeys = Array.from(this.seasonCache.keys()).filter(key => key.includes(imdbId));
        for (const key of seasonCacheKeys) {
            this.seasonCache.delete(key);
        }
        this.logger.debug('Invalidated related cache', { imdbId, cachePatterns: cachePatterns.length, seasonCacheKeys: seasonCacheKeys.length });
    }
    getStats() {
        return {
            cache: this.cacheService.getStats(),
            magnets: this.magnetService.getStats(),
            torrentCache: {
                size: this.torrentCache.size,
                entries: Array.from(this.torrentCache.keys())
            },
            seasonCache: {
                size: this.seasonCache.size,
                entries: Array.from(this.seasonCache.keys())
            }
        };
    }
    clearCache() {
        this.cacheService.clear();
        this.torrentCache.clear();
        this.seasonCache.clear();
        this.logger.info('Cleared all caches');
    }
    validateMagnet(magnet) {
        if (!magnet.startsWith('magnet:?')) {
            return false;
        }
        const hash = this.extractHashFromMagnet(magnet);
        if (!hash) {
            return false;
        }
        return hash.length >= 32 && hash.length <= 40;
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.StreamHandler = StreamHandler;
