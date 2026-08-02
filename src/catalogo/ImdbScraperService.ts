import { Logger } from '../utils/logger.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { getTmdbTitlesViaHtml } from './TmdbHtmlScraper.js';

const logger = new Logger('TMDBScraper');

// DNS bypass (igual aos scrapers)
dns.setServers(['8.8.8.8', '1.1.1.1']);
class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      const sock = tls.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined;
  }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupImdb = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

export interface ImdbTitles {
  originalTitle: string;
  portugueseTitle: string | null;
  portugueseTitleRaw: string | null;  // COM acentos, para busca em sites como TPB
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

  private static instance: ImdbScraperService;

  public static getInstance(): ImdbScraperService {
    if (!ImdbScraperService.instance) {
      ImdbScraperService.instance = new ImdbScraperService();
    }
    return ImdbScraperService.instance;
  }

  constructor() {
    this.tmdbApiKey = process.env.TMDB_API_KEY || '';
    
    if (!this.tmdbApiKey) {
      logger.warn('TMDB_API_KEY não configurada! Metadados em português não estarão disponíveis. Obtenha uma key gratuita em: https://www.themoviedb.org/settings/api');
    }
    
    logger.debug('TMDB Scraper ready');
  }

  async getTitlesFromImdbId(imdbId: string, season?: number): Promise<ImdbTitles> {
    try {
      const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
      const cached = ImdbScraperService.globalCache.get(cacheKey);
      
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return cached.data;
      }

      logger.debug('Cache TMDB miss', { imdbId, season });

      const tmdbInfo = await this.findInTMDB(imdbId);
      
      if (!tmdbInfo) {
        // Fallback 1: TMDB HTML scraper (OMDB → TMDB search → scrape)
        logger.debug('TMDB API offline, usando fallback HTML', { imdbId });
        const htmlResult = await getTmdbTitlesViaHtml(imdbId);
        if (htmlResult) {
          ImdbScraperService.globalCache.set(cacheKey, {
            data: htmlResult,
            timestamp: Date.now(),
          });
          return htmlResult;
        }
        // Fallback 2: IMDb HTML (só título original)
        logger.warn('TMDB HTML fallback falhou, tentando IMDb HTML', { imdbId });
        return await this.scrapeImdbTitle(imdbId);
      }

      const { tmdbId: tmdbIdNum, mediaType } = tmdbInfo;
      
      let year: number | undefined;
      let originalTitle = '';
      let portugueseTitle = '';
      
      if (mediaType === 'movie') {
        const details = await this.fetchDetailsFromTMDB(tmdbIdNum, 'movie');
        if (details) {
          originalTitle = details.original_title || details.title || '';
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
                originalTitle = seriesDetails.original_name || seriesDetails.name || '';
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
              originalTitle = seriesDetails.original_name || seriesDetails.name || '';
              portugueseTitle = seriesDetails.name || '';
              if (seriesDetails.first_air_date) {
                year = parseInt(seriesDetails.first_air_date.substring(0, 4));
              }
            }
          }
        } else {
          const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
          if (seriesDetails) {
            originalTitle = seriesDetails.original_name || seriesDetails.name || '';
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

      // Se título original é não-latino, busca em inglês (animes, etc)
      if (originalTitle && !/^[a-z0-9\s\-\.':,!]+$/i.test(originalTitle)) {
        const enDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, mediaType === 'tv' ? 'tv' : 'movie', 'en-US');
        const enTitle = mediaType === 'tv' ? enDetails?.name : enDetails?.title;
        if (enTitle) {
          logger.debug('TMDB título original trocado para EN', { imdbId, original: enTitle.substring(0, 40) });
          originalTitle = enTitle;
        }
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
        portugueseTitleRaw: hasPortuguese ? portugueseTitle : null,
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
      logger.debug('TMDB erro converter IMDB (esperado, fallback HTML funciona)', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  private async fetchDetailsFromTMDB(tmdbId: number, mediaType: 'movie' | 'tv', langOverride?: string): Promise<any> {
    try {
      const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
      
      const response = await axios.get(`${this.tmdbBaseUrl}/${endpoint}/${tmdbId}`, {
        params: {
          api_key: this.tmdbApiKey,
          language: langOverride || this.language
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

  /** Fallback: scrape IMDb HTML quando TMDB nao conhece o ID */
  private async scrapeImdbTitle(imdbId: string): Promise<ImdbTitles> {
    try {
      const url = `https://www.imdb.com/title/${imdbId}/`;
      const res = await axios.get(url, {
        timeout: 10000,
        httpsAgent: dnsAgent,
        lookup: lookupImdb,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        },
      });

      const $ = cheerio.load(res.data);
      // Título do <title> (ex: "Project Hail Mary (2026) - IMDb")
      const rawTitle = $('title').text().replace(/\s*-\s*IMDb\s*$/i, '').trim();
      // Extrai ano
      const yearMatch = rawTitle.match(/\((\d{4})\)/);
      const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

      // Título limpo sem o ano
      const cleanTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, '').trim();
      const normalized = this.normalizeTitle(cleanTitle);

      if (!normalized || normalized.length < 2) {
        return this.createEmptyResult(imdbId);
      }

      logger.info('IMDb HTML fallback', { imdbId, title: cleanTitle.substring(0, 50), year });

      return {
        originalTitle: normalized,
        portugueseTitle: null,
        portugueseTitleRaw: null,
        allTitles: [normalized],
        foundInPortuguese: false,
        portuguesePriority: false,
        year,
        mediaType: undefined,
      };
    } catch (err: any) {
      logger.warn('IMDb HTML fallback falhou', { imdbId, error: err.message });
      return this.createEmptyResult(imdbId);
    }
  }

  private createEmptyResult(imdbId: string): ImdbTitles {
    logger.debug('TMDB resultado vazio', { imdbId });
    
    return {
      originalTitle: `Unknown Title (${imdbId})`,
      portugueseTitle: null,
      portugueseTitleRaw: null,
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
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // \p{L}=Unicode letters, preserva coreano/japonês/árabe etc
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