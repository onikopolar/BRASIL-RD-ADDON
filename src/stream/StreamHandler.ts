import { TorboxService } from '../debrid/RealDebridService.js';
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
  private readonly cacheService: CacheService;
  private readonly logger: Logger;
  private staticResponseService: StaticResponseService;
  private readonly qualityDetector: QualityDetector;
  private readonly streamFormatter: StreamFormatter;
  private readonly catalogProvider: CatalogProvider;

  // Hashes checados em background — evita re-checar o mesmo por 1h.
  private readonly seedsCheckedAt = new Map<string, number>();
  private readonly SEEDS_RECHECK_TTL = 60 * 60 * 1000;
  private readonly SEEDS_BG_CONCURRENCY = 5;
  private readonly SEEDS_BG_TIMEOUT_SEC = 5;

  private stats = {
    totalRequests: 0,
    servedFromDatabase: 0,
    servedFromCatalog: 0,
    duplicatesRemoved: 0,
    servedInformativeStreams: 0
  };

  private constructor(baseUrl?: string) {
    this.torboxService = TorboxService.getInstance(baseUrl);
    this.cacheService = new CacheService();
    this.logger = new Logger('StreamHandler');
    this.staticResponseService = new StaticResponseService(baseUrl);
    this.qualityDetector = QualityDetector.getInstance();
    this.streamFormatter = StreamFormatter.getInstance();
    this.catalogProvider = new CatalogProvider();
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

  public get torbox(): TorboxService {
    return this.torboxService;
  }

  public get catalog(): CatalogProvider {
    return this.catalogProvider;
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
      const imdbId = this.extractImdbIdFromRequest(request);
      let tmdbTitles: string[] | undefined;
      let tmdbYear: number | undefined;

      // Tenta pegar títulos do TMDB só pra enriquecer o stream; falha aqui não interrompe nada
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
          // silencioso de propósito
        }
      }

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

  //Dispara em background a checagem de seeders via torrentinfo. Não bloqueia a resposta.
  private fireAndForgetSeeders(torrents: any[], apiKey: string): void {
    const hashes = [...new Set(
      torrents
        .map(t => (t.infoHash || '').toLowerCase())
        .filter((h): h is string => typeof h === 'string' && h.length >= 32)
    )];

    const now = Date.now();
    const paraChecar = hashes.filter(h => {
      const ultima = this.seedsCheckedAt.get(h);
      return !ultima || (now - ultima) > this.SEEDS_RECHECK_TTL;
    });

    if (paraChecar.length === 0) return;
    for (const h of paraChecar) this.seedsCheckedAt.set(h, now);

    void this.enrichSeedersEmBackground(paraChecar, apiKey).catch(() => {});
  }

  //Busca seeds reais de cada hash em lotes paralelos e grava no banco. Nunca lança.
  private async enrichSeedersEmBackground(hashes: string[], apiKey: string): Promise<void> {
    const start = Date.now();
    let atualizados = 0;

    for (let i = 0; i < hashes.length; i += this.SEEDS_BG_CONCURRENCY) {
      const batch = hashes.slice(i, i + this.SEEDS_BG_CONCURRENCY);
      await Promise.all(batch.map(async hash => {
        const seeds = await this.torboxService.getTorrentInfoByHash(hash, apiKey, this.SEEDS_BG_TIMEOUT_SEC).catch(() => 0);
        if (seeds > 0) {
          await Torrent.update({ seeders: seeds }, { where: { infoHash: hash } }).catch(() => {});
          atualizados++;
        }
      }));
    }

    this.logger.debug('SEEDERS_BG', {
      hashes: hashes.length,
      atualizados,
      durationMs: Date.now() - start,
    });
  }

  //Guarda os títulos TMDB no cache do Torbox pra usar no fallback de nome de arquivo
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
          // silencioso de propósito
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

      const where: any = {
        [Op.or]: [
          { imdbId },
          { imdbIds: { [Op.contains]: imdbId } },
        ],
      };

      if (request.type === 'series') {
        const seasonMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
        if (seasonMatch) {
          const season = parseInt(seasonMatch[1]);
          const episode = parseInt(seasonMatch[2]);

          // Temporada: aceita se o alvo cai dentro do range [imdbSeason, imdbSeasonEnd],
          // ou se o torrent não declara temporada nenhuma
          where[Op.and] = [
            {
              [Op.or]: [
                { imdbSeason: null },
                {
                  [Op.and]: [
                    { imdbSeason: { [Op.lte]: season } },
                    { imdbSeasonEnd: { [Op.gte]: season } },
                  ],
                },
              ],
            },
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

      // Dispara em background — não bloqueia a resposta. Próxima request já pega seeds reais.
      if (request.apiKey && torrents.length > 0) {
        this.fireAndForgetSeeders(torrents, request.apiKey);
      }

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

      // Usa o magnet completo salvo no banco; se não tiver, reconstrói mínimo pelo infoHash
      const magnetCompleto = torrent.magnet || `magnet:?xt=urn:btih:${torrent.infoHash}`;

      const torrentWithMagnet = {
        ...torrent,   // seeders vem do banco — populado em background pelo SEEDERS_BG
        magnet: magnetCompleto,
        magnet_link: magnetCompleto,
        quality,
        language: torrent.idioma || 'PT-BR',
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

  public clearCache(): void {
    this.cacheService.clear();
    this.catalogProvider.clearTmdbCache();
    this.seedsCheckedAt.clear();
  }

  public getStats() {
    return {
      totalRequests: this.stats.totalRequests,
      servedFromDatabase: this.stats.servedFromDatabase,
      servedFromCatalog: this.stats.servedFromCatalog,
      servedInformativeStreams: this.stats.servedInformativeStreams,
      duplicatesRemoved: this.stats.duplicatesRemoved,
      seedsCheckedHashes: this.seedsCheckedAt.size,
    };
  }
}