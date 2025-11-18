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
const logger_1 = require("../utils/logger");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const logger = new logger_1.Logger('TorrentScraper');
class TorrentScraperService {
    providers = [
        {
            name: 'Starck Filmes',
            baseUrl: 'https://www.starckfilmes-v3.com',
            searchPath: '/?s=',
            itemSelector: '.item',
            titleSelector: 'h3 a',
            linkSelector: 'a',
            priority: 3,
            timeout: 8000
        },
        {
            name: 'BaixaFilmesTorrent',
            baseUrl: 'https://baixafilmestorrent.com',
            searchPath: '/?s=',
            itemSelector: '.post',
            titleSelector: 'h2 a',
            linkSelector: 'a',
            priority: 2,
            timeout: 8000
        },
        {
            name: 'BLUDV',
            baseUrl: 'https://bludv.net',
            searchPath: '/?s=',
            itemSelector: '.post',
            titleSelector: 'div.title a',
            linkSelector: 'div.title a',
            priority: 4,
            timeout: 10000,
            usesAPI: true,
            apiEndpoint: '/wp-json/wp/v2/posts'
        }
    ];
    torrentIndexerConfig = {
        baseUrl: 'https://torrent-indexer.darklyn.org',
        timeout: 15000,
        enabled: true,
        priority: 5
    };
    maxRetries = 3;
    retryDelay = 1500;
    qualityPriority = {
        '2160p': 400,
        '1080p': 300,
        '720p': 200,
        '480p': 100,
        '360p': 50,
        'HD': 150,
        'SD': 50
    };
    ignoredWords = new Set([
        'filme', 'series', 'temporada', 'season', 'download', 'torrent',
        'com', 'de', 'e', 'the', 'and', 'pt-br', 'dual', 'dublado',
        'legendado', 'bluray', 'web-dl', '1080p', '720p', '480p', '2160p',
        'complete', 'completa', 'full', 'webrip', 'hdtv', 'brrip', 'bdrip'
    ]);
    promotionalKeywords = [
        'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
        'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
        'spam', 'advertisement', 'publicidade'
    ];
    qualityPatterns = [
        { pattern: /\b(4k|2160p)\b/i, quality: '2160p', confidence: 100 },
        { pattern: /\b(uhd|ultra[\s\._-]?hd)\b/i, quality: '2160p', confidence: 90 },
        { pattern: /\b(3840x2160)\b/, quality: '2160p', confidence: 100 },
        { pattern: /\b(1080p|fhd|full[\s\._-]?hd)\b/i, quality: '1080p', confidence: 95 },
        { pattern: /\b(1920x1080)\b/, quality: '1080p', confidence: 100 },
        { pattern: /\b(720p|hd[\s\._-]?rip)\b/i, quality: '720p', confidence: 90 },
        { pattern: /\b(1280x720)\b/, quality: '720p', confidence: 100 },
        { pattern: /\b(hdtv)\b/i, quality: '720p', confidence: 80 },
        { pattern: /\b(480p|dvd[\s\._-]?rip)\b/i, quality: '480p', confidence: 85 },
        { pattern: /\b(852x480|720x480)\b/, quality: '480p', confidence: 100 },
        { pattern: /\b(360p)\b/i, quality: '360p', confidence: 80 },
        { pattern: /\b(25gb|30gb|40gb|50gb|60gb|70gb|80gb)\b/i, quality: '2160p', confidence: 75 },
        { pattern: /\b(15gb|20gb|22gb|24gb)\b/i, quality: '2160p', confidence: 70 },
        { pattern: /\b(8gb|9gb|10gb|12gb|14gb)\b/i, quality: '1080p', confidence: 80 },
        { pattern: /\b(4gb|5gb|6gb|7gb)\b/i, quality: '1080p', confidence: 75 },
        { pattern: /\b(2gb|3gb)\b/i, quality: '720p', confidence: 80 },
        { pattern: /\b(1gb|1\.5gb)\b/i, quality: '720p', confidence: 70 },
        { pattern: /\b(500mb|700mb|800mb)\b/i, quality: '480p', confidence: 75 },
        { pattern: /\b(bluray|blu[\s\._-]?ray|remux)\b/i, quality: '1080p', confidence: 85 },
        { pattern: /\b(web[\s\._-]?dl|webrip)\b/i, quality: '1080p', confidence: 80 },
        { pattern: /\b(brrip|bdrip)\b/i, quality: '1080p', confidence: 75 },
        { pattern: /\b(dvdrip|dvdr)\b/i, quality: '480p', confidence: 80 },
        { pattern: /\b(cam|ts|scr|tc|r5)\b/i, quality: 'SD', confidence: 90 }
    ];
    constructor() {
        logger.info('TorrentScraperService initialized', {
            providers: this.providers.map(p => ({
                name: p.name,
                priority: p.priority,
                usesAPI: p.usesAPI || false
            })),
            torrentIndexer: this.torrentIndexerConfig.enabled,
            totalProviders: this.providers.length + (this.torrentIndexerConfig.enabled ? 1 : 0)
        });
    }
    async searchTorrents(query, type = 'movie', targetSeason) {
        const startTime = Date.now();
        logger.info('Starting torrent search', {
            query,
            type,
            targetSeason,
            providersCount: this.providers.length,
            usingTorrentIndexer: this.torrentIndexerConfig.enabled
        });
        try {
            const seasonQueries = this.generateSeasonQueries(query, targetSeason);
            logger.debug('Generated season queries', {
                originalQuery: query,
                targetSeason,
                seasonQueries
            });
            const torrentIndexerPromise = this.torrentIndexerConfig.enabled ?
                Promise.all(seasonQueries.map(seasonQuery => this.searchTorrentIndexer(seasonQuery, type, targetSeason))).then(results => results.flat()) :
                Promise.resolve([]);
            const traditionalSearchPromises = seasonQueries.map(seasonQuery => this.providers.map(provider => this.searchProvider(provider, seasonQuery, type, targetSeason))).flat();
            const allPromises = [torrentIndexerPromise, ...traditionalSearchPromises];
            const settledResults = await Promise.allSettled(allPromises);
            const allResults = this.processSettledResults(settledResults);
            const filteredResults = this.applyStrictFiltering(allResults, query, type, targetSeason);
            const uniqueResults = this.removeDuplicateResults(filteredResults);
            if (uniqueResults.length === 0) {
                logger.info('No relevant results found after strict filtering', {
                    query,
                    type,
                    targetSeason,
                    originalResults: allResults.length,
                    filteredResults: filteredResults.length
                });
                return [];
            }
            const qualityGroups = this.groupByQuality(uniqueResults);
            const bestResults = this.selectBestFromEachQuality(qualityGroups);
            const duration = Date.now() - startTime;
            this.logSearchResults(query, type, uniqueResults.length, bestResults, duration, qualityGroups, targetSeason, seasonQueries);
            return bestResults;
        }
        catch (error) {
            logger.error('Critical error in torrent search', {
                query,
                type,
                targetSeason,
                error: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined
            });
            return [];
        }
    }
    extractQuality(title) {
        const titleLower = title.toLowerCase();
        let bestMatch = null;
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(titleLower)) {
                if (!bestMatch || confidence > bestMatch.confidence) {
                    bestMatch = { quality, confidence };
                }
                if (confidence >= 95) {
                    logger.debug('High confidence quality match', {
                        title,
                        quality,
                        confidence,
                        pattern: pattern.source
                    });
                    return quality;
                }
            }
        }
        if (bestMatch) {
            logger.debug('Quality detected by pattern', {
                title,
                quality: bestMatch.quality,
                confidence: bestMatch.confidence
            });
            return bestMatch.quality;
        }
        const inferredQuality = this.inferQualityFromContext(titleLower);
        logger.debug('Quality inferred from context', {
            title,
            inferredQuality
        });
        return inferredQuality;
    }
    inferQualityFromContext(titleLower) {
        const currentYear = new Date().getFullYear();
        const yearMatch = titleLower.match(/(\d{4})/);
        const contentYear = yearMatch ? parseInt(yearMatch[1]) : 0;
        if (contentYear >= currentYear - 3) {
            return '1080p';
        }
        if (titleLower.includes('remux') || titleLower.includes('web-dl') ||
            titleLower.includes('bluray') || titleLower.includes('uhd')) {
            return '1080p';
        }
        if (titleLower.includes('dvdrip') || titleLower.includes('dvdr') ||
            titleLower.includes('hdtv')) {
            return '720p';
        }
        if (titleLower.includes('cam') || titleLower.includes('ts') ||
            titleLower.includes('scr') || titleLower.includes('r5')) {
            return 'SD';
        }
        if (titleLower.match(/s\d{1,2}e\d{1,2}/i) ||
            titleLower.includes('season') ||
            titleLower.includes('temporada')) {
            return '1080p';
        }
        return 'HD';
    }
    detectQualityFromFilename(filename) {
        const filenameLower = filename.toLowerCase();
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(filenameLower)) {
                logger.debug('Quality detected from filename', {
                    filename,
                    quality,
                    confidence
                });
                return quality;
            }
        }
        return this.inferQualityFromContext(filenameLower);
    }
    applyStrictFiltering(results, originalQuery, type, targetSeason) {
        const filteredResults = [];
        const mainTitle = this.extractMainTitle(originalQuery);
        const essentialKeywords = this.extractEssentialKeywords(mainTitle);
        logger.debug('Applying strict filtering', {
            originalQuery,
            mainTitle,
            essentialKeywords,
            totalResults: results.length
        });
        for (const result of results) {
            if (this.isExactlyRelevant(result.title, mainTitle, essentialKeywords, type, targetSeason)) {
                filteredResults.push(result);
            }
        }
        logger.info('Strict filtering completed', {
            originalCount: results.length,
            filteredCount: filteredResults.length,
            removedCount: results.length - filteredResults.length,
            essentialKeywords
        });
        return filteredResults;
    }
    isExactlyRelevant(title, mainTitle, essentialKeywords, type, targetSeason) {
        const titleLower = title.toLowerCase();
        const mainTitleLower = mainTitle.toLowerCase();
        if (this.isPromotionalContent(titleLower)) {
            logger.debug('Filtered promotional content', { title });
            return false;
        }
        if (type === 'series' && targetSeason) {
            if (!this.isCorrectSeason(titleLower, targetSeason)) {
                logger.debug('Filtered due to season mismatch', {
                    title,
                    expectedSeason: targetSeason,
                    foundSeason: this.extractSeasonNumber(titleLower)
                });
                return false;
            }
        }
        if (this.containsMainTitle(titleLower, mainTitleLower)) {
            logger.debug('Approved - contains main title', { title, mainTitle });
            return true;
        }
        const matchScore = this.calculateKeywordMatch(titleLower, essentialKeywords);
        const isRelevant = matchScore >= 0.9;
        if (!isRelevant) {
            logger.debug('Filtered - insufficient keyword match', {
                title,
                essentialKeywords,
                matchScore: `${(matchScore * 100).toFixed(1)}%`,
                required: '90%'
            });
        }
        else {
            logger.debug('Approved - high keyword match', {
                title,
                matchScore: `${(matchScore * 100).toFixed(1)}%`
            });
        }
        return isRelevant;
    }
    extractMainTitle(query) {
        return query
            .replace(/temporada\s*\d+/gi, '')
            .replace(/season\s*\d+/gi, '')
            .replace(/\s*\d+ª?\s*temp/gi, '')
            .replace(/s\d+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    extractEssentialKeywords(mainTitle) {
        return mainTitle
            .toLowerCase()
            .split(' ')
            .filter(word => word.length > 2 &&
            !this.ignoredWords.has(word))
            .slice(0, 6);
    }
    containsMainTitle(title, mainTitle) {
        return title.includes(mainTitle);
    }
    calculateKeywordMatch(title, essentialKeywords) {
        if (essentialKeywords.length === 0)
            return 1;
        const matches = essentialKeywords.filter(keyword => title.includes(keyword)).length;
        return matches / essentialKeywords.length;
    }
    isPromotionalContent(title) {
        return this.promotionalKeywords.some(keyword => title.includes(keyword));
    }
    isCorrectSeason(title, targetSeason) {
        const titleSeason = this.extractSeasonNumber(title);
        return titleSeason === null || titleSeason === targetSeason;
    }
    async searchTorrentIndexer(query, type, targetSeason) {
        if (!this.torrentIndexerConfig.enabled) {
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
            const searchUrl = `${this.torrentIndexerConfig.baseUrl}/search`;
            logger.debug('Searching Torrent Indexer', { searchUrl, params });
            const response = await axios_1.default.get(searchUrl, {
                timeout: this.torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) {
                logger.debug('Torrent Indexer returned no results or invalid format', {
                    resultsCount: data.results?.length || 0
                });
                return [];
            }
            const results = data.results.slice(0, 20);
            const mappedResults = results.map((indexerResult) => this.mapTorrentIndexerResult(indexerResult, type)).filter(Boolean);
            logger.debug('Torrent Indexer search completed', {
                query,
                type,
                targetSeason,
                resultsFound: mappedResults.length
            });
            return mappedResults;
        }
        catch (error) {
            logger.debug('Torrent Indexer search failed', {
                query,
                type,
                targetSeason,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    mapTorrentIndexerResult(indexerResult, type) {
        if (!indexerResult.title || !indexerResult.magnet_link) {
            return null;
        }
        const queryWords = indexerResult.title.toLowerCase().split(' ').filter(word => word.length > 2);
        const seasonNumber = this.extractSeasonNumber(indexerResult.title);
        const quality = this.extractQuality(indexerResult.title);
        return {
            title: this.cleanTitle(indexerResult.title),
            magnet: indexerResult.magnet_link,
            seeders: indexerResult.seed_count || this.estimateSeeders('TorrentIndexer', quality),
            leechers: indexerResult.leech_count || 0,
            size: indexerResult.size || 'Size not specified',
            quality: quality,
            provider: 'TorrentIndexer',
            language: this.extractLanguage(indexerResult.title),
            type,
            relevanceScore: this.calculateRelevanceScore(indexerResult.title, queryWords.join(' '), quality),
            sizeInBytes: this.calculateSizeInBytes(indexerResult.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(indexerResult.date || Date.now())
        };
    }
    getTorrentIndexerHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
    generateSeasonQueries(baseQuery, targetSeason) {
        const queries = [baseQuery];
        if (!targetSeason) {
            return queries;
        }
        const cleanQuery = baseQuery
            .replace(/temporada\s*\d+/gi, '')
            .replace(/season\s*\d+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleanQuery.length < 2) {
            queries.push(`Temporada ${targetSeason}`, `Season ${targetSeason}`, `${targetSeason}ª Temporada`);
        }
        else {
            queries.push(`${cleanQuery} Temporada ${targetSeason}`, `${cleanQuery} ${targetSeason}ª Temporada`, `${cleanQuery} Season ${targetSeason}`, `${cleanQuery} S${targetSeason}`, `${cleanQuery} T${targetSeason}`, `${cleanQuery} ${targetSeason}º Temporada`, `${cleanQuery} ${targetSeason}ª Temp`, `"${cleanQuery}" "${targetSeason}ª Temporada"`, `"${cleanQuery}" "Temporada ${targetSeason}"`);
        }
        logger.debug('Generated season queries', {
            baseQuery,
            cleanQuery,
            targetSeason,
            queries
        });
        return [...new Set(queries)];
    }
    processSettledResults(settledResults) {
        const allResults = [];
        settledResults.forEach((result, index) => {
            if (index === 0 && this.torrentIndexerConfig.enabled) {
                if (result.status === 'fulfilled') {
                    if (result.value.length > 0) {
                        allResults.push(...result.value);
                        logger.debug('Torrent Indexer returned results', {
                            results: result.value.length
                        });
                    }
                }
                else {
                    logger.debug('Torrent Indexer failed', {
                        error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
                    });
                }
            }
            else {
                const providerIndex = (index - (this.torrentIndexerConfig.enabled ? 1 : 0)) % this.providers.length;
                const provider = this.providers[providerIndex];
                if (result.status === 'fulfilled') {
                    if (result.value.length > 0) {
                        allResults.push(...result.value);
                        logger.debug('Provider returned results', {
                            provider: provider.name,
                            results: result.value.length,
                            usesAPI: provider.usesAPI || false
                        });
                    }
                }
                else {
                    logger.debug('Provider failed', {
                        provider: provider.name,
                        error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
                        usesAPI: provider.usesAPI || false
                    });
                }
            }
        });
        return allResults;
    }
    removeDuplicateResults(results) {
        const seenMagnets = new Set();
        const uniqueResults = [];
        for (const result of results) {
            if (result.magnet && !seenMagnets.has(result.magnet)) {
                seenMagnets.add(result.magnet);
                uniqueResults.push(result);
            }
        }
        logger.debug('Removed duplicate results', {
            originalCount: results.length,
            uniqueCount: uniqueResults.length,
            duplicatesRemoved: results.length - uniqueResults.length
        });
        return uniqueResults;
    }
    groupByQuality(results) {
        const groups = new Map();
        for (const result of results) {
            const quality = result.quality;
            if (!groups.has(quality)) {
                groups.set(quality, []);
            }
            groups.get(quality).push(result);
        }
        return groups;
    }
    selectBestFromEachQuality(qualityGroups) {
        const bestResults = [];
        const qualityOrder = ['2160p', '1080p', '720p', 'HD', '480p', '360p', 'SD'];
        for (const quality of qualityOrder) {
            const group = qualityGroups.get(quality);
            if (group && group.length > 0) {
                const bestInQuality = group.sort((a, b) => {
                    if (b.relevanceScore !== a.relevanceScore) {
                        return b.relevanceScore - a.relevanceScore;
                    }
                    if (b.seeders !== a.seeders) {
                        return b.seeders - a.seeders;
                    }
                    const providerPriorityA = this.getProviderPriority(a.provider);
                    const providerPriorityB = this.getProviderPriority(b.provider);
                    if (providerPriorityB !== providerPriorityA) {
                        return providerPriorityB - providerPriorityA;
                    }
                    if (b.sizeInBytes !== a.sizeInBytes) {
                        return b.sizeInBytes - a.sizeInBytes;
                    }
                    return 0;
                }).slice(0, 2);
                bestResults.push(...bestInQuality);
            }
        }
        return bestResults.slice(0, 8);
    }
    getProviderPriority(providerName) {
        if (providerName === 'TorrentIndexer') {
            return this.torrentIndexerConfig.priority;
        }
        const provider = this.providers.find(p => p.name === providerName);
        return provider?.priority || 1;
    }
    logSearchResults(query, type, totalResults, bestResults, duration, qualityGroups, targetSeason, seasonQueries) {
        const qualityDistribution = {};
        qualityGroups.forEach((results, quality) => {
            qualityDistribution[quality] = results.length;
        });
        const providerDistribution = {};
        qualityGroups.forEach((results) => {
            results.forEach(result => {
                providerDistribution[result.provider] = (providerDistribution[result.provider] || 0) + 1;
            });
        });
        logger.info('Search completed successfully', {
            query,
            type,
            targetSeason,
            totalResults,
            bestResults: bestResults.length,
            duration: `${duration}ms`,
            qualityDistribution,
            providerDistribution,
            selectedQualities: bestResults.map(r => r.quality),
            selectedProviders: bestResults.map(r => r.provider),
            queriesUsed: seasonQueries?.length || 1,
            torrentIndexerUsed: this.torrentIndexerConfig.enabled
        });
    }
    async searchProvider(provider, query, type, targetSeason) {
        const startTime = Date.now();
        try {
            if (provider.usesAPI && provider.apiEndpoint) {
                return await this.searchViaAPI(provider, query, type, targetSeason);
            }
            else {
                return await this.searchViaHTML(provider, query, type, targetSeason);
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.debug('Error searching provider', {
                provider: provider.name,
                query,
                targetSeason,
                usesAPI: provider.usesAPI || false,
                error: errorMessage
            });
            return [];
        }
    }
    async searchViaAPI(provider, query, type, targetSeason) {
        const apiUrl = `${provider.baseUrl}${provider.apiEndpoint}?search=${encodeURIComponent(query)}&per_page=50`;
        const response = await axios_1.default.get(apiUrl, {
            headers: this.getAPIHeaders(),
            timeout: provider.timeout
        });
        return this.parseAPIResults(response.data, provider, query, type, targetSeason);
    }
    async searchViaHTML(provider, query, type, targetSeason) {
        const startTime = Date.now();
        const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodeURIComponent(query)}`;
        const html = await this.fetchWithRetry(searchUrl, provider.timeout);
        const rawResults = this.parseHtmlResults(html, provider, query, type, targetSeason);
        const resultsWithMagnets = await this.enrichWithMagnets(rawResults, provider, html);
        const duration = Date.now() - startTime;
        logger.debug('Provider processed successfully', {
            provider: provider.name,
            query,
            results: resultsWithMagnets.length,
            duration: `${duration}ms`,
            usesAPI: provider.usesAPI || false
        });
        return resultsWithMagnets;
    }
    parseAPIResults(posts, provider, query, type, targetSeason) {
        const results = [];
        for (const post of posts) {
            try {
                const title = post.title.rendered;
                if (!title || title.length < 5) {
                    continue;
                }
                if (!this.isRelevantResult(title, query, type, targetSeason)) {
                    continue;
                }
                const magnet = this.extractMagnetFromContent(post.content.rendered);
                if (!magnet) {
                    continue;
                }
                const result = this.createTorrentResultFromAPI(post, provider.name, type, query, magnet);
                results.push(result);
            }
            catch (error) {
                logger.warn('Error parsing API item', {
                    provider: provider.name,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        }
        return results;
    }
    parseHtmlResults(html, provider, query, type, targetSeason) {
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
                if (!this.isRelevantResult(title, query, type, targetSeason)) {
                    return;
                }
                const result = this.createTorrentResult(title, provider.name, type, query);
                results.push(result);
            }
            catch (error) {
                logger.warn('Error parsing HTML item', {
                    provider: provider.name,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
            }
        });
        return results;
    }
    isRelevantResult(title, query, type, targetSeason) {
        const mainTitle = this.extractMainTitle(query);
        const essentialKeywords = this.extractEssentialKeywords(mainTitle);
        return this.isExactlyRelevant(title, mainTitle, essentialKeywords, type, targetSeason);
    }
    extractMagnetFromContent(content) {
        const magnetMatch = content.match(/magnet:\?[^"'\s<>]+/);
        return magnetMatch ? magnetMatch[0] : null;
    }
    createTorrentResultFromAPI(post, provider, type, query, magnet) {
        const title = post.title.rendered;
        const quality = this.extractQuality(title);
        const size = this.extractSizeFromContent(post.content.rendered);
        const sizeInBytes = this.calculateSizeInBytes(size);
        const seasonNumber = this.extractSeasonNumber(title);
        const relevanceScore = this.calculateRelevanceScore(title, query, quality);
        return {
            title: this.cleanTitle(title),
            magnet: magnet,
            seeders: this.estimateSeeders(provider, quality),
            leechers: this.estimateLeechers(provider),
            size,
            quality: quality,
            provider,
            language: this.extractLanguage(title),
            type,
            relevanceScore,
            sizeInBytes,
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(post.modified)
        };
    }
    createTorrentResult(title, provider, type, query) {
        const quality = this.extractQuality(title);
        const size = this.extractSize(title);
        const sizeInBytes = this.calculateSizeInBytes(size);
        const seasonNumber = this.extractSeasonNumber(title);
        const relevanceScore = this.calculateRelevanceScore(title, query, quality);
        return {
            title: this.cleanTitle(title),
            magnet: '',
            seeders: this.estimateSeeders(provider, quality),
            leechers: this.estimateLeechers(provider),
            size,
            quality: quality,
            provider,
            language: this.extractLanguage(title),
            type,
            relevanceScore,
            sizeInBytes,
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date()
        };
    }
    extractSizeFromContent(content) {
        const sizeMatch = content.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }
    async enrichWithMagnets(results, provider, originalHtml) {
        const enrichedResults = [];
        const magnetPromises = results.map(result => this.fetchMagnetForResult(result, provider, originalHtml));
        const magnetResults = await Promise.allSettled(magnetPromises);
        magnetResults.forEach((result, index) => {
            if (result.status === 'fulfilled' && result.value.magnet) {
                enrichedResults.push({
                    ...results[index],
                    magnet: result.value.magnet
                });
            }
        });
        return enrichedResults;
    }
    async fetchMagnetForResult(result, provider, originalHtml) {
        try {
            let detailUrl = null;
            if (originalHtml) {
                const $original = cheerio.load(originalHtml);
                const item = $original(provider.itemSelector).filter((_, element) => {
                    const itemTitle = $original(element).find(provider.titleSelector).text().trim();
                    return itemTitle === result.title;
                }).first();
                detailUrl = item.find(provider.linkSelector).attr('href') || null;
            }
            let html;
            if (detailUrl) {
                html = await this.fetchWithRetry(detailUrl, provider.timeout);
            }
            else {
                const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodeURIComponent(result.title)}`;
                html = await this.fetchWithRetry(searchUrl, provider.timeout);
            }
            const $ = cheerio.load(html);
            let magnetLink = $('a[href^="magnet:"]').first().attr('href');
            if (!magnetLink) {
                $('a').each((index, element) => {
                    const href = $(element).attr('href');
                    if (href && href.startsWith('magnet:')) {
                        magnetLink = href;
                        return false;
                    }
                });
            }
            return { magnet: magnetLink || '' };
        }
        catch (error) {
            logger.warn('Error fetching magnet for result', {
                title: result.title,
                provider: provider.name,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return { magnet: '' };
        }
    }
    calculateRelevanceScore(title, query, quality) {
        let score = 0;
        const titleLower = title.toLowerCase();
        const queryLower = query.toLowerCase();
        const mainPhrases = this.extractMainPhrases(queryLower);
        for (const phrase of mainPhrases) {
            if (titleLower.includes(phrase)) {
                score += phrase.split(' ').length * 15;
            }
        }
        score += this.qualityPriority[quality] || 100;
        if (titleLower.includes('dual') || titleLower.includes('dublado') || titleLower.includes('portugues')) {
            score += 25;
        }
        if (titleLower.includes('bluray') || titleLower.includes('web-dl') || titleLower.includes('remux')) {
            score += 20;
        }
        if (titleLower.includes('cam') || titleLower.includes('ts') || titleLower.includes('scr')) {
            score -= 50;
        }
        return Math.max(0, score);
    }
    extractMainPhrases(query) {
        const phrases = [];
        const words = query.split(' ').filter(word => word.length > 2);
        for (let i = 0; i < words.length - 1; i++) {
            for (let j = i + 2; j <= Math.min(i + 4, words.length); j++) {
                const phrase = words.slice(i, j).join(' ');
                if (phrase.length > 5) {
                    phrases.push(phrase);
                }
            }
        }
        return phrases.sort((a, b) => b.length - a.length);
    }
    cleanTitle(title) {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
    }
    extractSeasonNumber(text) {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i,
            /t(\d+)/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }
    extractSize(title) {
        const sizeMatch = title.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB|G|M)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }
    calculateSizeInBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Size not specified') {
            return 1.5 * 1024 * 1024 * 1024;
        }
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match) {
            return 1.5 * 1024 * 1024 * 1024;
        }
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G')
            return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M')
            return value * 1024 * 1024;
        return 1.5 * 1024 * 1024 * 1024;
    }
    extractLanguage(title) {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('dual') || titleLower.includes('dual audio'))
            return 'pt-BR,en';
        if (titleLower.includes('dublado') || titleLower.includes('dublado'))
            return 'pt-BR';
        if (titleLower.includes('legendado') || titleLower.includes('legenda'))
            return 'pt';
        return 'pt-BR';
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
            'HD': 1.1,
            '480p': 0.8,
            '360p': 0.6,
            'SD': 0.5
        };
        const base = baseSeeders[provider] || 30;
        const multiplier = qualityMultiplier[quality] || 1.0;
        return Math.round(base * multiplier);
    }
    estimateLeechers(provider) {
        const leecherEstimates = {
            'BLUDV': 15,
            'Starck Filmes': 12,
            'BaixaFilmesTorrent': 10,
            'TorrentIndexer': 8
        };
        return leecherEstimates[provider] || 5;
    }
    async fetchWithRetry(url, timeout) {
        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            try {
                const config = {
                    timeout,
                    headers: this.getRequestHeaders(),
                    validateStatus: (status) => status < 500
                };
                const response = await axios_1.default.get(url, config);
                if (response.status === 200) {
                    return response.data;
                }
                logger.warn('Search attempt failed', {
                    url,
                    attempt,
                    status: response.status,
                    provider: this.getProviderFromUrl(url)
                });
            }
            catch (error) {
                logger.warn('Search attempt error', {
                    url,
                    attempt,
                    provider: this.getProviderFromUrl(url),
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                if (attempt === this.maxRetries + 1) {
                    throw error;
                }
                await this.delay(this.retryDelay * attempt);
            }
        }
        throw new Error(`All ${this.maxRetries} attempts failed for: ${url}`);
    }
    getProviderFromUrl(url) {
        const provider = this.providers.find(p => url.includes(p.baseUrl));
        return provider?.name || 'Unknown';
    }
    getRequestHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'Referer': 'https://www.google.com/',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1'
        };
    }
    getAPIHeaders() {
        return {
            'User-Agent': 'BrasilRD-Addon/1.0 (+https://github.com/brasil-rd-addon)',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Referer': 'https://bludv.net/',
            'Cache-Control': 'no-cache'
        };
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.TorrentScraperService = TorrentScraperService;
//# sourceMappingURL=TorrentScraperService.js.map