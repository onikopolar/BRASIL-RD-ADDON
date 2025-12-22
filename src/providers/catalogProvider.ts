import { CuratedMagnetService } from '../services/CuratedMagnetService';
import { QualityDetector } from '../lib/qualityDetector';
import { StreamFormatter } from '../lib/streamFormatter';
import { Stream } from '../types/index';
import { extractHashFromMagnet } from '../lib/magnetHelper';
import { Logger } from '../utils/logger';
import { MetadataExtractor } from '../lib/title-filter/MetadataExtractor';
import { getImdbIdMovieEntries, getImdbIdSeriesEntries } from '../lib/repository';
import { TorrentScraperService } from '../services/scraper/TorrentScraperService';
import { ImdbScraperService, ImdbTitles } from '../services/ImdbScraperService';
import { TitleFilter } from '../lib/titleFilter';
import { AutoMagnetService } from '../services/AutoMagnetService';
import { metricsService } from '../services/MetricsService';

interface ScrapedTorrent {
  title: string;
  magnet: string;
  seeders: number;
  leechers: number;
  size: string;
  quality: string;
  provider: string;
  language: string;
  type: 'movie' | 'series';
}

export interface TmdbSearchData {
  searchTitle: string;
  imdbTitles: ImdbTitles | null;
  seasonYear: number | null;
  mediaType: string | null;
}

export class CatalogProvider {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;
  private readonly streamFormatter: StreamFormatter;
  private readonly metadataExtractor: MetadataExtractor;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly titleFilter: TitleFilter;
  private readonly autoMagnetService: AutoMagnetService;

  // Versionamento Semantico v4.7.3 - FIX: Passa imdbId para TorrentScraperService
  private readonly VERSION = '4.7.3';

  // Cache de streams otimizado
  private readonly streamCache: Map<string, { streams: Stream[], timestamp: number, isEmpty: boolean }> = new Map();
  private readonly STREAM_TTL = 24 * 60 * 60 * 1000;
  private readonly STREAM_EMPTY_TTL = 60 * 1000;
  private readonly CACHE_KEY_SEPARATOR = '|';

  // Cache de scraping inteligente
  private scrapingCache = new Map<string, { lastAttempt: Date, successful: boolean }>();
  private readonly scrapingCacheTTL = 6 * 60 * 60 * 1000;

  // Cache de dados TMDB para reuso
  private tmdbDataCache = new Map<string, { data: TmdbSearchData, timestamp: number }>();
  private readonly TMDB_CACHE_TTL = 5 * 60 * 1000;

  constructor(
    private readonly magnetService: CuratedMagnetService
  ) {
    this.logger = new Logger('CatalogProvider');
    this.qualityDetector = new QualityDetector();
    this.streamFormatter = new StreamFormatter();
    this.metadataExtractor = new MetadataExtractor();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = new ImdbScraperService();
    this.titleFilter = new TitleFilter();
    this.autoMagnetService = new AutoMagnetService();
    
    this.logger.info(`CatalogProvider v${this.VERSION} inicializado - Fix: Passa imdbId para TorrentScraperService`);
  }

  async getTmdbSearchData(imdbId: string, season?: number): Promise<TmdbSearchData> {
    const cacheKey = season !== undefined ? `${imdbId}:s${season}` : imdbId;
    const cached = this.tmdbDataCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.TMDB_CACHE_TTL) {
      this.logger.debug('Cache TMDB hit para busca', { imdbId, season });
      return cached.data;
    }
    
    this.logger.debug('Obtendo dados TMDB para busca', { imdbId, season });
    
    let imdbTitles: ImdbTitles | null = null;
    let searchTitle: string = '';
    let seasonYear: number | null = null;
    let mediaType: string | null = null;
    
