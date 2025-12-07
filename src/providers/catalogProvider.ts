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

export class CatalogProvider {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;
  private readonly streamFormatter: StreamFormatter;
  private readonly metadataExtractor: MetadataExtractor;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly titleFilter: TitleFilter;
  private readonly autoMagnetService: AutoMagnetService;

  // Versionamento Semantico v4.4.0 - Cache avançado integrado
  private readonly VERSION = '4.4.0';

  // Cache de streams com stale-while-revalidate
  private readonly streamCache: Map<string, { streams: Stream[], timestamp: number, isEmpty: boolean }> = new Map();
  private readonly STREAM_TTL = 24 * 60 * 60 * 1000;
  private readonly STREAM_EMPTY_TTL = 60 * 1000;
  private readonly STALE_REVALIDATE_TIME = 5 * 60 * 1000;
  private readonly CACHE_KEY_SEPARATOR = '|';

  // Cache para resultados de scraping com TTL mais curto
  private readonly scrapeCache: Map<string, { streams: Stream[], timestamp: number }> = new Map();
  private readonly SCRAPE_TTL = 30 * 60 * 1000;

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
    
    this.logger.info(`CatalogProvider v${this.VERSION} inicializado - Cache avançado integrado`);
  }

  async getStreamsFromCatalog(request: any): Promise<Stream[]> {
    const startTime = Date.now();
    const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
    const cacheKey = this.generateCacheKey(request, season, episode);

    // Verificar cache antes de processar
    const cachedStreams = this.getFromCache(cacheKey);
    if (cachedStreams !== null) {
      const duration = Date.now() - startTime;
      this.logger.debug('Resultado obtido do cache', {
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
      temApiKey: !!request.apiKey,
      season,
      episode
    });
    
    // Buscar streams do banco de dados
    const dbStreams = await this.getStreamsFromDatabase(request, season, episode);
    
    // Buscar streams do JSON curatado
    const jsonStreams = await this.getStreamsFromJson(request, season, episode);
    
    // Combinar resultados
    const catalogStreams = [...dbStreams, ...jsonStreams];
    
    // Remover duplicados mas manter qualidades diferentes
    const catalogUniqueStreams = this.removeDuplicateSourcesButKeepQualities(catalogStreams);
    
    // Registrar métricas
    catalogUniqueStreams.forEach(stream => {
      const quality = this.extractStreamQuality(stream);
      metricsService.recordStreamReturned(request.type, quality);
    });
    
    this.logger.info('Resultados catalogo obtidos', {
      total: catalogUniqueStreams.length,
      doBanco: dbStreams.length,
      doJson: jsonStreams.length,
      duplicadosRemovidos: catalogStreams.length - catalogUniqueStreams.length,
      duration: `${Date.now() - startTime}ms`
    });
    
    if (catalogUniqueStreams.length > 0) {
      this.saveToCache(cacheKey, catalogUniqueStreams);
      metricsService.setCacheSize(this.streamCache.size);
      
      this.logger.debug('Streams encontrados no catalogo, retornando', {
        requestId: request.id,
        quantidade: catalogUniqueStreams.length,
        cacheKey
      });
      return catalogUniqueStreams;
    }
    
    this.logger.debug('Nenhum stream no catalogo, tentando scraping', {
      requestId: request.id,
      type: request.type,
      season,
      episode
    });
    
    // Fallback para scraping
    const scrapedStreams = await this.performScrapingFallback(request, season, episode);
    
    // Remover duplicados mas manter qualidades diferentes
    const scrapedUniqueStreams = this.removeDuplicateSourcesButKeepQualities(scrapedStreams);
    
    // Registrar métricas dos streams raspados
    scrapedUniqueStreams.forEach(stream => {
      const quality = this.extractStreamQuality(stream);
      metricsService.recordStreamReturned(request.type, quality);
    });
    
    this.logger.info('Resultados scraping obtidos', {
      total: scrapedUniqueStreams.length,
      fonte: 'scraping',
      duplicadosRemovidos: scrapedStreams.length - scrapedUniqueStreams.length,
      duration: `${Date.now() - startTime}ms`
    });

    // Salvar resultado no cache (mesmo se vazio)
    this.saveToCache(cacheKey, scrapedUniqueStreams);
    metricsService.setCacheSize(this.streamCache.size);
    
    return scrapedUniqueStreams;
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
    const isFullyExpired = now - cacheEntry.timestamp > this.STREAM_TTL;
    const isStale = now - cacheEntry.timestamp > this.STREAM_TTL - this.STALE_REVALIDATE_TIME;
    
    if (isFullyExpired) {
      this.streamCache.delete(cacheKey);
      this.logger.debug('Cache expirado e removido', { cacheKey });
      metricsService.recordCacheMiss();
      return null;
    }
    
    if (isStale && !cacheEntry.isEmpty) {
      // Serve conteúdo stale e revalida em background
      this.revalidateInBackground(cacheKey, cacheEntry.streams);
      this.logger.debug('Cache stale servido, revalidando em background', { 
        cacheKey, 
        streams: cacheEntry.streams.length,
        age: now - cacheEntry.timestamp
      });
      metricsService.recordCacheHit();
    } else {
      metricsService.recordCacheHit();
    }
    
    this.logger.debug('Cache HIT', { 
      cacheKey, 
      streams: cacheEntry.streams.length,
      age: now - cacheEntry.timestamp,
      stale: isStale
    });
    
    return cacheEntry.streams;
  }

  private revalidateInBackground(cacheKey: string, currentStreams: Stream[]): void {
    // Executa em background sem bloquear resposta
    setImmediate(async () => {
      try {
        // Extrai informações da chave para revalidação
        const [baseId, type, seasonEpisode] = cacheKey.split(this.CACHE_KEY_SEPARATOR);
        const season = seasonEpisode?.startsWith('s') ? parseInt(seasonEpisode.slice(1)) : undefined;
        const episode = seasonEpisode?.includes('e') ? parseInt(seasonEpisode.split('e')[1]) : undefined;
        
        // Aqui poderia fazer nova busca para atualizar cache
        // Por enquanto apenas log
        this.logger.debug('Revalidação em background iniciada', {
          cacheKey,
          baseId,
          type,
          season,
          episode
        });
        
      } catch (error) {
        this.logger.debug('Erro na revalidação em background', { 
          cacheKey,
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
      }
    });
  }

  private saveToCache(cacheKey: string, streams: Stream[]): void {
    const isEmpty = streams.length === 0;
    const ttl = isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
    
    this.streamCache.set(cacheKey, {
      streams,
      timestamp: Date.now(),
      isEmpty
    });
    
    // Limpar cache se ficar muito grande (LRU simples)
    if (this.streamCache.size > 10000) {
      this.cleanupOldCache();
    }
  }

  private cleanupOldCache(): void {
    const now = Date.now();
    let removed = 0;
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 dias máximo
    
    for (const [key, entry] of this.streamCache) {
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
        temporada: finalSeason,
        episodio: finalEpisode
      });

      let dbEntries: any[] = [];
      if (request.type === 'movie') {
        dbEntries = await getImdbIdMovieEntries(baseImdbId);
      } else if (request.type === 'series' && finalSeason !== undefined) {
        dbEntries = await getImdbIdSeriesEntries(baseImdbId, finalSeason, finalEpisode);
      }

      this.logger.debug('Resultados banco encontrados', {
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
      const sortedTorrents = this.sortTorrentsHierarchically(torrentData);
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

        if (torrentMap.has(magnetHash)) {
          const existingTorrent = torrentMap.get(magnetHash);
          if (!existingTorrent.episodes) {
            existingTorrent.episodes = [];
          }
          existingTorrent.episodes.push({
            season: entry.imdbSeason,
            episode: entry.imdbEpisode,
            title: entry.title
          });
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
          episode: episode,
          episodes: [{
            season: entry.imdbSeason,
            episode: entry.imdbEpisode,
            title: entry.title
          }]
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
      torrentsUnicos: torrents.length,
      torrentsComMultiplosEpisodios: torrents.filter(t => t.episodes && t.episodes.length > 1).length
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
          undefined
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

  private sortTorrentsHierarchically(torrents: any[]): any[] {
    return torrents.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      
      if (b.seeds !== a.seeds) {
        return b.seeds - a.seeds;
      }
      
      const sizeA = this.parseSizeToBytes(a.size);
      const sizeB = this.parseSizeToBytes(b.size);
      if (sizeB !== sizeA) {
        return sizeB - sizeA;
      }
      
      return a.title.localeCompare(b.title);
    });
  }

  private async getStreamsFromJson(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const jsonStartTime = Date.now();
    
    try {
      const curatedMagnets = this.magnetService.searchMagnets(request);

      this.logger.debug('Resultados JSON obtidos', {
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
            undefined
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

  private async performScrapingFallback(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const scrapeStartTime = Date.now();
    
    // Verificar cache de scraping
    const scrapeCacheKey = this.generateScrapeCacheKey(request, season, episode);
    const cachedScrape = this.scrapeCache.get(scrapeCacheKey);
    
    if (cachedScrape && (Date.now() - cachedScrape.timestamp) < this.SCRAPE_TTL) {
      this.logger.debug('Scraping cache HIT', {
        cacheKey: scrapeCacheKey,
        streams: cachedScrape.streams.length
      });
      metricsService.recordCacheHit();
      return cachedScrape.streams;
    }

    this.logger.debug('Iniciando scraping como fallback', {
      requestId: request.id,
      type: request.type,
      season: season,
      episode: episode
    });

    try {
      const imdbId = this.extractBaseImdbId(request.id);
      
      let scrapedStreams: Stream[] = [];
      if (request.type === 'series') {
        scrapedStreams = await this.scrapeSeries(request, imdbId, season, episode);
      } else {
        scrapedStreams = await this.scrapeMovie(request, imdbId);
      }

      // Salvar no cache de scraping
      this.scrapeCache.set(scrapeCacheKey, {
        streams: scrapedStreams,
        timestamp: Date.now()
      });

      this.logger.info('Scraping concluido', {
        streams: scrapedStreams.length,
        duration: `${Date.now() - scrapeStartTime}ms`
      });

      return scrapedStreams;

    } catch (error) {
      this.logger.error('Erro no scraping fallback', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Erro',
        duration: `${Date.now() - scrapeStartTime}ms`
      });
      return [];
    }
  }

  private generateScrapeCacheKey(request: any, season?: number, episode?: number): string {
    const baseId = request.imdbId || request.id;
    const type = request.type || 'unknown';
    const seasonStr = season !== undefined ? `s${season}` : '';
    const episodeStr = episode !== undefined ? `e${episode}` : '';
    
    return `scrape:${baseId}:${type}:${seasonStr}${episodeStr}`;
  }

  private async scrapeSeries(request: any, imdbId: string | null, season?: number, episode?: number): Promise<Stream[]> {
    const match = request.id.match(/tt\d+:(\d+):(\d+)/);
    
    const finalSeason = season !== undefined ? season : (match ? parseInt(match[1]) : undefined);
    const finalEpisode = episode !== undefined ? episode : (match ? parseInt(match[2]) : undefined);

    if (!finalSeason || !finalEpisode) {
      this.logger.warn('Season ou episode nao definido para scraping serie', {
        imdbId,
        season: finalSeason,
        episode: finalEpisode
      });
      return [];
    }

    this.logger.debug('Scraping serie especifica', {
      imdbId,
      season: finalSeason,
      episode: finalEpisode
    });

    try {
      let imdbTitles: ImdbTitles | null = null;
      if (imdbId) {
        imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, finalSeason);
      }

      const searchTitle = imdbTitles?.allTitles[0] || 'Serie';
      const searchQuery = `${searchTitle} S${finalSeason.toString().padStart(2, '0')}E${finalEpisode.toString().padStart(2, '0')}`;

      this.logger.debug('Query scraping serie', {
        searchQuery,
        season: finalSeason,
        episode: finalEpisode
      });

      const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', finalSeason);
      
      if (torrentResults.length === 0) {
        this.logger.debug('Nenhum torrent encontrado no scraping', { searchQuery });
        return [];
      }

      const validTorrents = await this.filterScrapedTorrents(torrentResults, imdbId, request, finalSeason, finalEpisode, imdbTitles);
      
      if (validTorrents.length === 0) {
        this.logger.debug('Nenhum torrent valido apos filtragem', {
          totalTestados: torrentResults.length
        });
        return [];
      }

      this.logger.debug('Torrents validos encontrados no scraping', {
        total: validTorrents.length,
        torrents: validTorrents.map(t => ({
          titulo: t.title.substring(0, 60),
          seeders: t.seeders,
          qualidade: t.quality
        }))
      });

      await this.saveScrapedTorrentsToCatalog(validTorrents, request, imdbId, finalSeason, finalEpisode);

      const allStreams: Stream[] = [];
      
      for (const torrent of validTorrents) {
        const formattedTorrent = {
          title: torrent.title,
          magnet: torrent.magnet,
          seeders: torrent.seeders,
          size: torrent.size,
          quality: torrent.quality,
          language: torrent.language
        };
        
        const torrentStreams = this.streamFormatter.createMultipleQualityStreams(
          formattedTorrent,
          request,
          null,
          'series',
          finalSeason,
          finalEpisode,
          undefined
        );
        
        allStreams.push(...torrentStreams);
      }

      const uniqueStreams = this.removeDuplicateSourcesButKeepQualities(allStreams);

      this.logger.info('Streams criados do scraping', {
        quantidade: uniqueStreams.length,
        fonte: 'scraping',
        torrentsProcessados: validTorrents.length,
        season: finalSeason,
        episode: finalEpisode
      });

      return uniqueStreams;

    } catch (error) {
      this.logger.error('Erro no scraping serie', {
        imdbId,
        season: finalSeason,
        episode: finalEpisode,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return [];
    }
  }

  private async scrapeMovie(request: any, imdbId: string | null): Promise<Stream[]> {
    this.logger.debug('Scraping filme', { imdbId });

    try {
      let imdbTitles: ImdbTitles | null = null;
      if (imdbId) {
        imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
      }

      const searchTitle = imdbTitles?.allTitles[0] || 'Filme';
      const searchQuery = searchTitle;

      this.logger.debug('Query scraping filme', { searchQuery });

      const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'movie');
      
      if (torrentResults.length === 0) {
        this.logger.debug('Nenhum torrent encontrado no scraping', { searchQuery });
        return [];
      }

      const validTorrents = await this.filterScrapedTorrents(torrentResults, imdbId, request);
      
      if (validTorrents.length === 0) {
        this.logger.debug('Nenhum torrent valido apos filtragem', {
          totalTestados: torrentResults.length
        });
        return [];
      }

      const streams: Stream[] = [];
      for (const torrent of validTorrents) {
        const formattedTorrent = {
          title: torrent.title,
          magnet: torrent.magnet,
          seeders: torrent.seeders,
          size: torrent.size,
          quality: torrent.quality,
          language: torrent.language
        };
        
        const torrentStreams = this.streamFormatter.createMultipleQualityStreams(
          formattedTorrent,
          request,
          null,
          'movie',
          undefined,
          undefined,
          undefined
        );
        
        streams.push(...torrentStreams);
      }

      await this.saveScrapedTorrentsToCatalog(validTorrents, request, imdbId);

      this.logger.info('Streams criados do scraping', {
        quantidade: streams.length,
        fonte: 'scraping',
        torrentsValidos: validTorrents.length
      });

      return this.streamFormatter.sortStreamsByQuality(streams);

    } catch (error) {
      this.logger.error('Erro no scraping filme', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return [];
    }
  }

  private async filterScrapedTorrents(
    torrents: ScrapedTorrent[],
    imdbId: string | null,
    request: any,
    season?: number,
    episode?: number,
    imdbTitles: ImdbTitles | null = null
  ): Promise<ScrapedTorrent[]> {
    const valid: ScrapedTorrent[] = [];
    
    this.logger.debug('Filtrando torrents do scraping', {
      total: torrents.length,
      imdbId: imdbId,
      season: season,
      episode: episode
    });

    if (!imdbId) {
      return torrents;
    }

    for (const torrent of torrents) {
      try {
        const titleMatchResult = await this.titleFilter.doTitlesMatch(
          torrent.title, 
          imdbId, 
          season, 
          episode
        );
        
        if (titleMatchResult.matches) {
          valid.push(torrent);
        }
      } catch (error) {
        this.logger.debug('Erro filtragem torrent', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    this.logger.debug('Filtragem scraping concluida', {
      total: torrents.length,
      validos: valid.length,
      invalidos: torrents.length - valid.length
    });

    return valid;
  }

  private async saveScrapedTorrentsToCatalog(
    validTorrents: ScrapedTorrent[],
    request: any,
    imdbId: string | null,
    season?: number,
    episode?: number
  ): Promise<void> {
    if (!imdbId || validTorrents.length === 0) {
      return;
    }

    this.logger.debug('Salvando torrents do scraping no catalogo', {
      count: validTorrents.length,
      imdbId: imdbId,
      type: request.type,
      season: season,
      episode: episode
    });

    for (const torrent of validTorrents) {
      try {
        await this.autoMagnetService.autoAddMagnet(
          torrent.magnet,
          torrent.title,
          imdbId,
          request.type,
          torrent.seeders,
          torrent.quality,
          torrent.size,
          season,
          episode
        );
      } catch (error) {
        this.logger.warn('Erro salvar torrent do scraping', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    this.logger.debug('Torrents do scraping salvos', {
      totalProcessados: validTorrents.length
    });
  }

  private removeDuplicateSourcesButKeepQualities(streams: Stream[]): Stream[] {
    const seenStreamKeys = new Set<string>();
    const uniqueStreams: Stream[] = [];
    
    for (const stream of streams) {
      const streamUrl = stream.sources && stream.sources[0];
      const streamQuality = this.extractStreamQuality(stream);
      
      if (!streamUrl) {
        continue;
      }
      
      const streamKey = `${streamUrl}|${streamQuality}`;
      
      if (seenStreamKeys.has(streamKey)) {
        continue;
      }
      
      seenStreamKeys.add(streamKey);
      uniqueStreams.push(stream);
    }
    
    if (streams.length !== uniqueStreams.length) {
      this.logger.debug('Streams deduplicados (mantendo qualidades)', {
        antes: streams.length,
        depois: uniqueStreams.length,
        removidos: streams.length - uniqueStreams.length
      });
    }
    
    return uniqueStreams;
  }

  private extractStreamQuality(stream: Stream): string {
    const behaviorHints = stream.behaviorHints as any;
    if (behaviorHints?.streamQuality) {
      return behaviorHints.streamQuality;
    }
    
    const qualityMatch = stream.title?.match(/\((.*?)\)/) || stream.name?.match(/\((.*?)\)/);
    if (qualityMatch) {
      return qualityMatch[1];
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

  private formatLanguage(language: string): string {
    if (!language) return 'PT-BR';
    
    const langMap: Record<string, string> = {
      'pt-BR': 'PT-BR',
      'pt-BR,en': 'Dual',
      'en': 'EN',
      'dual': 'Dual',
      'multi': 'Multi',
      'pt': 'PT-BR',
      'pt-BR,en-US': 'Dual',
      'pt-BR,en-US,ja-JP': 'Multi'
    };
    return langMap[language] || language;
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

  private parseSizeToBytes(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'N/A') return 0;
    
    const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    switch (unit) {
      case 'KB': return value * 1024;
      case 'MB': return value * 1024 * 1024;
      case 'GB': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  getStats() {
    return {
      version: this.VERSION,
      cacheSize: this.streamCache.size,
      scrapeCacheSize: this.scrapeCache.size,
      features: [
        'Cache inteligente com stale-while-revalidate',
        'Cache separado para resultados de scraping',
        'Métricas integradas com Prometheus',
        'LRU automático para gerenciamento de memória',
        'Revalidação em background para conteúdo stale',
        'Duração das operações registrada em logs'
      ],
      ttlConfig: {
        streamCache: '24 horas',
        streamEmptyCache: '1 minuto',
        scrapeCache: '30 minutos',
        staleRevalidate: '5 minutos'
      }
    };
  }
}