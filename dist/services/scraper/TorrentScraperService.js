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
const logger_1 = require("../../utils/logger");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const scraperProviders_1 = require("./scraperProviders");
const scraperConfigs_1 = require("./scraperConfigs");
const qualityDetector_1 = require("../../lib/qualityDetector");
const QueueService_1 = require("../QueueService");
const logger = new logger_1.Logger('TorrentScraperService');
class TorrentScraperService {
    constructor() {
        this.providers = scraperProviders_1.scraperProviders;
        this.maxRetries = scraperConfigs_1.maxRetries;
        this.retryDelay = scraperConfigs_1.retryDelay;
        this.ignoredWords = scraperConfigs_1.ignoredWords;
        this.promotionalKeywords = scraperConfigs_1.promotionalKeywords;
        this.episodePatterns = scraperConfigs_1.episodePatterns;
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        logger.info('TorrentScraperService v2.0.0 iniciado - Sistema de filas integrado');
    }
    async searchTorrents(query, type = 'movie', targetSeason) {
        const startTime = Date.now();
        logger.info('Iniciando busca com filas', {
            query,
            type,
            targetSeason,
            providers: this.providers.length
        });
        try {
            const mainQuery = query;
            const allPromises = [];
            if (scraperProviders_1.torrentIndexerConfig.enabled) {
                allPromises.push(QueueService_1.queueService.executeInQueue('torrent-indexer', () => this.searchTorrentIndexer(mainQuery, type, targetSeason), `TorrentIndexer:${mainQuery.substring(0, 20)}`).catch(() => []));
            }
            for (const provider of this.providers) {
                allPromises.push(QueueService_1.queueService.executeInQueue('scraper-providers', () => this.searchProvider(provider, mainQuery, type, targetSeason), `${provider.name}:${mainQuery.substring(0, 20)}`).catch(() => []));
            }
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Timeout 8s')), 8000);
            });
            const searchPromise = Promise.all(allPromises).then(results => {
                const allResults = results.flat();
                const filteredResults = this.applyFilters(allResults, query, type);
                const bestResults = this.selectBestResults(filteredResults);
                return bestResults;
            });
            const bestResults = await Promise.race([searchPromise, timeoutPromise]);
            const duration = Date.now() - startTime;
            logger.info('Busca finalizada com filas', {
                query,
                total: bestResults.length,
                tempo: `${duration}ms`
            });
            return bestResults;
        }
        catch (error) {
            logger.error('Erro na busca com filas', {
                query,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
    }
    async searchProvider(provider, query, type, targetSeason) {
        try {
            if (provider.usesAPI && provider.apiEndpoint) {
                return await this.searchViaAPI(provider, query, type, targetSeason);
            }
            else {
                return await this.searchViaHTML(provider, query, type, targetSeason);
            }
        }
        catch (error) {
            return [];
        }
    }
    async searchViaAPI(provider, query, type, targetSeason) {
        const apiUrl = `${provider.baseUrl}${provider.apiEndpoint}?search=${encodeURIComponent(query)}&per_page=50`;
        try {
            const response = await axios_1.default.get(apiUrl, {
                headers: this.getAPIHeaders(),
                timeout: provider.timeout
            });
            return this.parseAPIResults(response.data, provider, type);
        }
        catch (error) {
            return [];
        }
    }
    async searchViaHTML(provider, query, type, targetSeason) {
        const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodeURIComponent(query)}`;
        try {
            const html = await this.fetchWithRetry(searchUrl, provider.timeout);
            const rawResults = this.parseHtmlResults(html, provider, type);
            if (rawResults.length > 0) {
                const resultsWithMagnets = await this.enrichWithMagnets(rawResults, provider, html);
                return resultsWithMagnets;
            }
            return [];
        }
        catch (error) {
            return [];
        }
    }
    async searchTorrentIndexer(query, type, targetSeason) {
        if (!scraperProviders_1.torrentIndexerConfig.enabled) {
            return [];
        }
        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params = {
                q: query.toLowerCase(),
                filter_results: 'true',
                category: category
            };
            if (targetSeason && type === 'series') {
                params.season = targetSeason.toString();
            }
            const response = await axios_1.default.get(`${scraperProviders_1.torrentIndexerConfig.baseUrl}/search`, {
                timeout: scraperProviders_1.torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) {
                return [];
            }
            const results = data.results.slice(0, 15);
            return results.map((indexerResult) => this.mapTorrentIndexerResult(indexerResult, type)).filter(Boolean);
        }
        catch (error) {
            return [];
        }
    }
    applyFilters(results, query, type) {
        return results.filter(result => {
            const titleLower = result.title.toLowerCase();
            if (this.promotionalKeywords.some(keyword => titleLower.includes(keyword))) {
                return false;
            }
            if (!this.qualityDetector.isValidQuality(result.quality)) {
                return false;
            }
            return true;
        });
    }
    selectBestResults(results) {
        const qualityGroups = new Map();
        const allowedQualities = ['2160p', '1080p', '720p', 'HD'];
        for (const quality of allowedQualities) {
            qualityGroups.set(quality, []);
        }
        for (const result of results) {
            if (this.qualityDetector.isValidQuality(result.quality)) {
                qualityGroups.get(result.quality).push(result);
            }
        }
        const bestResults = [];
        const qualityOrder = ['2160p', '1080p', '720p', 'HD'];
        for (const quality of qualityOrder) {
            const group = qualityGroups.get(quality);
            if (group && group.length > 0) {
                const bestInQuality = group.sort((a, b) => {
                    if (b.confidence !== a.confidence) {
                        return b.confidence - a.confidence;
                    }
                    if (b.seeders !== a.seeders) {
                        return b.seeders - a.seeders;
                    }
                    return 0;
                }).slice(0, 2);
                bestResults.push(...bestInQuality);
            }
        }
        return bestResults.slice(0, 8);
    }
    parseAPIResults(posts, provider, type) {
        const results = [];
        for (const post of posts) {
            try {
                const title = post.title?.rendered || '';
                if (!title || title.length < 5) {
                    continue;
                }
                const quality = this.qualityDetector.extractQualityFromFilename(title);
                const magnet = this.extractMagnetFromContent(post.content?.rendered || '');
                results.push({
                    title: this.cleanTitle(title),
                    magnet: magnet || '',
                    seeders: this.estimateSeeders(provider.name, quality),
                    leechers: 0,
                    size: this.extractSizeFromContent(post.content?.rendered || ''),
                    quality,
                    provider: provider.name,
                    language: this.extractLanguage(title),
                    type,
                    relevanceScore: 100,
                    sizeInBytes: this.calculateSizeInBytes(this.extractSizeFromContent(post.content?.rendered || '')),
                    season: this.extractSeasonNumber(title) || undefined,
                    lastUpdated: new Date(post.modified || Date.now()),
                    confidence: 0.5
                });
            }
            catch (error) {
                continue;
            }
        }
        return results;
    }
    parseHtmlResults(html, provider, type) {
        const results = [];
        const $ = cheerio.load(html);
        $(provider.itemSelector).each((index, element) => {
            try {
                const $element = $(element);
                const titleElement = $element.find(provider.titleSelector).first();
                const title = titleElement.text().trim();
                if (!title || title.length < 5) {
                    return;
                }
                const quality = this.qualityDetector.extractQualityFromFilename(title);
                results.push({
                    title: this.cleanTitle(title),
                    magnet: '',
                    seeders: this.estimateSeeders(provider.name, quality),
                    leechers: 0,
                    size: this.extractSize(title),
                    quality,
                    provider: provider.name,
                    language: this.extractLanguage(title),
                    type,
                    relevanceScore: 100,
                    sizeInBytes: this.calculateSizeInBytes(this.extractSize(title)),
                    season: this.extractSeasonNumber(title) || undefined,
                    lastUpdated: new Date(),
                    confidence: 0.5
                });
            }
            catch (error) {
                return;
            }
        });
        return results.slice(0, 10);
    }
    async enrichWithMagnets(results, provider, originalHtml) {
        const limitedResults = results.slice(0, 5);
        const enrichedResults = [];
        for (const result of limitedResults) {
            try {
                const $original = cheerio.load(originalHtml);
                const item = $original(provider.itemSelector).filter((_, element) => {
                    const itemTitle = $original(element).find(provider.titleSelector).text().trim();
                    return itemTitle === result.title;
                }).first();
                let detailUrl = item.find(provider.linkSelector).attr('href');
                let magnetLink = '';
                if (detailUrl) {
                    const html = await axios_1.default.get(detailUrl, {
                        timeout: 3000,
                        headers: this.getRequestHeaders()
                    }).then(res => res.data).catch(() => '');
                    if (html) {
                        const $ = cheerio.load(html);
                        magnetLink = $('a[href^="magnet:"]').first().attr('href') || '';
                    }
                }
                if (magnetLink) {
                    enrichedResults.push({
                        ...result,
                        magnet: magnetLink
                    });
                }
            }
            catch (error) {
                continue;
            }
        }
        return enrichedResults;
    }
    mapTorrentIndexerResult(indexerResult, type) {
        if (!indexerResult.title || !indexerResult.magnet_link) {
            return null;
        }
        const quality = this.qualityDetector.extractQualityFromFilename(indexerResult.title);
        if (!this.qualityDetector.isValidQuality(quality)) {
            return null;
        }
        const seasonNumber = this.extractSeasonNumber(indexerResult.title);
        return {
            title: this.cleanTitle(indexerResult.title),
            magnet: indexerResult.magnet_link,
            seeders: indexerResult.seed_count || this.estimateSeeders('TorrentIndexer', quality),
            leechers: indexerResult.leech_count || 0,
            size: indexerResult.size || 'Size not specified',
            quality,
            provider: 'TorrentIndexer',
            language: this.extractLanguage(indexerResult.title),
            type,
            relevanceScore: 100,
            sizeInBytes: this.calculateSizeInBytes(indexerResult.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(indexerResult.date || Date.now()),
            confidence: 0.5
        };
    }
    extractSeasonNumber(text) {
        for (const pattern of this.episodePatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }
    cleanTitle(title) {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .trim();
    }
    extractLanguage(title) {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('dual'))
            return 'pt-BR,en';
        if (titleLower.includes('dublado'))
            return 'pt-BR';
        if (titleLower.includes('legendado'))
            return 'pt';
        return 'pt-BR';
    }
    extractSize(title) {
        const sizeMatch = title.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB|G|M)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }
    extractSizeFromContent(content) {
        const sizeMatch = content.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }
    extractMagnetFromContent(content) {
        const magnetMatches = content.match(/magnet:\?[^"'\s<>]+/g);
        if (magnetMatches && magnetMatches.length > 0) {
            let bestMagnet = magnetMatches[0];
            for (const magnet of magnetMatches) {
                if (magnet.length > bestMagnet.length) {
                    bestMagnet = magnet;
                }
            }
            if (bestMagnet.includes('xt=urn:btih:') && bestMagnet.includes('&dn=')) {
                return bestMagnet;
            }
        }
        const fallbackPatterns = [
            /magnet:\?xt=urn:btih:[a-zA-Z0-9]+&dn=[^"'\s<>]+/,
            /magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^"'\s<>]*/,
            /magnet:\?[^"'\s<>]*xt=urn:btih:[a-zA-Z0-9]+[^"'\s<>]*/
        ];
        for (const pattern of fallbackPatterns) {
            const match = content.match(pattern);
            if (match) {
                return match[0];
            }
        }
        return null;
    }
    calculateSizeInBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Size not specified') {
            return 1.5 * 1024 * 1024 * 1024;
        }
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match)
            return 1.5 * 1024 * 1024 * 1024;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G')
            return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M')
            return value * 1024 * 1024;
        return 1.5 * 1024 * 1024 * 1024;
    }
    estimateSeeders(provider, quality) {
        const baseSeeders = {
            'BLUDV': 80,
            'Starck Filmes': 60,
            'BaixaFilmesTorrent': 50,
            'TorrentIndexer': 70
        };
        const qualityMultiplier = {
            '2160p': 1.5,
            '1080p': 1.3,
            '720p': 1.0,
            'HD': 1.1
        };
        const base = baseSeeders[provider] || 30;
        const multiplier = qualityMultiplier[quality] || 1.0;
        return Math.round(base * multiplier);
    }
    async fetchWithRetry(url, timeout) {
        try {
            const response = await axios_1.default.get(url, {
                timeout,
                headers: this.getRequestHeaders(),
                validateStatus: (status) => status < 500
            });
            if (response.status === 200) {
                return response.data;
            }
            throw new Error(`HTTP ${response.status}`);
        }
        catch (error) {
            await this.delay(1000);
            try {
                const response = await axios_1.default.get(url, {
                    timeout: timeout + 1000,
                    headers: this.getRequestHeaders()
                });
                return response.data;
            }
            catch {
                throw error;
            }
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    getAPIHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
    getTorrentIndexerHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
    getRequestHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
}
exports.TorrentScraperService = TorrentScraperService;