    try {
      imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
      
      if (imdbTitles) {
        if (imdbTitles.allTitles.length > 0) {
          searchTitle = imdbTitles.allTitles[0];
        }
        
        seasonYear = imdbTitles.year || null;
        mediaType = imdbTitles.mediaType || null;
        
        this.logger.debug('Dados TMDB obtidos para busca', {
          imdbId,
          season,
          searchTitle: searchTitle.substring(0, 60),
          seasonYear,
          hasYear: !!seasonYear,
          mediaType: mediaType
        });
      }
    } catch (error) {
      this.logger.warn('Erro ao obter dados TMDB para busca', {
        imdbId,
        season,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
    
    const tmdbData: TmdbSearchData = {
      searchTitle,
      imdbTitles,
      seasonYear,
      mediaType
    };
    
    this.tmdbDataCache.set(cacheKey, {
      data: tmdbData,
      timestamp: Date.now()
    });
    
    return tmdbData;
  }

  async getSeasonYear(imdbId: string, season: number): Promise<number | null> {
    const tmdbData = await this.getTmdbSearchData(imdbId, season);
    return tmdbData.seasonYear;
  }

  async getStreamsFromCatalog(request: any): Promise<Stream[]> {
    const startTime = Date.now();
    const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
    const cacheKey = this.generateCacheKey(request, season, episode);

    const cachedStreams = this.getFromCache(cacheKey);
    if (cachedStreams !== null) {
      const duration = Date.now() - startTime;
      this.logger.debug('Resultado do cache', {
        requestId: request.id,
        quantidade: cachedStreams.length,
        cacheKey,
        duration: `${duration}ms`
      });
      metricsService.recordCacheHit();
      return cachedStreams;
    }

    this.logger.debug('Busca de streams iniciada', {
      requestId: request.id,
      type: request.type,
      hasApiKey: !!request.apiKey,
      season,
      episode
    });
    
    let allStreams: Stream[] = [];
    
    const dbStreams = await this.getStreamsFromDatabase(request, season, episode);
    allStreams.push(...dbStreams);
    
    this.logger.debug('Resultados do banco', {
      quantidade: dbStreams.length,
      type: request.type,
      season,
      episode
    });
    
    if (dbStreams.length === 0) {
      const jsonStreams = await this.getStreamsFromJson(request, season, episode);
      allStreams.push(...jsonStreams);
      
      this.logger.debug('Resultados do JSON', {
        quantidade: jsonStreams.length,
        imdbId: request.imdbId || request.id
      });
    }
    
    const uniqueStreams = this.removeDuplicatesByInfoHash(allStreams);
    
    uniqueStreams.forEach(stream => {
      const quality = this.extractStreamQuality(stream);
      metricsService.recordStreamReturned(request.type, quality);
    });
    
    this.logger.info('Resultados do catalogo', {
      totalFinal: uniqueStreams.length,
      doBanco: dbStreams.length,
      doJson: allStreams.length - dbStreams.length,
      duplicadosRemovidos: allStreams.length - uniqueStreams.length,
      duration: `${Date.now() - startTime}ms`
    });
    
    if (uniqueStreams.length === 0) {
      const shouldScrape = await this.shouldAttemptScraping(request);
      if (!shouldScrape) {
        this.logger.debug('Scraping bloqueado por cache', {
          requestId: request.id,
          tipo: request.type
        });
        this.saveToCache(cacheKey, []);
        return [];
      }

      this.logger.debug('Iniciando scraping inteligente', {
        requestId: request.id,
        type: request.type,
        season,
        episode
      });
      
      const scrapedStreams = await this.performIntelligentScraping(request, season, episode);
      const scrapedUniqueStreams = this.removeDuplicatesByInfoHash(scrapedStreams);
      
      scrapedUniqueStreams.forEach(stream => {
        const quality = this.extractStreamQuality(stream);
        metricsService.recordStreamReturned(request.type, quality);
      });
      
      this.logger.info('Resultados do scraping inteligente', {
        quantidade: scrapedUniqueStreams.length,
        duration: `${Date.now() - startTime}ms`
      });
      
      await this.updateScrapingCache(request, scrapedUniqueStreams.length > 0);
      
      this.saveToCache(cacheKey, scrapedUniqueStreams);
      metricsService.setCacheSize(this.streamCache.size);
      return scrapedUniqueStreams;
    }
    
    this.saveToCache(cacheKey, uniqueStreams);
    metricsService.setCacheSize(this.streamCache.size);
    
    this.logger.debug('Streams do catalogo retornados', {
      requestId: request.id,
      quantidade: uniqueStreams.length,
      cacheKey
    });
    
    return uniqueStreams;
  }

  private async performIntelligentScraping(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const scrapeStartTime = Date.now();
    
    try {
      const type = request.type;
      const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
      const match = request.id.match(/tt\d+:(\d+):(\d+)/);
      
      this.logger.debug('Scraping inteligente iniciado', {
        requestId: request.id,
        type: type,
        imdbId: imdbId,
        season: season,
        episode: episode,
        match: !!match
      });

      const finalSeason = season !== undefined ? season : (match ? parseInt(match[1]) : undefined);
      const finalEpisode = episode !== undefined ? episode : (match ? parseInt(match[2]) : undefined);
      
      let tmdbSearchData: TmdbSearchData | null = null;
      let searchQuery: string | null = null;
      let seasonYear: number | null = null;
      
      if (imdbId) {
        tmdbSearchData = await this.getTmdbSearchData(imdbId, finalSeason);
        
        if (tmdbSearchData) {
          searchQuery = tmdbSearchData.searchTitle;
          seasonYear = tmdbSearchData.seasonYear;
          
          if (finalSeason && seasonYear) {
            this.logger.debug('TMDB: usando ano da temporada para busca', {
              imdbId,
              season: finalSeason,
              year: seasonYear,
              note: finalSeason > 1 ? 'Ano diferente da 1ª temporada - CORRETO' : 'Ano da 1ª temporada'
            });
          }
        }
      }

      if (!searchQuery || searchQuery === '') {
        this.logger.warn('Sem titulo para busca, usando fallback', {
          imdbId: imdbId,
          temTmdbData: !!tmdbSearchData
        });
        searchQuery = 'Unknown Title';
      }

      if (type === 'series' && match) {
        const seasonNum = parseInt(match[1]);
        searchQuery = `${searchQuery} Temporada ${seasonNum}`;
      }

      this.logger.debug('Scraping inteligente - busca torrents com parametros TMDB', {
        searchQuery: searchQuery,
        type: type,
        imdbId: imdbId,
        season: finalSeason,
        seasonYear: seasonYear,
        hasTmdbData: !!tmdbSearchData
      });

      // CORREÇÃO: imdbId pode ser null, converte para undefined
      const torrentResults = await this.torrentScraper.searchTorrents(
        searchQuery, 
        type, 
        finalSeason,
        seasonYear !== null ? seasonYear : undefined,
        imdbId || undefined  // ← CORREÇÃO AQUI
      );
      
      this.logger.debug('Scraping inteligente - resultados brutos', { 
        encontrados: torrentResults.length, 
        query: searchQuery,
        season: finalSeason,
        yearParam: seasonYear
      });

      if (torrentResults.length === 0) {
        this.logger.debug('Scraping inteligente - nenhum torrent encontrado', { 
          query: searchQuery,
          season: finalSeason,
          yearParam: seasonYear
        });
        return [];
      }

      const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
      
      const filteredTorrents = await this.filterAndValidateTorrents(
        deduplicatedTorrents,
        imdbId,
        request,
        finalSeason,
        finalEpisode,
        tmdbSearchData?.imdbTitles || null
      );
      
      this.logger.debug('Scraping inteligente - torrents filtrados', {
        total: deduplicatedTorrents.length,
        validos: filteredTorrents.valid.length,
        invalidos: filteredTorrents.invalid.length
      });

      if (filteredTorrents.valid.length === 0) {
        this.logger.debug('Scraping inteligente - nenhum torrent valido apos filtragem', {
          imdbId: imdbId,
          totalTestados: deduplicatedTorrents.length
        });
        return [];
      }

let episodeToSave: number | null | undefined = finalEpisode;
const hasCompletePack = filteredTorrents.valid.some(torrent => 
  torrent.title.toLowerCase().includes('temporada') && 
  !torrent.title.toLowerCase().match(/s\d+e\d+/i)
);

if (hasCompletePack && finalSeason) {
  this.logger.debug('Detectado pack de temporada completa, definindo episode como null para salvamento', {
    season: finalSeason,
    torrents: filteredTorrents.valid.map(t => t.title.substring(0, 40))
  });
  episodeToSave = null;
}

await this.saveValidTorrentsToCatalog(filteredTorrents.valid, request, finalSeason, episodeToSave, tmdbSearchData?.imdbTitles || null, hasCompletePack);

// CORREÇÃO: Para processTorrentsWithOptimization, usamos finalEpisode (não episodeToSave que pode ser null)
const streams = await this.processTorrentsWithOptimization(
  filteredTorrents.valid, 
  request, 
  finalSeason, 
  finalEpisode || undefined
);

      const sortedStreams = this.streamFormatter.sortStreamsByQuality(streams);

      this.logger.info('Scraping inteligente concluido', {
        requestId: request.id,
        torrents: filteredTorrents.valid.length,
        streams: sortedStreams.length,
        duration: `${Date.now() - scrapeStartTime}ms`,
        sistema: 'inteligente',
        parametrosUsados: {
          season: finalSeason,
          yearParam: seasonYear,
          episodeSalvoComo: episodeToSave === null ? 'null (pack)' : episodeToSave
        }
      });

      return sortedStreams;

    } catch (error) {
      this.logger.error('Erro no scraping inteligente', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        duration: `${Date.now() - scrapeStartTime}ms`
      });
      return [];
    }
  }

  private deduplicateTorrentsByMagnet(torrents: ScrapedTorrent[]): ScrapedTorrent[] {
    const seenMagnets = new Set<string>();
    const uniqueTorrents: ScrapedTorrent[] = [];
    
    for (const torrent of torrents) {
      const magnetHash = extractHashFromMagnet(torrent.magnet);
      if (magnetHash) {
        if (seenMagnets.has(magnetHash.toLowerCase())) continue;
        seenMagnets.add(magnetHash.toLowerCase());
      }
      uniqueTorrents.push(torrent);
    }
    
    if (torrents.length !== uniqueTorrents.length) {
      this.logger.debug('Torrents deduplicados', {
        antes: torrents.length,
        depois: uniqueTorrents.length,
        removidos: torrents.length - uniqueTorrents.length
      });
    }
    
    return uniqueTorrents;
  }

  private async filterAndValidateTorrents(
    torrents: ScrapedTorrent[],
    imdbId: string | null,
    request: any,
    season?: number,
    episode?: number,
    imdbTitles: ImdbTitles | null = null
  ): Promise<{ valid: ScrapedTorrent[], invalid: ScrapedTorrent[] }> {
    const valid: ScrapedTorrent[] = [];
    const invalid: ScrapedTorrent[] = [];
    
    this.logger.debug('Filtrando torrents', {
      total: torrents.length,
      imdbId: imdbId,
      type: request.type,
      season: season,
      episode: episode
    });

    if (!imdbId) {
      this.logger.debug('Sem IMDb ID, retornando todos');
      return { valid: torrents, invalid: [] };
    }

    for (const torrent of torrents) {
      try {
        this.logger.debug('Validando', {
          title: torrent.title.substring(0, 60),
          imdbId: imdbId
        });

        const titleMatchResult = await this.titleFilter.doTitlesMatch(
          torrent.title, 
          imdbId, 
          season, 
          episode
        );
        
        if (titleMatchResult.matches) {
          this.logger.debug('Valido', {
            title: torrent.title.substring(0, 60),
            reason: titleMatchResult.reason
          });
          valid.push(torrent);
        } else {
          this.logger.debug('Invalido', {
            title: torrent.title.substring(0, 60),
            reason: titleMatchResult.reason
          });
          invalid.push(torrent);
        }
      } catch (error) {
        this.logger.debug('Erro validacao', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
        invalid.push(torrent);
      }
    }

    this.logger.debug('Filtragem concluida', {
      total: torrents.length,
      validos: valid.length,
      invalidos: invalid.length
    });

    return { valid, invalid };
  }

  private async saveValidTorrentsToCatalog(
    validTorrents: ScrapedTorrent[],
    request: any,
    season?: number,
    episode?: number | null,
    imdbTitles: ImdbTitles | null = null,
    hasCompletePack: boolean = false
  ): Promise<void> {
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    
    this.logger.debug('Salvando torrents no catalogo', {
      count: validTorrents.length,
      imdbId: imdbId,
      type: request.type,
      season: season,
      episode: episode,
      episodeSalvoComo: episode === null ? 'null (pack completo)' : episode,
      hasCompletePack: hasCompletePack
    });

    if (!imdbId) {
      this.logger.debug('Sem IMDb ID, cancelando salvamento');
      return;
    }

    if (validTorrents.length === 0) {
      this.logger.debug('Nenhum torrent valido para salvar');
      return;
    }

    for (const torrent of validTorrents) {
      try {
        const episodeValue = hasCompletePack ? null : episode;
        
        this.logger.debug('Chamando AutoMagnetService com valor de episode', {
          title: torrent.title.substring(0, 60),
          season: season,
          episode: episodeValue,
          episodeTipo: episodeValue === null ? 'null' : typeof episodeValue
        });

        const result = await this.autoMagnetService.autoAddMagnet(
          torrent.magnet,
          torrent.title,
          imdbId,
          request.type,
          torrent.seeders,
          torrent.quality,
          torrent.size,
          season,
          episodeValue
        );

        this.logger.debug('Resultado autoAddMagnet', {
          title: torrent.title.substring(0, 60),
          success: result.success,
          magnetAdded: result.magnetAdded,
          reason: result.validation?.reason
        });

      } catch (error) {
        this.logger.error('Erro salvar magnet', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    this.logger.debug('Salvamento no catalogo concluido', {
      totalProcessados: validTorrents.length
    });
  }

  private async processTorrentsWithOptimization(
    torrents: ScrapedTorrent[],
    request: any,
    season?: number,
    episode?: number
  ): Promise<Stream[]> {
    const allStreams: Stream[] = [];
    const batchSize = 3;
    const delayBetweenTorrents = 800;

    for (let i = 0; i < torrents.length; i += batchSize) {
      const batch = torrents.slice(i, i + batchSize);
      const batchPromises = batch.map(async (torrent) => {
        try {
          if (request.type === 'series' && season !== undefined) {
            return this.streamFormatter.createMultipleQualityStreams(
              torrent,
              request,
              null,
              'series',
              season,
              episode,
              false
            );
          } else {
            return this.streamFormatter.createMultipleQualityStreams(
              torrent,
              request,
              null,
              'movie',
              undefined,
              undefined,
              false
            );
          }
        } catch (error) {
          return [];
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          allStreams.push(...result.value);
        }
      }

      if (i + batchSize < torrents.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenTorrents));
      }
    }

    return allStreams;
  }

  private async shouldAttemptScraping(request: any): Promise<boolean> {
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    const cacheEntry = this.scrapingCache.get(requestKey);
    
    if (cacheEntry) {
      const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
      if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2) return false;
      if (timeSinceLastAttempt < 5 * 60 * 1000) return false;
    }
    return true;
  }

  private async updateScrapingCache(request: any, successful: boolean): Promise<void> {
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    this.scrapingCache.set(requestKey, { lastAttempt: new Date(), successful });
    this.cleanupOldScrapingCache();
  }

  private cleanupOldScrapingCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    for (const [key, entry] of this.scrapingCache.entries()) {
      const age = now - entry.lastAttempt.getTime();
      if (age > this.scrapingCacheTTL * 2) toDelete.push(key);
    }
    for (const key of toDelete) this.scrapingCache.delete(key);
  }

  private generateCacheKey(request: any, season?: number, episode?: number): string {
    const baseId = request.imdbId || request.id;
    const type = request.type || 'unknown';
    const seasonStr = season !== undefined ? `s${season}` : '';
    const episodeStr = episode !== undefined ? `e${episode}` : '';
    
    return `${baseId}${this.CACHE_KEY_SEPARATOR}${type}${this.CACHE_KEY_SEPARATOR}${seasonStr}${episodeStr}`;
  }

  private getFromCache(cacheKey: string): Stream[] | null {
    const cacheEntry = this.streamCache.get(cacheKey);
    if (!cacheEntry) {
      metricsService.recordCacheMiss();
      return null;
    }

    const now = Date.now();
    const isExpired = cacheEntry.isEmpty 
      ? now - cacheEntry.timestamp > this.STREAM_EMPTY_TTL
      : now - cacheEntry.timestamp > this.STREAM_TTL;
    
    if (isExpired) {
      this.streamCache.delete(cacheKey);
      this.logger.debug('Cache expirado removido', { cacheKey });
      metricsService.recordCacheMiss();
      return null;
    }
    
    metricsService.recordCacheHit();
    this.logger.debug('Cache encontrado', { 
      cacheKey, 
      streams: cacheEntry.streams.length,
      age: now - cacheEntry.timestamp
    });
    
    return cacheEntry.streams;
  }

  private saveToCache(cacheKey: string, streams: Stream[]): void {
    const isEmpty = streams.length === 0;
    const ttl = isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
    
    this.streamCache.set(cacheKey, {
      streams,
      timestamp: Date.now(),
      isEmpty
    });
    
    if (this.streamCache.size > 10000) {
      this.cleanupOldCache();
    }
  }

  private cleanupOldCache(): void {
    const now = Date.now();
    let removed = 0;
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    
    for (const [key, entry] of this.streamCache.entries()) {
      if (now - entry.timestamp > maxAge) {
        this.streamCache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug('Cache antigo limpo', {
        removidos: removed,
        restantes: this.streamCache.size
      });
      metricsService.setCacheSize(this.streamCache.size);
    }
  }

  private async getStreamsFromDatabase(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const dbStartTime = Date.now();
    
    try {
      const baseImdbId = this.extractBaseImdbId(request.imdbId || request.id);
      if (!baseImdbId) {
        return [];
      }

      const finalSeason = season !== undefined ? season : request.season;
      const finalEpisode = episode !== undefined ? episode : request.episode;
      
      this.logger.debug('Buscando no banco de dados', {
        baseImdbId,
        type: request.type,
        season: finalSeason,
        episode: finalEpisode
      });

      let dbEntries: any[] = [];
      if (request.type === 'movie') {
        dbEntries = await getImdbIdMovieEntries(baseImdbId);
      } else if (request.type === 'series' && finalSeason !== undefined) {
        dbEntries = await getImdbIdSeriesEntries(baseImdbId, finalSeason, finalEpisode);
      }

      this.logger.debug('Resultados do banco', {
        baseImdbId,
        entradasEncontradas: dbEntries.length,
        type: request.type,
        season: finalSeason,
        episode: finalEpisode,
        duration: `${Date.now() - dbStartTime}ms`
      });

      if (dbEntries.length === 0) {
        return [];
      }

      const torrentData = await this.processDatabaseTorrents(dbEntries, request, finalSeason, finalEpisode);
      const sortedTorrents = this.sortTorrentsByQuality(torrentData);
      const streams = await this.createStreamsFromDbTorrents(sortedTorrents, request, finalSeason, finalEpisode);

      this.logger.info('Streams criados do banco', {
        baseImdbId,
        torrents: torrentData.length,
        streams: streams.length,
        duration: `${Date.now() - dbStartTime}ms`
      });

      return streams;

    } catch (error) {
      this.logger.error('Erro na busca no banco', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        duration: `${Date.now() - dbStartTime}ms`
      });
      return [];
    }
  }

  private async processDatabaseTorrents(dbEntries: any[], request: any, season?: number, episode?: number): Promise<any[]> {
    const torrentMap = new Map<string, any>();
    
    this.logger.debug('Processando torrents do banco', {
      totalEntradas: dbEntries.length,
      season,
      episode
    });

    for (const entry of dbEntries) {
      try {
        const torrent = entry.Torrent;
        const magnet = torrent.magnetLink || '';
        const magnetHash = extractHashFromMagnet(magnet);
        
        if (!magnetHash) {
          continue;
        }

        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        const quality = this.qualityDetector.extractBestQuality(torrent.title) || 'HD';
        const seeds = torrent.seeders || 50;
        const size = torrent.size ? this.formatSize(torrent.size) : 'N/A';
        const language = torrent.languages || 'PT-BR';
        const qualityScore = this.getQualityScore(quality);

        torrentMap.set(magnetHash, {
          torrent,
          metadata,
          quality,
          qualityScore,
          seeds,
          size,
          language,
          magnet,
          magnetHash,
          title: torrent.title,
          requestType: request.type,
          season: season,
          episode: episode
        });

      } catch (error) {
        this.logger.debug('Erro ao processar torrent do banco', {
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
      }
    }

    const torrents = Array.from(torrentMap.values());
    
    this.logger.debug('Torrents processados do banco', {
      totalEntradas: dbEntries.length,
      torrentsUnicos: torrents.length
    });
    
    return torrents;
  }

  private async createStreamsFromDbTorrents(torrents: any[], request: any, season?: number, episode?: number): Promise<Stream[]> {
    const streams: Stream[] = [];

    for (const torrentData of torrents) {
      try {
        this.logger.debug('Criando stream do banco', {
          titulo: torrentData.title.substring(0, 80),
          qualidade: torrentData.quality,
          seeds: torrentData.seeds,
          season,
          episode
        });

        const formattedTorrent = {
          title: torrentData.title,
          magnet: torrentData.magnet,
          seeders: torrentData.seeds,
          size: torrentData.size,
          quality: torrentData.quality,
          language: torrentData.language
        };
        
        const streamArrays = this.streamFormatter.createMultipleQualityStreams(
          formattedTorrent,
          request,
          null,
          torrentData.requestType,
          season,
          episode,
          undefined,
          0
        );

        streams.push(...streamArrays);

      } catch (error) {
        this.logger.error('Erro ao criar stream do banco', {
          titulo: torrentData.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    return streams;
  }

  private async getStreamsFromJson(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const jsonStartTime = Date.now();
    
    try {
      const curatedMagnets = this.magnetService.searchMagnets(request);

      this.logger.debug('Resultados do JSON obtidos', {
        magnetsEncontrados: curatedMagnets.length,
        imdbId: request.imdbId || request.id
      });

      if (curatedMagnets.length === 0) {
        return [];
      }

      const streams: Stream[] = [];
      
      for (const magnet of curatedMagnets) {
        try {
          const formattedTorrent = {
            title: magnet.title,
            magnet: magnet.magnet || '',
            seeders: magnet.seeds || 0,
            size: magnet.size || 'N/A',
            quality: magnet.quality || 'HD',
            language: magnet.language || 'PT-BR'
          };
          
          const isSeries = request.type === 'series';
          const targetSeason = season !== undefined ? season : magnet.season;
          const targetEpisode = episode !== undefined ? episode : magnet.episode;
          
          const streamArrays = this.streamFormatter.createMultipleQualityStreams(
            formattedTorrent,
            request,
            null,
            isSeries ? 'series' : 'movie',
            targetSeason,
            targetEpisode,
            undefined,
            0
          );
          
          if (streamArrays.length > 0) {
            streams.push(...streamArrays);
          }
        } catch (error) {
          this.logger.error('Erro ao processar magnet do JSON', {
            titulo: magnet.title.substring(0, 60),
            error: error instanceof Error ? error.message : 'Erro desconhecido'
          });
        }
      }

      this.logger.info('Streams do JSON criados', {
        quantidade: streams.length,
        duration: `${Date.now() - jsonStartTime}ms`
      });

      return streams;

    } catch (error) {
      this.logger.error('Erro na busca no JSON', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        duration: `${Date.now() - jsonStartTime}ms`
      });
      return [];
    }
  }

  private removeDuplicatesByInfoHash(streams: Stream[]): Stream[] {
    const seenStreamKeys = new Set<string>();
    const uniqueStreams: Stream[] = [];
    
    for (const stream of streams) {
      const streamInfoHash = stream.infoHash || 'unknown';
      const streamQuality = this.extractStreamQuality(stream);
      
      if (!streamInfoHash || streamInfoHash === 'unknown') {
        const fallbackKey = stream.title || String(Math.random());
        if (seenStreamKeys.has(fallbackKey)) {
          continue;
        }
        seenStreamKeys.add(fallbackKey);
        uniqueStreams.push(stream);
        continue;
      }
      
      const streamKey = `${streamInfoHash}|${streamQuality}`;
      
      if (seenStreamKeys.has(streamKey)) {
        continue;
      }
      
      seenStreamKeys.add(streamKey);
      uniqueStreams.push(stream);
    }
    
    if (streams.length !== uniqueStreams.length) {
      this.logger.debug('Streams deduplicados', {
        antes: streams.length,
        depois: uniqueStreams.length,
        removidos: streams.length - uniqueStreams.length,
        criterio: 'infoHash + qualidade',
        versaoFormato: '1.4.0'
      });
    }
    
    return uniqueStreams;
  }

  private extractStreamQuality(stream: Stream): string {
    const behaviorHints = stream.behaviorHints as any;
    if (behaviorHints?.streamQuality) {
      return behaviorHints.streamQuality;
    }
    
    const qualityFromTitle = this.qualityDetector.extractBestQuality(stream.title || '');
    if (qualityFromTitle && qualityFromTitle !== 'unknown') {
      return qualityFromTitle;
    }
    
    return 'unknown';
  }

  private extractSeasonEpisodeFromRequest(request: any): { season?: number, episode?: number } {
    let season = request.season;
    let episode = request.episode;
    
    if (!season && request.type === 'series' && request.id) {
      const seasonEpisodeMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
      if (seasonEpisodeMatch) {
        season = parseInt(seasonEpisodeMatch[1]);
        episode = parseInt(seasonEpisodeMatch[2]);
      }
    }
    
    return { season, episode };
  }

  private extractBaseImdbId(id: string): string | null {
    const match = id.match(/^(tt\d+)/);
    return match ? match[1] : null;
  }

  private sortTorrentsByQuality(torrents: any[]): any[] {
    return torrents.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      
      if (b.seeds !== a.seeds) {
        return b.seeds - a.seeds;
      }
      
      return a.title.localeCompare(b.title);
    });
  }

  private getQualityScore(quality: string): number {
    const scores: Record<string, number> = {
      '2160p': 100,
      '4k': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };
    return scores[quality] || 30;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
  }

  clearTmdbCache(): void {
    const sizeBefore = this.tmdbDataCache.size;
    this.tmdbDataCache.clear();
    this.logger.debug('Cache TMDB limpo', {
      itensRemovidos: sizeBefore,
      itensRestantes: 0
    });
  }

  getTmdbCacheStats() {
    return {
      totalItens: this.tmdbDataCache.size,
      ttl: this.TMDB_CACHE_TTL,
      descricao: 'Cache de dados TMDB para parametros de busca'
    };
  }

  getStats() {
    return {
      version: this.VERSION,
      cacheSize: this.streamCache.size,
      scrapingCacheSize: this.scrapingCache.size,
      tmdbCacheSize: this.tmdbDataCache.size,
      features: [
        'Fix: Passa imdbId para TorrentScraperService',
        'TorrentScraperService integrado com TMDB para queries inteligentes',
        'Corrige passagem de null para packs de temporada',
        'Envia episode como null para packs completos corretamente',
        'TMDB data publica para delegar parametros de busca',
        'Fluxo: Banco -> JSON -> Scraping Inteligente',
        'Deduplicacao por infoHash (formato v1.4.0 compativel)',
        'Cache inteligente com TTL diferenciado',
        'Scraping com cache de tentativas',
        'Integracao TMDB para titulos e anos',
        'Parametros de temporada e ano delegaveis para TorrentScraper'
      ],
      fluxo: 'PostgreSQL > magnets.json > Scraping Inteligente > Auto-populacao',
      novosMetodosPublicos: [
        'getTmdbSearchData() - Obtem dados TMDB para busca',
        'getSeasonYear() - Obtem ano especifico da temporada',
        'getTmdbCacheStats() - Estatisticas do cache TMDB',
        'clearTmdbCache() - Limpa cache TMDB'
      ],
      fixs: [
        'Passa imdbId para TorrentScraperService (linha 123)',
        'Corrige passagem de null para AutoMagnetService',
        'Packs de temporada completa salvos com episode: null',
        'Logs detalhados para debug de valores de episode'
      ]
    };
  }
}