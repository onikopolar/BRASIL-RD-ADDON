import { Logger } from '../utils/logger';
import axios from 'axios';

const logger = new Logger('TMDBScraper');

export interface ImdbTitles {
  originalTitle: string;
  portugueseTitle: string | null;
  allTitles: string[];
  foundInPortuguese: boolean;
  year?: number;
  mediaType?: 'movie' | 'tv';
  portuguesePriority: boolean;
}

export class ImdbScraperService {
  private readonly tmdbBaseUrl = 'https://api.themoviedb.org/3';
  private readonly tmdbApiKey: string;
  private readonly language = 'pt-BR';
  
  private static globalCache = new Map<string, {
    data: ImdbTitles;
    timestamp: number;
    tmdbId?: number;
    mediaType?: 'movie' | 'tv';
  }>();
  
  private readonly cacheTTL = 5 * 60 * 1000;

  constructor() {
    this.tmdbApiKey = process.env.TMDB_API_KEY || '4bfe2bbccad24f1bb07507953a137ebd';
    
    if (!this.tmdbApiKey) {
      logger.error('TMDB API KEY não configurada!');
    }
    
    logger.info('TMDB Scraper v2.0.0 inicializado', {
      feature: 'Português primeiro + cache otimizado'
    });
  }

  async getTitlesFromImdbId(imdbId: string, season?: number): Promise<ImdbTitles> {
    try {
      const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
      const cached = ImdbScraperService.globalCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('Cache TMDB hit', { imdbId, season });
        return cached.data;
      }

      logger.debug('Cache TMDB miss', { imdbId, season });

      const tmdbInfo = await this.findInTMDB(imdbId);
      
      if (!tmdbInfo) {
        logger.warn('TMDB: não encontrado', { imdbId });
        return this.createEmptyResult(imdbId);
      }

      const { tmdbId: tmdbIdNum, mediaType } = tmdbInfo;
      
      let year: number | undefined;
      let originalTitle = '';
      let portugueseTitle = '';
      
      if (mediaType === 'movie') {
        const details = await this.fetchDetailsFromTMDB(tmdbIdNum, 'movie');
        if (details) {
          originalTitle = details.original_title || '';
          portugueseTitle = details.title || '';
          
          if (details.release_date) {
            year = parseInt(details.release_date.substring(0, 4));
          }
          
          logger.debug('TMDB dados filme', {
            imdbId,
            original: originalTitle.substring(0, 40),
            portugues: portugueseTitle.substring(0, 40),
            year
          });
        }
      } else if (mediaType === 'tv') {
        if (season !== undefined && season > 0) {
          try {
            const seasonData = await this.fetchSeasonFromTMDB(tmdbIdNum, season);
            if (seasonData) {
              const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
              if (seriesDetails) {
                originalTitle = seriesDetails.original_name || '';
                portugueseTitle = seriesDetails.name || '';
              }
              
              if (seasonData.air_date) {
                year = parseInt(seasonData.air_date.substring(0, 4));
                logger.debug('TMDB ano temporada específica', {
                  imdbId,
                  season,
                  year,
                  airDate: seasonData.air_date
                });
              }
            }
          } catch (seasonError) {
            logger.warn('TMDB erro temporada, usando dados série', {
              imdbId,
              season,
              error: seasonError instanceof Error ? seasonError.message : 'Erro desconhecido'
            });
            
            const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
            if (seriesDetails) {
              originalTitle = seriesDetails.original_name || '';
              portugueseTitle = seriesDetails.name || '';
              if (seriesDetails.first_air_date) {
                year = parseInt(seriesDetails.first_air_date.substring(0, 4));
              }
            }
          }
        } else {
          const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
          if (seriesDetails) {
            originalTitle = seriesDetails.original_name || '';
            portugueseTitle = seriesDetails.name || '';
            if (seriesDetails.first_air_date) {
              year = parseInt(seriesDetails.first_air_date.substring(0, 4));
            }
          }
        }
        
        logger.debug('TMDB dados série', {
          imdbId,
          season,
          original: originalTitle.substring(0, 40),
          portugues: portugueseTitle.substring(0, 40),
          year
        });
      }

      if (!originalTitle) {
        logger.warn('TMDB: sem título', { imdbId });
        return this.createEmptyResult(imdbId);
      }

      const normalizedOriginal = this.normalizeTitle(originalTitle);
      const normalizedPortuguese = portugueseTitle ? this.normalizeTitle(portugueseTitle) : '';

      const hasPortuguese = !!normalizedPortuguese && normalizedPortuguese !== normalizedOriginal;
      const portuguesePriority = hasPortuguese;

      const allTitles: string[] = [];
      
      if (hasPortuguese) {
        allTitles.push(normalizedPortuguese);
        allTitles.push(normalizedOriginal);
      } else {
        allTitles.push(normalizedOriginal);
      }

      const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));

      const result: ImdbTitles = {
        originalTitle: normalizedOriginal,
        portugueseTitle: hasPortuguese ? normalizedPortuguese : null,
        allTitles: uniqueTitles,
        foundInPortuguese: hasPortuguese,
        year,
        mediaType,
        portuguesePriority
      };

      ImdbScraperService.globalCache.set(cacheKey, {
        data: result,
        timestamp: Date.now(),
        tmdbId: tmdbIdNum,
        mediaType
      });

      logger.info('TMDB títulos obtidos', {
        imdbId,
        tmdbId: tmdbIdNum,
        year,
        mediaType,
        season,
        portugues: hasPortuguese ? 'SIM' : 'NÃO',
        tituloPortugues: hasPortuguese ? normalizedPortuguese.substring(0, 50) : 'N/A',
        tituloOriginal: normalizedOriginal.substring(0, 50)
      });

      return result;

    } catch (error) {
      logger.error('TMDB erro geral', {
        imdbId,
        season,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      return this.createEmptyResult(imdbId);
    }
  }

  private async findInTMDB(imdbId: string): Promise<{tmdbId: number, mediaType: 'movie' | 'tv'} | null> {
    try {
      const response = await axios.get(`${this.tmdbBaseUrl}/find/${imdbId}`, {
        params: {
          api_key: this.tmdbApiKey,
          external_source: 'imdb_id',
          language: this.language
        },
        timeout: 10000
      });

      if (response.data.movie_results && response.data.movie_results.length > 0) {
        return {
          tmdbId: response.data.movie_results[0].id,
          mediaType: 'movie'
        };
      }
      
      if (response.data.tv_results && response.data.tv_results.length > 0) {
        return {
          tmdbId: response.data.tv_results[0].id,
          mediaType: 'tv'
        };
      }

      return null;
      
    } catch (error) {
      logger.error('TMDB erro converter IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  private async fetchDetailsFromTMDB(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<any> {
    try {
      const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
      
      const response = await axios.get(`${this.tmdbBaseUrl}/${endpoint}/${tmdbId}`, {
        params: {
          api_key: this.tmdbApiKey,
          language: this.language
        },
        timeout: 10000
      });

      return response.data;
      
    } catch (error) {
      logger.error('TMDB erro detalhes', {
        tmdbId,
        mediaType,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  private async fetchSeasonFromTMDB(tmdbId: number, season: number): Promise<any> {
    try {
      const response = await axios.get(`${this.tmdbBaseUrl}/tv/${tmdbId}/season/${season}`, {
        params: {
          api_key: this.tmdbApiKey,
          language: this.language
        },
        timeout: 10000
      });

      return response.data;
      
    } catch (error) {
      logger.error('TMDB erro temporada', {
        tmdbId,
        season,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      throw error;
    }
  }

  private createEmptyResult(imdbId: string): ImdbTitles {
    logger.debug('TMDB resultado vazio', { imdbId });
    
    return {
      originalTitle: `Unknown Title (${imdbId})`,
      portugueseTitle: null,
      allTitles: [],
      foundInPortuguese: false,
      portuguesePriority: false
    };
  }

  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async getTitleFromImdbId(imdbId: string): Promise<string | null> {
    try {
      const titles = await this.getTitlesFromImdbId(imdbId);
      return titles.portugueseTitle || titles.originalTitle || null;
    } catch (error) {
      logger.error('TMDB erro compatibilidade', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  static clearGlobalCache(): void {
    ImdbScraperService.globalCache.clear();
    logger.info('TMDB cache limpo');
  }

  static getGlobalCacheStats() {
    return {
      size: ImdbScraperService.globalCache.size,
      entries: Array.from(ImdbScraperService.globalCache.keys())
    };
  }

  clearInstanceCache(): void {
    ImdbScraperService.clearGlobalCache();
  }

  getStats() {
    return {
      cacheSize: ImdbScraperService.globalCache.size,
      cacheTTL: this.cacheTTL,
      version: '2.0.0',
      feature: 'Português primeiro + cache otimizado'
    };
  }
}