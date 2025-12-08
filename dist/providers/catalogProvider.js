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
        this.VERSION = '4.5.0';
        this.streamCache = new Map();
        this.STREAM_TTL = 24 * 60 * 60 * 1000;
        this.STREAM_EMPTY_TTL = 60 * 1000;
        this.CACHE_KEY_SEPARATOR = '|';
        this.logger = new logger_1.Logger('CatalogProvider');
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        this.streamFormatter = new streamFormatter_1.StreamFormatter();
        this.metadataExtractor = new MetadataExtractor_1.MetadataExtractor();
        this.torrentScraper = new TorrentScraperService_1.TorrentScraperService();
        this.imdbScraper = new ImdbScraperService_1.ImdbScraperService();
        this.titleFilter = new titleFilter_1.TitleFilter();
        this.autoMagnetService = new AutoMagnetService_1.AutoMagnetService();
        this.logger.info(`CatalogProvider v${this.VERSION} inicializado - Deduplicacao corrigida para formato v1.4.0`);
    }
    async getStreamsFromCatalog(request) {
        const startTime = Date.now();
        const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
        const cacheKey = this.generateCacheKey(request, season, episode);
        const cachedStreams = this.getFromCache(cacheKey);
        if (cachedStreams !== null) {
            const duration = Date.now() - startTime;
            this.logger.debug('Resultado do cache', {
                requestId: request.id,
                quantidade: cachedStreams.length,
                cacheKey,
                duration: `${duration}ms`
            });
            MetricsService_1.metricsService.recordCacheHit();
            return cachedStreams;
        }
        this.logger.debug('Busca de streams iniciada', {
            requestId: request.id,
            type: request.type,
            hasApiKey: !!request.apiKey,
            season,
            episode
        });
        let allStreams = [];
        const dbStreams = await this.getStreamsFromDatabase(request, season, episode);
        allStreams.push(...dbStreams);
        this.logger.debug('Resultados do banco', {
            quantidade: dbStreams.length,
            type: request.type,
            season,
            episode
        });
        if (dbStreams.length === 0) {
            const jsonStreams = await this.getStreamsFromJson(request, season, episode);
            allStreams.push(...jsonStreams);
            this.logger.debug('Resultados do JSON', {
                quantidade: jsonStreams.length,
                imdbId: request.imdbId || request.id
            });
        }
        const uniqueStreams = this.removeDuplicatesByInfoHash(allStreams);
        uniqueStreams.forEach(stream => {
            const quality = this.extractStreamQuality(stream);
            MetricsService_1.metricsService.recordStreamReturned(request.type, quality);
        });
        this.logger.info('Resultados do catalogo', {
            totalFinal: uniqueStreams.length,
            doBanco: dbStreams.length,
            doJson: allStreams.length - dbStreams.length,
            duplicadosRemovidos: allStreams.length - uniqueStreams.length,
            duration: `${Date.now() - startTime}ms`
        });
        if (uniqueStreams.length === 0) {
            this.logger.debug('Nenhum stream no catalogo, iniciando scraping', {
                requestId: request.id,
                type: request.type,
                season,
                episode
            });
            const scrapedStreams = await this.performScrapingFallback(request, season, episode);
            const scrapedUniqueStreams = this.removeDuplicatesByInfoHash(scrapedStreams);
            scrapedUniqueStreams.forEach(stream => {
                const quality = this.extractStreamQuality(stream);
                MetricsService_1.metricsService.recordStreamReturned(request.type, quality);
            });
            this.logger.info('Resultados do scraping', {
                quantidade: scrapedUniqueStreams.length,
                duration: `${Date.now() - startTime}ms`
            });
            this.saveToCache(cacheKey, scrapedUniqueStreams);
            MetricsService_1.metricsService.setCacheSize(this.streamCache.size);
            return scrapedUniqueStreams;
        }
        this.saveToCache(cacheKey, uniqueStreams);
        MetricsService_1.metricsService.setCacheSize(this.streamCache.size);
        this.logger.debug('Streams do catalogo retornados', {
            requestId: request.id,
            quantidade: uniqueStreams.length,
            cacheKey
        });
        return uniqueStreams;
    }
    generateCacheKey(request, season, episode) {
        const baseId = request.imdbId || request.id;
        const type = request.type || 'unknown';
        const seasonStr = season !== undefined ? `s${season}` : '';
        const episodeStr = episode !== undefined ? `e${episode}` : '';
        return `${baseId}${this.CACHE_KEY_SEPARATOR}${type}${this.CACHE_KEY_SEPARATOR}${seasonStr}${episodeStr}`;
    }
    getFromCache(cacheKey) {
        const cacheEntry = this.streamCache.get(cacheKey);
        if (!cacheEntry) {
            MetricsService_1.metricsService.recordCacheMiss();
            return null;
        }
        const now = Date.now();
        const isExpired = cacheEntry.isEmpty
            ? now - cacheEntry.timestamp > this.STREAM_EMPTY_TTL
            : now - cacheEntry.timestamp > this.STREAM_TTL;
        if (isExpired) {
            this.streamCache.delete(cacheKey);
            this.logger.debug('Cache expirado removido', { cacheKey });
            MetricsService_1.metricsService.recordCacheMiss();
            return null;
        }
        MetricsService_1.metricsService.recordCacheHit();
        this.logger.debug('Cache encontrado', {
            cacheKey,
            streams: cacheEntry.streams.length,
            age: now - cacheEntry.timestamp
        });
        return cacheEntry.streams;
    }
    saveToCache(cacheKey, streams) {
        const isEmpty = streams.length === 0;
        const ttl = isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
        this.streamCache.set(cacheKey, {
            streams,
            timestamp: Date.now(),
            isEmpty
        });
        if (this.streamCache.size > 10000) {
            this.cleanupOldCache();
        }
    }
    cleanupOldCache() {
        const now = Date.now();
        let removed = 0;
        const maxAge = 7 * 24 * 60 * 60 * 1000;
        for (const [key, entry] of this.streamCache) {
            if (now - entry.timestamp > maxAge) {
                this.streamCache.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            this.logger.debug('Cache antigo limpo', {
                removidos: removed,
                restantes: this.streamCache.size
            });
            MetricsService_1.metricsService.setCacheSize(this.streamCache.size);
        }
    }
    async getStreamsFromDatabase(request, season, episode) {
        const dbStartTime = Date.now();
        try {
            const baseImdbId = this.extractBaseImdbId(request.imdbId || request.id);
            if (!baseImdbId) {
                return [];
            }
            const finalSeason = season !== undefined ? season : request.season;
            const finalEpisode = episode !== undefined ? episode : request.episode;
            this.logger.debug('Buscando no banco de dados', {
                baseImdbId,
                type: request.type,
                season: finalSeason,
                episode: finalEpisode
            });
            let dbEntries = [];
            if (request.type === 'movie') {
                dbEntries = await (0, repository_1.getImdbIdMovieEntries)(baseImdbId);
            }
            else if (request.type === 'series' && finalSeason !== undefined) {
                dbEntries = await (0, repository_1.getImdbIdSeriesEntries)(baseImdbId, finalSeason, finalEpisode);
            }
            this.logger.debug('Resultados do banco', {
                baseImdbId,
                entradasEncontradas: dbEntries.length,
                type: request.type,
                season: finalSeason,
                episode: finalEpisode,
                duration: `${Date.now() - dbStartTime}ms`
            });
            if (dbEntries.length === 0) {
                return [];
            }
            const torrentData = await this.processDatabaseTorrents(dbEntries, request, finalSeason, finalEpisode);
            const sortedTorrents = this.sortTorrentsByQuality(torrentData);
            const streams = await this.createStreamsFromDbTorrents(sortedTorrents, request, finalSeason, finalEpisode);
            this.logger.info('Streams criados do banco', {
                baseImdbId,
                torrents: torrentData.length,
                streams: streams.length,
                duration: `${Date.now() - dbStartTime}ms`
            });
            return streams;
        }
        catch (error) {
            this.logger.error('Erro na busca no banco', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                duration: `${Date.now() - dbStartTime}ms`
            });
            return [];
        }
    }
    async processDatabaseTorrents(dbEntries, request, season, episode) {
        const torrentMap = new Map();
        this.logger.debug('Processando torrents do banco', {
            totalEntradas: dbEntries.length,
            season,
            episode
        });
        for (const entry of dbEntries) {
            try {
                const torrent = entry.Torrent;
                const magnet = torrent.magnetLink || '';
                const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(magnet);
                if (!magnetHash) {
                    continue;
                }
                const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
                const quality = this.qualityDetector.extractBestQuality(torrent.title) || 'HD';
                const seeds = torrent.seeders || 50;
                const size = torrent.size ? this.formatSize(torrent.size) : 'N/A';
                const language = torrent.languages || 'PT-BR';
                const qualityScore = this.getQualityScore(quality);
                torrentMap.set(magnetHash, {
                    torrent,
                    metadata,
                    quality,
                    qualityScore,
                    seeds,
                    size,
                    language,
                    magnet,
                    magnetHash,
                    title: torrent.title,
                    requestType: request.type,
                    season: season,
                    episode: episode
                });
            }
            catch (error) {
                this.logger.debug('Erro ao processar torrent do banco', {
                    error: error instanceof Error ? error.message : 'Erro desconhecido'
                });
            }
        }
        const torrents = Array.from(torrentMap.values());
        this.logger.debug('Torrents processados do banco', {
            totalEntradas: dbEntries.length,
            torrentsUnicos: torrents.length
        });
        return torrents;
    }
    async createStreamsFromDbTorrents(torrents, request, season, episode) {
        const streams = [];
        for (const torrentData of torrents) {
            try {
                this.logger.debug('Criando stream do banco', {
                    titulo: torrentData.title.substring(0, 80),
                    qualidade: torrentData.quality,
                    seeds: torrentData.seeds,
                    season,
                    episode
                });
                const formattedTorrent = {
                    title: torrentData.title,
                    magnet: torrentData.magnet,
                    seeders: torrentData.seeds,
                    size: torrentData.size,
                    quality: torrentData.quality,
                    language: torrentData.language
                };
                const streamArrays = this.streamFormatter.createMultipleQualityStreams(formattedTorrent, request, null, torrentData.requestType, season, episode, undefined, 0);
                streams.push(...streamArrays);
            }
            catch (error) {
                this.logger.error('Erro ao criar stream do banco', {
                    titulo: torrentData.title.substring(0, 60),
                    error: error instanceof Error ? error.message : 'Erro'
                });
            }
        }
        return streams;
    }
    sortTorrentsByQuality(torrents) {
        return torrents.sort((a, b) => {
            if (b.qualityScore !== a.qualityScore) {
                return b.qualityScore - a.qualityScore;
            }
            if (b.seeds !== a.seeds) {
                return b.seeds - a.seeds;
            }
            return a.title.localeCompare(b.title);
        });
    }
    async getStreamsFromJson(request, season, episode) {
        const jsonStartTime = Date.now();
        try {
            const curatedMagnets = this.magnetService.searchMagnets(request);
            this.logger.debug('Resultados do JSON obtidos', {
                magnetsEncontrados: curatedMagnets.length,
                imdbId: request.imdbId || request.id
            });
            if (curatedMagnets.length === 0) {
                return [];
            }
            const streams = [];
            for (const magnet of curatedMagnets) {
                try {
                    const formattedTorrent = {
                        title: magnet.title,
                        magnet: magnet.magnet || '',
                        seeders: magnet.seeds || 0,
                        size: magnet.size || 'N/A',
                        quality: magnet.quality || 'HD',
                        language: magnet.language || 'PT-BR'
                    };
                    const isSeries = request.type === 'series';
                    const targetSeason = season !== undefined ? season : magnet.season;
                    const targetEpisode = episode !== undefined ? episode : magnet.episode;
                    const streamArrays = this.streamFormatter.createMultipleQualityStreams(formattedTorrent, request, null, isSeries ? 'series' : 'movie', targetSeason, targetEpisode, undefined, 0);
                    if (streamArrays.length > 0) {
                        streams.push(...streamArrays);
                    }
                }
                catch (error) {
                    this.logger.error('Erro ao processar magnet do JSON', {
                        titulo: magnet.title.substring(0, 60),
                        error: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                }
            }
            this.logger.info('Streams do JSON criados', {
                quantidade: streams.length,
                duration: `${Date.now() - jsonStartTime}ms`
            });
            return streams;
        }
        catch (error) {
            this.logger.error('Erro na busca no JSON', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                duration: `${Date.now() - jsonStartTime}ms`
            });
            return [];
        }
    }
    removeDuplicatesByInfoHash(streams) {
        const seenStreamKeys = new Set();
        const uniqueStreams = [];
        for (const stream of streams) {
            const streamInfoHash = stream.infoHash || 'unknown';
            const streamQuality = this.extractStreamQuality(stream);
            if (!streamInfoHash || streamInfoHash === 'unknown') {
                const fallbackKey = stream.title || String(Math.random());
                if (seenStreamKeys.has(fallbackKey)) {
                    continue;
                }
                seenStreamKeys.add(fallbackKey);
                uniqueStreams.push(stream);
                continue;
            }
            const streamKey = `${streamInfoHash}|${streamQuality}`;
            if (seenStreamKeys.has(streamKey)) {
                continue;
            }
            seenStreamKeys.add(streamKey);
            uniqueStreams.push(stream);
        }
        if (streams.length !== uniqueStreams.length) {
            this.logger.debug('Streams deduplicados', {
                antes: streams.length,
                depois: uniqueStreams.length,
                removidos: streams.length - uniqueStreams.length,
                criterio: 'infoHash + qualidade',
                versaoFormato: '1.4.0'
            });
        }
        return uniqueStreams;
    }
    async performScrapingFallback(request, season, episode) {
        const scrapeStartTime = Date.now();
        this.logger.debug('Iniciando scraping como fallback', {
            requestId: request.id,
            type: request.type,
            season: season,
            episode: episode
        });
        try {
            const imdbId = this.extractBaseImdbId(request.id);
            let scrapedStreams = [];
            if (request.type === 'series') {
                scrapedStreams = await this.scrapeSeries(request, imdbId, season, episode);
            }
            else {
                scrapedStreams = await this.scrapeMovie(request, imdbId);
            }
            await this.autoPopulateDatabase(scrapedStreams, request, imdbId, season, episode);
            this.logger.info('Scraping concluido', {
                streams: scrapedStreams.length,
                duration: `${Date.now() - scrapeStartTime}ms`
            });
            return scrapedStreams;
        }
        catch (error) {
            this.logger.error('Erro no scraping fallback', {
                requestId: request.id,
                error: error instanceof Error ? error.message : 'Erro',
                duration: `${Date.now() - scrapeStartTime}ms`
            });
            return [];
        }
    }
    async scrapeSeries(request, imdbId, season, episode) {
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
        const finalSeason = season !== undefined ? season : (match ? parseInt(match[1]) : undefined);
        const finalEpisode = episode !== undefined ? episode : (match ? parseInt(match[2]) : undefined);
        if (!finalSeason || !finalEpisode) {
            this.logger.warn('Season ou episode nao definido para scraping serie', {
                imdbId,
                season: finalSeason,
                episode: finalEpisode
            });
            return [];
        }
        this.logger.debug('Scraping serie especifica', {
            imdbId,
            season: finalSeason,
            episode: finalEpisode
        });
        try {
            const searchQuery = `S${finalSeason.toString().padStart(2, '0')}E${finalEpisode.toString().padStart(2, '0')}`;
            const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', finalSeason);
            if (torrentResults.length === 0) {
                this.logger.debug('Nenhum torrent encontrado no scraping', { searchQuery });
                return [];
            }
            const validTorrents = await this.filterScrapedTorrents(torrentResults, imdbId, request, finalSeason, finalEpisode);
            if (validTorrents.length === 0) {
                this.logger.debug('Nenhum torrent valido apos filtragem', {
                    totalTestados: torrentResults.length
                });
                return [];
            }
            const allStreams = [];
            for (const torrent of validTorrents) {
                const formattedTorrent = {
                    title: torrent.title,
                    magnet: torrent.magnet,
                    seeders: torrent.seeders,
                    size: torrent.size,
                    quality: torrent.quality,
                    language: torrent.language
                };
                const torrentStreams = this.streamFormatter.createMultipleQualityStreams(formattedTorrent, request, null, 'series', finalSeason, finalEpisode, undefined, 0);
                allStreams.push(...torrentStreams);
            }
            return this.removeDuplicatesByInfoHash(allStreams);
        }
        catch (error) {
            this.logger.error('Erro no scraping serie', {
                imdbId,
                season: finalSeason,
                episode: finalEpisode,
                error: error instanceof Error ? error.message : 'Erro'
            });
            return [];
        }
    }
    async scrapeMovie(request, imdbId) {
        this.logger.debug('Scraping filme', { imdbId });
        try {
            const searchQuery = 'Filme';
            const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'movie');
            if (torrentResults.length === 0) {
                this.logger.debug('Nenhum torrent encontrado no scraping', { searchQuery });
                return [];
            }
            const validTorrents = await this.filterScrapedTorrents(torrentResults, imdbId, request);
            if (validTorrents.length === 0) {
                this.logger.debug('Nenhum torrent valido apos filtragem', {
                    totalTestados: torrentResults.length
                });
                return [];
            }
            const streams = [];
            for (const torrent of validTorrents) {
                const formattedTorrent = {
                    title: torrent.title,
                    magnet: torrent.magnet,
                    seeders: torrent.seeders,
                    size: torrent.size,
                    quality: torrent.quality,
                    language: torrent.language
                };
                const torrentStreams = this.streamFormatter.createMultipleQualityStreams(formattedTorrent, request, null, 'movie', undefined, undefined, undefined, 0);
                streams.push(...torrentStreams);
            }
            return this.removeDuplicatesByInfoHash(streams);
        }
        catch (error) {
            this.logger.error('Erro no scraping filme', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro'
            });
            return [];
        }
    }
    async filterScrapedTorrents(torrents, imdbId, request, season, episode, imdbTitles = null) {
        const valid = [];
        this.logger.debug('Filtrando torrents do scraping', {
            total: torrents.length,
            imdbId: imdbId,
            season: season,
            episode: episode
        });
        if (!imdbId) {
            return torrents;
        }
        for (const torrent of torrents) {
            try {
                const titleMatchResult = await this.titleFilter.doTitlesMatch(torrent.title, imdbId, season, episode);
                if (titleMatchResult.matches) {
                    valid.push(torrent);
                }
            }
            catch (error) {
                this.logger.debug('Erro filtragem torrent', {
                    title: torrent.title.substring(0, 60),
                    error: error instanceof Error ? error.message : 'Erro'
                });
            }
        }
        this.logger.debug('Filtragem scraping concluida', {
            total: torrents.length,
            validos: valid.length,
            invalidos: torrents.length - valid.length
        });
        return valid;
    }
    async autoPopulateDatabase(scrapedStreams, request, imdbId, season, episode) {
        if (!imdbId || scrapedStreams.length === 0) {
            return;
        }
        this.logger.debug('Auto-populando banco com resultados do scraping', {
            count: scrapedStreams.length,
            imdbId: imdbId,
            type: request.type,
            season: season,
            episode: episode
        });
        for (const stream of scrapedStreams) {
            try {
                if (stream.infoHash) {
                    await this.autoMagnetService.autoAddMagnet(stream.infoHash, stream.title || 'Torrent', imdbId, request.type, 50, this.extractStreamQuality(stream), 'N/A', season, episode);
                }
            }
            catch (error) {
                this.logger.warn('Erro ao auto-popular banco', {
                    title: stream.title?.substring(0, 60),
                    error: error instanceof Error ? error.message : 'Erro'
                });
            }
        }
        this.logger.debug('Auto-populacao concluida', {
            totalProcessados: scrapedStreams.length
        });
    }
    extractStreamQuality(stream) {
        const behaviorHints = stream.behaviorHints;
        if (behaviorHints?.streamQuality) {
            return behaviorHints.streamQuality;
        }
        const qualityFromTitle = this.qualityDetector.extractBestQuality(stream.title || '');
        if (qualityFromTitle && qualityFromTitle !== 'unknown') {
            return qualityFromTitle;
        }
        return 'unknown';
    }
    extractSeasonEpisodeFromRequest(request) {
        let season = request.season;
        let episode = request.episode;
        if (!season && request.type === 'series' && request.id) {
            const seasonEpisodeMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
            if (seasonEpisodeMatch) {
                season = parseInt(seasonEpisodeMatch[1]);
                episode = parseInt(seasonEpisodeMatch[2]);
            }
        }
        return { season, episode };
    }
    extractBaseImdbId(id) {
        const match = id.match(/^(tt\d+)/);
        return match ? match[1] : null;
    }
    getQualityScore(quality) {
        const scores = {
            '2160p': 100,
            '4k': 100,
            '1080p': 80,
            '720p': 60,
            'HD': 40,
            'SD': 20
        };
        return scores[quality] || 30;
    }
    formatSize(bytes) {
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        else if (bytes < 1024 * 1024 * 1024) {
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        }
        else {
            return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
        }
    }
    getStats() {
        return {
            version: this.VERSION,
            cacheSize: this.streamCache.size,
            features: [
                'Fluxo corrigido: Banco -> JSON -> Scraping',
                'Deduplicacao por infoHash (formato v1.4.0 compatível)',
                'Auto-populacao do banco com resultados de scraping',
                'Cache inteligente com TTL diferenciado',
                'Metricas integradas'
            ],
            fluxo: 'PostgreSQL > magnets.json > Scraper > Auto-populacao'
        };
    }
}
exports.CatalogProvider = CatalogProvider;
