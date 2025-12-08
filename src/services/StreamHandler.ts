import { RealDebridService } from './RealDebridService';
import { CuratedMagnetService } from './CuratedMagnetService';
import { AutoMagnetService } from './AutoMagnetService';
import { CacheService } from './CacheService';
import { TorrentScraperService } from './scraper/TorrentScraperService';
import { ImdbScraperService, ImdbTitles } from './ImdbScraperService';
import { Logger } from '../utils/logger';
import { Stream, StreamRequest, CuratedMagnet } from '../types/index';
import { Op } from 'sequelize';
import { Torrent, File } from '../database/models';
import { QualityDetector } from '../lib/qualityDetector';
import { extractHashFromMagnet, generateLazyResolveUrl } from '../lib/magnetHelper';
import { TitleFilter } from '../lib/titleFilter';
import { StreamFormatter } from '../lib/streamFormatter';
import { CatalogProvider } from '../providers/catalogProvider';
import { StaticResponseService, StaticResponse } from './StaticResponseService';
import { StreamStatusException } from './StreamStatusException';

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

interface StreamProcessingConfig {
  maxConcurrentTorrents: number;
  delayBetweenTorrents: number;
}

interface DatabaseStreamResult {
  success: boolean;
  streams: Stream[];
  source: 'database' | 'catalog' | 'scraping';
  processingTime: number;
}

interface ScrapingCacheEntry {
  lastAttempt: Date;
  successful: boolean;
}

export class StreamHandler {
  private readonly rdService: RealDebridService;
  private readonly magnetService: CuratedMagnetService;
  private readonly autoMagnetService: AutoMagnetService;
  private readonly cacheService: CacheService;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly logger: Logger;
  private staticResponseService: StaticResponseService;
  private readonly qualityDetector: QualityDetector;
  private readonly titleFilter: TitleFilter;
  private readonly streamFormatter: StreamFormatter;
  private readonly catalogProvider: CatalogProvider;

  private readonly processingConfig: StreamProcessingConfig = {
    maxConcurrentTorrents: 3,
    delayBetweenTorrents: 800
  };

  private scrapingCache = new Map<string, ScrapingCacheEntry>();
  private readonly scrapingCacheTTL = 6 * 60 * 60 * 1000;

  private stats = {
    totalRequests: 0,
    servedFromDatabase: 0,
    servedFromCatalog: 0,
    servedFromScraping: 0,
    duplicatesRemoved: 0,
    servedInformativeStreams: 0
  };

  constructor(baseUrl?: string) {
    this.rdService = new RealDebridService(baseUrl);
    this.magnetService = new CuratedMagnetService();
    this.autoMagnetService = new AutoMagnetService();
    this.cacheService = new CacheService();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = new ImdbScraperService();
    this.logger = new Logger('StreamHandler');
    this.logger.info('v5.0.0 inicializado - Fix completo TMDB Season');
    this.staticResponseService = new StaticResponseService(baseUrl);
    this.qualityDetector = new QualityDetector();
    this.titleFilter = new TitleFilter();
    this.streamFormatter = new StreamFormatter();
    this.catalogProvider = new CatalogProvider(this.magnetService);
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
    this.rdService.setStaticResponseBaseUrl(baseUrl);
  }

private deduplicateStreamsByInfoHash(streams: Stream[]): Stream[] {
    const seenCombinations = new Set<string>();
    const uniqueStreams: Stream[] = [];
    
    for (const stream of streams) {
        // 1. OBTÉM INFO_HASH (Formato Novo - campo direto)
        //    O infoHash agora vem diretamente no objeto stream
        let infoHash: string | undefined = stream.infoHash?.toLowerCase();
        
        // 2. OBTÉM QUALIDADE (Formato Novo - extrai do título ou behaviorHints)
        let quality = 'unknown';
        
        // Tenta extrair do behaviorHints primeiro (mais confiável)
        if (stream.behaviorHints?.streamQuality) {
            quality = stream.behaviorHints.streamQuality;
        } 
        // Se não tiver, tenta extrair do título (fallback)
        else if (stream.title) {
            const qualityMatch = stream.title.match(/\((\d+p|4K|HD|SD|2160p|1080p|720p|480p)\)/i);
            if (qualityMatch) {
                quality = qualityMatch[1].toLowerCase();
            }
        }
        
        // 3. CRIA CHAVE ÚNICA PARA DEDUPLICAÇÃO
        //    Combinação de infoHash e qualidade
        let uniqueKey: string;
        
        if (infoHash) {
            // Caso ideal: tem infoHash, usa ele + qualidade
            uniqueKey = `${infoHash}_${quality}`;
        } else {
            // Fallback extremo: se não tem infoHash, usa título completo
            // Isso é raro, mas previne erro
            this.logger.warn('Stream sem infoHash encontrado, usando título para dedup', {
                title: stream.title?.substring(0, 50)
            });
            uniqueKey = stream.title || `stream_${Math.random()}`;
        }
        
        // 4. VERIFICA SE JÁ VIU ESTA COMBINAÇÃO
        if (seenCombinations.has(uniqueKey)) {
            this.stats.duplicatesRemoved++;
            this.logger.debug('Stream duplicado removido', {
                infoHash: infoHash ? `${infoHash.substring(0, 8)}...` : 'none',
                quality: quality,
                uniqueKey: uniqueKey
            });
            continue;
        }
        
        // 5. ADICIONA À LISTA DE ÚNICOS
        seenCombinations.add(uniqueKey);
        uniqueStreams.push(stream);
    }
    
    // 6. LOG DE RESULTADOS
    if (streams.length !== uniqueStreams.length) {
        this.logger.debug('Deduplicação de streams concluída', {
            totalInicial: streams.length,
            totalFinal: uniqueStreams.length,
            duplicadosRemovidos: streams.length - uniqueStreams.length,
            formato: 'v1.4.0_compatible'
        });
    }
    
    return uniqueStreams;
}

