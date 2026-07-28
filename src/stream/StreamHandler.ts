import { TorboxService } from '../debrid/RealDebridService.js';
import { CuratedMagnetService } from '../catalogo/CuratedMagnetService.js';
import { AutoMagnetService } from '../debrid/AutoMagnetService.js';
import { CacheService } from '../debrid/CacheService.js';
import { Logger } from '../utils/logger.js';
import { Stream, StreamRequest, CuratedMagnet } from '../types/index.js';
import { Op } from 'sequelize';
import { Torrent } from '../database/models.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { analisarMagnet, gerarUrlResolve } from '../magnet/magnetHelper.js';
import { TitleFilter } from '../titulos/titleFilter.js';
import { StreamFormatter } from '../stream/streamFormatter.js';
import { CatalogProvider } from '../catalogo/catalogProvider.js';
import { StaticResponseService, StaticResponse } from './StaticResponseService.js';
import { StreamStatusException } from './StreamStatusException.js';

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
  private readonly torboxService: TorboxService;
  private readonly magnetService: CuratedMagnetService;
  private readonly autoMagnetService: AutoMagnetService;
  private readonly cacheService: CacheService;
  private readonly logger: Logger;
  private staticResponseService: StaticResponseService;
  private readonly qualityDetector: QualityDetector;
  private readonly titleFilter: TitleFilter;
  private readonly streamFormatter: StreamFormatter;
  private readonly catalogProvider: CatalogProvider;

  // Apenas evita scraping simultâneo para o mesmo conteúdo (sem cooldown)
  private readonly inFlightScraping: Set<string> = new Set();

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
    this.torboxService = new TorboxService(baseUrl);
    this.magnetService = new CuratedMagnetService();
    this.autoMagnetService = new AutoMagnetService();
    this.cacheService = new CacheService();
    this.logger = new Logger('StreamHandler');
    this.staticResponseService = new StaticResponseService(baseUrl);
    this.qualityDetector = QualityDetector.getInstance();
    this.titleFilter = TitleFilter.getInstance();
    this.streamFormatter = StreamFormatter.getInstance();
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
    this.torboxService.setStaticResponseBaseUrl(baseUrl);
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

      // Usa infoHash + qualidade como chave. Se nao tem infoHash, usa titulo + qualidade
      // (evita que streams 1080p e 720p do mesmo torrent sejam tratados como duplicatas)
      const uniqueKey = infoHash
        ? `${infoHash}_${quality}`
        : `${stream.title || 'stream'}_${quality}_${stream.fileIdx ?? 0}`;
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
        this.markScrapingStart(request);
        const scrapedStreams = await this.performScrapingThroughCatalog(request);
        const deduped = this.deduplicateStreamsByInfoHash(scrapedStreams);
        if (deduped.length > 0) this.stats.servedFromScraping++;
        return { streams: deduped };
      } catch (error) {
        if (error instanceof StreamStatusException) {
          const informativeStream = this.createInformativeStreamFromException(error, requestId);
          this.stats.servedInformativeStreams++;
          return { streams: [informativeStream] };
        }
        throw error;
      } finally {
        this.markScrapingEnd(request);
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

      // Query direta no Torrent (sem tabela File)
      const where: any = { imdbId, seeders: { [Op.gte]: 5 } };
      if (request.type === 'series') {
        const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (seasonMatch) where.imdbSeason = parseInt(seasonMatch[1]);
      }

      const torrents = await Torrent.findAll({
        where,
        limit: request.type === 'movie' ? 20 : 30,
        order: [['seeders', 'DESC']]
      });

      const validatedTorrents = await Promise.all(
        torrents.map(async (t) => {
          const titleValid = await this.validateDatabaseEntry(
            t.title, imdbId, request.type, t.imdbSeason
          );
          if (!titleValid) {
            this.logger.warn('Entrada do banco rejeitada por titulo', {
              imdbId, dbTitle: t.title?.substring(0, 60)
            });
            return null;
          }
          return t;
        })
      );

      const streams: Stream[] = [];
      for (const t of validatedTorrents) {
        if (!t) continue;
        const stream = await this.convertTorrentToStream(t, request);
        if (stream) streams.push(stream);
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

  /**
   * Validacao de seguranca: verifica se o titulo do torrent realmente
   * pertence ao IMDB solicitado.
   */
  private async validateDatabaseEntry(
    torrentTitle: string,
    imdbId: string,
    type: string,
    season?: number
  ): Promise<boolean> {
    try {
      const match = await this.titleFilter.titulosCombinam(
        torrentTitle, imdbId, season, undefined
      );
      return match.matches;
    } catch {
      return true;
    }
  }

  private async convertTorrentToStream(torrent: any, request: StreamRequest): Promise<Stream | null> {
    try {
      const magnetHash = torrent.infoHash;
      const quality = torrent.qualidade || this.qualityDetector.extractQualityFromFilename(torrent.title);
      const magnetLink = `magnet:?xt=urn:btih:${magnetHash}`;

      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series') {
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (match) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }
      }

      const stream: Stream = {
        title: torrent.title,
        name: `Brasil RD (${quality})`,
        description: `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'}`,
        sources: [magnetLink],
        behaviorHints: { notWebReady: false, bingeGroup: `br-db-${request.id}` },
        status: 'available',
        infoHash: magnetHash,
        magnet: magnetLink,
        url: await gerarUrlResolve(
          magnetLink, request.apiKey!, 'video.mkv', 0,
          request.type, season, episode
        )
      };

      return stream;
    } catch (error) {
      this.logger.error('Erro ao converter torrent para stream', {
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

  /**
   * Permite scraping SEMPRE, a menos que já exista um scraping em andamento
   * para o mesmo conteúdo (evita requisições simultâneas duplicadas).
   */
  private async shouldAttemptScraping(request: StreamRequest): Promise<boolean> {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;

    // Se já tem scraping em andamento, não inicia outro
    if (this.inFlightScraping.has(requestKey)) {
      this.logger.debug(' Scraping já em andamento, aguardando...', { requestKey });
      return false;
    }

    return true;
  }

  /** Marca início do scraping para evitar duplicação simultânea */
  private markScrapingStart(request: StreamRequest): void {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    this.inFlightScraping.add(requestKey);
  }

  /** Marca fim do scraping (sucesso ou falha) */
  private markScrapingEnd(request: StreamRequest): void {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    this.inFlightScraping.delete(requestKey);
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
    this.inFlightScraping.clear();
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
      inFlightScraping: this.inFlightScraping.size
    };
  }
}