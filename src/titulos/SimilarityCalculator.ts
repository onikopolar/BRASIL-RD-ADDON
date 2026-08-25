import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { isCollectionTitle } from './TechnicalWords.js';

const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

export class SimilarityCalculator {
  private readonly logger: Logger;
  private readonly tmdbScraper: ImdbScraperService | null;
  private readonly languageDetector: LanguageDetector;

  private readonly tmdbCache = new Map<string, { data: ImdbTitles; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  private static instance: SimilarityCalculator;

  public static getInstance(): SimilarityCalculator {
    if (!SimilarityCalculator.instance) {
      SimilarityCalculator.instance = new SimilarityCalculator(undefined, true);
    }
    return SimilarityCalculator.instance;
  }

  constructor(_titleCleaner?: any, useTmdbScraper: boolean = true) {
    this.logger = new Logger('SimilarityCalculator');
    this.tmdbScraper = useTmdbScraper ? ImdbScraperService.getInstance() : null;
    this.languageDetector = LanguageDetector.getInstance();
    this.startCacheCleanup();
  }

  private startCacheCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.tmdbCache.entries()) {
        if (now - entry.timestamp > this.cacheTTL) {
          this.tmdbCache.delete(key);
        }
      }
    }, CACHE_CLEANUP_INTERVAL);
    this.cleanupTimer.unref?.();
  }

  async smartTitleContainsCheck(
    torrentTitle: string,
    imdbId: string,
    _torrentMetadata?: { year?: number; season?: number },
    rawTitleForLanguage?: string,
    preFetchedTmdbData?: ImdbTitles | null
  ): Promise<SmartTitleMatch> {
    // Passe livre para títulos de coleção (quadrilogia, trilogia, saga, etc.)
    if (isCollectionTitle(torrentTitle)) {
      this.logger.info('Coleção/pack identificado, aceitando automaticamente', {
        torrentTitle: torrentTitle.substring(0, 80),
      });
      return { matches: true, similarity: 1, reason: 'Coleção/pack identificado' };
    }

    let movieInfo: {
      portugueseTitle: string | null;
      originalTitle: string;
      year?: number;
      allTitles: string[];
      mediaType?: 'movie' | 'tv';
      belongsToCollection?: any;
    } | null = null;

    if (preFetchedTmdbData) {
      movieInfo = {
        portugueseTitle: preFetchedTmdbData.portugueseTitle,
        originalTitle: preFetchedTmdbData.originalTitle,
        year: preFetchedTmdbData.year,
        allTitles: preFetchedTmdbData.allTitles,
        mediaType: preFetchedTmdbData.mediaType,
        belongsToCollection: undefined,
      };
    }

    if (!movieInfo && this.tmdbScraper) {
      try {
        const season = _torrentMetadata?.season;
        const cacheKey = season ? `tmdb-${imdbId}:s${season}` : `tmdb-${imdbId}`;
        const cached = this.tmdbCache.get(cacheKey);
        let tmdbData: ImdbTitles;
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
          tmdbData = cached.data;
        } else {
          tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
          this.tmdbCache.set(cacheKey, { data: tmdbData, timestamp: Date.now() });
        }
        movieInfo = {
          portugueseTitle: tmdbData.portugueseTitle,
          originalTitle: tmdbData.originalTitle,
          year: tmdbData.year,
          allTitles: tmdbData.allTitles,
          mediaType: tmdbData.mediaType,
          belongsToCollection: undefined,
        };
      } catch (error) {
        this.logger.error('Erro ao buscar TMDB', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
      }
    }

    if (!movieInfo) {
      return { matches: false, similarity: 0, reason: 'Sem dados do TMDB' };
    }

    const tituloParaIdioma = rawTitleForLanguage || torrentTitle;
    const idiomaPre = this.languageDetector.verificarIdioma(tituloParaIdioma);
    if (idiomaPre.palavrasEn.length > 0 && idiomaPre.palavrasPt.length === 0) {
      this.logger.debug('Idioma internacional rejeitado', {
        titulo: tituloParaIdioma.substring(0, 80),
        motivo: idiomaPre.motivo,
      });
      return {
        matches: false,
        similarity: 0,
        reason: `Idioma internacional: ${idiomaPre.motivo}`,
        mediaType: movieInfo.mediaType,
      };
    }

    return {
      matches: true,
      similarity: 1,
      reason: 'Validação por idioma e contexto HTML',
      mediaType: movieInfo.mediaType,
    };
  }
}

export type { SmartTitleMatch };