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
}

export class ImdbScraperService {
  private readonly tmdbBaseUrl = 'https://api.themoviedb.org/3';
  private readonly tmdbApiKey: string;
  private readonly language = 'pt-BR';
  
  // Cache global compartilhado
  private static globalCache = new Map<string, {
    data: ImdbTitles;
    timestamp: number;
    tmdbId?: number;
    mediaType?: 'movie' | 'tv';
  }>();
  
  private readonly cacheTTL = 5 * 60 * 1000; // 5 minutos

  constructor() {
    this.tmdbApiKey = process.env.TMDB_API_KEY || '4bfe2bbccad24f1bb07507953a137ebd';
    
    if (!this.tmdbApiKey) {
      logger.error('TMDB API KEY não configurada!');
    }
    
    logger.info('TMDB Scraper v1.1.0 inicializado', {
      feature: 'Cache global compartilhado'
    });
  }

  // Busca títulos - usa cache global
  async getTitlesFromImdbId(imdbId: string): Promise<ImdbTitles> {
    try {
      // Cache: verificar primeiro
      const cached = ImdbScraperService.globalCache.get(imdbId);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('Cache TMDB hit', { imdbId });
        return cached.data;
      }

      logger.debug('Cache TMDB miss', { imdbId });

      // Converter IMDB ID para TMDB ID
      const tmdbInfo = await this.findInTMDB(imdbId);
      
      if (!tmdbInfo) {
        return this.createEmptyResult(imdbId);
      }

      const { tmdbId, mediaType } = tmdbInfo;
      
      // Buscar detalhes
      const details = await this.fetchDetailsFromTMDB(tmdbId, mediaType);
      
      if (!details) {
        return this.createEmptyResult(imdbId);
      }

      // Extrair títulos
      let originalTitle = '';
      let portugueseTitle = '';
      let year: number | undefined;

      if (mediaType === 'movie') {
        originalTitle = details.original_title || '';
        portugueseTitle = details.title || '';
        if (details.release_date) {
          year = parseInt(details.release_date.substring(0, 4));
        }
      } else if (mediaType === 'tv') {
        originalTitle = details.original_name || '';
        portugueseTitle = details.name || '';
        if (details.first_air_date) {
          year = parseInt(details.first_air_date.substring(0, 4));
        }
      }

      if (!originalTitle) {
        return this.createEmptyResult(imdbId);
      }

      // Normalizar títulos
      const normalizedOriginal = this.normalizeTitle(originalTitle);
      const normalizedPortuguese = portugueseTitle ? this.normalizeTitle(portugueseTitle) : '';

      // Lista de todos os títulos
      const allTitles = [normalizedOriginal];
      if (normalizedPortuguese && normalizedPortuguese !== normalizedOriginal) {
        allTitles.push(normalizedPortuguese);
      }

      const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));

      const result: ImdbTitles = {
        originalTitle: normalizedOriginal,
        portugueseTitle: normalizedPortuguese || null,
        allTitles: uniqueTitles,
        foundInPortuguese: !!normalizedPortuguese,
        year,
        mediaType
      };

      // Armazenar em cache global
      ImdbScraperService.globalCache.set(imdbId, {
        data: result,
        timestamp: Date.now(),
        tmdbId,
        mediaType
      });

      logger.debug('Títulos encontrados no TMDB', {
        imdbId,
        tmdbId,
        year,
        mediaType
      });

      return result;

    } catch (error) {
      logger.error('Erro TMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      return this.createEmptyResult(imdbId);
    }
  }

  // Encontrar no TMDB usando IMDB ID
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

      // Filmes primeiro, depois séries
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
      logger.error('Erro converter IMDB para TMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  // Buscar detalhes do TMDB
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
      logger.error('Erro buscar detalhes TMDB', {
        tmdbId,
        mediaType,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  // Criar resultado vazio
  private createEmptyResult(imdbId: string): ImdbTitles {
    return {
      originalTitle: `Unknown Title (${imdbId})`,
      portugueseTitle: null,
      allTitles: [],
      foundInPortuguese: false
    };
  }

  // Normalizar título
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Método de compatibilidade
  async getTitleFromImdbId(imdbId: string): Promise<string | null> {
    try {
      const titles = await this.getTitlesFromImdbId(imdbId);
      return titles.portugueseTitle || titles.originalTitle || null;
    } catch (error) {
      logger.error('Erro compatibilidade', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  // Métodos estáticos para cache global
  static clearGlobalCache(): void {
    ImdbScraperService.globalCache.clear();
  }

  static getGlobalCacheStats() {
    return {
      size: ImdbScraperService.globalCache.size,
      entries: Array.from(ImdbScraperService.globalCache.keys())
    };
  }

  // Métodos de instância
  clearInstanceCache(): void {
    // Mantido para compatibilidade
    ImdbScraperService.clearGlobalCache();
  }

  getStats() {
    return {
      cacheSize: ImdbScraperService.globalCache.size,
      cacheTTL: this.cacheTTL,
      version: '1.1.0'
    };
  }
}