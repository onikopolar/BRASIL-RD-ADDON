import { Logger } from '../../utils/logger';
import { SmartTitleMatch } from './interfaces';
import { SeriesConfusion } from './interfaces';
import { ImdbScraperService } from '../../services/ImdbScraperService';

export class SimilarityCalculator {
  private readonly logger: Logger;
  private confusingSeries: SeriesConfusion[];
  private readonly titleCleaner: any;
  private readonly tmdbScraper: ImdbScraperService | null;
  
  // Cache para TMDB
  private readonly tmdbCache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutos

  private readonly TECHNICAL_WORDS = [
    'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv',
    '720p', '1080p', '2160p', '4k', 'hd', 'fullhd', 'uhd', 'sd',
    'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx',
    'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv',
    'camrip', 'ts', 'tc', 'r5', 'scr', 'dvdscr', 'bdscr', 'webscr',
    'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
    'legendado', 'legendada', 'legenda', 'ac3', 'dts', 'aac', 'dd5.1',
    'dolby', 'atmos', 'truehd', 'dts-hd', 'dtshd',
    'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br', 'portugues', 'português',
    'eng', 'english', 'ingles', 'brazilian', 'espanol', 'spanish',
    'repack', 'proper', 'extended', 'directors', 'cut', 'remastered',
    'complete', 'uncensored', 'uncut', 'limited', 'special', 'edition',
    'directors.cut', 'theatrical', 'unrated', 'imax', '3d',
    'yts', 'yify', 'rarbg', 'ettv', 'eztv', 'amzn', 'nf', 'hulu',
    'm2ts', 'iso', 'bdmv', 'mpls', 'playlist', 'chapter'
  ];

  constructor(titleCleaner?: any, useTmdbScraper: boolean = true) {
    this.logger = new Logger('SimilarityCalculator');
    this.logger.info('SimilarityCalculator v2.4.0 inicializado');
    this.titleCleaner = titleCleaner;
    
    if (useTmdbScraper) {
      this.tmdbScraper = new ImdbScraperService();
      this.logger.debug('TMDB Scraper integrado com cache');
    } else {
      this.tmdbScraper = null;
    }
    
    this.confusingSeries = [
      { original: 'american horror story', derivative: 'american horror stories', minSimilarity: 0.8 },
      { original: 'stranger things', derivative: 'stranger things stories', minSimilarity: 0.8 },
      { original: 'megamind', derivative: 'megamind vs', minSimilarity: 0.7 }
    ];
  }

  async smartTitleContainsCheck(
    torrentTitle: string, 
    imdbId: string,
    torrentMetadata?: { year?: number }
  ): Promise<SmartTitleMatch> {
    
    this.logger.debug('Verificando título', {
      torrentTitle: torrentTitle.substring(0, 100),
      imdbId,
      hasMetadata: !!torrentMetadata
    });

    let movieInfo: {
      portugueseTitle: string | null;
      englishTitle: string;
      year?: number;
      allTitles: string[];
    } | null = null;
    
    if (this.tmdbScraper) {
      try {
        // Cache: verificar primeiro
        const cacheKey = `tmdb-${imdbId}`;
        const cached = this.tmdbCache.get(cacheKey);
        
        let tmdbData;
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
          this.logger.debug('Usando cache do TMDB', { imdbId });
          tmdbData = cached.data;
        } else {
          tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId);
          this.tmdbCache.set(cacheKey, {
            data: tmdbData,
            timestamp: Date.now()
          });
        }
        
        movieInfo = {
          portugueseTitle: tmdbData.portugueseTitle,
          englishTitle: tmdbData.originalTitle,
          year: tmdbData.year,
          allTitles: tmdbData.allTitles
        };
        
      } catch (error) {
        this.logger.error('Erro ao obter dados do TMDB', {
          imdbId,
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
      }
    }

    if (!movieInfo) {
      return {
        matches: false,
        similarity: 0,
        reason: 'Não foi possível obter informações do filme do TMDB'
      };
    }

    const torrentYear = torrentMetadata?.year || this.extractYearFromTitle(torrentTitle);
    const torrentClean = this.normalizeForComparison(torrentTitle);
    
    this.logger.debug('Dados extraídos', {
      torrentClean: torrentClean.substring(0, 80),
      torrentYear,
      movieYear: movieInfo.year
    });

    // Validação de ano: diferença máxima de 2 anos
    if (movieInfo.year && torrentYear) {
      const yearDifference = Math.abs(movieInfo.year - torrentYear);
      
      if (yearDifference > 2) {
        this.logger.warn('Anos diferentes detectados', {
          requestedYear: movieInfo.year,
          torrentYear: torrentYear,
          difference: yearDifference
        });
        
        return {
          matches: false,
          similarity: 0.3,
          reason: `Anos diferentes demais: ${movieInfo.year} ≠ ${torrentYear}`
        };
      }
    }

    const validationResult = this.validateWithHierarchy(
      torrentClean, 
      movieInfo.englishTitle, 
      movieInfo.portugueseTitle,
      movieInfo.year,
      torrentYear
    );

    if (validationResult.matches) {
      this.logger.info('Match válido encontrado', {
        similarity: validationResult.similarity,
        reason: validationResult.reason,
        validationType: validationResult.validationType
      });
    }

    return validationResult;
  }

