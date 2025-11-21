import { Logger } from '../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';

const logger = new Logger('TorrentScraper');

export interface TorrentResult {
    title: string;
    magnet: string;
    seeders: number;
    leechers: number;
    size: string;
    quality: string;
    provider: string;
    language: string;
    type: 'movie' | 'series';
    relevanceScore: number;
    sizeInBytes: number;
    season?: number;
    lastUpdated: Date;
    confidence: number;
}

interface TorrentIndexerResult {
    title: string;
    magnet_link: string;
    seed_count: number;
    leech_count: number;
    size: string;
    info_hash: string;
    date: string;
    details: string;
    original_title?: string;
    imdb?: string;
}

interface ScraperProvider {
    name: string;
    baseUrl: string;
    searchPath: string;
    itemSelector: string;
    titleSelector: string;
    linkSelector: string;
    priority: number;
    timeout: number;
    requiresVPN?: boolean;
    usesAPI?: boolean;
    apiEndpoint?: string;
}

interface QualityPattern {
    pattern: RegExp;
    quality: string;
    confidence: number;
}

export class TorrentScraperService {
    private readonly providers: ScraperProvider[] = [
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

    private readonly torrentIndexerConfig = {
        baseUrl: 'https://torrent-indexer.darklyn.org',
        timeout: 15000,
        enabled: true,
        priority: 5
    };

    private readonly maxRetries = 3;
    private readonly retryDelay = 1500;
    
    private readonly allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
    private readonly qualityPriority: Record<string, number> = {
        '2160p': 400,
        '1080p': 300,
        '720p': 200,
        'HD': 150
    };

    private readonly ignoredWords = new Set([
        'filme', 'series', 'temporada', 'season', 'download', 'torrent', 
        'com', 'de', 'e', 'the', 'and', 'pt-br', 'dual', 'dublado',
        'legendado', 'bluray', 'web-dl', '1080p', '720p', '480p', '2160p',
        'complete', 'completa', 'full', 'webrip', 'hdtv', 'brrip', 'bdrip',
        'acesse', 'original', 'www', 'tv', 'encoder', 'by', 'mkv', 'mp4',
        'avi', 'x264', 'x265', 'h264', 'h265', 'aac', 'ac3', 'dts'
    ]);

    private readonly promotionalKeywords = [
        'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
        'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
        'spam', 'advertisement', 'publicidade'
    ];

    private readonly qualityPatterns: QualityPattern[] = [
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

    public async searchTorrents(
        query: string, 
        type: 'movie' | 'series' = 'movie',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
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
                Promise.all(seasonQueries.map(seasonQuery => 
                    this.searchTorrentIndexer(seasonQuery, type, targetSeason)
                )).then(results => results.flat()) :
                Promise.resolve([]);

            const traditionalSearchPromises = seasonQueries.map(seasonQuery =>
                this.providers.map(provider => 
                    this.searchProvider(provider, seasonQuery, type, targetSeason)
                )
            ).flat();

            const allPromises = [torrentIndexerPromise, ...traditionalSearchPromises];
            const settledResults = await Promise.allSettled(allPromises);
            
            const allResults = this.processSettledResults(settledResults);
            
            const titleQualityMatchedResults = this.applyTitleQualityMatchFiltering(allResults, query, type, targetSeason);
            
            const qualityGroupedResults = this.groupResultsByQuality(titleQualityMatchedResults);
            
            const bestResults = this.selectBestFromEachQualityGroup(qualityGroupedResults);

            const duration = Date.now() - startTime;
            this.logSearchResults(
                query, 
                type, 
                allResults.length, 
                bestResults, 
                duration, 
                qualityGroupedResults,
                targetSeason
            );

            return bestResults;

        } catch (error) {
            logger.error('Critical error in torrent search', {
                query,
                type,
                targetSeason,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return [];
        }
    }

    private applyTitleQualityMatchFiltering(
        results: TorrentResult[], 
        originalQuery: string, 
        type: 'movie' | 'series',
        targetSeason?: number
    ): TorrentResult[] {
        const filteredResults: TorrentResult[] = [];
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
            } else {
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

    private normalizeTitleForMatching(title: string): string {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b(o|a|os|as|the|and|de|da|do|das|dos)\b/gi, '')
            .trim();
    }

    private generateTitleMatchPatterns(normalizedTitle: string): RegExp[] {
        const words = normalizedTitle.split(' ').filter(word => word.length > 2);
        const patterns: RegExp[] = [];

        if (words.length === 0) return patterns;

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

    private doesTitleMatchSearch(
        resultTitle: string, 
        searchPatterns: RegExp[], 
        normalizedQuery: string
    ): { matches: boolean; confidence: number; matchType: string } {
        
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

        // 1. Match exato - títulos idênticos após normalização
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

        // 2. Match por padrões regex
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
                } else {
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

        // 3. Matching por palavras-chave SUPER RIGOROSO
        const queryWords = cleanQuery.split(' ').filter(word => word.length > 2);
        const resultWords = cleanResult.split(' ').filter(word => word.length > 2);

        logger.debug('📊 WORD-BASED MATCHING ANALYSIS', {
            queryWords,
            resultWords,
            queryWordCount: queryWords.length,
            resultWordCount: resultWords.length
        });

        // Só aplica matching por palavras se tiver pelo menos 3 palavras
        if (queryWords.length >= 3) {
            const matchingWords = queryWords.filter(queryWord =>
                resultWords.includes(queryWord) // Match exato, não substring
            );

            const conflictingWords = resultWords.filter(word => 
                !queryWords.includes(word) && word.length > 3
            );

            logger.debug('📈 WORD MATCHING DETAILS', {
                matchingWords,
                matchingCount: matchingWords.length,
                totalQueryWords: queryWords.length,
                matchPercentage: ((matchingWords.length / queryWords.length) * 100).toFixed(1) + '%',
                conflictingWords,
                conflictingCount: conflictingWords.length
            });

            // REQUER 100% das palavras principais matcharem
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

            // Ou pelo menos 90% E não pode ter palavras conflitantes
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

        // 4. Para títulos curtos, requer match perfeito
        if (queryWords.length === 2) {
            const matchingWords = queryWords.filter(queryWord =>
                resultWords.includes(queryWord)
            );

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

        // 5. SEM MATCH - rejeita qualquer coisa que não seja muito próxima
        logger.debug('🚫 NO ACCEPTABLE MATCH FOUND - rejecting torrent', {
            query: normalizedQuery,
            result: resultTitle,
            reason: 'No matching criteria met'
        });

        return { matches: false, confidence: 0, matchType: 'no-match' };
    }

    private calculateTitleQualityRelevanceScore(result: TorrentResult, confidence: number): number {
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

    private groupResultsByQuality(results: TorrentResult[]): Map<string, TorrentResult[]> {
        const groups = new Map<string, TorrentResult[]>();
        
        for (const quality of this.allowedQualities) {
            groups.set(quality, []);
        }
        
        for (const result of results) {
            if (this.allowedQualities.has(result.quality)) {
                groups.get(result.quality)!.push(result);
            }
        }
        
        return groups;
    }

    private selectBestFromEachQualityGroup(qualityGroups: Map<string, TorrentResult[]>): TorrentResult[] {
        const bestResults: TorrentResult[] = [];
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

    private isValidContent(title: string): boolean {
        const titleLower = title.toLowerCase();
        return !this.promotionalKeywords.some(keyword => titleLower.includes(keyword));
    }

    private isPromotionalContent(title: string): boolean {
        return this.promotionalKeywords.some(keyword => 
            title.includes(keyword)
        );
    }

    private extractQuality(title: string): string {
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

    private inferQualityFromContext(titleLower: string): string {
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

    private extractMainTitle(query: string): string {
        return query
            .replace(/temporada\s*\d+/gi, '')
            .replace(/season\s*\d+/gi, '')
            .replace(/\s*\d+ª?\s*temp/gi, '')
            .replace(/s\d+/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private extractSeasonNumber(text: string): number | null {
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

    private async searchTorrentIndexer(
        query: string, 
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        if (!this.torrentIndexerConfig.enabled) {
            return [];
        }

        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params: any = {
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
            const mappedResults = results.map((indexerResult: TorrentIndexerResult) => 
                this.mapTorrentIndexerResult(indexerResult, type)
            ).filter(Boolean) as TorrentResult[];

            return mappedResults;

        } catch (error) {
            return [];
        }
    }

    private mapTorrentIndexerResult(
        indexerResult: TorrentIndexerResult, 
        type: 'movie' | 'series'
    ): TorrentResult | null {
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

    private getTorrentIndexerHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }

    private generateSeasonQueries(baseQuery: string, targetSeason?: number): string[] {
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
            queries.push(
                `Temporada ${targetSeason}`,
                `Season ${targetSeason}`
            );
        } else {
            queries.push(
                `${cleanQuery} Temporada ${targetSeason}`,
                `${cleanQuery} Season ${targetSeason}`,
                `${cleanQuery} S${targetSeason}`
            );
        }
        
        return [...new Set(queries)];
    }

    private processSettledResults(settledResults: PromiseSettledResult<TorrentResult[]>[]): TorrentResult[] {
        const allResults: TorrentResult[] = [];

        settledResults.forEach((result) => {
            if (result.status === 'fulfilled') {
                allResults.push(...result.value);
            }
        });

        return allResults;
    }

    private cleanTitle(title: string): string {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .trim();
    }

    private extractLanguage(title: string): string {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('dual')) return 'pt-BR,en';
        if (titleLower.includes('dublado')) return 'pt-BR';
        if (titleLower.includes('legendado')) return 'pt';
        return 'pt-BR';
    }

    private calculateSizeInBytes(sizeStr: string): number {
        if (!sizeStr || sizeStr === 'Size not specified') {
            return 1.5 * 1024 * 1024 * 1024;
        }
        
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match) return 1.5 * 1024 * 1024 * 1024;

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        if (unit === 'GB' || unit === 'G') return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M') return value * 1024 * 1024;

        return 1.5 * 1024 * 1024 * 1024;
    }

    private estimateSeeders(provider: string, quality: string): number {
        const baseSeeders: Record<string, number> = {
            'BLUDV': 80,
            'Starck Filmes': 60,
            'BaixaFilmesTorrent': 50,
            'TorrentIndexer': 70
        };

        const qualityMultiplier: Record<string, number> = {
            '2160p': 1.5,
            '1080p': 1.3,
            '720p': 1.0,
            'HD': 1.1
        };

        const base = baseSeeders[provider] || 30;
        const multiplier = qualityMultiplier[quality] || 1.0;
        return Math.round(base * multiplier);
    }

    private async searchProvider(
        provider: ScraperProvider, 
        query: string, 
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        try {
            if (provider.usesAPI && provider.apiEndpoint) {
                return await this.searchViaAPI(provider, query, type, targetSeason);
            } else {
                return await this.searchViaHTML(provider, query, type, targetSeason);
            }
        } catch (error) {
            return [];
        }
    }

    private async searchViaAPI(
        provider: ScraperProvider,
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        const apiUrl = `${provider.baseUrl}${provider.apiEndpoint}?search=${encodeURIComponent(query)}&per_page=50`;
        
        const response = await axios.get(apiUrl, {
            headers: this.getAPIHeaders(),
            timeout: provider.timeout
        });

        return this.parseAPIResults(response.data, provider, query, type, targetSeason);
    }

    private async searchViaHTML(
        provider: ScraperProvider, 
        query: string, 
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodeURIComponent(query)}`;
        const html = await this.fetchWithRetry(searchUrl, provider.timeout);
        
        const rawResults = this.parseHtmlResults(html, provider, query, type, targetSeason);
        const resultsWithMagnets = await this.enrichWithMagnets(rawResults, provider, html);
        
        return resultsWithMagnets;
    }

    private parseAPIResults(
        posts: any[],
        provider: ScraperProvider,
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number
    ): TorrentResult[] {
        const results: TorrentResult[] = [];

        for (const post of posts) {
            try {
                const title = post.title.rendered;
                
                if (!title || title.length < 5) {
                    continue;
                }

                const result = this.createTorrentResultFromAPI(post, provider.name, type);
                results.push(result);

            } catch (error) {
                continue;
            }
        }

        return results;
    }

    private parseHtmlResults(
        html: string, 
        provider: ScraperProvider, 
        query: string, 
        type: 'movie' | 'series',
        targetSeason?: number
    ): TorrentResult[] {
        const results: TorrentResult[] = [];
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

            } catch (error) {
                return;
            }
        });

        return results;
    }

    private createTorrentResultFromAPI(
        post: any,
        provider: string,
        type: 'movie' | 'series'
    ): TorrentResult {
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

    private createTorrentResult(
        title: string, 
        provider: string, 
        type: 'movie' | 'series'
    ): TorrentResult {
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

    private extractMagnetFromContent(content: string): string | null {
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

    private extractSizeFromContent(content: string): string {
        const sizeMatch = content.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }

    private extractSize(title: string): string {
        const sizeMatch = title.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB|G|M)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }

    private async enrichWithMagnets(
        results: TorrentResult[], 
        provider: ScraperProvider,
        originalHtml: string
    ): Promise<TorrentResult[]> {
        const enrichedResults: TorrentResult[] = [];
        const magnetPromises = results.map(result => 
            this.fetchMagnetForResult(result, provider, originalHtml)
        );

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

    private async fetchMagnetForResult(
        result: TorrentResult,
        provider: ScraperProvider,
        originalHtml: string
    ): Promise<{ magnet: string }> {
        try {
            const $original = cheerio.load(originalHtml);
            const item = $original(provider.itemSelector).filter((_, element) => {
                const itemTitle = $original(element).find(provider.titleSelector).text().trim();
                return itemTitle === result.title;
            }).first();

            let detailUrl = item.find(provider.linkSelector).attr('href');
            
            let html: string;
            if (detailUrl) {
                html = await this.fetchWithRetry(detailUrl, provider.timeout);
            } else {
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

        } catch (error) {
            return { magnet: '' };
        }
    }

    private getAPIHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }

    private async fetchWithRetry(url: string, timeout: number): Promise<string> {
        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            try {
                const response = await axios.get(url, {
                    timeout,
                    headers: this.getRequestHeaders(),
                    validateStatus: (status: number) => status < 500
                });

                if (response.status === 200) {
                    return response.data;
                }

                if (attempt === this.maxRetries + 1) {
                    throw new Error(`HTTP ${response.status}`);
                }

                await this.delay(this.retryDelay * attempt);

            } catch (error) {
                if (attempt === this.maxRetries + 1) {
                    throw error;
                }
                await this.delay(this.retryDelay * attempt);
            }
        }

        throw new Error(`All ${this.maxRetries} attempts failed`);
    }

    private getRequestHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8,es;q=0.7',
            'Cache-Control': 'no-cache'
        };
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private logSearchResults(
        query: string, 
        type: string, 
        totalResults: number, 
        bestResults: TorrentResult[], 
        duration: number,
        qualityGroups: Map<string, TorrentResult[]>,
        targetSeason?: number
    ): void {
        const qualityDistribution: Record<string, number> = {};
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
            }, {} as Record<string, number>)
        });
    }
}