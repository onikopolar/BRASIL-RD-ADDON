import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { ImdbScraperService } from '../../catalogo/ImdbScraperService.js';
import { WordPressScraper } from './wordpressScraper.js';
import { BludvScraper } from './bludvScraper.js';
import { searchStarck } from './starckScraper.js';
import { searchHdr } from './hdrScraper.js';
import { extrairRangeEpisodios } from '../../titulos/TechnicalWords.js';

const logger = new Logger('TorrentScraperService');

interface CommonTorrentParams {
  title: string;
  magnet: string;
  seeders: number;
  leechers?: number;
  size: string;
  quality: string;
  provider: string;
  language: string;
  type: 'movie' | 'series';
  season?: number;
  episode?: number;
  originalTitle?: string;
  year?: number;
  canonicalName?: string;
  confidence?: number;
  relevanceScore?: number;
  sizeInBytes?: number;
}

export class TorrentScraperService {
  private readonly qualityDetector: QualityDetector;
  private readonly tmdbScraper: ImdbScraperService;
  private readonly wpScraper: WordPressScraper;
  private readonly bludvScraper: BludvScraper;
  private readonly version = '6.5.4';

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
      }

      const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);

      logger.debug(`🔍 Buscando torrents para: "${query}" | alvo S${targetSeason ?? '?'}E${'?'} | imdbId: ${imdbId ?? 'N/A'}`);
      logger.debug(`🔍 Queries geradas: ${searchQueries.length}`, {
        queries: searchQueries.slice(0, 10),
        total: searchQueries.length,
      });

      const [wpResults, starckResults, hdrResults] = await Promise.all([
        Promise.all([
          this.bludvScraper.search(query, type, targetSeason, searchQueries).catch(() => []),
          this.wpScraper.search(query, type, targetSeason, searchQueries).catch(() => []),
        ]).then(([bludvResultados, wpResultados]) => {
          const seen = new Set<string>();
          const combined = [...bludvResultados, ...wpResultados];

          logger.debug(`📊 BLUDV: ${bludvResultados.length} | WP: ${wpResultados.length} | total bruto: ${combined.length}`);

          if (combined.length > 0) {
            const sample = combined.slice(0, 3);
            for (const t of sample) {
              logger.debug(`📄 Amostra: "${t.title?.substring(0, 50)}" | htmlTitle: "${(t.htmlTitle || '').substring(0, 30)}" | episode: ${t.episode ?? 'N/A'} | provider: ${t.provider}`);
            }
          }

          return combined.filter(t => {
            if (seen.has(t.magnet)) return false;
            seen.add(t.magnet);
            return true;
          });
        }).catch(() => []),

        searchStarck(query, type, targetSeason, searchQueries)
          .then(results => {
            const seen = new Set<string>();
            logger.debug(`📊 Starck: ${results.length} resultados brutos`);
            return results
              .filter(t => { if (seen.has(t.infoHash)) return false; seen.add(t.infoHash); return true; })
              .map(r => {
                logger.debug('STARCK_RESULT_BRUTO', {
                  magnetInicio: r.magnet?.substring(0, 80),
                  canonicalName: r.canonicalName,
                  episode: r.episode,
                  season: r.season,
                  qualityHint: r.qualityHint,
                  originalTitle: r.originalTitle,
                  year: r.year,
                });
                return this.mapStarckResult(r, type);
              })
              .filter((r): r is TorrentResult => r !== null);
          })
          .catch(() => []),

        searchHdr(query, type, targetSeason, searchQueries)
          .then(results => {
            const seen = new Set<string>();
            logger.debug(`📊 HDR: ${results.length} resultados brutos`);
            return results
              .filter(t => { if (seen.has(t.infoHash)) return false; seen.add(t.infoHash); return true; })
              .map(r => this.mapHdrResult(r, type))
              .filter((r): r is TorrentResult => r !== null);
          })
          .catch(() => []),
      ]);

      const allResults = [...wpResults, ...starckResults, ...hdrResults];

      logger.debug(`📊 Total consolidado: ${allResults.length} torrents (WP+BLUDV: ${wpResults.length}, Starck: ${starckResults.length}, HDR: ${hdrResults.length})`);

      const comHtmlTitle = allResults.filter(t => t.htmlTitle).length;
      const comEpisode = allResults.filter(t => t.episode !== undefined).length;
      logger.debug(`📊 htmlTitle presente em ${comHtmlTitle}/${allResults.length} | episode presente em ${comEpisode}/${allResults.length}`);

      const duration = Date.now() - startTime;
      if (duration > 5000) {
        logger.warn('Coleta de torrents lenta', {
          tempo: `${duration}ms`,
          resultados: allResults.length,
          queries: searchQueries.length,
        });
      }

      return allResults;
    } catch (error) {
      logger.error('Erro na coleta de torrents', {
        erro: error instanceof Error ? error.message : 'Erro desconhecido',
        tempo: `${Date.now() - startTime}ms`,
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

    // ============ SÉRIES ============
    if (type === 'series' && targetSeason !== undefined && tmdbData?.allTitles?.length > 0) {
      const titulosUnicos: string[] = [];

      for (const titulo of tmdbData.allTitles) {
        if (titulo && !titulosUnicos.some(t => t.toLowerCase() === titulo.toLowerCase())) {
          titulosUnicos.push(titulo);
        }
      }

      if (titulosUnicos.length < 2) {
        for (const titulo of [tmdbData.portugueseTitle, tmdbData.portugueseTitleRaw]) {
          if (titulo && !titulosUnicos.some(t => t.toLowerCase() === titulo.toLowerCase())) {
            titulosUnicos.push(titulo);
            if (titulosUnicos.length >= 2) break;
          }
        }
      }

      if (titulosUnicos.length === 0) {
        titulosUnicos.push(query);
      }

      const titulosSelecionados = titulosUnicos.slice(0, 2);

      for (const titulo of titulosSelecionados) {
        queries.push(`${titulo} ${targetSeason}ª temporada`);
      }

      if (queries.length === 0) {
        queries.push(`${query} ${targetSeason}ª temporada`);
      }

      return queries;
    }

    // ============ FILMES ============
    if (tmdbData?.originalTitle) {
      const yearToUse = targetYear || tmdbData.year;

      // Prioriza original e português, únicos, máximo 2
      const titulosBase = [
        tmdbData.originalTitle,
        tmdbData.portugueseTitle,
        ...(tmdbData.allTitles || [])
      ];

      const titulosUnicos = titulosBase
        .filter((t): t is string => !!t && t.trim().length > 3)
        .map(t => t.trim())
        .filter((t, i, arr) => arr.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i)
        .slice(0, 2);

      // 1º: sem ano (original + português)
      for (const titulo of titulosUnicos) {
        queries.push(titulo);
      }

      // 2º: com ano (original + português) — fallback
      for (const titulo of titulosUnicos) {
        if (yearToUse) {
          queries.push(`${titulo} ${yearToUse}`);
        }
      }
    }

    // Fallback final
    if (queries.length === 0) {
      queries.push(query);
      if (targetYear) {
        queries.push(`${query} ${targetYear}`);
      }
    }

    // Remove duplicatas e vazias
    return [...new Set(queries.filter(q => q && q.trim().length > 3))];
  }

  private buildTorrentResult(params: CommonTorrentParams): TorrentResult {
    return {
      title: params.title,
      magnet: params.magnet,
      seeders: params.seeders,
      leechers: params.leechers ?? 0,
      size: params.size,
      quality: params.quality,
      provider: params.provider,
      language: params.language,
      type: params.type,
      relevanceScore: params.relevanceScore ?? 0,
      sizeInBytes: params.sizeInBytes ?? 0,
      season: params.season,
      episode: params.episode,
      lastUpdated: new Date(),
      confidence: params.confidence ?? 0.7,
      originalTitle: params.originalTitle,
      year: params.year,
      canonicalName: params.canonicalName,
    };
  }

  private extractDnFromMagnet(magnet: string): string {
    const dnMatch = magnet.match(/dn=([^&]+)/i);
    return dnMatch ? decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')) : magnet;
  }

  private mapHdrResult(
    r: {
      title: string;
      magnet: string;
      infoHash: string;
      seeders: number;
      size: string;
      language: string;
      originalTitle?: string;
      year?: number;
      canonicalName?: string;
      season?: number;
      episode?: number;
    },
    type: 'movie' | 'series'
  ): TorrentResult | null {
    if (!r.magnet) return null;

    const magnetName = r.canonicalName || this.extractDnFromMagnet(r.magnet) || r.title;
    const quality = this.qualityDetector.extractQualityFromFilename(magnetName);
    const range = extrairRangeEpisodios(magnetName);
    const season = r.season ?? range?.season ?? undefined;
    const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);
    const language = r.language ? this.mapHdrLanguage(r.language) : 'desconhecido';

    return this.buildTorrentResult({
      title: magnetName,
      magnet: r.magnet,
      seeders: r.seeders,
      leechers: 0,
      size: r.size || 'N/A',
      quality: quality || 'HD',
      provider: 'HDR Torrent',
      language,
      type,
      season,
      episode,
      originalTitle: r.originalTitle,
      year: r.year,
      canonicalName: magnetName,
      confidence: 0.70,
      relevanceScore: 0,
      sizeInBytes: this.calculateSizeInBytes(r.size),
    });
  }

  private mapStarckResult(
    r: {
      magnet: string;
      infoHash: string;
      originalTitle?: string;
      year?: number;
      canonicalName?: string;
      language?: string;
      qualityHint?: string;
      season?: number;
      episode?: number;
    },
    type: 'movie' | 'series'
  ): TorrentResult | null {
    if (!r.magnet) return null;

    const dnDoMagnet = this.extractDnFromMagnet(r.magnet);
    const temDn = dnDoMagnet !== r.magnet;
    const displayName = r.canonicalName || (temDn ? dnDoMagnet : undefined);

    let quality = this.qualityDetector.extractQualityFromFilename(displayName || '');
    if (quality === 'HD' && r.qualityHint) {
      const hintQuality = this.qualityDetector.extractQualityFromFilename(r.qualityHint);
      if (hintQuality !== 'HD') quality = hintQuality;
    }

    const range = displayName ? extrairRangeEpisodios(displayName) : null;
    const season = r.season ?? range?.season ?? undefined;
    const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);

    const titleFinal = r.canonicalName || r.originalTitle || displayName || 'Starck Torrent';

    return this.buildTorrentResult({
      title: titleFinal,
      magnet: r.magnet,
      seeders: 0,
      leechers: 0,
      size: 'N/A',
      quality: quality || 'HD',
      provider: 'Starck',
      language: r.language || 'desconhecido',
      type,
      season,
      episode,
      originalTitle: r.originalTitle,
      year: r.year,
      canonicalName: r.canonicalName || (temDn ? dnDoMagnet : undefined),
      confidence: 0.70,
      relevanceScore: 0,
    });
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
      provedoresAtivos: 3,
    };
  }
}