"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentScraperService = void 0;
const logger_js_1 = require("../../utils/logger.js");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const scraperProviders_js_1 = require("./scraperProviders.js");
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
const ImdbScraperService_js_1 = require("../../catalogo/ImdbScraperService.js");
const wordpressScraper_js_1 = require("./wordpressScraper.js");
const tpbScraper_js_1 = require("./tpbScraper.js");
const rargbScraper_js_1 = require("./rargbScraper.js");
const starckScraper_js_1 = require("./starckScraper.js");
const hdrScraper_js_1 = require("./hdrScraper.js");
const episodeMatcher_js_1 = require("../../titulos/episodeMatcher.js");
const logger = new logger_js_1.Logger('TorrentScraperService');
class TorrentScraperService {
    constructor(tmdbScraper) {
        this.episodeMatcher = episodeMatcher_js_1.EpisodeMatcher.getInstance();
        this.version = '6.2.0';
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.tmdbScraper = tmdbScraper || ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.wpScraper = new wordpressScraper_js_1.WordPressScraper();
    }
    async searchTorrents(query, type = 'movie', targetSeason, targetYear, imdbId, skipPriority = false) {
        const startTime = Date.now();
        try {
            let tmdbData = null;
            if (imdbId) {
                tmdbData = await this.getTmdbData(imdbId, targetSeason);
            }
            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);
            const allResults = [];
            const indexerPromise = scraperProviders_js_1.torrentIndexerConfig.enabled
                ? this.searchTorrentIndexerWithQueries(searchQueries, type, targetSeason, targetYear, tmdbData)
                    .catch(() => [])
                : Promise.resolve([]);
            const webScrapersPromise = this.searchWebScrapersWithQueries(searchQueries, type, tmdbData)
                .catch(() => []);
            const wpQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const wpQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const wpPromise = Promise.all([
                this.wpScraper.search(wpQueryEn, type).catch(() => []),
                wpQueryPt !== wpQueryEn ? this.wpScraper.search(wpQueryPt, type).catch(() => []) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set();
                const merged = [...en, ...pt].filter(t => {
                    if (seen.has(t.magnet))
                        return false;
                    seen.add(t.magnet);
                    return true;
                });
                return merged;
            }).catch(() => []);
            const tpbQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const tpbQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const tpbPromise = Promise.all([
                (0, tpbScraper_js_1.searchTpb)(tpbQueryEn, type),
                tpbQueryPt !== tpbQueryEn ? (0, tpbScraper_js_1.searchTpb)(tpbQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set();
                const merged = [...en, ...pt].filter(t => {
                    if (seen.has(t.infoHash))
                        return false;
                    seen.add(t.infoHash);
                    return true;
                });
                return merged.map(r => this.mapTpbResult(r, type)).filter((r) => r !== null);
            }).catch(() => []);
            const rargbQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const rargbQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const rargbPromise = Promise.all([
                (0, rargbScraper_js_1.searchRargb)(rargbQueryEn, type),
                rargbQueryPt !== rargbQueryEn ? (0, rargbScraper_js_1.searchRargb)(rargbQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set();
                const merged = [...en, ...pt].filter(t => {
                    if (seen.has(t.infoHash))
                        return false;
                    seen.add(t.infoHash);
                    return true;
                });
                return merged.map(r => this.mapRargbResult(r, type)).filter((r) => r !== null);
            }).catch(() => []);
            const starckQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const starckQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const starckPromise = Promise.all([
                (0, starckScraper_js_1.searchStarck)(starckQueryEn, type),
                starckQueryPt !== starckQueryEn ? (0, starckScraper_js_1.searchStarck)(starckQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set();
                const merged = [...en, ...pt].filter(t => {
                    if (seen.has(t.infoHash))
                        return false;
                    seen.add(t.infoHash);
                    return true;
                });
                return merged.map(r => this.mapStarckResult(r, type)).filter((r) => r !== null);
            }).catch(() => []);
            const hdrQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const hdrQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const hdrPromise = Promise.all([
                (0, hdrScraper_js_1.searchHdr)(hdrQueryEn, type),
                hdrQueryPt !== hdrQueryEn ? (0, hdrScraper_js_1.searchHdr)(hdrQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set();
                const merged = [...en, ...pt].filter(t => {
                    if (seen.has(t.infoHash))
                        return false;
                    seen.add(t.infoHash);
                    return true;
                });
                return merged.map(r => this.mapHdrResult(r, type)).filter((r) => r !== null);
            }).catch(() => []);
            const [wpResults, starckResults, hdrResults, indexerResults, webResults, tpbResults, rargbResults] = await Promise.all([
                skipPriority ? Promise.resolve([]) : wpPromise,
                skipPriority ? Promise.resolve([]) : starckPromise,
                hdrPromise, indexerPromise, webScrapersPromise, tpbPromise, rargbPromise
            ]);
            allResults.push(...wpResults, ...starckResults, ...hdrResults, ...indexerResults, ...webResults, ...rargbResults, ...tpbResults);
            const filteredResults = this.filterResultsBySeason(allResults, targetSeason, type);
            const uniqueResults = this.removeDuplicateResults(filteredResults);
            const duration = Date.now() - startTime;
            if (duration > 5000) {
                logger.warn('Coleta de torrents lenta', {
                    tempo: `${duration}ms`,
                    resultados: uniqueResults.length,
                    queries: searchQueries.length
                });
            }
            return uniqueResults;
        }
        catch (error) {
            logger.error('Erro na coleta de torrents', {
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${Date.now() - startTime}ms`
            });
            return [];
        }
    }
    async getTmdbData(imdbId, season) {
        try {
            return await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
        }
        catch {
            return null;
        }
    }
    generateSearchQueries(query, type, targetSeason, targetYear, tmdbData) {
        const queries = [];
        if (tmdbData?.allTitles?.length > 0) {
            const yearToUse = targetYear || tmdbData.year;
            for (const title of tmdbData.allTitles) {
                queries.push(title);
                if (yearToUse)
                    queries.push(`${title} ${yearToUse}`);
                if (type === 'series' && targetSeason !== undefined) {
                    queries.push(`${title} ${targetSeason}ª temporada`);
                    queries.push(`${title} temporada ${targetSeason}`);
                    queries.push(`${title} season ${targetSeason}`);
                }
                const trimmed = title.replace(/^\d+\s*/, '');
                if (trimmed !== title && trimmed.trim().length > 3)
                    queries.push(trimmed);
            }
        }
        if (queries.length === 0) {
            const base = this.prepareSearchQuery(query, type, targetSeason);
            queries.push(base);
            if (targetYear)
                queries.push(`${base} ${targetYear}`);
        }
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }
    async searchTorrentIndexerWithQueries(queries, type, targetSeason, targetYear, tmdbData) {
        const results = [];
        const yearToUse = targetYear || tmdbData?.year;
        for (const query of queries.slice(0, 3)) {
            try {
                const res = await this.searchTorrentIndexer(query, type, targetSeason, yearToUse);
                results.push(...res);
            }
            catch { }
        }
        return results;
    }
    async searchTorrentIndexer(query, type, targetSeason, targetYear) {
        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params = { q: query, filter_results: 'true', category };
            if (type === 'series' && targetSeason !== undefined)
                params.season = targetSeason.toString();
            if (targetYear !== undefined)
                params.year = targetYear.toString();
            const response = await axios_1.default.get(`${scraperProviders_js_1.torrentIndexerConfig.baseUrl}/search`, {
                timeout: scraperProviders_js_1.torrentIndexerConfig.timeout,
                httpsAgent: wordpressScraper_js_1.agenteHttps,
                lookup: wordpressScraper_js_1.lookupCustomizado,
                headers: { 'User-Agent': 'Brasil-RD-Addon/6.1.1', 'Accept': 'application/json' },
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results))
                return [];
            return data.results.slice(0, 20)
                .map((r) => this.mapTorrentIndexerResult(r, type))
                .filter((r) => r !== null);
        }
        catch {
            return [];
        }
    }
    async searchWebScrapersWithQueries(queries, type, tmdbData) {
        const results = [];
        for (const query of queries.slice(0, 2)) {
            try {
                const res = await this.searchWebScrapers(query, type);
                results.push(...res);
            }
            catch { }
        }
        return results;
    }
    async searchWebScrapers(query, type) {
        const activeProviders = scraperProviders_js_1.scraperProviders
            .filter(p => p.priority > 0)
            .sort((a, b) => b.priority - a.priority);
        if (activeProviders.length === 0)
            return [];
        const promises = activeProviders.map(provider => this.searchWithProvider(provider, query, type).catch(() => []));
        const resultsArrays = await Promise.all(promises);
        return resultsArrays.flat();
    }
    async searchWithProvider(provider, query, type) {
        try {
            const pageLinks = await this.scrapeProviderLinks(provider, query);
            if (!pageLinks.length)
                return [];
            const maxPages = Math.min(pageLinks.length, 3);
            const magnetPromises = pageLinks.slice(0, maxPages).map(async (link) => {
                try {
                    const magnet = await this.extractMagnetFromPage(link.pageUrl, provider.timeout);
                    return magnet ? { ...link, magnet } : null;
                }
                catch {
                    return null;
                }
            });
            const results = (await Promise.all(magnetPromises)).filter(Boolean);
            return results.map(item => this.mapProviderResult(item, provider.name, type))
                .filter((r) => r !== null);
        }
        catch {
            return [];
        }
    }
    async scrapeProviderLinks(provider, query) {
        try {
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodedQuery}`;
            const response = await axios_1.default.get(searchUrl, {
                timeout: provider.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                }
            });
            const $ = cheerio.load(response.data);
            const links = [];
            if (provider.name === 'Starck Filmes') {
                $('h3.sl-title').each((_, el) => {
                    const $title = $(el);
                    const title = $title.text().trim();
                    const $container = $title.closest('.movies, .slide-item, .post-catalog, .item');
                    const $link = $container.length ? $container.find('a').first() : $title.parent().find('a').first();
                    const pageUrl = $link.attr('href') || '';
                    if (title && pageUrl && !title.includes('...') && !links.some(l => l.pageUrl === pageUrl)) {
                        links.push({ title, pageUrl, provider: provider.name });
                    }
                });
            }
            else {
                const itemSelectors = provider.itemSelector?.split(',').map((s) => s.trim()) || ['article', '.post', '.item'];
                const titleSelectors = provider.titleSelector?.split(',').map((s) => s.trim()) || ['h2 a', 'h3 a', '.title a'];
                for (const itemSel of itemSelectors) {
                    $(itemSel).each((_, el) => {
                        const $el = $(el);
                        for (const titleSel of titleSelectors) {
                            const $a = $el.find(titleSel).first();
                            if ($a.length) {
                                const title = $a.text().trim();
                                const pageUrl = $a.attr('href') || '';
                                if (title && pageUrl && !links.some(l => l.pageUrl === pageUrl)) {
                                    links.push({ title, pageUrl, provider: provider.name });
                                }
                                break;
                            }
                        }
                    });
                    if (links.length > 0)
                        break;
                }
            }
            return links;
        }
        catch {
            return [];
        }
    }
    async extractMagnetFromPage(pageUrl, timeout) {
        try {
            const response = await axios_1.default.get(pageUrl, {
                timeout,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $ = cheerio.load(response.data);
            const directMagnet = $('a[href^="magnet:"]').attr('href');
            if (directMagnet)
                return directMagnet;
            const match = response.data.match(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"\s]*/);
            return match ? match[0] : null;
        }
        catch {
            return null;
        }
    }
    mapTorrentIndexerResult(r, type) {
        if (!r.title || !r.magnet_link)
            return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality))
            return null;
        const season = this.extractSeasonNumber(r.title);
        return {
            title: this.cleanTitle(r.title),
            magnet: r.magnet_link,
            seeders: r.seed_count || this.estimateSeeders('TorrentIndexer', quality),
            leechers: r.leech_count || 0,
            size: r.size || 'Tamanho não especificado',
            quality,
            provider: 'TorrentIndexer',
            language: this.extractLanguage(r.title),
            type,
            relevanceScore: this.calculateRelevanceScore(r.title, season, this.extractLanguage(r.title)),
            sizeInBytes: this.calculateSizeInBytes(r.size),
            season: season ?? undefined,
            lastUpdated: new Date(r.date || Date.now()),
            confidence: 0.8
        };
    }
    mapRargbResult(r, type) {
        if (!r.title || !r.magnet)
            return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality))
            return null;
        const season = this.extractSeasonNumber(r.title);
        return {
            title: this.cleanTitle(r.title),
            magnet: r.magnet,
            seeders: r.seeders,
            leechers: r.leechers,
            size: r.size || 'N/A',
            quality,
            provider: 'RARGB',
            language: this.extractLanguage(r.title),
            type,
            relevanceScore: this.calculateRelevanceScore(r.title, season, this.extractLanguage(r.title)),
            sizeInBytes: this.calculateSizeInBytes(r.size),
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.75
        };
    }
    mapHdrResult(r, type) {
        if (!r.title || !r.magnet)
            return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality))
            return null;
        const season = this.extractSeasonNumber(r.title);
        return {
            title: this.cleanTitle(r.title),
            magnet: r.magnet,
            seeders: r.seeders,
            leechers: 0,
            size: r.size || 'N/A',
            quality,
            provider: 'HDR Torrent',
            language: this.extractLanguage(r.title),
            type,
            relevanceScore: this.calculateRelevanceScore(r.title, season, this.extractLanguage(r.title)),
            sizeInBytes: this.calculateSizeInBytes(r.size),
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.70
        };
    }
    mapStarckResult(r, type) {
        if (!r.magnet)
            return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.magnet);
        if (!this.qualityDetector.isValidQuality(quality))
            return null;
        const season = this.extractSeasonNumber(r.magnet);
        return {
            title: r.magnet,
            magnet: r.magnet,
            seeders: 0,
            leechers: 0,
            size: 'N/A',
            quality,
            provider: 'Starck',
            language: this.extractLanguage(r.magnet),
            type,
            relevanceScore: this.calculateRelevanceScore(r.magnet, season, this.extractLanguage(r.magnet)),
            sizeInBytes: 0,
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.70
        };
    }
    mapTpbResult(r, type) {
        if (!r.title || !r.magnet)
            return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality))
            return null;
        const season = this.extractSeasonNumber(r.title);
        return {
            title: this.cleanTitle(r.title),
            magnet: r.magnet,
            seeders: r.seeders,
            leechers: r.leechers,
            size: 'N/A',
            quality,
            provider: 'TPB',
            language: this.extractLanguage(r.title),
            type,
            relevanceScore: this.calculateRelevanceScore(r.title, season, this.extractLanguage(r.title)),
            sizeInBytes: 0,
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.7
        };
    }
    mapProviderResult(item, providerName, type) {
        if (!item.title || !item.magnet)
            return null;
        const quality = this.qualityDetector.extractQualityFromFilename(item.title);
        if (!this.qualityDetector.isValidQuality(quality))
            return null;
        const season = this.extractSeasonNumber(item.title);
        return {
            title: this.cleanTitle(item.title),
            magnet: item.magnet,
            seeders: item.seeders || this.estimateSeeders(providerName, quality),
            leechers: item.leechers || 0,
            size: item.size || 'Tamanho não especificado',
            quality,
            provider: providerName,
            language: this.extractLanguage(item.title),
            type,
            relevanceScore: this.calculateRelevanceScore(item.title, season, this.extractLanguage(item.title)),
            sizeInBytes: this.calculateSizeInBytes(item.size),
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.6
        };
    }
    filterResultsBySeason(results, targetSeason, type) {
        if (targetSeason === undefined || type !== 'series')
            return results;
        return results.filter(r => {
            if (r.season !== undefined)
                return r.season === targetSeason;
            const detected = this.extractSeasonNumber(r.title);
            if (detected !== null)
                return detected === targetSeason;
            const isPack = /complete|pack|temporada completa|season pack/i.test(r.title);
            return isPack;
        });
    }
    removeDuplicateResults(results) {
        const seen = new Set();
        return results.filter(r => {
            if (seen.has(r.magnet))
                return false;
            seen.add(r.magnet);
            return true;
        });
    }
    calculateRelevanceScore(title, season, language) {
        let score = 70;
        const t = title.toLowerCase();
        if (language && /pt|dual/i.test(language))
            score += 25;
        if (/1080p|2160p|4k/i.test(t))
            score += 15;
        else if (/720p|hd/i.test(t))
            score += 10;
        if (/480p|sd/i.test(t))
            score -= 15;
        if (/web-dl|bluray|remux/i.test(t))
            score += 10;
        return Math.max(0, Math.min(100, score));
    }
    extractSeasonNumber(text) {
        return this.episodeMatcher.extractSeasonFromTitle(text);
    }
    prepareSearchQuery(query, type, targetSeason) {
        if (type === 'series' && targetSeason !== undefined && !/temporada|season|s\d+/i.test(query)) {
            return `${query} s${targetSeason.toString().padStart(2, '0')}`;
        }
        return this.cleanQuery(query);
    }
    cleanQuery(query) {
        return query.replace(/[^\w\s\-.:]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    cleanTitle(title) {
        if (title.length > 100) {
            const lines = title.split(/(?=[A-ZÀ-Ú])/);
            const validLine = lines.find(l => l.trim().length > 10);
            if (validLine)
                title = validLine.trim();
        }
        return title.replace(/\s+/g, ' ').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    }
    extractLanguage(title) {
        const t = title.toLowerCase();
        if (t.includes('dual') && t.includes('audio'))
            return 'pt-BR,en';
        if (/dublado|dublada|dublagem/.test(t))
            return 'pt-BR';
        if (/legendado|legendada|legenda/.test(t))
            return 'pt';
        if (/português|portugues|pt-br|ptbr/.test(t))
            return 'pt-BR';
        if (/brazilian|brasil/.test(t))
            return 'pt-BR';
        if (/multi|multilanguage/.test(t))
            return 'multi';
        if (/english|ingles|\(eng\)/.test(t))
            return 'en';
        return 'desconhecido';
    }
    calculateSizeInBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Tamanho não especificado')
            return 1.5 * 1024 ** 3;
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match)
            return 1.5 * 1024 ** 3;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G')
            return value * 1024 ** 3;
        if (unit === 'MB' || unit === 'M')
            return value * 1024 ** 2;
        return 1.5 * 1024 ** 3;
    }
    estimateSeeders(provider, quality) {
        const base = { 'TorrentIndexer': 70, 'BLUDV Filmes': 80, 'default': 35 };
        const mult = { '2160p': 1.5, '1080p': 1.3, '720p': 1.0, 'HD': 1.1, 'desconhecido': 0.8, '480p': 0.6 };
        return Math.round((base[provider] || base['default']) * (mult[quality] || 0.8));
    }
    getStats() {
        return {
            versao: this.version,
            provedoresAtivos: (scraperProviders_js_1.torrentIndexerConfig.enabled ? 1 : 0) + 1
        };
    }
}
exports.TorrentScraperService = TorrentScraperService;