  private validateWithHierarchy(
    torrentClean: string,
    englishTitle: string,
    portugueseTitle: string | null,
    movieYear: number | undefined,
    torrentYear: number | null
  ): SmartTitleMatch & { validationType: string } {
    
    this.logger.debug('Iniciando validação hierárquica', {
      englishTitle,
      hasPortugueseTitle: !!portugueseTitle
    });

    // PRIORIDADE 1: Validação com título original em inglês
    const englishMatch = this.checkTitleMatch(
      this.normalizeForComparison(englishTitle),
      englishTitle,
      torrentClean
    );

    if (englishMatch.matches && englishMatch.similarity >= 0.5) {
      this.logger.debug('Match com título inglês encontrado', {
        title: englishTitle,
        similarity: englishMatch.similarity
      });
      
      return {
        ...englishMatch,
        validationType: 'primary_english'
      };
    }

    this.logger.debug('Match com título inglês insuficiente', {
      title: englishTitle,
      similarity: englishMatch.similarity,
      threshold: '50%'
    });

    // PRIORIDADE 2: Validação com título em português (TMDB é confiável!)
    if (portugueseTitle) {
      const portugueseMatch = this.checkTitleMatch(
        this.normalizeForComparison(portugueseTitle),
        portugueseTitle,
        torrentClean
      );

      if (portugueseMatch.matches) {
        const adjustedSimilarity = Math.max(portugueseMatch.similarity, 0.7);
        
        this.logger.debug('Match com título português (TMDB) encontrado', {
          title: portugueseTitle,
          similarity: portugueseMatch.similarity,
          adjustedSimilarity
        });
        
        return {
          matches: true,
          similarity: adjustedSimilarity,
          reason: `Título português (TMDB): "${portugueseTitle}"`,
          validationType: 'tmdb_portuguese'
        };
      }
    }

    this.logger.debug('Nenhum match encontrado na hierarquia', {
      triedEnglish: true,
      triedPortuguese: !!portugueseTitle
    });

    return {
      matches: false,
      similarity: Math.max(englishMatch.similarity, portugueseTitle ? 
        this.checkTitleMatch(
          this.normalizeForComparison(portugueseTitle),
          portugueseTitle,
          torrentClean
        ).similarity : 0),
      reason: 'Nenhuma correspondência encontrada',
      validationType: 'no_match'
    };
  }

  private checkTitleMatch(
    knownClean: string,
    knownOriginalTitle: string,
    torrentClean: string
  ): SmartTitleMatch {
    const knownWords = knownClean.split(' ').filter(w => w.length >= 3);
    
    if (knownWords.length === 1) {
      return this.checkSingleWordTitle(knownClean, knownOriginalTitle, torrentClean);
    }
    
    return this.checkMultiWordTitle(knownClean, knownOriginalTitle, torrentClean);
  }

  private checkSingleWordTitle(
    knownClean: string,
    knownOriginalTitle: string,
    torrentClean: string
  ): SmartTitleMatch {
    const torrentWords = torrentClean.split(' ').filter(w => w.length >= 2);
    
    if (torrentWords.length === 0) {
      return {
        matches: false,
        similarity: 0,
        reason: 'Título do torrent vazio após normalização'
      };
    }

    const firstNonTechnicalWord = this.getFirstNonTechnicalWord(torrentWords);
    if (firstNonTechnicalWord === knownClean) {
      return {
        matches: true,
        similarity: 0.95,
        reason: `"${knownOriginalTitle}" como primeira palavra relevante do título`
      };
    }
    
    if (torrentWords.length <= 4) {
      const exactMatch = torrentWords.find(word => word === knownClean);
      if (exactMatch) {
        return {
          matches: true,
          similarity: 0.95,
          reason: `"${knownOriginalTitle}" em título curto (${torrentWords.length} palavras)`
        };
      }
    }
    
    const containsMatch = torrentClean.includes(knownClean);
    if (containsMatch) {
      const position = torrentClean.indexOf(knownClean);
      
      if (position > 0) {
        const textBefore = torrentClean.substring(0, position).trim();
        const wordsBefore = textBefore.split(' ').filter(w => w.length >= 2);
        const nonTechnicalWordsBefore = wordsBefore.filter(word => 
          !this.TECHNICAL_WORDS.includes(word)
        );
        
        if (nonTechnicalWordsBefore.length >= 1) {
          return {
            matches: false,
            similarity: 0.3,
            reason: `"${knownOriginalTitle}" não é termo principal (tem "${nonTechnicalWordsBefore[0]}" antes)`
          };
        }
      }
      
      const beforeChar = position > 0 ? torrentClean[position - 1] : ' ';
      const afterChar = torrentClean[position + knownClean.length];
      
      const isIsolated = (beforeChar === ' ' || beforeChar === '(' || beforeChar === '[') &&
                        (afterChar === ' ' || afterChar === ')' || afterChar === ']' || afterChar === undefined);
      
      if (isIsolated) {
        return {
          matches: true,
          similarity: 0.9,
          reason: `"${knownOriginalTitle}" isolado no título`
        };
      }
    }
    
    const similarity = this.calculateWordSimilarity(torrentClean, knownClean);
    
    if (similarity >= 0.8) {
      return {
        matches: true,
        similarity,
        reason: `Similaridade alta: ${(similarity * 100).toFixed(1)}%`
      };
    }
    
    return {
      matches: false,
      similarity,
      reason: `Similaridade insuficiente: ${(similarity * 100).toFixed(1)}%`
    };
  }

