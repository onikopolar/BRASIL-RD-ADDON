import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { ImdbScraperService } from '../../catalogo/ImdbScraperService.js';
import { WordPressScraper } from './wordpressScraper.js';
import { BludvScraper } from './bludvScraper.js';
import { searchStarck } from './starckScraper.js';
import { searchHdr } from './hdrScraper.js';
import { EpisodeMatcher } from '../../titulos/episodeMatcher.js';

const logger = new Logger('TorrentScraperService');

export class TorrentScraperService {
    private readonly qualityDetector: QualityDetector;
    private readonly tmdbScraper: ImdbScraperService;
    private readonly wpScraper: WordPressScraper;
    private readonly bludvScraper: BludvScraper;
    private readonly episodeMatcher = EpisodeMatcher.getInstance();
    private readonly version = '6.2.0'; // WP API scraper integrado

    constructor(tmdbScraper?: ImdbScraperService) {
        this.qualityDetector = QualityDetector.getInstance();
        this.tmdbScraper = tmdbScraper || ImdbScraperService.getInstance();
        this.wpScraper = new WordPressScraper();
        this.bludvScraper = new BludvScraper();
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
                if (tmdbData) {
                    const isLatin = (t: string) => /^[a-z0-9\s\-\.']+$/i.test(t);
                    if (tmdbData.originalTitle && !isLatin(tmdbData.originalTitle)) tmdbData.originalTitle = '';
                    if (tmdbData.portugueseTitleRaw && !isLatin(tmdbData.portugueseTitleRaw)) tmdbData.portugueseTitleRaw = '';
                    if (tmdbData.portugueseTitle && !isLatin(tmdbData.portugueseTitle)) tmdbData.portugueseTitle = '';
                }
            }

            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);

            const qEn = tmdbData?.originalTitle || searchQueries[0] || query;
            const qPt = tmdbData?.portugueseTitleRaw || tmdbData?.portugueseTitle || query;
            const ptDiferente = qPt !== qEn;

            const [wpResults, starckResults, hdrResults] = await Promise.all([
                // WordPress + Bludv (Comando e Starck via WP API não funciona — Starck retorna vazio)
                Promise.all([
                    this.bludvScraper.search(qEn, type).catch(() => []),
                    this.bludvScraper.search(qPt, type).catch(() => []),
                    this.wpScraper.search(qEn, type).catch(() => []),
                    ptDiferente ? this.wpScraper.search(qPt, type).catch(() => []) : Promise.resolve([])
                ]).then(([bludvEn, bludvPt, wpEn, wpPt]) => {
                    const seen = new Set<string>();
                    return [...bludvEn, ...bludvPt, ...wpEn, ...wpPt].filter(t => {
                        if (seen.has(t.magnet)) return false;
                        seen.add(t.magnet);
                        return true;
                    });
                }).catch(() => []),

                // Starck (scraper dedicado — WP API não funciona pra Starck)
                Promise.all([
                    searchStarck(qEn, type),
                    ptDiferente ? searchStarck(qPt, type) : Promise.resolve([])
                ]).then(([en, pt]) => {
                    const seen = new Set<string>();
                    return [...en, ...pt]
                        .filter(t => { if (seen.has(t.infoHash)) return false; seen.add(t.infoHash); return true; })
                        .map(r => this.mapStarckResult(r, type))
                        .filter((r): r is TorrentResult => r !== null);
                }).catch(() => []),

                // HDR
                Promise.all([
                    searchHdr(qEn, type),
                    ptDiferente ? searchHdr(qPt, type) : Promise.resolve([]),
                    // HDR usa "1ª Temporada" em vez de "Temporada 1" — tenta formato ordinal
                    // HDR search é case-sensitive, capitaliza primeira letra
                    targetSeason ? searchHdr(`${query.replace(/\s+Temporada\s+\d+$/i, '').replace(/\b\w/g, (c: string) => c.toUpperCase())} ${targetSeason}ª Temporada`, type) : Promise.resolve([]),
                ]).then(([en, pt, ord]) => {
                    const seen = new Set<string>();
                    return [...en, ...pt, ...ord]
                        .filter(t => { if (seen.has(t.infoHash)) return false; seen.add(t.infoHash); return true; })
                        .map(r => this.mapHdrResult(r, type))
                        .filter((r): r is TorrentResult => r !== null);
                }).catch(() => [])
            ]);