  async handleStreamRequest(request: StreamRequest): Promise<{ streams: Stream[] }> {
    const requestId = request.id;
    const requestStartTime = Date.now();
    this.stats.totalRequests++;

    this.logger.debug('Processando request', {
      requestId,
      type: request.type,
      hasApiKey: !!request.apiKey
    });

    if (!request.apiKey) return { streams: [] };

    try {
      await this.magnetService.waitForInitialization();

      const dbResult = await this.getStreamsFromDatabase(request);
      if (dbResult.success && dbResult.streams.length > 0) {
        const dedupedStreams = this.deduplicateStreamsByInfoHash(dbResult.streams);
        this.stats.servedFromDatabase++;
        this.logger.debug('Streams do banco', {
          requestId,
          antes: dbResult.streams.length,
          depois: dedupedStreams.length,
          tempo: dbResult.processingTime
        });
        return { streams: dedupedStreams };
      }

      const catalogResult = await this.getStreamsFromCatalog(request);
      if (catalogResult.success && catalogResult.streams.length > 0) {
        const dedupedStreams = this.deduplicateStreamsByInfoHash(catalogResult.streams);
        this.stats.servedFromCatalog++;
        this.logger.debug('Streams do catálogo', {
          requestId,
          antes: catalogResult.streams.length,
          depois: dedupedStreams.length,
          tempo: catalogResult.processingTime
        });
        return { streams: dedupedStreams };
      }

      const shouldScrape = await this.shouldAttemptScraping(request);
      if (!shouldScrape) {
        const informativeStream = this.createInformativeStreamIfNoContent(request);
        if (informativeStream) return { streams: [informativeStream] };
        return { streams: [] };
      }

      try {
        const scrapingResult = await this.processStreamRequest(request);
        const dedupedStreams = this.deduplicateStreamsByInfoHash(scrapingResult);
        await this.updateScrapingCache(request, dedupedStreams.length > 0);
        this.stats.servedFromScraping += dedupedStreams.length > 0 ? 1 : 0;
        this.logger.debug('Streams do scraping', {
          requestId,
          antes: scrapingResult.length,
          depois: dedupedStreams.length,
          fonte: 'scraping'
        });
        return { streams: dedupedStreams };
      } catch (error) {
        if (error instanceof StreamStatusException) {
          const informativeStream = this.createInformativeStreamFromException(error, requestId);
          this.stats.servedInformativeStreams++;
          return { streams: [informativeStream] };
        }
        throw error;
      }

    } catch (error) {
      this.logger.error('Falha no processamento', {
        requestId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      
      if (error instanceof StreamStatusException) {
        const informativeStream = this.createInformativeStreamFromException(error, requestId);
        this.stats.servedInformativeStreams++;
        return { streams: [informativeStream] };
      }
      
      const errorStream = this.staticResponseService.createInformativeStream(
        StaticResponse.FAILED_UNEXPECTED,
        requestId
      );
      return { streams: [this.convertToStreamFormat(errorStream)] };
    }
  }

  private createInformativeStreamFromException(exception: StreamStatusException, requestId: string): Stream {
    const informativeStream = this.staticResponseService.createInformativeStream(
      exception.staticResponse,
      requestId
    );
    return this.convertToStreamFormat(informativeStream);
  }

  private createInformativeStreamIfNoContent(request: StreamRequest): Stream | null {
    if (request.type === 'series') {
      const imdbId = this.extractImdbIdFromRequest(request);
      if (imdbId) {
        const informativeStream = this.staticResponseService.createInformativeStream(
          StaticResponse.DOWNLOADING,
          request.id
        );
        return this.convertToStreamFormat(informativeStream);
      }
    }
    
    const informativeStream = this.staticResponseService.createInformativeStream(
      StaticResponse.DOWNLOADING,
      request.id
    );
    return this.convertToStreamFormat(informativeStream);
  }

  private convertToStreamFormat(informativeStream: any): Stream {
    const infoHash = `info-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    const stream: Stream = {
      title: informativeStream.title || 'Brasil RD - Informação',
      name: informativeStream.name || 'Brasil RD - Mensagem Informativa',
      description: informativeStream.description || 'Mensagem informativa do addon Brasil RD',
      url: informativeStream.url || 'data:text/plain,Brasil%20RD%20-%20Mensagem%20informativa',
      behaviorHints: { notWebReady: true, bingeGroup: 'br-info' },
      status: 'available',
      infoHash: infoHash,
      magnet: `brasilrd://info/${infoHash}`,
      sources: [`brasilrd://info/${infoHash}`]
    };
    
    return stream;
  }

  private async getStreamsFromDatabase(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();
    try {
      let fileEntries: any[] = [];
      const imdbId = this.extractImdbIdFromRequest(request);
      if (!imdbId) return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };

      if (request.type === 'movie') {
        fileEntries = await this.getImdbIdMovieEntries(imdbId);
      } else if (request.type === 'series') {
        const imdbId = this.extractImdbIdFromRequest(request);
        const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (seasonMatch) {
          const season = parseInt(seasonMatch[1]);
          const episode = parseInt(seasonMatch[2]);
          fileEntries = await this.getImdbIdSeriesEntries(imdbId!, season, episode);
        }
      }

      const streams: Stream[] = [];
      for (const fileEntry of fileEntries) {
        const torrent = fileEntry.torrent;
        if (torrent && torrent.infoHash) {
          const stream = this.convertDatabaseEntryToStream(fileEntry, torrent, request);
          if (stream) streams.push(stream);
        }
      }

      return { success: true, streams, source: 'database', processingTime: Date.now() - startTime };
    } catch (error) {
      return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
    }
  }

