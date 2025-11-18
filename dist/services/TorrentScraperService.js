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
            const torrentIndexerPromise = this.torrentIndexerConfig.enabled ?
                Promise.all(seasonQueries.map(seasonQuery => this.searchTorrentIndexer(seasonQuery, type, targetSeason))).then(results => results.flat()) :
                Promise.resolve([]);
            const traditionalSearchPromises = seasonQueries.map(seasonQuery => this.providers.map(provider => this.searchProvider(provider, seasonQuery, type, targetSeason))).flat();
            const allPromises = [torrentIndexerPromise, ...traditionalSearchPromises];
            const settledResults = await Promise.allSettled(allPromises);
            const allResults = this.processSettledResults(settledResults);
            // FILTRAGEM MENOS RESTRITIVA - 70% match em vez de 90%
            const filteredResults = this.applyFlexibleFiltering(allResults, query, type, targetSeason);
            const uniqueResults = this.removeDuplicateResults(filteredResults);
            if (uniqueResults.length === 0) {
                logger.info('No relevant results found after filtering', {
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
            this.logSearchResults(query, type, uniqueResults.length, bestResults, duration, qualityGroups, targetSeason);
            return bestResults;
        }
        catch (error) {
            logger.error('Critical error in torrent search', {
                query,
                type,
                targetSeason,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }
    extractQuality(title) {
        const titleLower = title.toLowerCase();
        // DETECÇÃO PRECISA - APENAS PADRÕES EXPLÍCITOS
        const qualityPatterns = [
            { pattern: /\b(4k|2160p|uhd|ultra[\s\._-]?hd)\b/i, quality: '2160p' },
            { pattern: /\b(1080p|fhd|full[\s\._-]?hd)\b/i, quality: '1080p' },
            { pattern: /\b(720p|hd[\s\._-]?rip)\b/i, quality: '720p' },
            { pattern: /\b(480p|dvd[\s\._-]?rip)\b/i, quality: '480p' },
            { pattern: /\b(360p)\b/i, quality: '360p' },
            { pattern: /\b(3840x2160)\b/, quality: '2160p' },
            { pattern: /\b(1920x1080)\b/, quality: '1080p' },
            { pattern: /\b(1280x720)\b/, quality: '720p' },
            { pattern: /\b(852x480|720x480)\b/, quality: '480p' }
        ];
        for (const { pattern, quality } of qualityPatterns) {
            if (pattern.test(titleLower)) {
                logger.debug('Quality detected by explicit pattern', {
                    title,
                    quality,
                    pattern: pattern.source
                });
                return quality;
            }
        }
        // SE NÃO ENCONTROU PADRÃO EXPLÍCITO, RETORNAR "unknown"
        // EVITAR INFERÊNCIA QUE CAUSA ERROS
        logger.debug('No explicit quality found, returning unknown', {
            title,
            detectedAs: 'unknown'
        });
        return 'unknown';
    }
    applyFlexibleFiltering(results, originalQuery, type, targetSeason) {
        const filteredResults = [];
        const mainTitle = this.extractMainTitle(originalQuery);
        const essentialKeywords = this.extractEssentialKeywords(mainTitle);
        for (const result of results) {
            if (this.isRelevant(result.title, mainTitle, essentialKeywords, type, targetSeason)) {
                filteredResults.push(result);
            }
        }
        logger.info('Flexible filtering completed', {
            originalCount: results.length,
            filteredCount: filteredResults.length,
            removedCount: results.length - filteredResults.length
        });
        return filteredResults;
    }
    isRelevant(title, mainTitle, essentialKeywords, type, targetSeason) {
        const titleLower = title.toLowerCase();
        const mainTitleLower = mainTitle.toLowerCase();
        // Filtrar conteúdo promocional
        if (this.isPromotionalContent(titleLower)) {
            return false;
        }
        // Para séries, verificar temporada
        if (type === 'series' && targetSeason) {
            const titleSeason = this.extractSeasonNumber(titleLower);
            if (titleSeason !== null && titleSeason !== targetSeason) {
                return false;
            }
        }
        // Match mais flexível - 70% em vez de 90%
        const matchScore = this.calculateKeywordMatch(titleLower, essentialKeywords);
        return matchScore >= 0.7; // REDUZIDO de 0.9 para 0.7
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
            .slice(0, 4); // Reduzido de 6 para 4 keywords
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
    extractSeasonNumber(text) {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i
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
            const response = await axios_1.default.get(searchUrl, {
                timeout: this.torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) {
                return [];
            }
            const results = data.results.slice(0, 25); // Aumentado de 20 para 25
            const mappedResults = results.map((indexerResult) => this.mapTorrentIndexerResult(indexerResult, type)).filter(Boolean);
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
            queries.push(`Temporada ${targetSeason}`, `Season ${targetSeason}`);
        }
        else {
            queries.push(`${cleanQuery} Temporada ${targetSeason}`, `${cleanQuery} Season ${targetSeason}`, `${cleanQuery} S${targetSeason}`);
        }
        return [...new Set(queries)];
    }
    processSettledResults(settledResults) {
        const allResults = [];
        settledResults.forEach((result, index) => {
            if (index === 0 && this.torrentIndexerConfig.enabled) {
                if (result.status === 'fulfilled') {
                    allResults.push(...result.value);
                }
            }
            else {
                if (result.status === 'fulfilled') {
                    allResults.push(...result.value);
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
            uniqueCount: uniqueResults.length
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
        const qualityOrder = ['2160p', '1080p', '720p', '480p', '360p', 'HD', 'SD', 'unknown'];
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
                    return 0;
                }).slice(0, 3); // Aumentado de 2 para 3 por qualidade
                bestResults.push(...bestInQuality);
            }
        }
        return bestResults.slice(0, 15); // Aumentado para 15 streams
    }
    getProviderPriority(providerName) {
        if (providerName === 'TorrentIndexer') {
            return this.torrentIndexerConfig.priority;
        }
        const provider = this.providers.find(p => p.name === providerName);
        return provider?.priority || 1;
    }
    logSearchResults(query, type, totalResults, bestResults, duration, qualityGroups, targetSeason) {
        const qualityDistribution = {};
        qualityGroups.forEach((results, quality) => {
            qualityDistribution[quality] = results.length;
        });
        logger.info('Search completed successfully', {
            query,
            type,
            targetSeason,
            totalResults,
            bestResults: bestResults.length,
            duration: `${duration}ms`,
            qualityDistribution,
            selectedQualities: bestResults.map(r => r.quality)
        });
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
        const response = await axios_1.default.get(apiUrl, {
            headers: this.getAPIHeaders(),
            timeout: provider.timeout
        });
        return this.parseAPIResults(response.data, provider, query, type, targetSeason);
    }
    async searchViaHTML(provider, query, type, targetSeason) {
        const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodeURIComponent(query)}`;
        const html = await this.fetchWithRetry(searchUrl, provider.timeout);
        const rawResults = this.parseHtmlResults(html, provider, query, type, targetSeason);
        const resultsWithMagnets = await this.enrichWithMagnets(rawResults, provider, html);
        return resultsWithMagnets;
    }
    parseAPIResults(posts, provider, query, type, targetSeason) {
        const results = [];
        for (const post of posts) {
            try {
                const title = post.title.rendered;
                if (!title || title.length < 5)
                    continue;
                if (!this.isRelevant(title, this.extractMainTitle(query), this.extractEssentialKeywords(query), type, targetSeason))
                    continue;
                const magnet = this.extractMagnetFromContent(post.content.rendered);
                if (!magnet)
                    continue;
                const result = this.createTorrentResultFromAPI(post, provider.name, type, query, magnet);
                results.push(result);
            }
            catch (error) {
                // Ignore parsing errors
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
                if (!title || title.length < 5)
                    return;
                if (!this.isRelevant(title, this.extractMainTitle(query), this.extractEssentialKeywords(query), type, targetSeason))
                    return;
                const result = this.createTorrentResult(title, provider.name, type, query);
                results.push(result);
            }
            catch (error) {
                // Ignore parsing errors
            }
        });
        return results;
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
            return { magnet: '' };
        }
    }
    calculateRelevanceScore(title, query, quality) {
        let score = 0;
        const titleLower = title.toLowerCase();
        const queryLower = query.toLowerCase();
        // Score base por palavras-chave
        const words = queryLower.split(' ').filter(word => word.length > 2);
        for (const word of words) {
            if (titleLower.includes(word)) {
                score += 10;
            }
        }
        // Score por qualidade
        score += this.qualityPriority[quality] || 50;
        // Bonus por conteúdo em português
        if (titleLower.includes('dublado') || titleLower.includes('portugues')) {
            score += 20;
        }
        return Math.max(0, score);
    }
    cleanTitle(title) {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
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
            }
            catch (error) {
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