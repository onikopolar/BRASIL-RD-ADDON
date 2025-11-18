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
    allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
    qualityPriority = {
        '2160p': 400,
        '1080p': 300,
        '720p': 200,
        'HD': 150
    };
    ignoredWords = new Set([
        'filme', 'series', 'temporada', 'season', 'download', 'torrent',
        'com', 'de', 'e', 'the', 'and', 'pt-br', 'dual', 'dublado',
        'legendado', 'bluray', 'web-dl', '1080p', '720p', '480p', '2160p',
        'complete', 'completa', 'full', 'webrip', 'hdtv', 'brrip', 'bdrip',
        'acesse', 'original', 'www', 'tv', 'encoder', 'by', 'mkv', 'mp4',
        'avi', 'x264', 'x265', 'h264', 'h265', 'aac', 'ac3', 'dts'
    ]);
    promotionalKeywords = [
        'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
        'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
        'spam', 'advertisement', 'publicidade'
    ];
    qualityPatterns = [
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
    constructor() {
        logger.info('TorrentScraperService initialized - ADVANCED CONFIDENCE DETECTION', {
            providers: this.providers.map(p => ({
                name: p.name,
                priority: p.priority,
                usesAPI: p.usesAPI || false
            })),
            torrentIndexer: this.torrentIndexerConfig.enabled,
            allowedQualities: Array.from(this.allowedQualities),
            confidenceDetection: '97% based on title + quality'
        });
    }
    async searchTorrents(query, type = 'movie', targetSeason) {
        const startTime = Date.now();
        logger.info('Starting ADVANCED CONFIDENCE torrent search', {
            query,
            type,
            targetSeason,
            providersCount: this.providers.length,
            allowedQualities: Array.from(this.allowedQualities)
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
            const filteredResults = this.applyAdvancedConfidenceFiltering(allResults, query, type, targetSeason);
            const highQualityResults = this.filterHighQualityOnly(filteredResults);
            const uniqueResults = this.removeDuplicateResults(highQualityResults);
            if (uniqueResults.length === 0) {
                logger.info('No HIGH CONFIDENCE results found', {
                    query,
                    type,
                    targetSeason,
                    originalResults: allResults.length,
                    highQualityResults: highQualityResults.length
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
    applyAdvancedConfidenceFiltering(results, originalQuery, type, targetSeason) {
        const filteredResults = [];
        const mainTitle = this.extractMainTitle(originalQuery);
        const exactTitle = this.normalizeTitle(mainTitle);
        const essentialKeywords = this.extractEssentialKeywords(mainTitle);
        logger.debug('Applying ADVANCED CONFIDENCE filtering', {
            originalQuery,
            mainTitle,
            exactTitle,
            essentialKeywords,
            totalResults: results.length
        });
        for (const result of results) {
            const titleMatch = this.analyzeTitleMatch(result.title, mainTitle, exactTitle, essentialKeywords, type, targetSeason);
            const qualityMatch = this.analyzeQualityMatch(result.title, result.quality);
            const overallConfidence = this.calculateOverallConfidence(titleMatch, qualityMatch);
            if (overallConfidence >= 0.85 && this.isValidContent(result.title)) {
                result.confidence = overallConfidence;
                result.relevanceScore = this.calculateAdvancedRelevanceScore(result.title, result.quality, overallConfidence);
                filteredResults.push(result);
                logger.debug('Torrent passed confidence filter', {
                    title: result.title,
                    quality: result.quality,
                    confidence: `${(overallConfidence * 100).toFixed(1)}%`,
                    titleConfidence: `${(titleMatch.confidence * 100).toFixed(1)}%`,
                    qualityConfidence: `${(qualityMatch.confidence * 100).toFixed(1)}%`
                });
            }
            else {
                logger.debug('Torrent filtered by confidence', {
                    title: result.title,
                    quality: result.quality,
                    confidence: `${(overallConfidence * 100).toFixed(1)}%`,
                    required: '85%'
                });
            }
        }
        logger.info('Advanced confidence filtering completed', {
            originalCount: results.length,
            filteredCount: filteredResults.length,
            removedCount: results.length - filteredResults.length,
            averageConfidence: filteredResults.length > 0 ?
                (filteredResults.reduce((sum, r) => sum + r.confidence, 0) / filteredResults.length).toFixed(3) : 0
        });
        return filteredResults;
    }
    analyzeTitleMatch(torrentTitle, mainTitle, exactTitle, essentialKeywords, type, targetSeason) {
        const titleLower = torrentTitle.toLowerCase();
        const exactTitleLower = exactTitle.toLowerCase();
        const mainTitleLower = mainTitle.toLowerCase();
        let confidence = 0;
        const matchedKeywords = [];
        let exactMatch = false;
        if (this.isPromotionalContent(titleLower)) {
            return { confidence: 0, matchedKeywords: [], exactMatch: false };
        }
        if (type === 'series' && targetSeason) {
            if (!this.isCorrectSeason(titleLower, targetSeason)) {
                return { confidence: 0, matchedKeywords: [], exactMatch: false };
            }
        }
        if (titleLower.includes(exactTitleLower)) {
            confidence += 0.6;
            exactMatch = true;
            matchedKeywords.push(...exactTitleLower.split(' ').filter(w => w.length > 2));
        }
        if (titleLower.includes(mainTitleLower)) {
            confidence += 0.3;
            matchedKeywords.push(...mainTitleLower.split(' ').filter(w => w.length > 2));
        }
        const keywordMatches = essentialKeywords.filter(keyword => titleLower.includes(keyword));
        if (keywordMatches.length > 0) {
            confidence += (keywordMatches.length / essentialKeywords.length) * 0.4;
            matchedKeywords.push(...keywordMatches);
        }
        if (type === 'movie') {
            if (this.hasExactMovieMatch(titleLower, exactTitleLower)) {
                confidence += 0.2;
            }
        }
        const uniqueKeywords = [...new Set(matchedKeywords)];
        return {
            confidence: Math.min(confidence, 1.0),
            matchedKeywords: uniqueKeywords,
            exactMatch
        };
    }
    analyzeQualityMatch(torrentTitle, detectedQuality) {
        const titleLower = torrentTitle.toLowerCase();
        let confidence = 0.5;
        let reliable = false;
        for (const { pattern, quality, confidence: patternConfidence } of this.qualityPatterns) {
            if (pattern.test(titleLower)) {
                if (quality === detectedQuality) {
                    if (patternConfidence >= 95) {
                        confidence = 0.95;
                        reliable = true;
                        break;
                    }
                    else if (patternConfidence >= 90) {
                        confidence = Math.max(confidence, 0.9);
                        reliable = true;
                    }
                    else if (patternConfidence >= 80) {
                        confidence = Math.max(confidence, 0.8);
                    }
                }
            }
        }
        const exactQualityPatterns = [
            { pattern: /\b2160p\b/i, quality: '2160p' },
            { pattern: /\b4k\b/i, quality: '2160p' },
            { pattern: /\b1080p\b/i, quality: '1080p' },
            { pattern: /\b720p\b/i, quality: '720p' },
            { pattern: /\bhd\b/i, quality: 'HD' }
        ];
        for (const { pattern, quality } of exactQualityPatterns) {
            if (pattern.test(titleLower) && quality === detectedQuality) {
                confidence = Math.max(confidence, 0.97);
                reliable = true;
                break;
            }
        }
        return { confidence, reliable };
    }
    calculateOverallConfidence(titleMatch, qualityMatch) {
        const titleWeight = 0.7;
        const qualityWeight = 0.3;
        let overallConfidence = (titleMatch.confidence * titleWeight) + (qualityMatch.confidence * qualityWeight);
        if (titleMatch.exactMatch) {
            overallConfidence += 0.15;
        }
        if (qualityMatch.reliable) {
            overallConfidence += 0.1;
        }
        return Math.min(overallConfidence, 1.0);
    }
    hasExactMovieMatch(title, exactTitle) {
        const cleanTitle = title
            .replace(/\s+(?:i{1,3}|iv|v|vi{0,3}|[1-9])(?:\s|$)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (cleanTitle.includes(exactTitle)) {
            return true;
        }
        const titleWords = cleanTitle.split(/\s+/).filter(word => word.length > 2);
        const exactWords = exactTitle.split(/\s+/).filter(word => word.length > 2);
        if (exactWords.length === 0)
            return false;
        const matchingWords = exactWords.filter(word => titleWords.some(titleWord => titleWord.includes(word)));
        return matchingWords.length >= Math.max(2, exactWords.length * 0.9);
    }
    calculateAdvancedRelevanceScore(title, quality, confidence) {
        let score = this.qualityPriority[quality] || 100;
        score += confidence * 200;
        const titleLower = title.toLowerCase();
        if (titleLower.includes('dual') || titleLower.includes('dublado')) {
            score += 25;
        }
        if (titleLower.includes('bluray') || titleLower.includes('web-dl')) {
            score += 20;
        }
        if (titleLower.match(/s\d+e\d+/i)) {
            score += 15;
        }
        return Math.round(score);
    }
    isValidContent(title) {
        const titleLower = title.toLowerCase();
        return !this.promotionalKeywords.some(keyword => titleLower.includes(keyword));
    }
    extractQuality(title) {
        const cleanTitle = title.toLowerCase();
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(cleanTitle) && confidence >= 95) {
                return quality;
            }
        }
        const exactPatterns = [
            { pattern: /\b2160p\b/i, quality: '2160p' },
            { pattern: /\b4k\b/i, quality: '2160p' },
            { pattern: /\b1080p\b/i, quality: '1080p' },
            { pattern: /\b720p\b/i, quality: '720p' },
            { pattern: /\bhd\b/i, quality: 'HD' }
        ];
        for (const { pattern, quality } of exactPatterns) {
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
    filterHighQualityOnly(results) {
        const highQualityResults = results.filter(result => this.allowedQualities.has(result.quality));
        const removedCount = results.length - highQualityResults.length;
        if (removedCount > 0) {
            const removedQualities = [...new Set(results
                    .filter(r => !this.allowedQualities.has(r.quality))
                    .map(r => r.quality))];
            logger.info('Removed low quality torrents', {
                removedCount,
                remainingCount: highQualityResults.length,
                removedQualities,
                allowedQualities: Array.from(this.allowedQualities)
            });
        }
        return highQualityResults;
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
    normalizeTitle(title) {
        return title
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b(o|a|os|as|the|and|de|da|do|das|dos)\b/gi, '')
            .trim();
    }
    extractEssentialKeywords(mainTitle) {
        const normalized = this.normalizeTitle(mainTitle);
        return normalized
            .split(' ')
            .filter(word => word.length > 2 &&
            !this.ignoredWords.has(word))
            .slice(0, 6);
    }
    isPromotionalContent(title) {
        return this.promotionalKeywords.some(keyword => title.includes(keyword));
    }
    isCorrectSeason(title, targetSeason) {
        const titleSeason = this.extractSeasonNumber(title);
        return titleSeason === null || titleSeason === targetSeason;
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
            const response = await axios_1.default.get(`${this.torrentIndexerConfig.baseUrl}/search`, {
                timeout: this.torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) {
                return [];
            }
            const results = data.results.slice(0, 20);
            const mappedResults = results.map((indexerResult) => this.mapTorrentIndexerResult(indexerResult, type)).filter(Boolean);
            return mappedResults;
        }
        catch (error) {
            return [];
        }
    }
    mapTorrentIndexerResult(indexerResult, type) {
        if (!indexerResult.title || !indexerResult.magnet_link) {
            return null;
        }
        const quality = this.extractQuality(indexerResult.title);
        if (!this.allowedQualities.has(quality)) {
            return null;
        }
        const seasonNumber = this.extractSeasonNumber(indexerResult.title);
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
            relevanceScore: 100,
            sizeInBytes: this.calculateSizeInBytes(indexerResult.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(indexerResult.date || Date.now()),
            confidence: 0.5
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
        settledResults.forEach((result) => {
            if (result.status === 'fulfilled') {
                allResults.push(...result.value);
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
        const qualityOrder = ['2160p', '1080p', '720p', 'HD'];
        for (const quality of qualityOrder) {
            const group = qualityGroups.get(quality);
            if (group && group.length > 0) {
                const bestInQuality = group.sort((a, b) => {
                    if (b.confidence !== a.confidence) {
                        return b.confidence - a.confidence;
                    }
                    if (b.relevanceScore !== a.relevanceScore) {
                        return b.relevanceScore - a.relevanceScore;
                    }
                    if (b.seeders !== a.seeders) {
                        return b.seeders - a.seeders;
                    }
                    return b.sizeInBytes - a.sizeInBytes;
                }).slice(0, 2);
                bestResults.push(...bestInQuality);
            }
        }
        return bestResults.slice(0, 8);
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
                if (!title || title.length < 5) {
                    continue;
                }
                const result = this.createTorrentResultFromAPI(post, provider.name, type);
                results.push(result);
            }
            catch (error) {
                continue;
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
                const result = this.createTorrentResult(title, provider.name, type);
                results.push(result);
            }
            catch (error) {
                return;
            }
        });
        return results;
    }
    createTorrentResultFromAPI(post, provider, type) {
        const title = post.title.rendered;
        const quality = this.extractQuality(title);
        const size = this.extractSizeFromContent(post.content.rendered);
        const sizeInBytes = this.calculateSizeInBytes(size);
        const seasonNumber = this.extractSeasonNumber(title);
        const magnet = this.extractMagnetFromContent(post.content.rendered) || '';
        return {
            title: this.cleanTitle(title),
            magnet: magnet,
            seeders: this.estimateSeeders(provider, quality),
            leechers: 0,
            size,
            quality: quality,
            provider,
            language: this.extractLanguage(title),
            type,
            relevanceScore: 100,
            sizeInBytes,
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(post.modified),
            confidence: 0.5
        };
    }
    createTorrentResult(title, provider, type) {
        const quality = this.extractQuality(title);
        const size = this.extractSize(title);
        const sizeInBytes = this.calculateSizeInBytes(size);
        const seasonNumber = this.extractSeasonNumber(title);
        return {
            title: this.cleanTitle(title),
            magnet: '',
            seeders: this.estimateSeeders(provider, quality),
            leechers: 0,
            size,
            quality: quality,
            provider,
            language: this.extractLanguage(title),
            type,
            relevanceScore: 100,
            sizeInBytes,
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(),
            confidence: 0.5
        };
    }
    extractMagnetFromContent(content) {
        const magnetMatch = content.match(/magnet:\?[^"'\s<>]+/);
        return magnetMatch ? magnetMatch[0] : null;
    }
    extractSizeFromContent(content) {
        const sizeMatch = content.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }
    extractSize(title) {
        const sizeMatch = title.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB|G|M)/i);
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
            const $original = cheerio.load(originalHtml);
            const item = $original(provider.itemSelector).filter((_, element) => {
                const itemTitle = $original(element).find(provider.titleSelector).text().trim();
                return itemTitle === result.title;
            }).first();
            let detailUrl = item.find(provider.linkSelector).attr('href');
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
    getAPIHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
    async fetchWithRetry(url, timeout) {
        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            try {
                const response = await axios_1.default.get(url, {
                    timeout,
                    headers: this.getRequestHeaders(),
                    validateStatus: (status) => status < 500
                });
                if (response.status === 200) {
                    return response.data;
                }
                if (attempt === this.maxRetries + 1) {
                    throw new Error(`HTTP ${response.status}`);
                }
                await this.delay(this.retryDelay * attempt);
            }
            catch (error) {
                if (attempt === this.maxRetries + 1) {
                    throw error;
                }
                await this.delay(this.retryDelay * attempt);
            }
        }
        throw new Error(`All ${this.maxRetries} attempts failed`);
    }
    getRequestHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7',
            'Cache-Control': 'no-cache'
        };
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    logSearchResults(query, type, totalResults, bestResults, duration, qualityGroups, targetSeason) {
        const qualityDistribution = {};
        qualityGroups.forEach((results, quality) => {
            qualityDistribution[quality] = results.length;
        });
        const avgConfidence = bestResults.length > 0 ?
            (bestResults.reduce((sum, r) => sum + r.confidence, 0) / bestResults.length).toFixed(3) : 0;
        logger.info('ADVANCED CONFIDENCE search completed', {
            query,
            type,
            targetSeason,
            totalResults,
            bestResults: bestResults.length,
            duration: `${duration}ms`,
            qualityDistribution,
            selectedQualities: bestResults.map(r => r.quality),
            averageConfidence: avgConfidence,
            confidenceRange: bestResults.length > 0 ?
                `${(Math.min(...bestResults.map(r => r.confidence)) * 100).toFixed(1)}% - ${(Math.max(...bestResults.map(r => r.confidence)) * 100).toFixed(1)}%` : 'N/A',
            confidenceDetection: '97% based on title + quality analysis'
        });
    }
}
exports.TorrentScraperService = TorrentScraperService;
//# sourceMappingURL=TorrentScraperService.js.map