  private async getImdbIdMovieEntries(imdbId: string) {
    return File.findAll({
      where: { imdbId: { [Op.eq]: imdbId } },
      include: [{ model: Torrent, required: true, where: { seeders: { [Op.gte]: 5 } } }],
      limit: 20,
      order: [[Torrent, 'seeders', 'DESC']]
    });
  }

  private async getImdbIdSeriesEntries(imdbId: string, season: number, episode: number) {
    return File.findAll({
      where: { imdbId: { [Op.eq]: imdbId }, imdbSeason: { [Op.eq]: season }, imdbEpisode: { [Op.eq]: episode } },
      include: [{ model: Torrent, required: true, where: { seeders: { [Op.gte]: 5 } } }],
      limit: 15,
      order: [[Torrent, 'seeders', 'DESC']]
    });
  }

  private convertDatabaseEntryToStream(fileEntry: any, torrent: any, request: StreamRequest): Stream | null {
    try {
      const magnetHash = torrent.infoHash;
      const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
      const magnetLink = `magnet:?xt=urn:btih:${magnetHash}`;

      let titleSuffix = '';
      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series') {
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (match) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
          titleSuffix = ` S${season!.toString().padStart(2, '0')}E${episode!.toString().padStart(2, '0')}`;
        }
      }

      const stream: Stream = {
        title: torrent.title,
        name: `Brasil RD (${quality})${titleSuffix}`,
        description: `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'}`,
        sources: [magnetLink],
        behaviorHints: { notWebReady: false, bingeGroup: `br-db-${request.id}` },
        status: 'available',
        infoHash: magnetHash,
        magnet: magnetLink,
        url: request.type === 'series' && season !== undefined
          ? generateLazyResolveUrl(magnetLink, request.apiKey!, 'series', season, episode)
          : generateLazyResolveUrl(magnetLink, request.apiKey!, 'movie')
      };

