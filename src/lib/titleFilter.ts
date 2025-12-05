import { Logger } from '../utils/logger';
import { ImdbScraperService, ImdbTitles } from '../services/ImdbScraperService';

import {
  TitleCleaner,
  LanguageDetector,
  SimilarityCalculator,
  MetadataExtractor,
  CacheManager,
  SeriesMetadata,
  TitleMatchResult,
  SeriesConfusion,
  SmartTitleMatch,
  DeduplicationCacheEntry,
  ImdbTitleCacheEntry
} from './title-filter';

export class TitleFilter {
  private readonly logger: Logger;
  private imdbScraper: ImdbScraperService;
  
  private readonly titleCleaner: TitleCleaner;
  private readonly languageDetector: LanguageDetector;
  private readonly similarityCalculator: SimilarityCalculator;
  private readonly metadataExtractor: MetadataExtractor;
  private readonly cacheManager: CacheManager;
  
  private readonly IMDB_CACHE_TTL = 30 * 60 * 1000;
  private readonly DEDUP_CACHE_TTL = 10 * 60 * 1000;
  private readonly TITLE_CACHE_TTL = 5 * 60 * 1000;

  constructor() {
    this.logger = new Logger('TitleFilter');
    this.logger.info('TitleFilter v2.0 inicializado');
    this.imdbScraper = new ImdbScraperService();
    
    this.titleCleaner = new TitleCleaner();
    this.languageDetector = new LanguageDetector();
    this.similarityCalculator = new SimilarityCalculator(undefined, true);
    this.metadataExtractor = new MetadataExtractor();
    this.cacheManager = new CacheManager();
  }

  private cleanupOldCaches(): void {
    this.cacheManager.cleanupOldCaches(this.IMDB_CACHE_TTL, this.DEDUP_CACHE_TTL, this.TITLE_CACHE_TTL);
  }

  private extractInfoHash(source: string | any): string | null {
    if (typeof source === 'string') {
      const magnetMatch = source.match(/btih:([a-zA-Z0-9]{40})/i);
      return magnetMatch ? magnetMatch[1].toLowerCase() : null;
    } else if (source && typeof source === 'object') {
      if (source.infoHash) {
        return source.infoHash.toLowerCase();
      }
      if (source.magnet && typeof source.magnet === 'string') {
        const magnetMatch = source.magnet.match(/btih:([a-zA-Z0-9]{40})/i);
        return magnetMatch ? magnetMatch[1].toLowerCase() : null;
      }
    }
    return null;
  }

  private createDedupeKey(torrentTitle: string, infoHash?: string): string {
    const cleanTitle = this.extractCleanTitle(torrentTitle).toLowerCase().replace(/\s+/g, '_');
    return infoHash ? `${infoHash}:${cleanTitle}` : cleanTitle;
  }

  private isAlreadyProcessed(torrent: any): boolean {
    const infoHash = this.extractInfoHash(torrent.magnet || torrent);
    const title = torrent.title || torrent;
    const dedupeKey = this.createDedupeKey(title, infoHash || undefined);
    
    if (Math.random() < 0.01) {
      this.cleanupOldCaches();
    }
    
    if (this.cacheManager.isAlreadyProcessed(dedupeKey)) {
      return true;
    }
    
    this.cacheManager.markAsProcessed(dedupeKey);
    return false;
  }

  deduplicateTorrents(torrents: any[]): any[] {
    if (torrents.length <= 1) return torrents;
    
    const seen = new Set<string>();
    const uniqueTorrents: any[] = [];
    let duplicatesRemoved = 0;
    
    for (const torrent of torrents) {
      const infoHash = this.extractInfoHash(torrent.magnet || torrent);
      const title = torrent.title || 'unknown';
      
      let key: string;
      if (infoHash) {
        key = infoHash;
      } else {
        const cleanTitle = this.extractCleanTitle(title).toLowerCase();
        key = cleanTitle;
      }
      
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      
      seen.add(key);
      uniqueTorrents.push(torrent);
    }
    
    if (duplicatesRemoved > 0) {
      this.logger.info('Deduplicação concluída', {
        totalAntes: torrents.length,
        totalDepois: uniqueTorrents.length,
        duplicatasRemovidas: duplicatesRemoved
      });
    }
    
    return uniqueTorrents;
  }

