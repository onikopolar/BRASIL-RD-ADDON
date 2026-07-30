import { Logger } from '../../utils/logger.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { TorrentResult } from './torrentTypes.js';
import { torrentIndexerConfig, scraperProviders } from './scraperProviders.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { ImdbScraperService } from '../../catalogo/ImdbScraperService.js';
import { WordPressScraper, agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { searchTpb } from './tpbScraper.js';
import { searchRargb } from './rargbScraper.js';
import { searchStarck } from './starckScraper.js';
import { searchHdr } from './hdrScraper.js';
import { EpisodeMatcher } from '../../titulos/episodeMatcher.js';

const logger = new Logger('TorrentScraperService');

export class TorrentScraperService {
    private readonly qualityDetector: QualityDetector;
    private readonly tmdbScraper: ImdbScraperService;
    private readonly wpScraper: WordPressScraper;
    private readonly episodeMatcher = EpisodeMatcher.getInstance();
    private readonly version = '6.2.0'; // WP API scraper integrado

    constructor(tmdbScraper?: ImdbScraperService) {
        this.qualityDetector = QualityDetector.getInstance();
        this.tmdbScraper = tmdbScraper || ImdbScraperService.getInstance();
        this.wpScraper = new WordPressScraper();
    }

    async searchTorrents(
        query: string,
        type: 'movie' | 'series' = 'movie',
        targetSeason?: number,
        targetYear?: number,
        imdbId?: string
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        try {
            let tmdbData = null;
            if (imdbId) {
                tmdbData = await this.getTmdbData(imdbId, targetSeason);
            }

            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);
            const allResults: TorrentResult[] = [];

            // Executa TorrentIndexer, WebScrapers e WordPress API em paralelo
            const indexerPromise = torrentIndexerConfig.enabled
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
                const seen = new Set<string>();
                const merged = [...en, ...pt].filter(t => {
                  if (seen.has(t.magnet)) return false;
                  seen.add(t.magnet);
                  return true;
                });
                return merged;
            }).catch(() => [] as TorrentResult[]);

            // TPB: busca em inglês E português (torrents PT têm títulos nos dois idiomas)
            // ⚠️ TPB é sensível a acentos: usa portugueseTitleRaw (com acentos) para PT
            const tpbQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const tpbQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const tpbPromise = Promise.all([
                searchTpb(tpbQueryEn, type),
                tpbQueryPt !== tpbQueryEn ? searchTpb(tpbQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                // Merge e dedup por infoHash
                const seen = new Set<string>();
                const merged = [...en, ...pt].filter(t => {
                  if (seen.has(t.infoHash)) return false;
                  seen.add(t.infoHash);
                  return true;
                });
                return merged.map(r => this.mapTpbResult(r, type)).filter((r): r is TorrentResult => r !== null);
            }).catch(() => [] as TorrentResult[]);

            // RARGB: busca em inglês E português (mesmo padrão do TPB)
            const rargbQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const rargbQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const rargbPromise = Promise.all([
                searchRargb(rargbQueryEn, type),
                rargbQueryPt !== rargbQueryEn ? searchRargb(rargbQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set<string>();
                const merged = [...en, ...pt].filter(t => {
                  if (seen.has(t.infoHash)) return false;
                  seen.add(t.infoHash);
                  return true;
                });
                return merged.map(r => this.mapRargbResult(r, type)).filter((r): r is TorrentResult => r !== null);
            }).catch(() => [] as TorrentResult[]);

            // Starck Oficial: busca em inglês E português (HTML scraper, não WordPress API)
            const starckQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const starckQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const starckPromise = Promise.all([
                searchStarck(starckQueryEn, type),
                starckQueryPt !== starckQueryEn ? searchStarck(starckQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set<string>();
                const merged = [...en, ...pt].filter(t => {
                  if (seen.has(t.infoHash)) return false;
                  seen.add(t.infoHash);
                  return true;
                });
                return merged.map(r => this.mapStarckResult(r, type)).filter((r): r is TorrentResult => r !== null);
            }).catch(() => [] as TorrentResult[]);

            // HDR Torrent: busca EN + PT (HTML scraper, magnets diretos no HTML)
            const hdrQueryEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const hdrQueryPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const hdrPromise = Promise.all([
                searchHdr(hdrQueryEn, type),
                hdrQueryPt !== hdrQueryEn ? searchHdr(hdrQueryPt, type) : Promise.resolve([])
            ]).then(([en, pt]) => {
                const seen = new Set<string>();
                const merged = [...en, ...pt].filter(t => {
                  if (seen.has(t.infoHash)) return false;
                  seen.add(t.infoHash);
                  return true;
                });
                return merged.map(r => this.mapHdrResult(r, type)).filter((r): r is TorrentResult => r !== null);
            }).catch(() => [] as TorrentResult[]);

            // ═══ PRIORIDADE 1: Comando, BLUDV, Starck (WordPress + HTML) ═══
            const [wpResults, starckResults] = await Promise.all([
                wpPromise, starckPromise
            ]);
            const highPriorityResults = [...wpResults, ...starckResults];

            if (highPriorityResults.length > 0) {
                allResults.push(...highPriorityResults);
            } else {
                // ═══ FALLBACK: HDR, TorrentIndexer, WebScrapers, RARGB, TPB ═══
                logger.debug('Prioritarios vazios — caindo pra fallback (HDR, TPB, RARGB, etc)');
                const [hdrResults, indexerResults, webResults, tpbResults, rargbResults] = await Promise.all([
                    hdrPromise, indexerPromise, webScrapersPromise, tpbPromise, rargbPromise
                ]);
                allResults.push(...hdrResults, ...indexerResults, ...webResults, ...rargbResults, ...tpbResults);
            }

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
        } catch (error) {
            logger.error('Erro na coleta de torrents', {
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${Date.now() - startTime}ms`
            });
            return [];
        }
    }

    private async getTmdbData(imdbId: string, season?: number): Promise<any> {
        try {
            return await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
        } catch {
            return null;
        }
    }

    private generateSearchQueries(
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number,
        targetYear?: number,
        tmdbData?: any
    ): string[] {
        const queries: string[] = [];
        if (tmdbData?.allTitles?.length > 0) {
            const yearToUse = targetYear || tmdbData.year;
            for (const title of tmdbData.allTitles) {
                queries.push(title);
                if (yearToUse) queries.push(`${title} ${yearToUse}`);
                if (type === 'series' && targetSeason !== undefined) {
                    queries.push(`${title} ${targetSeason}ª temporada`);
                    queries.push(`${title} temporada ${targetSeason}`);
                    queries.push(`${title} season ${targetSeason}`);
                }
                const trimmed = title.replace(/^\d+\s*/, '');
                if (trimmed !== title && trimmed.trim().length > 3) queries.push(trimmed);
            }
        }
        if (queries.length === 0) {
            const base = this.prepareSearchQuery(query, type, targetSeason);
            queries.push(base);
            if (targetYear) queries.push(`${base} ${targetYear}`);
        }
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }

    private async searchTorrentIndexerWithQueries(
        queries: string[], type: 'movie' | 'series',
        targetSeason?: number, targetYear?: number, tmdbData?: any
    ): Promise<TorrentResult[]> {
        const results: TorrentResult[] = [];
        const yearToUse = targetYear || tmdbData?.year;
        for (const query of queries.slice(0, 3)) {
            try {
                const res = await this.searchTorrentIndexer(query, type, targetSeason, yearToUse);
                results.push(...res);
            } catch { /* ignora falhas por query */ }
        }
        return results;
    }

    private async searchTorrentIndexer(
        query: string, type: 'movie' | 'series',
        targetSeason?: number, targetYear?: number
    ): Promise<TorrentResult[]> {
        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params: any = { q: query, filter_results: 'true', category };
            if (type === 'series' && targetSeason !== undefined) params.season = targetSeason.toString();
            if (targetYear !== undefined) params.year = targetYear.toString();

            const response = await axios.get(`${torrentIndexerConfig.baseUrl}/search`, {
                timeout: torrentIndexerConfig.timeout,
                httpsAgent: agenteHttps,
                lookup: lookupCustomizado,
                headers: { 'User-Agent': 'Brasil-RD-Addon/6.1.1', 'Accept': 'application/json' },
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) return [];
            return data.results.slice(0, 20)
                .map((r: any) => this.mapTorrentIndexerResult(r, type))
                .filter((r: TorrentResult | null): r is TorrentResult => r !== null);
        } catch {
            return [];
        }
    }

    private async searchWebScrapersWithQueries(
        queries: string[], type: 'movie' | 'series', tmdbData?: any
    ): Promise<TorrentResult[]> {
        const results: TorrentResult[] = [];
        for (const query of queries.slice(0, 2)) {
            try {
                const res = await this.searchWebScrapers(query, type);
                results.push(...res);
            } catch { /* ignora */ }
        }
        return results;
    }

    private async searchWebScrapers(query: string, type: 'movie' | 'series'): Promise<TorrentResult[]> {
        const activeProviders = scraperProviders
            .filter(p => p.priority > 0)
            .sort((a, b) => b.priority - a.priority);
        if (activeProviders.length === 0) return [];

        const promises = activeProviders.map(provider =>
            this.searchWithProvider(provider, query, type).catch(() => [])
        );
        const resultsArrays = await Promise.all(promises);
        return resultsArrays.flat();
    }

    private async searchWithProvider(provider: any, query: string, type: 'movie' | 'series'): Promise<TorrentResult[]> {
        try {
            const pageLinks = await this.scrapeProviderLinks(provider, query);
            if (!pageLinks.length) return [];

            // Paraleliza extração de magnets (até 3 páginas)
            const maxPages = Math.min(pageLinks.length, 3);
            const magnetPromises = pageLinks.slice(0, maxPages).map(async (link: any) => {
                try {
                    const magnet = await this.extractMagnetFromPage(link.pageUrl, provider.timeout);
                    return magnet ? { ...link, magnet } : null;
                } catch {
                    return null;
                }
            });
            const results = (await Promise.all(magnetPromises)).filter(Boolean);
            return results.map(item => this.mapProviderResult(item, provider.name, type))
                .filter((r: TorrentResult | null): r is TorrentResult => r !== null);
        } catch {
            return [];
        }
    }

    private async scrapeProviderLinks(provider: any, query: string): Promise<any[]> {
        try {
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodedQuery}`;
            const response = await axios.get(searchUrl, {
                timeout: provider.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                }
            });
            const $ = cheerio.load(response.data);
            const links: any[] = [];

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
            } else {
                const itemSelectors = provider.itemSelector?.split(',').map((s: string) => s.trim()) || ['article', '.post', '.item'];
                const titleSelectors = provider.titleSelector?.split(',').map((s: string) => s.trim()) || ['h2 a', 'h3 a', '.title a'];
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
                    if (links.length > 0) break;
                }
            }
            return links;
        } catch {
            return [];
        }
    }

    private async extractMagnetFromPage(pageUrl: string, timeout: number): Promise<string | null> {
        try {
            const response = await axios.get(pageUrl, {
                timeout,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
            });
            const $ = cheerio.load(response.data);
            const directMagnet = $('a[href^="magnet:"]').attr('href');
            if (directMagnet) return directMagnet;

            const match = response.data.match(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"\s]*/);
            return match ? match[0] : null;
        } catch {
            return null;
        }
    }

    // Mapeamentos (mantidos sem logs)
    private mapTorrentIndexerResult(r: any, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.title || !r.magnet_link) return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality)) return null;
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

    private mapRargbResult(r: { title: string; magnet: string; seeders: number; leechers: number; size: string; infoHash: string }, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.title || !r.magnet) return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality)) return null;
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
    private mapHdrResult(r: { title: string; magnet: string; infoHash: string; seeders: number; size: string }, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.title || !r.magnet) return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality)) return null;
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
    private mapStarckResult(r: { magnet: string; infoHash: string }, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.magnet) return null;
        // Usa o proprio magnet como titulo — catalogProvider extrai o nome real via parse-torrent
        const quality = this.qualityDetector.extractQualityFromFilename(r.magnet);
        if (!this.qualityDetector.isValidQuality(quality)) return null;
        const season = this.extractSeasonNumber(r.magnet);
        return {
            title: r.magnet, // catalogProvider substitui pelo canonicalName do parse-torrent
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

    private mapTpbResult(r: { title: string; magnet: string; seeders: number; leechers: number; infoHash: string }, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.title || !r.magnet) return null;
        const quality = this.qualityDetector.extractQualityFromFilename(r.title);
        if (!this.qualityDetector.isValidQuality(quality)) return null;
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

    private mapProviderResult(item: any, providerName: string, type: 'movie' | 'series'): TorrentResult | null {
        if (!item.title || !item.magnet) return null;
        const quality = this.qualityDetector.extractQualityFromFilename(item.title);
        if (!this.qualityDetector.isValidQuality(quality)) return null;
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

    // Helpers (idênticos, mas sem logs)
    private filterResultsBySeason(results: TorrentResult[], targetSeason?: number, type?: 'movie' | 'series'): TorrentResult[] {
        if (targetSeason === undefined || type !== 'series') return results;
        return results.filter(r => {
            if (r.season !== undefined) return r.season === targetSeason;
            const detected = this.extractSeasonNumber(r.title);
            if (detected !== null) return detected === targetSeason;
            const isPack = /complete|pack|temporada completa|season pack/i.test(r.title);
            return isPack;
        });
    }

    private removeDuplicateResults(results: TorrentResult[]): TorrentResult[] {
        const seen = new Set<string>();
        return results.filter(r => {
            if (seen.has(r.magnet)) return false;
            seen.add(r.magnet);
            return true;
        });
    }

    private calculateRelevanceScore(title: string, season?: number | null, language?: string): number {
        let score = 70;
        const t = title.toLowerCase();
        if (language && /pt|dual/i.test(language)) score += 25;
        if (/1080p|2160p|4k/i.test(t)) score += 15;
        else if (/720p|hd/i.test(t)) score += 10;
        if (/480p|sd/i.test(t)) score -= 15;
        if (/web-dl|bluray|remux/i.test(t)) score += 10;
        return Math.max(0, Math.min(100, score));
    }

    private extractSeasonNumber(text: string): number | null {
        return this.episodeMatcher.extractSeasonFromTitle(text);
    }

    private prepareSearchQuery(query: string, type: 'movie' | 'series', targetSeason?: number): string {
        if (type === 'series' && targetSeason !== undefined && !/temporada|season|s\d+/i.test(query)) {
            return `${query} s${targetSeason.toString().padStart(2, '0')}`;
        }
        return this.cleanQuery(query);
    }

    private cleanQuery(query: string): string {
        return query.replace(/[^\w\s\-.:]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    private cleanTitle(title: string): string {
        if (title.length > 100) {
            const lines = title.split(/(?=[A-ZÀ-Ú])/);
            const validLine = lines.find(l => l.trim().length > 10);
            if (validLine) title = validLine.trim();
        }
        return title.replace(/\s+/g, ' ').replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '').trim();
    }

    private extractLanguage(title: string): string {
        const t = title.toLowerCase();
        if (t.includes('dual') && t.includes('audio')) return 'pt-BR,en';
        if (/dublado|dublada|dublagem/.test(t)) return 'pt-BR';
        if (/legendado|legendada|legenda/.test(t)) return 'pt';
        if (/português|portugues|pt-br|ptbr/.test(t)) return 'pt-BR';
        if (/brazilian|brasil/.test(t)) return 'pt-BR';
        if (/multi|multilanguage/.test(t)) return 'multi';
        if (/english|ingles|\(eng\)/.test(t)) return 'en';
        return 'desconhecido';
    }

    private calculateSizeInBytes(sizeStr: string): number {
        if (!sizeStr || sizeStr === 'Tamanho não especificado') return 1.5 * 1024 ** 3;
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match) return 1.5 * 1024 ** 3;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G') return value * 1024 ** 3;
        if (unit === 'MB' || unit === 'M') return value * 1024 ** 2;
        return 1.5 * 1024 ** 3;
    }

    private estimateSeeders(provider: string, quality: string): number {
        const base: Record<string, number> = { 'TorrentIndexer': 70, 'BLUDV Filmes': 80, 'default': 35 };
        const mult: Record<string, number> = { '2160p': 1.5, '1080p': 1.3, '720p': 1.0, 'HD': 1.1, 'desconhecido': 0.8, '480p': 0.6 };
        return Math.round((base[provider] || base['default']) * (mult[quality] || 0.8));
    }

    getStats() {
        return {
            versao: this.version,
            provedoresAtivos: (torrentIndexerConfig.enabled ? 1 : 0) + 1 // Indexer + WP API
        };
    }
}