      return stream;
    } catch (error) {
      return null;
    }
  }

  private async getStreamsFromCatalog(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();
    try {
      const streams = await this.catalogProvider.getStreamsFromCatalog(request);
      return { success: true, streams, source: 'catalog', processingTime: Date.now() - startTime };
    } catch (error) {
      return { success: false, streams: [], source: 'catalog', processingTime: Date.now() - startTime };
    }
  }

  private async shouldAttemptScraping(request: StreamRequest): Promise<boolean> {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    const cacheEntry = this.scrapingCache.get(requestKey);
    
    if (cacheEntry) {
      const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
      if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2) return false;
      if (timeSinceLastAttempt < 5 * 60 * 1000) return false;
    }
    return true;
  }

  private async updateScrapingCache(request: StreamRequest, successful: boolean): Promise<void> {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    this.scrapingCache.set(requestKey, { lastAttempt: new Date(), successful });
    this.cleanupOldCache();
  }

  private cleanupOldCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    for (const [key, entry] of this.scrapingCache.entries()) {
      const age = now - entry.lastAttempt.getTime();
      if (age > this.scrapingCacheTTL * 2) toDelete.push(key);
    }
    for (const key of toDelete) this.scrapingCache.delete(key);
  }

  private async processStreamRequest(request: StreamRequest): Promise<Stream[]> {
    if (request.type === 'series') return await this.processSeriesRequest(request);
    else return await this.processMovieRequest(request);
  }

  private async processMovieRequest(request: StreamRequest): Promise<Stream[]> {
    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      return await this.performIntelligentScraping(imdbId, request);
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      return [];
    }
  }

  private async processSeriesRequest(request: StreamRequest): Promise<Stream[]> {
    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      if (!imdbId) return await this.performIntelligentScraping(null, request);

      const match = request.id.match(/tt\d+:(\d+):(\d+)/);
      if (match) {
        const season = parseInt(match[1]);
        const episode = parseInt(match[2]);
        const episodeStream = await this.processSpecificEpisode(imdbId, season, episode, request);
        if (episodeStream) return Array.isArray(episodeStream) ? episodeStream : [episodeStream];
      }

      return await this.performIntelligentScraping(imdbId, request);
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      return [];
    }
  }

  private async performIntelligentScraping(imdbId: string | null, request: StreamRequest): Promise<Stream[]> {
    try {
      const type = request.type;
      const match = request.id.match(/tt\d+:(\d+):(\d+)/);

      let searchTitle: string | null = null;
      let imdbTitles: ImdbTitles | null = null;

      // FIX CRÍTICO: Passar season para TMDBScraper
      const season = match ? parseInt(match[1]) : undefined;

      if (imdbId) {
        imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
        
        if (imdbTitles && season && imdbTitles.year) {
          this.logger.debug('TMDB: usando ano da temporada', {
            imdbId,
            season,
            year: imdbTitles.year,
            note: season > 1 ? 'Ano diferente da 1ª temporada - NORMAL' : 'Ano da 1ª temporada'
          });
        }
        
        if (imdbTitles && imdbTitles.allTitles.length > 0) searchTitle = imdbTitles.allTitles[0];
      }

      if (!searchTitle) searchTitle = 'Unknown Title';

      let searchQuery = searchTitle;
      if (type === 'series' && match) {
        const season = parseInt(match[1]);
        searchQuery = `${searchTitle} Temporada ${season}`;
      }

      this.logger.debug('Iniciando scraping', {
        searchQuery,
        type,
        imdbId,
        season,
        hasImdbTitles: !!imdbTitles
      });

      const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, type, match ? parseInt(match[1]) : undefined);
      this.logger.debug('Resultados scraping', { encontrados: torrentResults.length, query: searchQuery });

      if (torrentResults.length === 0) return [];

      const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
      const episode = match ? parseInt(match[2]) : undefined;
      
      const filteredTorrents = await this.filterAndValidateTorrents(
        deduplicatedTorrents, 
        imdbId, 
        request, 
        season, 
        episode, 
        imdbTitles
      );
      
      this.logger.debug('DEBUG - FILTRADOS', {
        validos: filteredTorrents.valid.length,
        invalidos: filteredTorrents.invalid.length
      });

      if (filteredTorrents.valid.length === 0) return [];

      await this.saveValidTorrentsToCatalog(filteredTorrents.valid, request, season, episode, imdbTitles);

      const streams = await this.processTorrentsWithOptimization(filteredTorrents.valid, request, season, episode);
      return this.streamFormatter.sortStreamsByQuality(streams);

    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
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
        depois: uniqueTorrents.length
      });
    }
    
    return uniqueTorrents;
  }

  private async filterAndValidateTorrents(
    torrents: ScrapedTorrent[],
    imdbId: string | null,
    request: StreamRequest,
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

        // FIX: Passar mediaType para TitleFilter
const titleMatchResult = await this.titleFilter.doTitlesMatch(
  torrent.title, 
  imdbId, 
  season, 
  episode
);
        
        if (titleMatchResult.matches) {
          this.logger.debug('Válido', {
            title: torrent.title.substring(0, 60),
            reason: titleMatchResult.reason
          });
          valid.push(torrent);
        } else {
          this.logger.debug('Inválido', {
            title: torrent.title.substring(0, 60),
            reason: titleMatchResult.reason
          });
          invalid.push(torrent);
        }
      } catch (error) {
        this.logger.debug('Erro validação', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
        invalid.push(torrent);
      }
    }

    this.logger.debug('Filtragem concluída', {
      total: torrents.length,
      validos: valid.length,
      invalidos: invalid.length
    });

    return { valid, invalid };
  }

  private async saveValidTorrentsToCatalog(
    validTorrents: ScrapedTorrent[],
    request: StreamRequest,
    season?: number,
    episode?: number,
    imdbTitles: ImdbTitles | null = null
  ): Promise<void> {
    const imdbId = this.extractImdbIdFromRequest(request);
    
    this.logger.debug('SALVANDO CATÁLOGO', {
      count: validTorrents.length,
      imdbId: imdbId,
      type: request.type,
      season: season,
      episode: episode
    });

    if (!imdbId) {
      this.logger.debug('Sem IMDb ID, cancelando');
      return;
    }

    if (validTorrents.length === 0) {
      this.logger.debug('Nenhum torrent válido');
      return;
    }

    for (const torrent of validTorrents) {
      try {
        const result = await this.autoMagnetService.autoAddMagnet(
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

        this.logger.debug('Resultado autoAddMagnet', {
          title: torrent.title.substring(0, 60),
          success: result.success,
          magnetAdded: result.magnetAdded
        });

      } catch (error) {
        this.logger.error('Erro salvar magnet', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    this.logger.debug('Salvamento concluído', {
      totalProcessados: validTorrents.length
    });
  }

  private async processTorrentsWithOptimization(
    torrents: ScrapedTorrent[],
    request: StreamRequest,
    season?: number,
    episode?: number
  ): Promise<Stream[]> {
    const allStreams: Stream[] = [];
    const batchSize = this.processingConfig.maxConcurrentTorrents;

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
          if (error instanceof StreamStatusException) throw error;
          return [];
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) allStreams.push(...result.value);
      }

      if (i + batchSize < torrents.length) {
        await new Promise(resolve => setTimeout(resolve, this.processingConfig.delayBetweenTorrents));
      }
    }

    return allStreams;
  }

  private async processSpecificEpisode(
    imdbId: string,
    season: number,
    episode: number,
    request: StreamRequest
  ): Promise<Stream[] | null> {
    const requestId = request.id;
    
    this.logger.debug('EPISÓDIO ESPECÍFICO', {
      requestId,
      imdbId,
      season,
      episode
    });

    try {
      // FIX CRÍTICO: Passar season para TMDBScraper
      this.logger.debug('Buscando títulos IMDB', { imdbId, season });
      const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
      
      if (imdbTitles && imdbTitles.year && season > 1) {
        this.logger.debug('TMDB: usando ano da temporada específica', {
          imdbId,
          season,
          year: imdbTitles.year,
          note: 'Temporada > 1: ano diferente da 1ª temporada - CORRETO'
        });
      }
      
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        this.logger.debug('Sem títulos IMDB', { imdbId });
        return null;
      }

      const searchTitle = imdbTitles.allTitles[0];
      const searchQuery = `${searchTitle} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
      
      this.logger.debug('Query busca', {
        searchQuery,
        season,
        episode
      });

      const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', season);
      
      this.logger.debug('Resultados scraping', {
        encontrados: torrentResults.length,
        query: searchQuery
      });

      if (torrentResults.length === 0) {
        this.logger.debug('Nenhum torrent', { searchQuery });
        return null;
      }

      const deduplicatedTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
      
      const filteredTorrents = await this.filterAndValidateTorrents(
        deduplicatedTorrents, 
        imdbId, 
        request, 
        season, 
        episode, 
        imdbTitles
      );
      
      this.logger.debug('Resultado filtragem', {
        total: deduplicatedTorrents.length,
        validos: filteredTorrents.valid.length,
        invalidos: filteredTorrents.invalid.length
      });

      if (filteredTorrents.valid.length === 0) {
        this.logger.debug('Nenhum válido', {
          imdbId,
          season,
          episode,
          totalTestados: deduplicatedTorrents.length
        });
        return null;
      }
      
      const bestTorrent = filteredTorrents.valid.reduce((best, current) =>
        current.seeders > best.seeders ? current : best
      );

      this.logger.debug('Melhor encontrado', {
        title: bestTorrent.title.substring(0, 60),
        seeders: bestTorrent.seeders,
        quality: bestTorrent.quality
      });
      
      const streams = this.streamFormatter.createMultipleQualityStreams(
        bestTorrent,
        request,
        null,
        'series',
        season,
        episode,
        false
      );

      this.logger.debug('Streams criados', {
        quantidade: streams.length,
        season,
        episode,
        hasStreams: streams.length > 0
      });

      await this.saveValidTorrentsToCatalog(filteredTorrents.valid, request, season, episode, imdbTitles);

      const result = streams.length > 0 ? streams : null;
      
      this.logger.debug('Episódio concluído', {
        success: result !== null,
        streamsCount: result ? result.length : 0,
        season,
        episode
      });

      return result;

    } catch (error) {
      this.logger.error('Erro episódio', {
        imdbId,
        season,
        episode,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return null;
    }
  }

  private extractImdbIdFromRequest(request: StreamRequest): string | null {
    if (request.imdbId) return request.imdbId;
    const imdbMatch = request.id.match(/^(tt\d+)/);
    return imdbMatch ? imdbMatch[1] : null;
  }

  addCuratedMagnet(magnet: CuratedMagnet): void {
    this.magnetService.addMagnet(magnet);
    this.invalidateRelatedCache(magnet.imdbId);
  }

  removeCuratedMagnet(imdbId: string, magnetLink: string): boolean {
    const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
    if (removed) this.invalidateRelatedCache(imdbId);
    return removed;
  }

  clearCache(): void {
    this.cacheService.clear();
    this.scrapingCache.clear();
  }

  private invalidateRelatedCache(imdbId: string): void {
    const cachePatterns = [
      `streams:movie:${imdbId}`,
      `streams:series:${imdbId}`,
      `streams:series:${imdbId}:*`
    ];
    for (const pattern of cachePatterns) this.cacheService.delete(pattern);
  }

  public getStats() {
    return {
      totalRequests: this.stats.totalRequests,
      servedFromDatabase: this.stats.servedFromDatabase,
      servedFromCatalog: this.stats.servedFromCatalog,
      servedFromScraping: this.stats.servedFromScraping,
      servedInformativeStreams: this.stats.servedInformativeStreams,
      duplicatesRemoved: this.stats.duplicatesRemoved,
      scrapingCacheSize: this.scrapingCache.size,
      version: '5.0.0'
    };
  }
}