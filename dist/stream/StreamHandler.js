"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamHandler = void 0;
const RealDebridService_js_1 = require("../debrid/RealDebridService.js");
const CacheService_js_1 = require("../debrid/CacheService.js");
const logger_js_1 = require("../utils/logger.js");
const sequelize_1 = require("sequelize");
const models_js_1 = require("../database/models.js");
const qualityDetector_js_1 = require("../lib/qualityDetector.js");
const catalogProvider_js_1 = require("../catalogo/catalogProvider.js");
const streamFormatter_js_1 = require("../stream/streamFormatter.js");
const StaticResponseService_js_1 = require("./StaticResponseService.js");
const StreamStatusException_js_1 = require("./StreamStatusException.js");
const TechnicalWords_js_1 = require("../titulos/TechnicalWords.js");
const LEGENDADO_REGEX = new RegExp('\\b(' + TechnicalWords_js_1.INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b', 'i');
class StreamHandler {
    constructor(baseUrl) {
        this.seedsCheckedAt = new Map();
        this.SEEDS_RECHECK_TTL = 60 * 60 * 1000;
        this.SEEDS_BG_CONCURRENCY = 5;
        this.SEEDS_BG_TIMEOUT_SEC = 5;
        this.stats = {
            totalRequests: 0,
            servedFromDatabase: 0,
            servedFromCatalog: 0,
            duplicatesRemoved: 0,
            servedInformativeStreams: 0
        };
        this.torboxService = RealDebridService_js_1.TorboxService.getInstance(baseUrl);
        this.cacheService = new CacheService_js_1.CacheService();
        this.logger = new logger_js_1.Logger('StreamHandler');
        this.staticResponseService = new StaticResponseService_js_1.StaticResponseService(baseUrl);
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.streamFormatter = streamFormatter_js_1.StreamFormatter.getInstance();
        this.catalogProvider = new catalogProvider_js_1.CatalogProvider();
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
    get torbox() {
        return this.torboxService;
    }
    get catalog() {
        return this.catalogProvider;
    }
    setStaticResponseBaseUrl(baseUrl) {
        this.staticResponseService.setBaseUrl(baseUrl);
        this.torboxService.setStaticResponseBaseUrl(baseUrl);
    }
    async handleStreamRequest(request) {
        const requestId = request.id;
        this.stats.totalRequests++;
        if (!request.apiKey)
            return { streams: [] };
        try {
            const imdbId = this.extractImdbIdFromRequest(request);
            let tmdbTitles;
            let tmdbYear;
            if (imdbId) {
                try {
                    const tmdbData = await this.catalogProvider.getTmdbSearchData(imdbId);
                    if (tmdbData.imdbTitles?.allTitles?.length) {
                        tmdbTitles = tmdbData.imdbTitles.allTitles;
                    }
                    if (tmdbData.imdbTitles?.year) {
                        tmdbYear = tmdbData.imdbTitles.year;
                    }
                }
                catch {
                }
            }
            const dbResult = await this.getStreamsFromDatabase(request);
            if (dbResult.success && dbResult.streams.length > 0) {
                this.stats.servedFromDatabase++;
                const originalCount = dbResult.streams.length;
                const deduped = this.catalogProvider.removeDuplicatesByInfoHash(dbResult.streams);
                this.stats.duplicatesRemoved += originalCount - deduped.length;
                const sorted = this.streamFormatter.sortStreamsByQuality(deduped);
                this.registerTitlesForStreams(sorted, tmdbTitles, tmdbYear);
                return { streams: sorted };
            }
            const catalogResult = await this.getStreamsFromCatalog(request);
            if (catalogResult.success && catalogResult.streams.length > 0) {
                this.stats.servedFromCatalog++;
                const originalCount = catalogResult.streams.length;
                const deduped = this.catalogProvider.removeDuplicatesByInfoHash(catalogResult.streams);
                this.stats.duplicatesRemoved += originalCount - deduped.length;
                const sorted = this.streamFormatter.sortStreamsByQuality(deduped);
                this.registerTitlesForStreams(sorted, tmdbTitles, tmdbYear);
                return { streams: sorted };
            }
            this.logger.info('📭 Nada encontrado', {
                requestId,
                imdbId,
                type: request.type,
                dbStreams: dbResult.streams.length,
                catalogStreams: catalogResult.streams.length,
            });
            return { streams: [] };
        }
        catch (error) {
            this.logger.error('Falha no processamento', {
                requestId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            if (error instanceof StreamStatusException_js_1.StreamStatusException) {
                const informativeStream = this.createInformativeStreamFromException(error, requestId);
                this.stats.servedInformativeStreams++;
                return { streams: [informativeStream] };
            }
            const errorStream = this.staticResponseService.createInformativeStream(StaticResponseService_js_1.StaticResponse.FAILED_UNEXPECTED, requestId);
            return { streams: [this.convertToStreamFormat(errorStream)] };
        }
    }
    fireAndForgetSeeders(torrents, apiKey) {
        const hashes = [...new Set(torrents
                .map(t => (t.infoHash || '').toLowerCase())
                .filter((h) => typeof h === 'string' && h.length >= 32))];
        const now = Date.now();
        const paraChecar = hashes.filter(h => {
            const ultima = this.seedsCheckedAt.get(h);
            return !ultima || (now - ultima) > this.SEEDS_RECHECK_TTL;
        });
        if (paraChecar.length === 0)
            return;
        for (const h of paraChecar)
            this.seedsCheckedAt.set(h, now);
        void this.enrichSeedersEmBackground(paraChecar, apiKey).catch(() => { });
    }
    async enrichSeedersEmBackground(hashes, apiKey) {
        const start = Date.now();
        let atualizados = 0;
        for (let i = 0; i < hashes.length; i += this.SEEDS_BG_CONCURRENCY) {
            const batch = hashes.slice(i, i + this.SEEDS_BG_CONCURRENCY);
            await Promise.all(batch.map(async (hash) => {
                const seeds = await this.torboxService.getTorrentInfoByHash(hash, apiKey, this.SEEDS_BG_TIMEOUT_SEC).catch(() => 0);
                if (seeds > 0) {
                    await models_js_1.Torrent.update({ seeders: seeds }, { where: { infoHash: hash } }).catch(() => { });
                    atualizados++;
                }
            }));
        }
        this.logger.debug('SEEDERS_BG', {
            hashes: hashes.length,
            atualizados,
            durationMs: Date.now() - start,
        });
    }
    registerTitlesForStreams(streams, titles, year) {
        if (!titles || titles.length === 0)
            return;
        const enrichedTitles = year
            ? titles.map(t => `${t} ${year}`)
            : titles;
        for (const stream of streams) {
            if (stream.infoHash) {
                try {
                    this.torboxService.setTitlesForHash(stream.infoHash, enrichedTitles);
                }
                catch {
                }
            }
        }
    }
    createInformativeStreamFromException(exception, requestId) {
        const informativeStream = this.staticResponseService.createInformativeStream(exception.staticResponse, requestId);
        return this.convertToStreamFormat(informativeStream);
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
            const where = {
                [sequelize_1.Op.or]: [
                    { imdbId },
                    { imdbIds: { [sequelize_1.Op.contains]: imdbId } },
                ],
            };
            if (request.type === 'series') {
                const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
                if (seasonMatch) {
                    const season = parseInt(seasonMatch[1]);
                    const episode = parseInt(seasonMatch[2]);
                    where[sequelize_1.Op.and] = [
                        {
                            [sequelize_1.Op.or]: [
                                { imdbSeason: null },
                                {
                                    [sequelize_1.Op.and]: [
                                        { imdbSeason: { [sequelize_1.Op.lte]: season } },
                                        { imdbSeasonEnd: { [sequelize_1.Op.gte]: season } },
                                    ],
                                },
                            ],
                        },
                        {
                            [sequelize_1.Op.or]: [
                                { imdbEpisodeStart: null },
                                { imdbEpisodeEnd: null },
                                {
                                    imdbEpisodeStart: { [sequelize_1.Op.lte]: episode },
                                    imdbEpisodeEnd: { [sequelize_1.Op.gte]: episode },
                                },
                            ],
                        },
                    ];
                }
            }
            const torrents = await models_js_1.Torrent.findAll({
                where,
                limit: request.type === 'movie' ? 20 : 30,
                order: [['seeders', 'DESC']],
                raw: true
            });
            if (request.apiKey && torrents.length > 0) {
                this.fireAndForgetSeeders(torrents, request.apiKey);
            }
            const streams = [];
            for (const t of torrents) {
                const idioma = (t.idioma || '').toLowerCase();
                if (idioma === 'legendado' || idioma === 'en' || idioma === 'es' || idioma === 'fr')
                    continue;
                const titleLower = (t.title || '').toLowerCase();
                if (LEGENDADO_REGEX.test(titleLower))
                    continue;
                const stream = await this.convertTorrentToStream(t, request);
                if (stream)
                    streams.push(stream);
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
    async convertTorrentToStream(torrent, request) {
        try {
            const quality = torrent.qualidade || this.qualityDetector.extractQualityFromFilename(torrent.title);
            let season;
            let episode;
            if (request.type === 'series') {
                const match = request.id.match(/tt\d+:(\d+):(\d+)/);
                if (match) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
            }
            const magnetCompleto = torrent.magnet || `magnet:?xt=urn:btih:${torrent.infoHash}`;
            const torrentWithMagnet = {
                ...torrent,
                magnet: magnetCompleto,
                magnet_link: magnetCompleto,
                quality,
                language: torrent.idioma || 'PT-BR',
            };
            const streams = await this.streamFormatter.createMultipleQualityStreams(torrentWithMagnet, request, null, request.type, season, episode, false, 0);
            return streams[0] || null;
        }
        catch (error) {
            this.logger.error('Erro ao converter torrent para stream', {
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
    extractImdbIdFromRequest(request) {
        if (request.imdbId)
            return request.imdbId;
        const imdbMatch = request.id.match(/^(tt\d+)/);
        return imdbMatch ? imdbMatch[1] : null;
    }
    clearCache() {
        this.cacheService.clear();
        this.catalogProvider.clearTmdbCache();
        this.seedsCheckedAt.clear();
    }
    getStats() {
        return {
            totalRequests: this.stats.totalRequests,
            servedFromDatabase: this.stats.servedFromDatabase,
            servedFromCatalog: this.stats.servedFromCatalog,
            servedInformativeStreams: this.stats.servedInformativeStreams,
            duplicatesRemoved: this.stats.duplicatesRemoved,
            seedsCheckedHashes: this.seedsCheckedAt.size,
        };
    }
}
exports.StreamHandler = StreamHandler;
