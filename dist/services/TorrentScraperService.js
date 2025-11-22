import { Logger } from '../utils/logger.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
const logger = new Logger('TorrentScraper');
export class TorrentScraperService {
    constructor() {
        this.providers = [
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
        this.torrentIndexerConfig = {
            baseUrl: 'https://torrent-indexer.darklyn.org',
            timeout: 15000,
            enabled: true,
            priority: 5
        };
        this.maxRetries = 3;
        this.retryDelay = 1500;
        this.allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
        this.qualityPriority = {
            '2160p': 400,
            '1080p': 300,
            '720p': 200,
            'HD': 150
        };
        this.ignoredWords = new Set([
            'filme', 'series', 'temporada', 'season', 'download', 'torrent',
            'com', 'de', 'e', 'the', 'and', 'pt-br', 'dual', 'dublado',
            'legendado', 'bluray', 'web-dl', '1080p', '720p', '480p', '2160p',
            'complete', 'completa', 'full', 'webrip', 'hdtv', 'brrip', 'bdrip',
            'acesse', 'original', 'www', 'tv', 'encoder', 'by', 'mkv', 'mp4',
            'avi', 'x264', 'x265', 'h264', 'h265', 'aac', 'ac3', 'dts'
        ]);
        this.promotionalKeywords = [
            'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
            'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
            'spam', 'advertisement', 'publicidade'
        ];
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
        logger.info('TorrentScraperService initialized - TITLE + QUALITY MATCH DETECTION', {
            providers: this.providers.map(p => ({
                name: p.name,
                priority: p.priority,
                usesAPI: p.usesAPI || false
            })),
            torrentIndexer: this.torrentIndexerConfig.enabled,
            allowedQualities: Array.from(this.allowedQualities),
            matchDetection: 'Title + Quality exact match in magnet names'
        });
    }
    async searchTorrents(query, type = 'movie', targetSeason) {
        const startTime = Date.now();
        logger.info('Starting TITLE + QUALITY torrent search', {
            query,
            type,
            targetSeason,
            providersCount: this.providers.length,
            targetQualities: Array.from(this.allowedQualities)
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
            const titleQualityMatchedResults = this.applyTitleQualityMatchFiltering(allResults, query, type, targetSeason);
            const qualityGroupedResults = this.groupResultsByQuality(titleQualityMatchedResults);
            const bestResults = this.selectBestFromEachQualityGroup(qualityGroupedResults);
            const duration = Date.now() - startTime;
            this.logSearchResults(query, type, allResults.length, bestResults, duration, qualityGroupedResults, targetSeason);
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
    applyTitleQualityMatchFiltering(results, originalQuery, type, targetSeason) {
        const filteredResults = [];
        const normalizedQuery = this.normalizeTitleForMatching(originalQuery);
        const searchTitlePatterns = this.generateTitleMatchPatterns(normalizedQuery);
        logger.debug('Applying TITLE + QUALITY match filtering', {
            originalQuery,
            normalizedQuery,
            searchTitlePatterns: searchTitlePatterns.map(p => p.source),
            totalResults: results.length
        });
        for (const result of results) {
            const normalizedResultTitle = this.normalizeTitleForMatching(result.title);
            const titleMatch = this.doesTitleMatchSearch(normalizedResultTitle, searchTitlePatterns, normalizedQuery);
            const qualityMatch = this.allowedQualities.has(result.quality);
            if (titleMatch.matches && qualityMatch && this.isValidContent(result.title)) {
                result.confidence = titleMatch.confidence;
                result.relevanceScore = this.calculateTitleQualityRelevanceScore(result, titleMatch.confidence);
                filteredResults.push(result);
                logger.debug('✅ Torrent PASSED TITLE + QUALITY filter', {
                    originalTitle: result.title,
                    normalizedTitle: normalizedResultTitle,
                    quality: result.quality,
                    confidence: `${(titleMatch.confidence * 100).toFixed(1)}%`,
                    matchType: titleMatch.matchType
                });
            }
            else {
                logger.debug('❌ Torrent FILTERED by TITLE + QUALITY', {
                    title: result.title,
                    quality: result.quality,
                    titleMatch: titleMatch.matches,
                    qualityMatch: qualityMatch,
                    matchType: titleMatch.matchType,
                    reason: !titleMatch.matches ? 'title_mismatch' : !qualityMatch ? 'quality_mismatch' : 'invalid_content'
                });
            }
        }
        logger.info('Title + Quality filtering completed', {
            originalCount: results.length,
            filteredCount: filteredResults.length,
            removedCount: results.length - filteredResults.length,
            matchSuccessRate: results.length > 0 ?
                `${((filteredResults.length / results.length) * 100).toFixed(1)}%` : '0%'
        });
        return filteredResults;
    }
    normalizeTitleForMatching(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b(o|a|os|as|the|and|de|da|do|das|dos)\b/gi, '')
            .trim();
    }
    generateTitleMatchPatterns(normalizedTitle) {
        const words = normalizedTitle.split(' ').filter(word => word.length > 2);
        const patterns = [];
        if (words.length === 0)
            return patterns;
        patterns.push(new RegExp(`\\b${normalizedTitle.replace(/\s+/g, '\\s+')}\\b`, 'i'));
        if (words.length > 1) {
            const mainPattern = words.slice(0, Math.min(4, words.length)).join('\\s+');
            patterns.push(new RegExp(`\\b${mainPattern}\\b`, 'i'));
        }
        if (words.length >= 3) {
            const essentialPattern = words.filter((_, index) => index % 2 === 0).join('\\s+');
            patterns.push(new RegExp(`\\b${essentialPattern}\\b`, 'i'));
        }
        const individualWordPatterns = words
            .filter(word => word.length > 3)
            .map(word => new RegExp(`\\b${word}\\b`, 'i'));
        patterns.push(...individualWordPatterns);
        return patterns;
    }
    doesTitleMatchSearch(resultTitle, searchPatterns, normalizedQuery) {
        logger.debug('🔍 STARTING TITLE MATCHING', {
            query: normalizedQuery,
            result: resultTitle
        });
        if (this.isPromotionalContent(resultTitle)) {
            logger.debug('🚫 PROMOTIONAL CONTENT - REJECTED', {
                result: resultTitle
            });
            return { matches: false, confidence: 0, matchType: 'promotional' };
        }
        const cleanQuery = normalizedQuery.replace(/\s+/g, ' ').trim();
        const cleanResult = resultTitle.replace(/\s+/g, ' ').trim();
        logger.debug('📝 COMPARING CLEAN TITLES', {
            cleanQuery,
            cleanResult,
            exactMatch: cleanQuery === cleanResult
        });
        if (cleanQuery === cleanResult) {
            logger.debug('🎯 EXACT MATCH FOUND - titles are identical', {
                query: cleanQuery,
                result: cleanResult
            });
            return {
                matches: true,
                confidence: 1.0,
                matchType: 'exact-clean'
            };
        }
        for (const pattern of searchPatterns) {
            if (pattern.test(resultTitle)) {
                const matchLength = pattern.source.replace(/\\s\+/g, ' ').length - 4;
                const confidence = Math.min(matchLength / normalizedQuery.length, 1.0);
                logger.debug('🔤 REGEX PATTERN MATCH', {
                    pattern: pattern.source,
                    matchLength,
                    normalizedQueryLength: normalizedQuery.length,
                    confidence: confidence.toFixed(2)
                });
                if (matchLength > normalizedQuery.length * 0.8) {
                    logger.debug('✅ STRONG REGEX MATCH - accepting', {
                        matchType: 'exact',
                        finalConfidence: Math.max(confidence, 0.95)
                    });
                    return {
                        matches: true,
                        confidence: Math.max(confidence, 0.95),
                        matchType: 'exact'
                    };
                }
                else {
                    logger.debug('✅ PARTIAL REGEX MATCH - accepting', {
                        matchType: 'partial',
                        finalConfidence: Math.max(confidence, 0.8)
                    });
                    return {
                        matches: true,
                        confidence: Math.max(confidence, 0.8),
                        matchType: 'partial'
                    };
                }
            }
        }
        const queryWords = cleanQuery.split(' ').filter(word => word.length > 2);
        const resultWords = cleanResult.split(' ').filter(word => word.length > 2);
        logger.debug('📊 WORD-BASED MATCHING ANALYSIS', {
            queryWords,
            resultWords,
            queryWordCount: queryWords.length,
            resultWordCount: resultWords.length
        });
        if (queryWords.length >= 3) {
            const matchingWords = queryWords.filter(queryWord => resultWords.includes(queryWord));
            const conflictingWords = resultWords.filter(word => !queryWords.includes(word) && word.length > 3);
            logger.debug('📈 WORD MATCHING DETAILS', {
                matchingWords,
                matchingCount: matchingWords.length,
                totalQueryWords: queryWords.length,
                matchPercentage: ((matchingWords.length / queryWords.length) * 100).toFixed(1) + '%',
                conflictingWords,
                conflictingCount: conflictingWords.length
            });
            if (matchingWords.length === queryWords.length) {
                logger.debug('🎯 PERFECT WORD MATCH - 100% words matched', {
                    matchType: 'exact-words'
                });
                return {
                    matches: true,
                    confidence: 1.0,
                    matchType: 'exact-words'
                };
            }
            if (matchingWords.length >= queryWords.length * 0.9 && conflictingWords.length === 0) {
                const confidence = matchingWords.length / queryWords.length;
                logger.debug('✅ STRICT KEYWORD MATCH - 90%+ words matched, no conflicts', {
                    matchType: 'strict-keyword',
                    finalConfidence: Math.max(confidence, 0.9)
                });
                return {
                    matches: true,
                    confidence: Math.max(confidence, 0.9),
                    matchType: 'strict-keyword'
                };
            }
            logger.debug('❌ WORD MATCHING FAILED - insufficient match or conflicts', {
                matchPercentage: ((matchingWords.length / queryWords.length) * 100).toFixed(1) + '%',
                requiredPercentage: '90%',
                hasConflicts: conflictingWords.length > 0
            });
        }
        if (queryWords.length === 2) {
            const matchingWords = queryWords.filter(queryWord => resultWords.includes(queryWord));
            logger.debug('📏 SHORT TITLE MATCHING', {
                matchingWords,
                required: '2/2 words'
            });
            if (matchingWords.length === 2) {
                logger.debug('✅ PERFECT SHORT TITLE MATCH', {
                    matchType: 'exact-short'
                });
                return {
                    matches: true,
                    confidence: 1.0,
                    matchType: 'exact-short'
                };
            }
        }
        logger.debug('🚫 NO ACCEPTABLE MATCH FOUND - rejecting torrent', {
            query: normalizedQuery,
            result: resultTitle,
            reason: 'No matching criteria met'
        });
        return { matches: false, confidence: 0, matchType: 'no-match' };
    }
    calculateTitleQualityRelevanceScore(result, confidence) {
        let score = this.qualityPriority[result.quality] || 100;
        score += confidence * 200;
        const titleLower = result.title.toLowerCase();
        if (titleLower.includes('dual') || titleLower.includes('dublado')) {
            score += 25;
        }
        if (titleLower.includes('bluray') || titleLower.includes('web-dl')) {
            score += 20;
        }
        if (result.seeders > 0) {
            score += Math.min(result.seeders * 0.5, 50);
        }
        if (titleLower.match(/s\d+e\d+/i)) {
            score += 15;
        }
        return Math.round(score);
    }
    groupResultsByQuality(results) {
        const groups = new Map();
        for (const quality of this.allowedQualities) {
            groups.set(quality, []);
        }
        for (const result of results) {
            if (this.allowedQualities.has(result.quality)) {
                groups.get(result.quality).push(result);
            }
        }
        return groups;
    }
    selectBestFromEachQualityGroup(qualityGroups) {
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
                }).slice(0, 3);
                bestResults.push(...bestInQuality);
            }
        }
        return bestResults.slice(0, 12);
    }
    isValidContent(title) {
        const titleLower = title.toLowerCase();
        return !this.promotionalKeywords.some(keyword => titleLower.includes(keyword));
    }
    isPromotionalContent(title) {
        return this.promotionalKeywords.some(keyword => title.includes(keyword));
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
    extractMainTitle(query) {
        return query
            .replace(/temporada\s*\d+/gi, '')
            .replace(/season\s*\d+/gi, '')
            .replace(/\s*\d+ª?\s*temp/gi, '')
            .replace(/s\d+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
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
            const response = await axios.get(`${this.torrentIndexerConfig.baseUrl}/search`, {
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
        const response = await axios.get(apiUrl, {
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
        const magnetMatches = content.match(/magnet:\?[^"'\s<>]+/g);
        if (magnetMatches && magnetMatches.length > 0) {
            let bestMagnet = magnetMatches[0];
            for (const magnet of magnetMatches) {
                if (magnet.length > bestMagnet.length) {
                    bestMagnet = magnet;
                }
            }
            if (bestMagnet.includes('xt=urn:btih:') && bestMagnet.includes('&dn=')) {
                logger.debug('Magnet link completo encontrado', {
                    magnetLength: bestMagnet.length,
                    hasHash: bestMagnet.includes('xt=urn:btih:'),
                    hasName: bestMagnet.includes('&dn='),
                    hasTrackers: bestMagnet.includes('&tr=')
                });
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
                logger.debug('Magnet link encontrado via fallback pattern', {
                    pattern: pattern.source,
                    magnetLength: match[0].length
                });
                return match[0];
            }
        }
        return null;
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
                const enrichedResult = {
                    ...results[index],
                    magnet: result.value.magnet
                };
                logger.debug('Resultado enriquecido com magnet link completo', {
                    title: enrichedResult.title,
                    magnetLength: enrichedResult.magnet.length,
                    hasTrackers: enrichedResult.magnet.includes('&tr='),
                    provider: provider.name
                });
                enrichedResults.push(enrichedResult);
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
                const links = $('a');
                for (let i = 0; i < links.length; i++) {
                    const href = $(links[i]).attr('href');
                    if (href && href.startsWith('magnet:')) {
                        magnetLink = href;
                        break;
                    }
                }
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
                const response = await axios.get(url, {
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
        const availableQualities = bestResults.map(r => r.quality);
        const uniqueQualities = [...new Set(availableQualities)];
        const magnetStats = {
            totalMagnets: bestResults.length,
            completeMagnets: bestResults.filter(r => r.magnet && r.magnet.includes('&tr=')).length,
            averageMagnetLength: bestResults.reduce((sum, r) => sum + (r.magnet?.length || 0), 0) / bestResults.length
        };
        logger.info('TITLE + QUALITY search completed', {
            query,
            type,
            targetSeason,
            totalResults,
            bestResults: bestResults.length,
            duration: `${duration}ms`,
            qualityDistribution,
            availableStreamQualities: uniqueQualities,
            magnetStats,
            matchDetection: 'Title + Quality exact match in magnet names',
            streamsPerQuality: availableQualities.reduce((acc, quality) => {
                acc[quality] = (acc[quality] || 0) + 1;
                return acc;
            }, {})
        });
    }
}