  private getFirstNonTechnicalWord(words: string[]): string | null {
    for (const word of words) {
      if (!this.TECHNICAL_WORDS.includes(word)) {
        return word;
      }
    }
    return null;
  }

  private checkMultiWordTitle(
    knownClean: string,
    knownOriginalTitle: string,
    torrentClean: string
  ): SmartTitleMatch {
    if (torrentClean.includes(knownClean)) {
      return {
        matches: true,
        similarity: 0.95,
        reason: `Título "${knownOriginalTitle}" encontrado no torrent`
      };
    }
    
    const similarity = this.calculateWordSimilarity(torrentClean, knownClean);
    
    if (similarity >= 0.5) {
      return {
        matches: true,
        similarity,
        reason: `Similaridade: ${(similarity * 100).toFixed(1)}%`
      };
    }
    
    return {
      matches: false,
      similarity,
      reason: `Similaridade insuficiente: ${(similarity * 100).toFixed(1)}%`
    };
  }

  private extractYearFromTitle(title: string): number | null {
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      return parseInt(yearMatch[0]);
    }
    return null;
  }

  normalizeForComparison(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  calculateWordSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ').filter(w => w.length > 0);
    const words2 = str2.split(' ').filter(w => w.length > 0);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    const wordSet1 = new Set(words1);
    const commonWords = words2.filter(word => wordSet1.has(word));
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  smartTitleContainsCheckSync(torrentTitle: string, imdbTitle: string): SmartTitleMatch {
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);
    
    const imdbWords = normImdb.split(' ').filter(w => w.length >= 3);
    
    if (imdbWords.length === 1) {
      return this.checkSingleWordTitle(normImdb, imdbTitle, normTorrent);
    }
    
    return this.checkMultiWordTitle(normImdb, imdbTitle, normTorrent);
  }

  detectConfusingSeries(torrentTitle: string, imdbTitle: string): { 
    isConfusing: boolean; 
    minSimilarity: number 
  } {
    const torrentLower = torrentTitle.toLowerCase();
    const imdbLower = imdbTitle.toLowerCase();
    
    for (const confusion of this.confusingSeries) {
      const hasDerivative = torrentLower.includes(confusion.derivative);
      const hasOriginal = imdbLower.includes(confusion.original);
      
      if (hasDerivative && hasOriginal) {
        return { isConfusing: true, minSimilarity: confusion.minSimilarity };
      }
    }
    
    return { isConfusing: false, minSimilarity: 0 };
  }

  addConfusingSeries(original: string, derivative: string, minSimilarity: number = 0.8): void {
    this.confusingSeries.push({
      original: original.toLowerCase(),
      derivative: derivative.toLowerCase(),
      minSimilarity
    });
  }

  listConfusingSeries(): SeriesConfusion[] {
    return this.confusingSeries;
  }

  removeConfusingSeries(original: string, derivative: string): boolean {
    const originalLower = original.toLowerCase();
    const derivativeLower = derivative.toLowerCase();
    
    const initialLength = this.confusingSeries.length;
    this.confusingSeries = this.confusingSeries.filter(
      confusion => !(confusion.original === originalLower && confusion.derivative === derivativeLower)
    );
    
    return initialLength > this.confusingSeries.length;
  }

  clearCache(): void {
    this.tmdbCache.clear();
  }

  getStats() {
    return {
      confusingSeriesCount: this.confusingSeries.length,
      tmdbScraperAvailable: !!this.tmdbScraper,
      cacheSize: this.tmdbCache.size,
      strategy: 'Hierarquia inglês (primário) / TMDB português (confiável) - v2.4.0',
      technicalWordsCount: this.TECHNICAL_WORDS.length,
      version: '2.4.0',
      feature: 'TMDB com cache - otimizado para performance'
    };
  }
}

export type { SmartTitleMatch, SeriesConfusion };