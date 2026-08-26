import { TorboxService } from '../debrid/RealDebridService.js';
import { CuratedMagnetService } from '../catalogo/CuratedMagnetService.js';
import { CacheService } from '../debrid/CacheService.js';
import { Logger } from '../utils/logger.js';
import { Stream, StreamRequest, CuratedMagnet } from '../types/index.js';
import { Op } from 'sequelize';
import { Torrent } from '../database/models.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { CatalogProvider } from '../catalogo/catalogProvider.js';
import { StreamFormatter } from '../stream/streamFormatter.js';
import { StaticResponseService, StaticResponse } from './StaticResponseService.js';
import { StreamStatusException } from './StreamStatusException.js';
import { INDICADORES_INTERNACIONAL_TORRENTS } from '../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

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
  private readonly cacheService: CacheService;
  private readonly logger: Logger;
  private staticResponseService: StaticResponseService;
  private readonly qualityDetector: QualityDetector;
  private readonly streamFormatter: StreamFormatter;
  private readonly catalogProvider: CatalogProvider;

  private stats = {
    totalRequests: 0,
    servedFromDatabase: 0,
    servedFromCatalog: 0,
    duplicatesRemoved: 0,
    servedInformativeStreams: 0
  };

  private constructor(baseUrl?: string) {
    this.torboxService = TorboxService.getInstance(baseUrl);
    this.magnetService = new CuratedMagnetService();
    this.cacheService = new CacheService();
    this.logger = new Logger('StreamHandler');
    this.staticResponseService = new StaticResponseService(baseUrl);
    this.qualityDetector = QualityDetector.getInstance();
    this.streamFormatter = StreamFormatter.getInstance();
    this.catalogProvider = new CatalogProvider(this.magnetService);
  }

  public static getInstance(baseUrl?: string): StreamHandler {
    if (!StreamHandler.instance) {
      StreamHandler.instance = new StreamHandler(baseUrl);
    }
    if (baseUrl && StreamHandler.instance.staticResponseService.getBaseUrl() !== baseUrl) {
      StreamHandler.instance.setStaticResponseBaseUrl(baseUrl);
    }
    return StreamHandler.instance;
  }

  /** Getter público para o TorboxService compartilhado (cache de títulos, etc.) */
  public get torbox(): TorboxService {
    return this.torboxService;
  }

  /** Getter público para o CatalogProvider (usado pela rota de resolve para obter títulos TMDB) */
  public get catalog(): CatalogProvider {
    return this.catalogProvider;
  }

  public async initialize(): Promise<void> {
    await this.magnetService.waitForInitialization();
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
    this.torboxService.setStaticResponseBaseUrl(baseUrl);
  }

  public async handleStreamRequest(request: StreamRequest): Promise<{ streams: Stream[] }> {
    const requestId = request.id;
    this.stats.totalRequests++;

    if (!request.apiKey) return { streams: [] };

    try {
      await this.magnetService.waitForInitialization();

      // Obtém títulos e ano do TMDB para o IMDb ID da requisição
      const imdbId = this.extractImdbIdFromRequest(request);
      let tmdbTitles: string[] | undefined;
      let tmdbYear: number | undefined;

      if (imdbId) {
        try {
          const tmdbData = await this.catalogProvider.getTmdbSearchData(imdbId);
          if (tmdbData.imdbTitles?.allTitles?.length) {
            tmdbTitles = tmdbData.imdbTitles.allTitles;
          }
          if (tmdbData.imdbTitles?.year) {
            tmdbYear = tmdbData.imdbTitles.year;
          }
        } catch {
          // Falha ao obter títulos não deve interromper o fluxo
        }
      }

      // Tenta banco de dados primeiro
      const dbResult = await this.getStreamsFromDatabase(request);
      if (dbResult.success && dbResult.streams.length > 0) {
        this.stats.servedFromDatabase++;
        const originalCount = dbResult.streams.length;
        const deduped = this.catalogProvider.removeDuplicatesByInfoHash(dbResult.streams);
        this.stats.duplicatesRemoved += originalCount - deduped.length;
        const sorted = this.streamFormatter.sortStreamsByQuality(deduped);
        this.registerTitlesForStreams(sorted, tmdbTitles, tmdbYear);
        return { streams: sorted };
      }

      // Depois tenta catálogo
      const catalogResult = await this.getStreamsFromCatalog(request);
      if (catalogResult.success && catalogResult.streams.length > 0) {
        this.stats.servedFromCatalog++;
        const originalCount = catalogResult.streams.length;
        const deduped = this.catalogProvider.removeDuplicatesByInfoHash(catalogResult.streams);
        this.stats.duplicatesRemoved += originalCount - deduped.length;
        const sorted = this.streamFormatter.sortStreamsByQuality(deduped);
        this.registerTitlesForStreams(sorted, tmdbTitles, tmdbYear);
        return { streams: sorted };
      }

      // Sem streams — informativo
      const informativeStream = this.createInformativeStreamIfNoContent(request);
      return { streams: informativeStream ? [informativeStream] : [] };
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

  /** Registra os títulos TMDB (enriquecidos com o ano) no cache do TorboxService para cada stream com infoHash */
  private registerTitlesForStreams(streams: Stream[], titles?: string[], year?: number): void {
    if (!titles || titles.length === 0) return;
    
    const enrichedTitles = year 
      ? titles.map(t => `${t} ${year}`)
      : titles;

    for (const stream of streams) {
      if (stream.infoHash) {
        try {
          this.torboxService.setTitlesForHash(stream.infoHash, enrichedTitles);
        } catch {
          // Silencioso – falha no registro não afeta a entrega do stream
        }
      }
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

      const where: any = { imdbId };
      if (request.type === 'series') {
        const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (seasonMatch) {
          const season = parseInt(seasonMatch[1]);
          const episode = parseInt(seasonMatch[2]);
          where[Op.or] = [
            { imdbSeason: season },
            { imdbSeason: null },
          ];
          where[Op.and] = [
            {
              [Op.or]: [
                { imdbEpisodeStart: null },
                { imdbEpisodeEnd: null },
                {
                  imdbEpisodeStart: { [Op.lte]: episode },
                  imdbEpisodeEnd: { [Op.gte]: episode },
                },
              ],
            },
          ];
        }
      }

      const torrents = await Torrent.findAll({
        where,
        limit: request.type === 'movie' ? 20 : 30,
        order: [['seeders', 'DESC']],
        raw: true
      });

      const streams: Stream[] = [];
      for (const t of torrents) {
        const idioma = (t.idioma || '').toLowerCase();
        if (idioma === 'legendado' || idioma === 'en' || idioma === 'es' || idioma === 'fr') continue;
        const titleLower = (t.title || '').toLowerCase();
        if (LEGENDADO_REGEX.test(titleLower)) continue;

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

  private async convertTorrentToStream(torrent: any, request: StreamRequest): Promise<Stream | null> {
    try {
      const quality = torrent.qualidade || this.qualityDetector.extractQualityFromFilename(torrent.title);

      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series') {
        const match = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (match) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }
      }

      // Usa o magnet completo salvo no banco, se existir; caso contrário, fallback para magnet mínimo.
      const magnetCompleto = torrent.magnet || `magnet:?xt=urn:btih:${torrent.infoHash}`;
      
      const torrentWithMagnet = {
        ...torrent,
        magnet: magnetCompleto,
        magnet_link: magnetCompleto,
      };

      const streams = await this.streamFormatter.createMultipleQualityStreams(
        torrentWithMagnet,
        request,
        null,
        request.type,
        season,
        episode,
        false,
        0
      );

      return streams[0] || null;
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
      servedInformativeStreams: this.stats.servedInformativeStreams,
      duplicatesRemoved: this.stats.duplicatesRemoved
    };
  }
}