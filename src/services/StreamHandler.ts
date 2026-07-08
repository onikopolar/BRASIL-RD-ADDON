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

export class StreamHandler {
  private static instance: StreamHandler;
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

  private readonly scrapingCache: Map<string, { lastAttempt: Date; successful: boolean }> = new Map();
  private readonly scrapingCacheTTL = 6 * 60 * 60 * 1000; // 6 horas

  // Estatísticas globais
  private stats = {
    totalRequests: 0,
    servedFromDatabase: 0,
    servedFromCatalog: 0,
    servedFromScraping: 0,
    duplicatesRemoved: 0,
    servedInformativeStreams: 0
  };

  private constructor(baseUrl?: string) {
    this.rdService = new RealDebridService(baseUrl);
    this.magnetService = new CuratedMagnetService();
    this.autoMagnetService = new AutoMagnetService();
    this.cacheService = new CacheService();
    this.imdbScraper = new ImdbScraperService();
    this.logger = new Logger('StreamHandler');
    this.staticResponseService = new StaticResponseService(baseUrl);
    this.qualityDetector = new QualityDetector();
    this.titleFilter = new TitleFilter();
    this.streamFormatter = new StreamFormatter();
    this.catalogProvider = new CatalogProvider(this.magnetService);
  }

  /**
   * Retorna a instancia unica do StreamHandler.
   * Em producao, a URL base deve ser fornecida na primeira chamada.
   */
  public static getInstance(baseUrl?: string): StreamHandler {
    if (!StreamHandler.instance) {
      StreamHandler.instance = new StreamHandler(baseUrl);
    }
    // Atualiza URL base se fornecido e necessario
    if (baseUrl && StreamHandler.instance.staticResponseService.getBaseUrl() !== baseUrl) {
      StreamHandler.instance.setStaticResponseBaseUrl(baseUrl);
    }
    return StreamHandler.instance;
  }

  /**
   * Aguarda a inicializacao dos servicos dependentes (ex: carregar magnets).
   * Deve ser chamado uma unica vez na inicializacao do servidor.
   */
  public async initialize(): Promise<void> {
    await this.magnetService.waitForInitialization();
    // Outros servicos podem ser inicializados aqui se necessario
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
    this.rdService.setStaticResponseBaseUrl(baseUrl);
  }

  private deduplicateStreamsByInfoHash(streams: Stream[]): Stream[] {
    const seenCombinations = new Set<string>();
    const uniqueStreams: Stream[] = [];

    for (const stream of streams) {
      const infoHash = stream.infoHash?.toLowerCase();
      let quality = 'unknown';
      if (stream.behaviorHints?.streamQuality) {
        quality = stream.behaviorHints.streamQuality;
      } else if (stream.title) {
        const qualityMatch = stream.title.match(/\((\d+p|4K|HD|SD|2160p|1080p|720p|480p)\)/i);
        if (qualityMatch) {
          quality = qualityMatch[1].toLowerCase();
        }
      }

      const uniqueKey = infoHash ? `${infoHash}_${quality}` : (stream.title || `stream_${Math.random()}`);
      if (seenCombinations.has(uniqueKey)) {
        this.stats.duplicatesRemoved++;
        continue;
      }
      seenCombinations.add(uniqueKey);
      uniqueStreams.push(stream);
    }

    return uniqueStreams;
  }

  public async handleStreamRequest(request: StreamRequest): Promise<{ streams: Stream[] }> {
    const requestId = request.id;
    this.stats.totalRequests++;

    if (!request.apiKey) return { streams: [] };

    try {
      // Garantia de que o serviço de magnets está pronto (caso ainda não inicializado)
      await this.magnetService.waitForInitialization();

      const dbResult = await this.getStreamsFromDatabase(request);
      if (dbResult.success && dbResult.streams.length > 0) {
        this.stats.servedFromDatabase++;
        return { streams: this.deduplicateStreamsByInfoHash(dbResult.streams) };
      }

      const catalogResult = await this.getStreamsFromCatalog(request);
      if (catalogResult.success && catalogResult.streams.length > 0) {
        this.stats.servedFromCatalog++;
        return { streams: this.deduplicateStreamsByInfoHash(catalogResult.streams) };
      }

      const shouldScrape = await this.shouldAttemptScraping(request);
      if (!shouldScrape) {
        const informativeStream = this.createInformativeStreamIfNoContent(request);
        return { streams: informativeStream ? [informativeStream] : [] };
      }

      try {
        const scrapedStreams = await this.performScrapingThroughCatalog(request);
        const deduped = this.deduplicateStreamsByInfoHash(scrapedStreams);
        await this.updateScrapingCache(request, deduped.length > 0);
        if (deduped.length > 0) this.stats.servedFromScraping++;
        return { streams: deduped };
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
    const imdbId = this.extractImdbIdFromRequest(request);
    if (imdbId || request.type === 'series') {
      const informativeStream = this.staticResponseService.createInformativeStream(
        StaticResponse.DOWNLOADING,
        request.id
      );
      return this.convertToStreamFormat(informativeStream);
    }
    return null;
  }

  private convertToStreamFormat(informativeStream: any): Stream {
    const infoHash = `info-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    return {
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
  }

  private async getStreamsFromDatabase(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();
    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      if (!imdbId) return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };

      let fileEntries: any[] = [];
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
    // Busca episodio especifico
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

    // Fallback para packs completos (episode null)
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
          titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
        }
      }

      const filename = fileEntry.title || 'video.mkv';
      const fileIndex = fileEntry.fileIndex || 0;

      // Para packs completos, o fileIndex pode ser ajustado pela ordem do episodio
      let finalFileIndex = fileIndex;
      if (fileEntry.imdbEpisode === null && episode !== undefined && season !== undefined) {
        // Metodo conservador: assume que os episodios estao em ordem numerica no pack
        finalFileIndex = episode - 1;
        this.logger.warn('Ajuste de fileIndex para pack completo', {
          infoHash: magnetHash,
          season,
          episode,
          originalIndex: fileIndex,
          adjustedIndex: finalFileIndex
        });
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
    if (!cacheEntry) return true;

    const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
    if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2) return false;
    if (timeSinceLastAttempt < 5 * 60 * 1000) return false;
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
    for (const [key, entry] of this.scrapingCache.entries()) {
      if (now - entry.lastAttempt.getTime() > this.scrapingCacheTTL * 2) {
        this.scrapingCache.delete(key);
      }
    }
  }

  private extractImdbIdFromRequest(request: StreamRequest): string | null {
    if (request.imdbId) return request.imdbId;
    const imdbMatch = request.id.match(/^(tt\d+)/);
    return imdbMatch ? imdbMatch[1] : null;
  }

  public addCuratedMagnet(magnet: CuratedMagnet): void {
    this.magnetService.addMagnet(magnet);
    this.invalidateRelatedCache(magnet.imdbId);
  }

  public removeCuratedMagnet(imdbId: string, magnetLink: string): boolean {
    const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
    if (removed) this.invalidateRelatedCache(imdbId);
    return removed;
  }

  public clearCache(): void {
    this.cacheService.clear();
    this.scrapingCache.clear();
    this.catalogProvider.clearTmdbCache();
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
      scrapingCacheSize: this.scrapingCache.size
    };
  }
}