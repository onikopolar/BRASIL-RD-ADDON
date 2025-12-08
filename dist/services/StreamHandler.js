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
const titleFilter_1 = require("../lib/titleFilter");
const streamFormatter_1 = require("../lib/streamFormatter");
const catalogProvider_1 = require("../providers/catalogProvider");
const StaticResponseService_1 = require("./StaticResponseService");
const StreamStatusException_1 = require("./StreamStatusException");
class StreamHandler {
    constructor(baseUrl) {
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
            duplicatesRemoved: 0,
            servedInformativeStreams: 0
        };
        this.rdService = new RealDebridService_1.RealDebridService(baseUrl);
        this.magnetService = new CuratedMagnetService_1.CuratedMagnetService();
        this.autoMagnetService = new AutoMagnetService_1.AutoMagnetService();
        this.cacheService = new CacheService_1.CacheService();
        this.torrentScraper = new TorrentScraperService_1.TorrentScraperService();
        this.imdbScraper = new ImdbScraperService_1.ImdbScraperService();
        this.logger = new logger_1.Logger('StreamHandler');
        this.logger.info('v5.0.0 inicializado - Fix completo TMDB Season');
        this.staticResponseService = new StaticResponseService_1.StaticResponseService(baseUrl);
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        this.titleFilter = new titleFilter_1.TitleFilter();
        this.streamFormatter = new streamFormatter_1.StreamFormatter();
        this.catalogProvider = new catalogProvider_1.CatalogProvider(this.magnetService);
    }
    setStaticResponseBaseUrl(baseUrl) {
        this.staticResponseService.setBaseUrl(baseUrl);
        this.rdService.setStaticResponseBaseUrl(baseUrl);
    }
    deduplicateStreamsByInfoHash(streams) {
        const seenCombinations = new Set();
        const uniqueStreams = [];
        for (const stream of streams) {
            let infoHash = stream.infoHash?.toLowerCase();
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
            let uniqueKey;
            if (infoHash) {
                uniqueKey = `${infoHash}_${quality}`;
            }
            else {
                this.logger.warn('Stream sem infoHash encontrado, usando título para dedup', {
                    title: stream.title?.substring(0, 50)
                });
                uniqueKey = stream.title || `stream_${Math.random()}`;
            }
            if (seenCombinations.has(uniqueKey)) {
                this.stats.duplicatesRemoved++;
                this.logger.debug('Stream duplicado removido', {
                    infoHash: infoHash ? `${infoHash.substring(0, 8)}...` : 'none',
                    quality: quality,
                    uniqueKey: uniqueKey
                });
                continue;
            }
            seenCombinations.add(uniqueKey);
            uniqueStreams.push(stream);
        }
        if (streams.length !== uniqueStreams.length) {
            this.logger.debug('Deduplicação de streams concluída', {
                totalInicial: streams.length,
                totalFinal: uniqueStreams.length,
                duplicadosRemovidos: streams.length - uniqueStreams.length,
                formato: 'v1.4.0_compatible'
            });
        }
        return uniqueStreams;
    }
    async handleStreamRequest(request) {
        const requestId = request.id;
        const requestStartTime = Date.now();
        this.stats.totalRequests++;
        this.logger.debug('Processando request', {
            requestId,
            type: request.type,
            hasApiKey: !!request.apiKey
        });
        if (!request.apiKey)
            return { streams: [] };
        try {
            await this.magnetService.waitForInitialization();
            const dbResult = await this.getStreamsFromDatabase(request);
            if (dbResult.success && dbResult.streams.length > 0) {
                const dedupedStreams = this.deduplicateStreamsByInfoHash(dbResult.streams);
                this.stats.servedFromDatabase++;
                this.logger.debug('Streams do banco', {
                    requestId,
                    antes: dbResult.streams.length,
                    depois: dedupedStreams.length,
                    tempo: dbResult.processingTime
                });
                return { streams: dedupedStreams };
            }
            const catalogResult = await this.getStreamsFromCatalog(request);
            if (catalogResult.success && catalogResult.streams.length > 0) {
                const dedupedStreams = this.deduplicateStreamsByInfoHash(catalogResult.streams);
                this.stats.servedFromCatalog++;
                this.logger.debug('Streams do catálogo', {
                    requestId,
                    antes: catalogResult.streams.length,
                    depois: dedupedStreams.length,
                    tempo: catalogResult.processingTime
                });
                return { streams: dedupedStreams };
            }
            const shouldScrape = await this.shouldAttemptScraping(request);
            if (!shouldScrape) {
                const informativeStream = this.createInformativeStreamIfNoContent(request);
                if (informativeStream)
                    return { streams: [informativeStream] };
                return { streams: [] };
            }
            try {
                const scrapingResult = await this.processStreamRequest(request);
                const dedupedStreams = this.deduplicateStreamsByInfoHash(scrapingResult);
                await this.updateScrapingCache(request, dedupedStreams.length > 0);
                this.stats.servedFromScraping += dedupedStreams.length > 0 ? 1 : 0;
                this.logger.debug('Streams do scraping', {
                    requestId,
                    antes: scrapingResult.length,
                    depois: dedupedStreams.length,
                    fonte: 'scraping'
                });
                return { streams: dedupedStreams };
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
    createInformativeStreamFromException(exception, requestId) {
        const informativeStream = this.staticResponseService.createInformativeStream(exception.staticResponse, requestId);
        return this.convertToStreamFormat(informativeStream);
    }
    createInformativeStreamIfNoContent(request) {
        if (request.type === 'series') {
            const imdbId = this.extractImdbIdFromRequest(request);
            if (imdbId) {
                const informativeStream = this.staticResponseService.createInformativeStream(StaticResponseService_1.StaticResponse.DOWNLOADING, request.id);
                return this.convertToStreamFormat(informativeStream);
            }
        }
        const informativeStream = this.staticResponseService.createInformativeStream(StaticResponseService_1.StaticResponse.DOWNLOADING, request.id);
        return this.convertToStreamFormat(informativeStream);
    }
    convertToStreamFormat(informativeStream) {
        const infoHash = `info-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        const stream = {
            title: informativeStream.title || 'Brasil RD - Informação',
            name: informativeStream.name || 'Brasil RD - Mensagem Informativa',
            description: informativeStream.description || 'Mensagem informativa do addon Brasil RD',
            url: informativeStream.url || 'data:text/plain,Brasil%20RD%20-%20Mensagem%20informativa',
            behaviorHints: { notWebReady: true, bingeGroup: 'br-info' },
            status: 'available',
            infoHash: infoHash,
            magnet: `brasilrd://info/${infoHash}`,
            sources: [`brasilrd://info/${infoHash}`]
        };
        return stream;
    }
    async getStreamsFromDatabase(request) {
        const startTime = Date.now();
        try {
            let fileEntries = [];
            const imdbId = this.extractImdbIdFromRequest(request);
            if (!imdbId)
                return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
            if (request.type === 'movie') {
                fileEntries = await this.getImdbIdMovieEntries(imdbId);
            }
            else if (request.type === 'series') {
                const imdbId = this.extractImdbIdFromRequest(request);
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
        return models_1.File.findAll({
            where: { imdbId: { [sequelize_1.Op.eq]: imdbId }, imdbSeason: { [sequelize_1.Op.eq]: season }, imdbEpisode: { [sequelize_1.Op.eq]: episode } },
            include: [{ model: models_1.Torrent, required: true, where: { seeders: { [sequelize_1.Op.gte]: 5 } } }],
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
            if (request.type === 'series') {
                const match = request.id.match(/tt\d+:(\d+):(\d+)/);
                if (match) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                    titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
                }
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
        if (cacheEntry) {
            const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
            if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2)
                return false;
            if (timeSinceLastAttempt < 5 * 60 * 1000)
                return false;
        }
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
        const toDelete = [];
        for (const [key, entry] of this.scrapingCache.entries()) {
            const age = now - entry.lastAttempt.getTime();
            if (age > this.scrapingCacheTTL * 2)
                toDelete.push(key);
        }
        for (const key of toDelete)
            this.scrapingCache.delete(key);
    }
    async processStreamRequest(request) {
        if (request.type === 'series')
            return await this.processSeriesRequest(request);
        else
            return await this.processMovieRequest(request);
    }
    async processMovieRequest(request) {
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            return await this.performIntelligentScraping(imdbId, request);
        }
        catch (error) {
            if (error instanceof StreamStatusException_1.StreamStatusException)
                throw error;
            return [];
        }
    }
    async processSeriesRequest(request) {
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            if (!imdbId)
                return await this.performIntelligentScraping(null, request);
            const match = request.id.match(/tt\d+:(\d+):(\d+)/);
            if (match) {
                const season = parseInt(match[1]);
                const episode = parseInt(match[2]);
                const episodeStream = await this.processSpecificEpisode(imdbId, season, episode, request);
                if (episodeStream)
                    return Array.isArray(episodeStream) ? episodeStream : [episodeStream];
            }
            return await this.performIntelligentScraping(imdbId, request);
        }
        catch (error) {
            if (error instanceof StreamStatusException_1.StreamStatusException)
                throw error;
            return [];
        }
    }
    async performIntelligentScraping(imdbId, request) {
        try {
            const type = request.type;
            const match = request.id.match(/tt\d+:(\d+):(\d+)/);
            let searchTitle = null;
            let imdbTitles = null;
            const season = match ? parseInt(match[1]) : undefined;
            if (imdbId) {
                imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
                if (imdbTitles && season && imdbTitles.year) {
                    this.logger.debug('TMDB: usando ano da temporada', {
                        imdbId,
                        season,
                        year: imdbTitles.year,
                        note: season > 1 ? 'Ano diferente da 1ª temporada - NORMAL' : 'Ano da 1ª temporada'
                    });
                }
                if (imdbTitles && imdbTitles.allTitles.length > 0)
                    searchTitle = imdbTitles.allTitles[0];
            }
            if (!searchTitle)
                searchTitle = 'Unknown Title';
            let searchQuery = searchTitle;
            if (type === 'series' && match) {
                const season = parseInt(match[1]);
                searchQuery = `${searchTitle} Temporada ${season}`;
            }
            this.logger.debug('Iniciando scraping', {
                searchQuery,
                type,
                imdbId,
                season,
                hasImdbTitles: !!imdbTitles
            });
            const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, match ? parseInt(match[1]) : undefined);
            this.logger.debug('Resultados scraping', { encontrados: torrentResults.length, query: searchQuery });
            if (torrentResults.length === 0)
                return [];
            const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
            const episode = match ? parseInt(match[2]) : undefined;
            const filteredTorrents = await this.filterAndValidateTorrents(deduplicatedTorrents, imdbId, request, season, episode, imdbTitles);
            this.logger.debug('DEBUG - FILTRADOS', {
                validos: filteredTorrents.valid.length,
                invalidos: filteredTorrents.invalid.length
            });
            if (filteredTorrents.valid.length === 0)
                return [];
            await this.saveValidTorrentsToCatalog(filteredTorrents.valid, request, season, episode, imdbTitles);
            const streams = await this.processTorrentsWithOptimization(filteredTorrents.valid, request, season, episode);
            return this.streamFormatter.sortStreamsByQuality(streams);
        }
        catch (error) {
            if (error instanceof StreamStatusException_1.StreamStatusException)
                throw error;
            return [];
        }
    }
    deduplicateTorrentsByMagnet(torrents) {
        const seenMagnets = new Set();
        const uniqueTorrents = [];
        for (const torrent of torrents) {
            const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(torrent.magnet);
            if (magnetHash) {
                if (seenMagnets.has(magnetHash.toLowerCase()))
                    continue;
                seenMagnets.add(magnetHash.toLowerCase());
            }
            uniqueTorrents.push(torrent);
        }
        if (torrents.length !== uniqueTorrents.length) {
            this.logger.debug('Torrents deduplicados', {
                antes: torrents.length,
                depois: uniqueTorrents.length
            });
        }
        return uniqueTorrents;
    }
    async filterAndValidateTorrents(torrents, imdbId, request, season, episode, imdbTitles = null) {
        const valid = [];
        const invalid = [];
        this.logger.debug('Filtrando torrents', {
            total: torrents.length,
            imdbId: imdbId,
            type: request.type,
            season: season,
            episode: episode
        });
        if (!imdbId) {
            this.logger.debug('Sem IMDb ID, retornando todos');
            return { valid: torrents, invalid: [] };
        }
        for (const torrent of torrents) {
            try {
                this.logger.debug('Validando', {
                    title: torrent.title.substring(0, 60),
                    imdbId: imdbId
                });
                const titleMatchResult = await this.titleFilter.doTitlesMatch(torrent.title, imdbId, season, episode);
                if (titleMatchResult.matches) {
                    this.logger.debug('Válido', {
                        title: torrent.title.substring(0, 60),
                        reason: titleMatchResult.reason
                    });
                    valid.push(torrent);
                }
                else {
                    this.logger.debug('Inválido', {
                        title: torrent.title.substring(0, 60),
                        reason: titleMatchResult.reason
                    });
                    invalid.push(torrent);
                }
            }
            catch (error) {
                this.logger.debug('Erro validação', {
                    title: torrent.title.substring(0, 60),
                    error: error instanceof Error ? error.message : 'Erro'
                });
                invalid.push(torrent);
            }
        }
        this.logger.debug('Filtragem concluída', {
            total: torrents.length,
            validos: valid.length,
            invalidos: invalid.length
        });
        return { valid, invalid };
    }
    async saveValidTorrentsToCatalog(validTorrents, request, season, episode, imdbTitles = null) {
        const imdbId = this.extractImdbIdFromRequest(request);
        this.logger.debug('SALVANDO CATÁLOGO', {
            count: validTorrents.length,
            imdbId: imdbId,
            type: request.type,
            season: season,
            episode: episode
        });
        if (!imdbId) {
            this.logger.debug('Sem IMDb ID, cancelando');
            return;
        }
        if (validTorrents.length === 0) {
            this.logger.debug('Nenhum torrent válido');
            return;
        }
        for (const torrent of validTorrents) {
            try {
                const result = await this.autoMagnetService.autoAddMagnet(torrent.magnet, torrent.title, imdbId, request.type, torrent.seeders, torrent.quality, torrent.size, season, episode);
                this.logger.debug('Resultado autoAddMagnet', {
                    title: torrent.title.substring(0, 60),
                    success: result.success,
                    magnetAdded: result.magnetAdded
                });
            }
            catch (error) {
                this.logger.error('Erro salvar magnet', {
                    title: torrent.title.substring(0, 60),
                    error: error instanceof Error ? error.message : 'Erro'
                });
            }
        }
        this.logger.debug('Salvamento concluído', {
            totalProcessados: validTorrents.length
        });
    }
    async processTorrentsWithOptimization(torrents, request, season, episode) {
        const allStreams = [];
        const batchSize = this.processingConfig.maxConcurrentTorrents;
        for (let i = 0; i < torrents.length; i += batchSize) {
            const batch = torrents.slice(i, i + batchSize);
            const batchPromises = batch.map(async (torrent) => {
                try {
                    if (request.type === 'series' && season !== undefined) {
                        return this.streamFormatter.createMultipleQualityStreams(torrent, request, null, 'series', season, episode, false);
                    }
                    else {
                        return this.streamFormatter.createMultipleQualityStreams(torrent, request, null, 'movie', undefined, undefined, false);
                    }
                }
                catch (error) {
                    if (error instanceof StreamStatusException_1.StreamStatusException)
                        throw error;
                    return [];
                }
            });
            const batchResults = await Promise.allSettled(batchPromises);
            for (const result of batchResults) {
                if (result.status === 'fulfilled' && result.value)
                    allStreams.push(...result.value);
            }
            if (i + batchSize < torrents.length) {
                await new Promise(resolve => setTimeout(resolve, this.processingConfig.delayBetweenTorrents));
            }
        }
        return allStreams;
    }
    async processSpecificEpisode(imdbId, season, episode, request) {
        const requestId = request.id;
        this.logger.debug('EPISÓDIO ESPECÍFICO', {
            requestId,
            imdbId,
            season,
            episode
        });
        try {
            this.logger.debug('Buscando títulos IMDB', { imdbId, season });
            const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
            if (imdbTitles && imdbTitles.year && season > 1) {
                this.logger.debug('TMDB: usando ano da temporada específica', {
                    imdbId,
                    season,
                    year: imdbTitles.year,
                    note: 'Temporada > 1: ano diferente da 1ª temporada - CORRETO'
                });
            }
            if (!imdbTitles || imdbTitles.allTitles.length === 0) {
                this.logger.debug('Sem títulos IMDB', { imdbId });
                return null;
            }
            const searchTitle = imdbTitles.allTitles[0];
            const searchQuery = `${searchTitle} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            this.logger.debug('Query busca', {
                searchQuery,
                season,
                episode
            });
            const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', season);
            this.logger.debug('Resultados scraping', {
                encontrados: torrentResults.length,
                query: searchQuery
            });
            if (torrentResults.length === 0) {
                this.logger.debug('Nenhum torrent', { searchQuery });
                return null;
            }
            const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
            const filteredTorrents = await this.filterAndValidateTorrents(deduplicatedTorrents, imdbId, request, season, episode, imdbTitles);
            this.logger.debug('Resultado filtragem', {
                total: deduplicatedTorrents.length,
                validos: filteredTorrents.valid.length,
                invalidos: filteredTorrents.invalid.length
            });
            if (filteredTorrents.valid.length === 0) {
                this.logger.debug('Nenhum válido', {
                    imdbId,
                    season,
                    episode,
                    totalTestados: deduplicatedTorrents.length
                });
                return null;
            }
            const bestTorrent = filteredTorrents.valid.reduce((best, current) => current.seeders > best.seeders ? current : best);
            this.logger.debug('Melhor encontrado', {
                title: bestTorrent.title.substring(0, 60),
                seeders: bestTorrent.seeders,
                quality: bestTorrent.quality
            });
            const streams = this.streamFormatter.createMultipleQualityStreams(bestTorrent, request, null, 'series', season, episode, false);
            this.logger.debug('Streams criados', {
                quantidade: streams.length,
                season,
                episode,
                hasStreams: streams.length > 0
            });
            await this.saveValidTorrentsToCatalog(filteredTorrents.valid, request, season, episode, imdbTitles);
            const result = streams.length > 0 ? streams : null;
            this.logger.debug('Episódio concluído', {
                success: result !== null,
                streamsCount: result ? result.length : 0,
                season,
                episode
            });
            return result;
        }
        catch (error) {
            this.logger.error('Erro episódio', {
                imdbId,
                season,
                episode,
                error: error instanceof Error ? error.message : 'Erro'
            });
            return null;
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
            scrapingCacheSize: this.scrapingCache.size,
            version: '5.0.0'
        };
    }
}
exports.StreamHandler = StreamHandler;