            const allResults = [...wpResults, ...starckResults, ...hdrResults];

            const duration = Date.now() - startTime;
            if (duration > 5000) {
                logger.warn('Coleta de torrents lenta', {
                    tempo: `${duration}ms`,
                    resultados: allResults.length,
                    queries: searchQueries.length
                });
            }

            return allResults;
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
            // PT primeiro (último do array), depois EN — prioriza busca em português
            // Filtra títulos não-latinos (coreano, japonês etc) — inúteis em scrapers BR
            const titlesReverse = [...tmdbData.allTitles]
              .filter((t: string) => /^[a-z0-9\s\-\.]+$/i.test(t))
              .reverse();
            for (const title of titlesReverse) {
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
            queries.push(query);
            if (targetYear) queries.push(`${query} ${targetYear}`);
        }
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }

    // ═══════════════════════════════════════════════════════════
    //  MAPEAMENTOS (simplificados — qualidade/idioma delegados ao pipeline)
    // ═══════════════════════════════════════════════════════════

    private mapHdrResult(r: { title: string; magnet: string; infoHash: string; seeders: number; size: string; language: string; originalTitle?: string; year?: number }, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.magnet) return null;
        // Usa o nome real do magnet (dn=) como título — tem season, idioma e qualidade
        const dnMatch = r.magnet.match(/dn=([^&]+)/i);
        const magnetName = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : r.title;
        const quality = this.qualityDetector.extractQualityFromFilename(magnetName);
        const season = this.episodeMatcher.extractSeasonFromTitle(magnetName);
        const language = r.language ? this.mapHdrLanguage(r.language) : 'desconhecido';
        return {
            title: magnetName,
            magnet: r.magnet,
            seeders: r.seeders,
            leechers: 0,
            size: r.size || 'N/A',
            quality: quality || 'HD',
            provider: 'HDR Torrent',
            language,
            type,
            relevanceScore: 0,
            sizeInBytes: this.calculateSizeInBytes(r.size),
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.70,
            originalTitle: r.originalTitle,
            year: r.year,
        };
    }

    private mapStarckResult(r: { magnet: string; infoHash: string; originalTitle?: string; year?: number }, type: 'movie' | 'series'): TorrentResult | null {
        if (!r.magnet) return null;
        const dnMatch = r.magnet.match(/dn=([^&]+)/i);
        const displayName = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : r.magnet;
        const quality = this.qualityDetector.extractQualityFromFilename(displayName);
        const season = this.episodeMatcher.extractSeasonFromTitle(displayName);
        return {
            title: r.magnet,
            magnet: r.magnet,
            seeders: 0,
            leechers: 0,
            size: 'N/A',
            quality: quality || 'HD',
            provider: 'Starck',
            language: 'desconhecido',
            type,
            relevanceScore: 0,
            sizeInBytes: 0,
            season: season ?? undefined,
            lastUpdated: new Date(),
            confidence: 0.70,
            originalTitle: r.originalTitle,
            year: r.year,
        };
    }

    private mapHdrLanguage(label: string): string {
        switch (label) {
            case 'Dual Áudio': return 'Dual Áudio';
            case 'Dublado': return 'Dublado';
            case 'Legendado': return 'Legendado';
            case 'Nacional': return 'Nacional';
            default: return 'desconhecido';
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════

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

    getStats() {
        return {
            versao: this.version,
            provedoresAtivos: 3 // Bludv, WP (Comando + Starck), HDR
        };
    }
}