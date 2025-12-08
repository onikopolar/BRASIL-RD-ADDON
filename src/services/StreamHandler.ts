import { RealDebridService } from './RealDebridService';
import { CuratedMagnetService } from './CuratedMagnetService';
import { AutoMagnetService } from './AutoMagnetService';
import { CacheService } from './CacheService';
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
    this.imdbScraper = new ImdbScraperService();
    this.logger = new Logger('StreamHandler');
    this.logger.info('StreamHandler v5.1.1 inicializado - Corrige integracao com CatalogProvider e AutoMagnetService atualizados');
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
      let infoHash: string | undefined = stream.infoHash?.toLowerCase();
      
      let quality = 'unknown';
      if (stream.behaviorHints?.streamQuality) {
        quality = stream.behaviorHints.streamQuality;
      } else if (stream.title) {
        const qualityMatch = stream.title.match(/\((\d+p|4K|HD|SD|2160p|1080p|720p|480p)\)/i);
        if (qualityMatch) {
          quality = qualityMatch[1].toLowerCase();
        }
      }
      
      let uniqueKey: string;
      if (infoHash) {
        uniqueKey = `${infoHash}_${quality}`;
      } else {
        this.logger.warn('Stream sem infoHash encontrado, usando titulo para dedup', {
          title: stream.title?.substring(0, 50)
        });
        uniqueKey = stream.title || `stream_${Math.random()}`;
      }
      
      if (seenCombinations.has(uniqueKey)) {
        this.stats.duplicatesRemoved++;
        this.logger.debug('Stream duplicado removido', {
          infoHash: infoHash ? `${infoHash.substring(0, 8)}...` : 'none',
          quality: quality,
          uniqueKey: uniqueKey
        });
        continue;
      }
      
      seenCombinations.add(uniqueKey);
      uniqueStreams.push(stream);
    }
    
    if (streams.length !== uniqueStreams.length) {
      this.logger.debug('Deduplicacao de streams concluida', {
        totalInicial: streams.length,
        totalFinal: uniqueStreams.length,
        duplicadosRemovidos: streams.length - uniqueStreams.length,
        formato: 'v1.4.0_compativel'
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
        this.logger.debug('Streams do catalogo', {
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
        const scrapingResult = await this.performScrapingThroughCatalog(request);
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

  private async performScrapingThroughCatalog(request: StreamRequest): Promise<Stream[]> {
    this.logger.debug('Iniciando scraping atraves do CatalogProvider', {
      requestId: request.id,
      type: request.type
    });

    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
      let season: number | undefined;
      let episode: number | undefined;
      
      if (seasonMatch) {
        season = parseInt(seasonMatch[1]);
        episode = parseInt(seasonMatch[2]);
      }

      const catalogRequest = {
        id: request.id,
        type: request.type,
        imdbId: imdbId,
        apiKey: request.apiKey,
        season: season,
        episode: episode,
        config: request.config || {
          quality: 'Todas as Qualidades',
          language: 'pt-BR',
          streamType: 'direct',
          maxResults: '25'
        }
      };

      const streams = await this.catalogProvider.getStreamsFromCatalog(catalogRequest);
      
      this.logger.debug('Scraping via CatalogProvider concluido', {
        requestId: request.id,
        streams: streams.length,
        tipo: 'unificado',
        versaoCatalogProvider: '4.7.1'
      });
      
      return streams;
    } catch (error) {
      this.logger.error('Erro no scraping via CatalogProvider', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return [];
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
      title: informativeStream.title || 'Brasil RD - Informacao',
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
        const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (seasonMatch) {
          const season = parseInt(seasonMatch[1]);
          const episode = parseInt(seasonMatch[2]);
          fileEntries = await this.getImdbIdSeriesEntries(imdbId, season, episode);
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

      this.logger.debug('Resultados do banco processados', {
        imdbId,
        entradasEncontradas: fileEntries.length,
        streamsCriados: streams.length,
        tempo: Date.now() - startTime
      });

      return { success: true, streams, source: 'database', processingTime: Date.now() - startTime };
    } catch (error) {
      this.logger.error('Erro na busca no banco', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        tempo: Date.now() - startTime
      });
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
    // Primeiro busca por episodio especifico
    const specificEpisodeEntries = await File.findAll({
      where: { 
        imdbId: { [Op.eq]: imdbId }, 
        imdbSeason: { [Op.eq]: season }, 
        imdbEpisode: { [Op.eq]: episode } 
      },
      include: [{ model: Torrent, required: true, where: { seeders: { [Op.gte]: 5 } } }],
      limit: 15,
      order: [[Torrent, 'seeders', 'DESC']]
    });

    if (specificEpisodeEntries.length > 0) {
      return specificEpisodeEntries;
    }

    // Se nao encontrou episodio especifico, busca por pack completo (episode = null)
    const completePackEntries = await File.findAll({
      where: { 
        imdbId: { [Op.eq]: imdbId }, 
        imdbSeason: { [Op.eq]: season }, 
        imdbEpisode: { [Op.eq]: null } 
      },
      include: [{ model: Torrent, required: true, where: { seeders: { [Op.gte]: 5 } } }],
      limit: 15,
      order: [[Torrent, 'seeders', 'DESC']]
    });

    if (completePackEntries.length > 0) {
      this.logger.debug('Encontrado pack completo no banco', {
        imdbId,
        season,
        episode,
        packsEncontrados: completePackEntries.length
      });
    }

    return completePackEntries;
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

      const filename = fileEntry.title || 'video.mkv';
      const fileIndex = fileEntry.fileIndex || 0;
      
      // Para packs completos, ajusta o fileIndex com base no episodio
      let finalFileIndex = fileIndex;
      if (fileEntry.imdbEpisode === null && episode !== undefined && season !== undefined) {
        // Tenta encontrar o episodio correto dentro do pack
        // Esta logica pode ser aprimorada para analisar o arquivo correto
        finalFileIndex = episode - 1; // Assume que episodios estao em ordem
        this.logger.debug('Pack completo - ajustando fileIndex', {
          infoHash: magnetHash,
          season,
          episode,
          fileIndex: finalFileIndex
        });
      }

      this.logger.debug('Criando stream do banco', {
        infoHash: magnetHash,
        filename: filename,
        fileIndex: finalFileIndex,
        type: request.type,
        season: season,
        episode: episode,
        entradaEpisode: fileEntry.imdbEpisode
      });

      const stream: Stream = {
        title: torrent.title,
        name: `Brasil RD (${quality})${titleSuffix}`,
        description: `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'}`,
        sources: [magnetLink],
        behaviorHints: { notWebReady: false, bingeGroup: `br-db-${request.id}` },
        status: 'available',
        infoHash: magnetHash,
        magnet: magnetLink,
        url: generateLazyResolveUrl(
          magnetLink,
          request.apiKey!,
          filename,
          finalFileIndex,
          request.type,
          season,
          episode
        )
      };

      this.logger.debug('URL gerada formato Torrentio', {
        urlPreview: stream.url?.substring(0, 100),
        formato: 'torrentio_compativel'
      });

      return stream;
    } catch (error) {
      this.logger.error('Erro ao converter entrada do banco para stream', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
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
    this.catalogProvider.clearTmdbCache();
    this.logger.info('Todos os caches limpos', {
      scrapingCacheSize: this.scrapingCache.size
    });
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
      versao: '5.1.1',
      integracoes: [
        'CatalogProvider v4.7.1 (fix packs de temporada)',
        'AutoMagnetService v1.5.1 (fix episode null para packs)',
        'Suporte completo a packs de temporada',
        'Busca por episode especifico ou pack completo'
      ],
      fluxo: 'Banco -> Catalogo -> Scraping via CatalogProvider'
    };
  }
}