  isPortugueseContent(torrentTitle: string): boolean {
    return this.languageDetector.isPortugueseContent(torrentTitle);
  }

  normalizeForComparison(title: string): string {
    return this.titleCleaner.normalizeForComparison(title);
  }

  extractCleanTitle(fullTitle: string): string {
    return this.titleCleaner.extractCleanTitle(fullTitle);
  }

  extractSeriesMetadata(torrentTitle: string): SeriesMetadata {
    return this.metadataExtractor.extractSeriesMetadata(torrentTitle);
  }

  private extractTorrentYear(torrentTitle: string): number | undefined {
    const yearMatch = torrentTitle.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      return parseInt(yearMatch[0]);
    }
    return undefined;
  }

  private async getImdbTitlesWithCache(imdbId: string): Promise<ImdbTitles | null> {
    const cachedEntry = this.cacheManager.getImdbTitlesFromCache(imdbId);
    if (cachedEntry) {
      return cachedEntry.titles;
    }
    
    try {
      const titles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
      if (titles.allTitles.length > 0) {
        this.cacheManager.saveImdbTitlesToCache(imdbId, titles);
        return titles;
      } else {
        this.logger.warn('Nenhum título encontrado no IMDB', { imdbId });
      }
    } catch (error) {
      this.logger.error('Erro ao obter títulos do IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
    
    return null;
  }

  private async smartTitleContainsCheck(
    torrentTitle: string, 
    imdbId: string,
    torrentMetadata?: { year?: number }
  ): Promise<SmartTitleMatch> {
    const torrentYear = torrentMetadata?.year || this.extractTorrentYear(torrentTitle);
    
    return await this.similarityCalculator.smartTitleContainsCheck(
      torrentTitle,
      imdbId,
      { year: torrentYear }
    );
  }

  async doTitlesMatch(
    torrentTitle: string,
    imdbId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<TitleMatchResult> {
    try {
      // 1. Verificação de português
      const isPortuguese = this.isPortugueseContent(torrentTitle);
      
      if (!isPortuguese) {
        const metadata = this.extractSeriesMetadata(torrentTitle);
        this.logger.warn('Conteúdo rejeitado - não está em português', {
          torrentTitle: torrentTitle.substring(0, 80)
        });
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadata,
          reason: 'Conteúdo não está em português'
        };
      }

      // 2. Obtém títulos do IMDB
      const imdbTitles = await this.getImdbTitlesWithCache(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const metadata = this.extractSeriesMetadata(torrentTitle);
        this.logger.warn('Nenhum título encontrado no IMDB', {
          imdbId,
          torrentTitle: torrentTitle.substring(0, 80)
        });
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadata,
          reason: `Nenhum título encontrado no IMDB para ${imdbId}`
        };
      }

      // 3. Validação de série
      const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
      const torrentYear = this.extractTorrentYear(torrentTitle);
      
      // Validação de ano
      if (imdbTitles.year && torrentYear) {
        const yearDifference = Math.abs(imdbTitles.year - torrentYear);
        if (yearDifference > 2) {
          this.logger.warn('ANOS DIFERENTES! Possível filme diferente', {
            requestedYear: imdbTitles.year,
            torrentYear,
            difference: yearDifference
          });
          
          return {
            matches: false,
            similarity: 0.3,
            torrentMetadata,
            reason: `Possível filme diferente: Ano solicitado ${imdbTitles.year} ≠ Ano do torrent ${torrentYear}`
          };
        }
      }

      // Validação de episódios/temporadas
      if (targetSeason !== undefined) {
        // Verificar temporada
        if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
          this.logger.warn('Temporada diferente', {
            torrentTitle: torrentTitle.substring(0, 80),
            torrentSeason: torrentMetadata.season,
            targetSeason
          });
          return {
            matches: false,
            similarity: 0,
            torrentMetadata,
            reason: `Temporada diferente: Torrent S${torrentMetadata.season} vs S${targetSeason}`
          };
        }
        
        // Verificar episódio se buscando específico
        if (targetEpisode !== undefined) {
          if (torrentMetadata.episode && torrentMetadata.episode !== targetEpisode) {
            this.logger.warn('Episódio diferente', {
              torrentTitle: torrentTitle.substring(0, 80),
              torrentEpisode: torrentMetadata.episode,
              targetEpisode
            });
            return {
              matches: false,
              similarity: 0,
              torrentMetadata,
              reason: `Episódio diferente: Torrent E${torrentMetadata.episode} vs E${targetEpisode}`
            };
          }
          
          // Se torrent não especifica episódio, verificar se é package
          if (!torrentMetadata.episode && !torrentMetadata.isCompleteSeason) {
            const isPackage = this.metadataExtractor.isPackageTitle(torrentTitle.toLowerCase());
            if (!isPackage) {
              this.logger.warn('Torrent não especifica episódio', {
                torrentTitle: torrentTitle.substring(0, 80),
                targetEpisode
              });
              return {
                matches: false,
                similarity: 0,
                torrentMetadata,
                reason: 'Busca episódio específico mas torrent não especifica episódio'
              };
            }
          }
        }
      }

      // 4. Usa SimilarityCalculator com IMDB ID
      const smartMatch = await this.smartTitleContainsCheck(
        torrentTitle,
        imdbId,
        { year: torrentYear }
      );

      // 5. Resultado final
      const result = {
        matches: smartMatch.matches,
        matchedTitle: imdbTitles.portugueseTitle || imdbTitles.originalTitle,
        matchedLanguage: imdbTitles.portugueseTitle ? 'português' as const : 'original' as const,
        similarity: smartMatch.similarity,
        torrentMetadata,
        reason: smartMatch.reason
      };

      return result;

    } catch (error) {
      this.logger.error('Erro ao comparar títulos', {
        torrentTitle,
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      return {
        matches: false,
        similarity: 0,
        torrentMetadata: this.extractSeriesMetadata(torrentTitle),
        reason: `Erro ao processar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  doTitlesMatchSync(
    torrentTitle: string,
    imdbTitle: string,
    targetSeason?: number,
    targetEpisode?: number
  ): boolean {
    if (!this.isPortugueseContent(torrentTitle)) {
      return false;
    }

    const smartMatch = this.similarityCalculator.smartTitleContainsCheckSync(torrentTitle, imdbTitle);
    const baseThreshold = 0.4;
    const confusionCheck = this.similarityCalculator.detectConfusingSeries(torrentTitle, imdbTitle);
    const adjustedThreshold = confusionCheck.isConfusing ? 
      Math.max(baseThreshold, confusionCheck.minSimilarity) : 
      baseThreshold;

    if (smartMatch.matches && smartMatch.similarity >= adjustedThreshold) {
      if (targetSeason !== undefined) {
        const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
        
        if (torrentMetadata.hasEpisodeInfo) {
          if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
            return false;
          }
          
          if (targetEpisode !== undefined && torrentMetadata.episode) {
            if (torrentMetadata.episode !== targetEpisode) {
              return false;
            }
          }
        }
      }
      
      return true;
    }

    return false;
  }

  async applyTitleFilter(
    torrents: any[],
    imdbId: string,
    requestId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<any[]> {
    const startTime = Date.now();
    
    this.logger.info('Aplicando filtro de título', {
      requestId,
      imdbId,
      targetSeason,
      targetEpisode,
      totalTorrents: torrents.length
    });

    // 1. Deduplicação
    const uniqueTorrents = this.deduplicateTorrents(torrents);
    
    const results = {
      included: [] as any[],
      excluded: [] as any[],
      reasons: [] as string[],
      duplicatesRemoved: torrents.length - uniqueTorrents.length
    };

    // 2. Filtro de português COM CACHE DE PROCESSAMENTO
    const portugueseTorrents = uniqueTorrents.filter(torrent => {
      if (this.isAlreadyProcessed(torrent)) {
        results.excluded.push(torrent);
        return false;
      }

      const isPortuguese = this.isPortugueseContent(torrent.title);
      if (!isPortuguese) {
        results.excluded.push(torrent);
      }
      return isPortuguese;
    });

    if (portugueseTorrents.length === 0) {
      this.logger.warn('Nenhum torrent em português encontrado', {
        requestId,
        imdbId,
        totalTorrents: uniqueTorrents.length
      });
      return [];
    }

    // 3. Obtém títulos do IMDB
    let imdbTitles: ImdbTitles | null;
    try {
      imdbTitles = await this.getImdbTitlesWithCache(imdbId);
      if (!imdbTitles) {
        this.logger.error('Não foi possível obter títulos do IMDB', { imdbId });
        return [];
      }
    } catch (error) {
      this.logger.error('Erro ao obter títulos do IMDB', {
        requestId,
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return [];
    }

    // 4. Processa cada torrent
    for (const torrent of portugueseTorrents) {
      const torrentMetadata = this.extractSeriesMetadata(torrent.title);
      const torrentYear = this.extractTorrentYear(torrent.title);
      
      // Validação de ano
      let yearCheckPassed = true;
      if (imdbTitles.year && torrentYear) {
        const yearDifference = Math.abs(imdbTitles.year - torrentYear);
        if (yearDifference > 2) {
          yearCheckPassed = false;
          
          this.logger.debug('Torrent rejeitado por ano diferente', {
            torrentTitle: torrent.title.substring(0, 60),
            requestedYear: imdbTitles.year,
            torrentYear,
            difference: yearDifference
          });
        }
      }

      if (!yearCheckPassed) {
        results.excluded.push(torrent);
        continue;
      }

      // Validação de temporada/episódio
      if (targetSeason !== undefined) {
        if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
          results.excluded.push(torrent);
          continue;
        }
        
        if (targetEpisode !== undefined) {
          if (torrentMetadata.episode && torrentMetadata.episode !== targetEpisode) {
            results.excluded.push(torrent);
            continue;
          }
          
          // Se não tem episódio, verificar se é package
          if (!torrentMetadata.episode && !torrentMetadata.isCompleteSeason) {
            const isPackage = this.metadataExtractor.isPackageTitle(torrent.title.toLowerCase());
            if (!isPackage) {
              results.excluded.push(torrent);
              continue;
            }
          }
        }
      }

      // Usa SimilarityCalculator com IMDB ID
      const match = await this.smartTitleContainsCheck(
        torrent.title,
        imdbId,
        { year: torrentYear }
      );

      if (match.matches) {
        results.included.push(torrent);
      } else {
        results.excluded.push(torrent);
      }
    }

    const processingTime = Date.now() - startTime;

    this.logger.info('Resultado do filtro', {
      requestId,
      imdbId,
      filmYear: imdbTitles.year || 'Desconhecido',
      totalOriginal: torrents.length,
      duplicatasRemovidas: results.duplicatesRemoved,
      portugueses: portugueseTorrents.length,
      incluidos: results.included.length,
      excluidos: results.excluded.length,
      processingTime: `${processingTime}ms`
    });

    return results.included;
  }

  applyTitleFilterSync(
    torrents: any[],
    imdbTitle: string,
    requestId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): any[] {
    const startTime = Date.now();
    
    this.logger.info('Aplicando filtro de título (sync)', {
      requestId,
      totalTorrents: torrents.length
    });
    
    const uniqueTorrents = this.deduplicateTorrents(torrents);
    
    const results = {
      included: [] as any[],
      excluded: [] as any[],
      duplicatesRemoved: torrents.length - uniqueTorrents.length
    };

    for (const torrent of uniqueTorrents) {
      if (!this.isPortugueseContent(torrent.title)) {
        results.excluded.push(torrent);
        continue;
      }

      const matches = this.doTitlesMatchSync(
        torrent.title,
        imdbTitle,
        targetSeason,
        targetEpisode
      );

      if (matches) {
        results.included.push(torrent);
      } else {
        results.excluded.push(torrent);
      }
    }

    const processingTime = Date.now() - startTime;

    this.logger.info('Resultado filtro sync', {
      requestId,
      totalOriginal: torrents.length,
      duplicatasRemovidas: results.duplicatesRemoved,
      incluidos: results.included.length,
      processingTime: `${processingTime}ms`
    });

    return results.included;
  }

  async testTitleMatch(
    torrentTitle: string,
    imdbId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<TitleMatchResult> {
    this.logger.info('Teste de título', {
      torrentTitle,
      imdbId,
      targetSeason,
      targetEpisode
    });
    
    return await this.doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode);
  }

  testTitleMatchSync(
    torrentTitle: string,
    imdbTitle: string,
    targetSeason?: number,
    targetEpisode?: number
  ): {
    matches: boolean;
    normalizedTorrent: string;
    normalizedImdb: string;
    contains: boolean;
    contained: boolean;
    similarity: number;
    metadata: SeriesMetadata;
    isPortuguese: boolean;
  } {
    const isPortuguese = this.isPortugueseContent(torrentTitle);
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);
    const metadata = this.extractSeriesMetadata(torrentTitle);

    const contains = normTorrent.includes(normImdb);
    const contained = normImdb.includes(normTorrent);
    const similarity = this.similarityCalculator.calculateWordSimilarity(normTorrent, normImdb);

    const confusionCheck = this.similarityCalculator.detectConfusingSeries(torrentTitle, imdbTitle);
    const baseThreshold = 0.4;
    const adjustedThreshold = confusionCheck.isConfusing ? 
      Math.max(baseThreshold, confusionCheck.minSimilarity) : 
      baseThreshold;

    let matches = isPortuguese && (contains || contained || similarity >= adjustedThreshold);

    if (targetSeason !== undefined && metadata.hasEpisodeInfo) {
      if (metadata.season && metadata.season !== targetSeason) {
        matches = false;
      }
      if (targetEpisode !== undefined && metadata.episode && metadata.episode !== targetEpisode) {
        matches = false;
      }
    }

    return {
      matches,
      normalizedTorrent: normTorrent,
      normalizedImdb: normImdb,
      contains,
      contained,
      similarity,
      metadata,
      isPortuguese
    };
  }

  clearAllCaches(): void {
    this.cacheManager.clearAllCaches();
    this.logger.info('Todos os caches do TitleFilter foram limpos');
  }

  getCacheStats(): {
    imdbCacheSize: number;
    dedupCacheSize: number;
    processedTimestampsSize: number;
    cleanTitleCacheSize: number;
    portugueseCheckCacheSize: number;
  } {
    return this.cacheManager.getCacheStats();
  }

  addConfusingSeries(original: string, derivative: string, minSimilarity: number = 0.8): void {
    this.similarityCalculator.addConfusingSeries(original, derivative, minSimilarity);
    this.logger.info('Série confusa adicionada', {
      original,
      derivative,
      minSimilarity
    });
  }

  listConfusingSeries(): SeriesConfusion[] {
    return this.similarityCalculator.listConfusingSeries();
  }

  getSimilarityCalculatorStats() {
    return this.similarityCalculator.getStats();
  }
}

export { 
  SeriesMetadata, 
  TitleMatchResult, 
  SeriesConfusion 
};