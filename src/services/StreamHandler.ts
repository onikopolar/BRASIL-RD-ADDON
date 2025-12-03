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
import { extractCleanMovieTitle } from '../lib/stringUtils';
import { EpisodeMatcher } from '../lib/episodeMatcher';
import { TitleFilter } from '../lib/titleFilter';
import { StreamFormatter } from '../lib/streamFormatter';
import { CatalogProvider } from '../providers/catalogProvider';

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

  // Módulos utilitários
  private readonly qualityDetector: QualityDetector;
  private readonly episodeMatcher: EpisodeMatcher;
  private readonly titleFilter: TitleFilter;
  private readonly streamFormatter: StreamFormatter;
  private readonly catalogProvider: CatalogProvider;

  // Configurações
  private readonly processingConfig: StreamProcessingConfig = {
    maxConcurrentTorrents: 3,
    delayBetweenTorrents: 800
  };

  // Cache para scraping
  private scrapingCache = new Map<string, ScrapingCacheEntry>();
  private readonly scrapingCacheTTL = 6 * 60 * 60 * 1000; // 6 horas

  // Estatísticas
  private stats = {
    totalRequests: 0,
    servedFromDatabase: 0,
    servedFromCatalog: 0,
    servedFromScraping: 0
  };

  constructor() {
    this.rdService = new RealDebridService();
    this.magnetService = new CuratedMagnetService();
    this.autoMagnetService = new AutoMagnetService();
    this.cacheService = new CacheService();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = new ImdbScraperService();
    this.logger = new Logger('StreamHandler');

    // Inicializar módulos utilitários
    this.qualityDetector = new QualityDetector();
    this.episodeMatcher = new EpisodeMatcher();
    this.titleFilter = new TitleFilter();
    this.streamFormatter = new StreamFormatter();
    this.catalogProvider = new CatalogProvider(this.magnetService);
  }

  // ==================== HANDLER PRINCIPAL ====================

  async handleStreamRequest(request: StreamRequest): Promise<{ streams: Stream[] }> {
    const requestId = request.id;
    const requestStartTime = Date.now();
    this.stats.totalRequests++;

    if (!request.apiKey) {
      return { streams: [] };
    }

    try {
      // AGUARDAR INICIALIZAÇÃO DO CATÁLOGO ANTES DE TUDO
      await this.magnetService.waitForInitialization();

      const imdbId = this.extractImdbIdFromRequest(request);
      
      // 1. BANCO DE DADOS (PRIMEIRO)
      const dbResult = await this.getStreamsFromDatabase(request);
      if (dbResult.success && dbResult.streams.length > 0) {
        this.stats.servedFromDatabase++;
        return { streams: dbResult.streams };
      }

      // 2. CATÁLOGO JSON (SEGUNDO)
      const catalogResult = await this.getStreamsFromCatalog(request);
      if (catalogResult.success && catalogResult.streams.length > 0) {
        this.stats.servedFromCatalog++;
        return { streams: catalogResult.streams };
      }

      // 3. SCRAPING (ÚLTIMO RECURSO)
      const shouldScrape = await this.shouldAttemptScraping(request);
      if (!shouldScrape) {
        return { streams: [] };
      }

      const scrapingResult = await this.processStreamRequest(request);
      
      // Atualizar cache de scraping
      await this.updateScrapingCache(request, scrapingResult.length > 0);
      
      this.stats.servedFromScraping += scrapingResult.length > 0 ? 1 : 0;
      
      return { streams: scrapingResult };

    } catch (error) {
      this.logger.error('Falha no processamento de stream', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { streams: [] };
    }
  }

  // ==================== BANCO DE DADOS ====================

  private async getStreamsFromDatabase(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();

    try {
      let fileEntries: any[] = [];
      const imdbId = this.extractImdbIdFromRequest(request);

      if (!imdbId) {
        return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
      }

      if (request.type === 'movie') {
        fileEntries = await this.getImdbIdMovieEntries(imdbId);
      } else if (request.type === 'series') {
        const episodeInfo = this.episodeMatcher.extractEpisodeFromMultipleSources(request.id);
        if (episodeInfo.isValid) {
          fileEntries = await this.getImdbIdSeriesEntries(imdbId, episodeInfo.season, episodeInfo.episode);
        }
      }

      const streams: Stream[] = [];
      for (const fileEntry of fileEntries) {
        const torrent = fileEntry.torrent;
        if (torrent && torrent.infoHash) {
          const stream = this.convertDatabaseEntryToStream(fileEntry, torrent, request);
          if (stream) {
            streams.push(stream);
          }
        }
      }

      return {
        success: true,
        streams,
        source: 'database',
        processingTime: Date.now() - startTime
      };

    } catch (error) {
      return { success: false, streams: [], source: 'database', processingTime: Date.now() - startTime };
    }
  }

  private async getImdbIdMovieEntries(imdbId: string) {
    return File.findAll({
      where: { imdbId: { [Op.eq]: imdbId } },
      include: [{
        model: Torrent,
        required: true,
        where: { seeders: { [Op.gte]: 5 } }
      }],
      limit: 20,
      order: [[Torrent, 'seeders', 'DESC']]
    });
  }

  private async getImdbIdSeriesEntries(imdbId: string, season: number, episode: number) {
    return File.findAll({
      where: {
        imdbId: { [Op.eq]: imdbId },
        imdbSeason: { [Op.eq]: season },
        imdbEpisode: { [Op.eq]: episode }
      },
      include: [{
        model: Torrent,
        required: true,
        where: { seeders: { [Op.gte]: 5 } }
      }],
      limit: 15,
      order: [[Torrent, 'seeders', 'DESC']]
    });
  }

  private convertDatabaseEntryToStream(fileEntry: any, torrent: any, request: StreamRequest): Stream | null {
    try {
      const magnetHash = torrent.infoHash;
      const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
      const magnetLink = `magnet:?xt=urn:btih:${magnetHash}`;

      // Adicionar informação de temporada/episódio para séries
      let titleSuffix = '';
      let season: number | undefined;
      let episode: number | undefined;

      if (request.type === 'series' && fileEntry.imdbSeason && fileEntry.imdbEpisode) {
        season = fileEntry.imdbSeason;
        episode = fileEntry.imdbEpisode;
        titleSuffix = ` S${season!.toString().padStart(2, '0')}E${episode!.toString().padStart(2, '0')}`;
      }

      const stream: Stream = {
        title: torrent.title,
        name: `Brasil RD (${quality})${titleSuffix}`,
        description: `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'pt-BR')}`,
        sources: [magnetLink],
        behaviorHints: {
          notWebReady: false,
          bingeGroup: `br-db-${request.id}`
        },
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

  // ==================== CATÁLOGO JSON ====================

  private async getStreamsFromCatalog(request: StreamRequest): Promise<DatabaseStreamResult> {
    const startTime = Date.now();

    try {
      const streams = await this.catalogProvider.getStreamsFromCatalog(request);
      
      return {
        success: true,
        streams,
        source: 'catalog',
        processingTime: Date.now() - startTime
      };
    } catch (error) {
      return { success: false, streams: [], source: 'catalog', processingTime: Date.now() - startTime };
    }
  }

  // ==================== DECISÃO DE SCRAPING ====================

  private async shouldAttemptScraping(request: StreamRequest): Promise<boolean> {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;

    // Verificar cache de scraping
    const cacheEntry = this.scrapingCache.get(requestKey);
    if (cacheEntry) {
      const timeSinceLastAttempt = Date.now() - cacheEntry.lastAttempt.getTime();
      
      // Se já tentou recentemente e não encontrou nada, não tentar de novo
      if (!cacheEntry.successful && timeSinceLastAttempt < this.scrapingCacheTTL / 2) {
        return false;
      }

      // Se já tentou muito recentemente, esperar um pouco
      if (timeSinceLastAttempt < 5 * 60 * 1000) { // 5 minutos
        return false;
      }
    }

    return true;
  }

  private async updateScrapingCache(request: StreamRequest, successful: boolean): Promise<void> {
    const imdbId = this.extractImdbIdFromRequest(request);
    const requestKey = `${imdbId || request.id}:${request.type}`;
    
    this.scrapingCache.set(requestKey, {
      lastAttempt: new Date(),
      successful
    });

    // Limpar cache antigo
    this.cleanupOldCache();
  }

  private cleanupOldCache(): void {
    const now = Date.now();
    const toDelete: string[] = [];

    for (const [key, entry] of this.scrapingCache.entries()) {
      const age = now - entry.lastAttempt.getTime();
      if (age > this.scrapingCacheTTL * 2) {
        toDelete.push(key);
      }
    }

    for (const key of toDelete) {
      this.scrapingCache.delete(key);
    }
  }

  // ==================== SCRAPING ====================

  private async processStreamRequest(request: StreamRequest): Promise<Stream[]> {
    if (request.type === 'series') {
      return await this.processSeriesRequest(request);
    } else {
      return await this.processMovieRequest(request);
    }
  }

  private async processMovieRequest(request: StreamRequest): Promise<Stream[]> {
    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      return await this.performIntelligentScraping(imdbId, request);
    } catch (error) {
      return [];
    }
  }

  private async processSeriesRequest(request: StreamRequest): Promise<Stream[]> {
    try {
      const imdbId = this.extractImdbIdFromRequest(request);
      if (!imdbId) {
        return await this.performIntelligentScraping(null, request);
      }

      const episodeInfo = this.episodeMatcher.extractEpisodeFromMultipleSources(request.id);

      if (episodeInfo.isValid) {
        const episodeStream = await this.processSpecificEpisode(
          imdbId,
          episodeInfo.season,
          episodeInfo.episode,
          request
        );

        if (episodeStream) {
          if (Array.isArray(episodeStream)) {
            return episodeStream;
          } else {
            return [episodeStream];
          }
        }
      }

      return await this.performIntelligentScraping(imdbId, request);

    } catch (error) {
      return [];
    }
  }

  private async performIntelligentScraping(
    imdbId: string | null,
    request: StreamRequest
  ): Promise<Stream[]> {
    try {
      const type = request.type;
      const episodeInfo = this.episodeMatcher.extractEpisodeFromRequest(request.id);

      let searchTitle: string | null = null;
      let imdbTitles: ImdbTitles | null = null;

      // Obter títulos do IMDB se tiver imdbId
      if (imdbId) {
        imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
        if (imdbTitles && imdbTitles.allTitles.length > 0) {
          searchTitle = imdbTitles.allTitles[0];
        }
      }

      if (!searchTitle) {
        searchTitle = 'Unknown Title';
      }

      let searchQuery = searchTitle;
      if (type === 'series' && episodeInfo.isValid) {
        searchQuery = `${searchTitle} Temporada ${episodeInfo.season}`;
      }

      // Buscar torrents
      const torrentResults = await this.torrentScraper.searchTorrents(
        searchQuery,
        type,
        episodeInfo.isValid ? episodeInfo.season : undefined
      );

      if (torrentResults.length === 0) {
        return [];
      }

      const filteredTorrents = await this.filterAndValidateTorrents(
        torrentResults,
        imdbId,
        request,
        episodeInfo,
        imdbTitles
      );

      if (filteredTorrents.valid.length === 0) {
        return [];
      }

      await this.saveValidTorrentsToCatalog(
        filteredTorrents.valid,
        request,
        episodeInfo,
        imdbTitles
      );

      const streams = await this.processTorrentsWithOptimization(
        filteredTorrents.valid,
        request,
        episodeInfo
      );

      return this.streamFormatter.sortStreamsByQuality(streams);

    } catch (error) {
      return [];
    }
  }

  private async filterAndValidateTorrents(
    torrents: ScrapedTorrent[],
    imdbId: string | null,
    request: StreamRequest,
    episodeInfo: { season: number; episode: number; isValid: boolean },
    imdbTitles: ImdbTitles | null = null
  ): Promise<{ valid: ScrapedTorrent[], invalid: ScrapedTorrent[] }> {
    const valid: ScrapedTorrent[] = [];
    const invalid: ScrapedTorrent[] = [];

    // Se não tem imdbId, aceita todos (fallback)
    if (!imdbId) {
      return { valid: torrents, invalid: [] };
    }

    for (const torrent of torrents) {
      try {
        const titleMatchResult = await this.titleFilter.doTitlesMatch(
          torrent.title,
          imdbId,
          episodeInfo.isValid ? episodeInfo.season : undefined,
          episodeInfo.isValid ? episodeInfo.episode : undefined
        );

        if (titleMatchResult.matches) {
          valid.push(torrent);
        } else {
          invalid.push(torrent);
        }
      } catch (error) {
        invalid.push(torrent);
      }
    }

    return { valid, invalid };
  }

  private async saveValidTorrentsToCatalog(
    validTorrents: ScrapedTorrent[],
    request: StreamRequest,
    episodeInfo: { season: number; episode: number; isValid: boolean },
    imdbTitles: ImdbTitles | null = null
  ): Promise<void> {
    const imdbId = this.extractImdbIdFromRequest(request);

    if (!imdbId || validTorrents.length === 0) {
      return;
    }

    for (const torrent of validTorrents) {
      try {
        const finalMatchResult = await this.titleFilter.doTitlesMatch(
          torrent.title,
          imdbId,
          episodeInfo.isValid ? episodeInfo.season : undefined,
          episodeInfo.isValid ? episodeInfo.episode : undefined
        );

        if (!finalMatchResult.matches) {
          continue;
        }

        const metadata = this.titleFilter.extractSeriesMetadata(torrent.title);
        const imdbSeason = episodeInfo.isValid ? episodeInfo.season : metadata.season;
        const imdbEpisode = episodeInfo.isValid ? episodeInfo.episode : metadata.episode;

        await this.autoMagnetService.autoAddMagnet(
          torrent.magnet,
          torrent.title,
          imdbId,
          request.type,
          torrent.seeders,
          torrent.quality,
          torrent.size,
          imdbSeason,
          imdbEpisode
        );
      } catch (error) {
        // Ignorar erros ao salvar
      }
    }
  }

  // ==================== PROCESSAMENTO DE TORRENTS ====================

  private async processTorrentsWithOptimization(
    torrents: ScrapedTorrent[],
    request: StreamRequest,
    episodeInfo: { season: number; episode: number; isValid: boolean }
  ): Promise<Stream[]> {
    const allStreams: Stream[] = [];
    const batchSize = this.processingConfig.maxConcurrentTorrents;

    for (let i = 0; i < torrents.length; i += batchSize) {
      const batch = torrents.slice(i, i + batchSize);

      const batchPromises = batch.map(async (torrent) => {
        try {
          return request.type === 'series'
            ? await this.createSeriesStream(torrent, request, episodeInfo)
            : await this.createMovieStream(torrent, request);
        } catch (error) {
          return null;
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);

      for (const result of batchResults) {
        if (result.status === 'fulfilled' && result.value) {
          const streamResult = result.value;
          if (Array.isArray(streamResult)) {
            allStreams.push(...streamResult);
          } else {
            allStreams.push(streamResult);
          }
        }
      }

      if (i + batchSize < torrents.length) {
        await this.delay(this.processingConfig.delayBetweenTorrents);
      }
    }

    return allStreams;
  }

  private async createMovieStream(
    torrent: ScrapedTorrent,
    request: StreamRequest
  ): Promise<Stream> {
    const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);
    const magnetHash = extractHashFromMagnet(torrent.magnet);

    return {
      title: `Brasil RD (${quality})`,
      name: `Brasil RD (${quality})`,
      description: `${extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`,
      sources: [torrent.magnet],
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-scrape-${request.id}`
      },
      status: 'available',
      infoHash: magnetHash || undefined,
      magnet: torrent.magnet,
      url: generateLazyResolveUrl(torrent.magnet, request.apiKey!, 'movie')
    };
  }

  private async createSeriesStream(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    episodeInfo: { season: number; episode: number; isValid: boolean }
  ): Promise<Stream | Stream[]> {
    const quality = this.qualityDetector.extractQualityFromFilename(torrent.title);

    if (episodeInfo.isValid) {
      const episodeTag = `S${episodeInfo.season.toString().padStart(2, '0')}E${episodeInfo.episode.toString().padStart(2, '0')}`;
      const magnetHash = extractHashFromMagnet(torrent.magnet);

      return {
        title: `Brasil RD (${quality}) ${episodeTag}`,
        name: `Brasil RD (${quality}) ${episodeTag}`,
        description: `${extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`,
        sources: [torrent.magnet],
        behaviorHints: {
          notWebReady: false,
          bingeGroup: `br-${request.id}-${episodeInfo.season}`
        },
        status: 'available',
        infoHash: magnetHash || undefined,
        magnet: torrent.magnet,
        url: generateLazyResolveUrl(torrent.magnet, request.apiKey!, 'series', episodeInfo.season, episodeInfo.episode)
      };
    } else {
      return await this.createMovieStream(torrent, request);
    }
  }

  // ==================== UTILITÁRIOS ====================

  private extractImdbIdFromRequest(request: StreamRequest): string | null {
    if (request.imdbId) return request.imdbId;
    const imdbMatch = request.id.match(/^(tt\d+)/);
    return imdbMatch ? imdbMatch[1] : null;
  }

  private async processSpecificEpisode(
    imdbId: string,
    season: number,
    episode: number,
    request: StreamRequest
  ): Promise<Stream | Stream[] | null> {
    try {
      const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        return null;
      }

      const searchTitle = imdbTitles.allTitles[0];
      const searchQuery = `${searchTitle} S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;

      const torrentResults = await this.torrentScraper.searchTorrents(
        searchQuery,
        'series',
        season
      );

      if (torrentResults.length === 0) {
        return null;
      }

      const episodeInfo = { season, episode, isValid: true };
      const filteredTorrents = await this.filterAndValidateTorrents(
        torrentResults,
        imdbId,
        request,
        episodeInfo,
        imdbTitles
      );

      if (filteredTorrents.valid.length === 0) {
        return null;
      }

      const bestTorrent = filteredTorrents.valid.reduce((best, current) =>
        current.seeders > best.seeders ? current : best
      );

      const streamResult = await this.createSeriesStream(bestTorrent, request, episodeInfo);

      if (Array.isArray(streamResult)) {
        return streamResult.length > 0 ? streamResult[0] : null;
      } else {
        return streamResult;
      }

    } catch (error) {
      return null;
    }
  }

  private formatLanguage(language: string): string {
    const langMap: Record<string, string> = {
      'pt-BR': 'PT-BR',
      'pt-BR,en': 'Dual PT-BR/EN',
      'en': 'EN',
      'dual': 'Dual Audio',
      'pt': 'Português'
    };
    return langMap[language] || language;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== MÉTODOS PÚBLICOS ====================

  addCuratedMagnet(magnet: CuratedMagnet): void {
    this.magnetService.addMagnet(magnet);
    this.invalidateRelatedCache(magnet.imdbId);
  }

  removeCuratedMagnet(imdbId: string, magnetLink: string): boolean {
    const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
    if (removed) {
      this.invalidateRelatedCache(imdbId);
    }
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

    for (const pattern of cachePatterns) {
      this.cacheService.delete(pattern);
    }
  }

  public getStats() {
    return {
      totalRequests: this.stats.totalRequests,
      servedFromDatabase: this.stats.servedFromDatabase,
      servedFromCatalog: this.stats.servedFromCatalog,
      servedFromScraping: this.stats.servedFromScraping,
      scrapingCacheSize: this.scrapingCache.size
    };
  }
}