import { Logger } from '../../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { TorrentResult, ScraperProvider } from './torrentTypes';
import { scraperProviders, torrentIndexerConfig } from './scraperProviders';
import { 
    maxRetries, 
    retryDelay,
    ignoredWords,
    promotionalKeywords,
    episodePatterns
} from './scraperConfigs';
import { QualityDetector } from '../../lib/qualityDetector';

const logger = new Logger('TorrentScraperService');

export class TorrentScraperService {
    private readonly providers = scraperProviders;
    private readonly maxRetries = maxRetries;
    private readonly retryDelay = retryDelay;
    private readonly qualityDetector: QualityDetector;
    private readonly ignoredWords = ignoredWords;
    private readonly promotionalKeywords = promotionalKeywords;
    private readonly episodePatterns = episodePatterns;

    constructor() {
        this.qualityDetector = new QualityDetector();
        logger.info('TorrentScraperService iniciado');
    }

    async searchTorrents(
        query: string, 
        type: 'movie' | 'series' = 'movie',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        
        logger.info('Iniciando busca', {
            query,
            type,
            targetSeason,
            providers: this.providers.length
        });

        try {
            // Buscar apenas com query principal (otimização)
            const mainQuery = query;
            
            const allPromises: Promise<TorrentResult[]>[] = [];
            
            // TorrentIndexer
            if (torrentIndexerConfig.enabled) {
                allPromises.push(
                    this.searchTorrentIndexer(mainQuery, type, targetSeason)
                        .catch(() => [])
                );
            }
            
            // Todos providers em paralelo
            for (const provider of this.providers) {
                allPromises.push(
                    this.searchProvider(provider, mainQuery, type, targetSeason)
                        .catch(() => [])
                );
            }
            
            // Timeout global: 8 segundos
            const timeoutPromise = new Promise<TorrentResult[]>((_, reject) => {
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
            logger.info('Busca finalizada', {
                query,
                total: bestResults.length,
                tempo: `${duration}ms`
            });

            return bestResults;

        } catch (error) {
            logger.error('Erro na busca', {
                query,
                error: error instanceof Error ? error.message : 'Unknown'
            });
            return [];
        }
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
        
        try {
            const response = await axios.get(apiUrl, {
                headers: this.getAPIHeaders(),
                timeout: provider.timeout
            });

            return this.parseAPIResults(response.data, provider, type);
        } catch (error) {
            return [];
        }
    }

    private async searchViaHTML(
        provider: ScraperProvider,
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodeURIComponent(query)}`;
        
        try {
            const html = await this.fetchWithRetry(searchUrl, provider.timeout);
            const rawResults = this.parseHtmlResults(html, provider, type);
            
            // Otimização: não buscar magnets para todos (apenas se necessário)
            if (rawResults.length > 0) {
                const resultsWithMagnets = await this.enrichWithMagnets(rawResults, provider, html);
                return resultsWithMagnets;
            }
            
            return [];
        } catch (error) {
            return [];
        }
    }

    private async searchTorrentIndexer(
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        if (!torrentIndexerConfig.enabled) {
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

            const response = await axios.get(`${torrentIndexerConfig.baseUrl}/search`, {
                timeout: torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params
            });

            const data = response.data;
            
            if (!data.results || !Array.isArray(data.results)) {
                return [];
            }

            const results = data.results.slice(0, 15);
            return results.map((indexerResult: any) => 
                this.mapTorrentIndexerResult(indexerResult, type)
            ).filter(Boolean) as TorrentResult[];

        } catch (error) {
            return [];
        }
    }

    private applyFilters(
        results: TorrentResult[], 
        query: string, 
        type: 'movie' | 'series'
    ): TorrentResult[] {
        return results.filter(result => {
            const titleLower = result.title.toLowerCase();
            
            // Filtrar promocional
            if (this.promotionalKeywords.some(keyword => titleLower.includes(keyword))) {
                return false;
            }

            // Filtrar qualidade
            if (!this.qualityDetector.isValidQuality(result.quality)) {
                return false;
            }

            return true;
        });
    }

    private selectBestResults(results: TorrentResult[]): TorrentResult[] {
        const qualityGroups = new Map<string, TorrentResult[]>();
        
        const allowedQualities = ['2160p', '1080p', '720p', 'HD'];
        for (const quality of allowedQualities) {
            qualityGroups.set(quality, []);
        }
        
        for (const result of results) {
            if (this.qualityDetector.isValidQuality(result.quality)) {
                qualityGroups.get(result.quality)!.push(result);
            }
        }

        const bestResults: TorrentResult[] = [];
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
                }).slice(0, 2); // Apenas 2 por qualidade
                
                bestResults.push(...bestInQuality);
            }
        }
        
        return bestResults.slice(0, 8); // Máximo 8 resultados
    }

    private parseAPIResults(posts: any[], provider: ScraperProvider, type: 'movie' | 'series'): TorrentResult[] {
        const results: TorrentResult[] = [];

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

            } catch (error) {
                continue;
            }
        }

        return results;
    }

    private parseHtmlResults(html: string, provider: ScraperProvider, type: 'movie' | 'series'): TorrentResult[] {
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

            } catch (error) {
                return;
            }
        });

        return results.slice(0, 10); // Limitar a 10 resultados por provider
    }

    private async enrichWithMagnets(
        results: TorrentResult[],
        provider: ScraperProvider,
        originalHtml: string
    ): Promise<TorrentResult[]> {
        // Otimização: apenas os primeiros 5 resultados
        const limitedResults = results.slice(0, 5);
        const enrichedResults: TorrentResult[] = [];

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
                    // Timeout curto para detalhes
                    const html = await axios.get(detailUrl, {
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

            } catch (error) {
                continue;
            }
        }

        return enrichedResults;
    }

    private mapTorrentIndexerResult(indexerResult: any, type: 'movie' | 'series'): TorrentResult | null {
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

    private extractSeasonNumber(text: string): number | null {
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

    private extractSize(title: string): string {
        const sizeMatch = title.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB|G|M)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
    }

    private extractSizeFromContent(content: string): string {
        const sizeMatch = content.match(/(\d+\.?\d*)\s*(GB|MB|GiB|MiB)/i);
        return sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2].toUpperCase()}` : 'Size not specified';
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

    private async fetchWithRetry(url: string, timeout: number): Promise<string> {
        // Apenas 1 retry (otimização)
        try {
            const response = await axios.get(url, {
                timeout,
                headers: this.getRequestHeaders(),
                validateStatus: (status: number) => status < 500
            });

            if (response.status === 200) {
                return response.data;
            }
            throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            // Única tentativa de retry
            await this.delay(1000);
            try {
                const response = await axios.get(url, {
                    timeout: timeout + 1000,
                    headers: this.getRequestHeaders()
                });
                return response.data;
            } catch {
                throw error;
            }
        }
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private getAPIHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }

    private getTorrentIndexerHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }

    private getRequestHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
}