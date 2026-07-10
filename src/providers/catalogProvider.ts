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
import { TorrentioService, TorrentioResult } from '../services/TorrentioService';

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
  private readonly torrentioService: TorrentioService;

  private readonly streamCache = new Map<string, { streams: Stream[]; timestamp: number; isEmpty: boolean }>();
  private readonly STREAM_TTL = 24 * 60 * 60 * 1000;
  private readonly STREAM_EMPTY_TTL = 10 * 1000; // Ajustado para 10s (evita falso vazio)
  private readonly CACHE_KEY_SEPARATOR = '|';

  // Apenas evita scraping simultâneo para o mesmo conteúdo (sem cooldown)
  private readonly inFlightScraping: Set<string> = new Set();

  private tmdbDataCache = new Map<string, { data: TmdbSearchData; timestamp: number }>();
  private readonly TMDB_CACHE_TTL = 5 * 60 * 1000;

  constructor(private readonly magnetService: CuratedMagnetService) {
    this.logger = new Logger('CatalogProvider');
    this.qualityDetector = QualityDetector.getInstance();
    this.streamFormatter = StreamFormatter.getInstance();
    this.metadataExtractor = MetadataExtractor.getInstance();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = ImdbScraperService.getInstance();
    this.titleFilter = TitleFilter.getInstance();
    this.autoMagnetService = new AutoMagnetService();
    this.torrentioService = new TorrentioService();
  }

  async getTmdbSearchData(imdbId: string, season?: number): Promise<TmdbSearchData> {
    const cacheKey = season !== undefined ? `${imdbId}:s${season}` : imdbId;
    const cached = this.tmdbDataCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.TMDB_CACHE_TTL) return cached.data;

    let imdbTitles: ImdbTitles | null = null;
    let searchTitle = '';
    let seasonYear: number | null = null;
    let mediaType: string | null = null;

    try {
      imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
      if (imdbTitles?.allTitles.length) {
        searchTitle = imdbTitles.allTitles[0];
        seasonYear = imdbTitles.year || null;
        mediaType = imdbTitles.mediaType || null;
      }
    } catch (error) {
      this.logger.warn('Erro ao obter dados TMDB', { imdbId, season, error: error instanceof Error ? error.message : 'Erro' });
    }

    const data: TmdbSearchData = { searchTitle, imdbTitles, seasonYear, mediaType };
    this.tmdbDataCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  async getSeasonYear(imdbId: string, season: number): Promise<number | null> {
    const tmdb = await this.getTmdbSearchData(imdbId, season);
    return tmdb.seasonYear;
  }

  async getStreamsFromCatalog(request: any): Promise<Stream[]> {
    const startTime = Date.now();
    const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
    const cacheKey = this.generateCacheKey(request, season, episode);

    const cached = this.getFromCache(cacheKey);
    if (cached !== null) return cached;

    let allStreams: Stream[] = [];

    // DB query já foi feita pelo StreamHandler - vai direto pro JSON
    const jsonStreams = await this.getStreamsFromJson(request, season, episode);
    allStreams.push(...jsonStreams);

    const uniqueStreams = this.removeDuplicatesByInfoHash(allStreams);
    uniqueStreams.forEach(s => metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));

    if (uniqueStreams.length === 0) {
      const shouldScrape = await this.shouldAttemptScraping(request);
      if (!shouldScrape) {
        this.saveToCache(cacheKey, []);
        return [];
      }

      this.markScrapingStart(request);
      try {
        this.logger.debug(` Iniciando scraping para ${request.imdbId || request.id}`);
        const scraped = await this.performIntelligentScraping(request, season, episode);
        const scrapedUnique = this.removeDuplicatesByInfoHash(scraped);
        scrapedUnique.forEach(s => metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
        this.saveToCache(cacheKey, scrapedUnique);
        return scrapedUnique;
      } finally {
        this.markScrapingEnd(request);
      }
    }

    this.saveToCache(cacheKey, uniqueStreams);
    return uniqueStreams;
  }

  private async performIntelligentScraping(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const type = request.type;
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    const match = request.id.match(/tt\d+:(\d+):(\d+)/);
    const finalSeason = season ?? (match ? parseInt(match[1]) : undefined);
    const finalEpisode = episode ?? (match ? parseInt(match[2]) : undefined);

    let searchQuery = '';
    let seasonYear: number | null = null;
    if (imdbId) {
      const tmdb = await this.getTmdbSearchData(imdbId, finalSeason);
      if (tmdb) {
        searchQuery = tmdb.searchTitle;
        seasonYear = tmdb.seasonYear;
      }
    }
    if (!searchQuery) {
      this.logger.warn('Sem título para scraping', { imdbId });
      return [];
    }

    if (type === 'series' && finalSeason) {
      searchQuery = `${searchQuery} Temporada ${finalSeason}`;
    }

    const torrentResults = await this.torrentScraper.searchTorrents(
      searchQuery, type, finalSeason, seasonYear ?? undefined, imdbId || undefined
    );
    if (!torrentResults.length) return [];

    const uniqueTorrents = this.deduplicateTorrentsByMagnet(torrentResults);
    const { valid, invalid } = await this.filterAndValidateTorrents(
      uniqueTorrents, imdbId, request, finalSeason, finalEpisode,
      (await this.getTmdbSearchData(imdbId!, finalSeason)).imdbTitles
    );

    //  FALLBACK: Se scrapers não acharam nada válido, tenta Torrentio
    if (valid.length === 0) {
      this.logger.debug(' Scrapers não acharam torrents PT-BR, tentando Torrentio como fallback...', { imdbId });
      const torrentioResults = await this.torrentioService.search(
        type as 'movie' | 'series', imdbId!, finalSeason, finalEpisode
      );

      if (torrentioResults.length > 0) {
        this.logger.info(` Torrentio fallback: ${torrentioResults.length} torrents PT-BR encontrados`, { imdbId });

        // Converter TorrentioResult para ScrapedTorrent (formato interno)
        const scrapedFromTorrentio: ScrapedTorrent[] = torrentioResults.map(tr => ({
          title: tr.title,
          magnet: tr.magnet,
          seeders: tr.seeders,
          leechers: 0,
          size: tr.size,
          quality: tr.quality,
          provider: `Torrentio/${tr.provider}`,
          language: tr.language,
          type: tr.type
        }));

        // Validar com TitleFilter (revalidar pra segurança)
        const torrentioValidation = await this.filterAndValidateTorrents(
          scrapedFromTorrentio, imdbId, request, finalSeason, finalEpisode,
          (await this.getTmdbSearchData(imdbId!, finalSeason)).imdbTitles
        );

        if (torrentioValidation.valid.length > 0) {
          valid.push(...torrentioValidation.valid);
        } else {
          this.logger.debug(' Torrentio: resultados rejeitados pelo TitleFilter', { imdbId, count: torrentioResults.length });
        }
      } else {
        this.logger.debug(' Torrentio: nenhum resultado PT-BR', { imdbId });
      }
    }

    if (valid.length === 0) return [];

    // Fallback para packs
    const hasExactEpisode = finalEpisode !== undefined && valid.some(t =>
      /s\d+e\d+/i.test(t.title) && this.extractEpisodeNumber(t.title) === finalEpisode
    );
    const hasCompletePack = valid.some(t => /\b(?:temporada completa|season pack|complete pack)\b/i.test(t.title));

    let episodeToSave: number | null | undefined = finalEpisode;
    if (!hasExactEpisode && hasCompletePack && finalSeason) {
      episodeToSave = null; // pack
    }

    await this.saveValidTorrentsToCatalog(valid, request, finalSeason, episodeToSave,
      (await this.getTmdbSearchData(imdbId!, finalSeason)).imdbTitles, !hasExactEpisode && hasCompletePack);

    const streams = await this.processTorrentsWithOptimization(valid, request, finalSeason, finalEpisode);
    return this.streamFormatter.sortStreamsByQuality(streams);
  }

  private extractEpisodeNumber(title: string): number | null {
    const match = title.match(/e(\d+)/i);
    return match ? parseInt(match[1]) : null;
  }

  private async filterAndValidateTorrents(
    torrents: ScrapedTorrent[],
    imdbId: string | null,
    request: any,
    season?: number,
    episode?: number,
    imdbTitles: ImdbTitles | null = null
  ): Promise<{ valid: ScrapedTorrent[]; invalid: ScrapedTorrent[] }> {
    if (!imdbId) return { valid: torrents, invalid: [] };

    const valid: ScrapedTorrent[] = [];
    const invalid: ScrapedTorrent[] = [];

    for (const torrent of torrents) {
      try {
        const matchResult = await this.titleFilter.doTitlesMatch(torrent.title, imdbId, season, episode);
        if (matchResult.matches) {
          valid.push(torrent);
        } else {
          // se falhou mas é pack completo, aceita como fallback
          if (season && /\b(?:temporada completa|season pack|complete pack)\b/i.test(torrent.title)) {
            valid.push(torrent);
          } else {
            invalid.push(torrent);
          }
        }
      } catch {
        invalid.push(torrent);
      }
    }
    return { valid, invalid };
  }

  private async saveValidTorrentsToCatalog(
    torrents: ScrapedTorrent[],
    request: any,
    season?: number,
    episode?: number | null,
    imdbTitles: ImdbTitles | null = null,
    isPackFallback = false
  ): Promise<void> {
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    if (!imdbId || torrents.length === 0) return;

    for (const torrent of torrents) {
      try {
        const episodeValue = isPackFallback ? null : episode;
        await this.autoMagnetService.autoAddMagnet(
          torrent.magnet, torrent.title, imdbId, request.type,
          torrent.seeders, torrent.quality, torrent.size, season, episodeValue
        );
      } catch (error) {
        this.logger.error('Erro ao salvar magnet', { title: torrent.title.substring(0, 60), error: error instanceof Error ? error.message : 'Erro' });
      }
    }
  }

  private async processTorrentsWithOptimization(
    torrents: ScrapedTorrent[], request: any, season?: number, episode?: number
  ): Promise<Stream[]> {
    const streams: Stream[] = [];
    const batchSize = 3;
    for (let i = 0; i < torrents.length; i += batchSize) {
      const batch = torrents.slice(i, i + batchSize);
      const batchPromises = batch.map(async torrent => {
        try {
          return this.streamFormatter.createMultipleQualityStreams(
            torrent, request, null,
            request.type === 'series' ? 'series' : 'movie',
            season, episode, false
          );
        } catch {
          return [];
        }
      });
      const results = await Promise.allSettled(batchPromises);
      for (const r of results) {
        if (r.status === 'fulfilled') streams.push(...r.value);
      }
      if (i + batchSize < torrents.length) await new Promise(resolve => setTimeout(resolve, 800));
    }
    return streams;
  }

  private generateCacheKey(request: any, season?: number, episode?: number): string {
    return `${request.imdbId || request.id}|${request.type}|${season ?? ''}|${episode ?? ''}`;
  }

  private getFromCache(key: string): Stream[] | null {
    const entry = this.streamCache.get(key);
    if (!entry) { metricsService.recordCacheMiss(); return null; }
    const now = Date.now();
    const ttl = entry.isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
    if (now - entry.timestamp > ttl) {
      this.streamCache.delete(key);
      metricsService.recordCacheMiss();
      return null;
    }
    metricsService.recordCacheHit();
    return entry.streams;
  }

  private saveToCache(key: string, streams: Stream[]): void {
    this.streamCache.set(key, { streams, timestamp: Date.now(), isEmpty: streams.length === 0 });
    if (this.streamCache.size > 10000) this.cleanupOldCache();
  }

  private cleanupOldCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.streamCache.entries()) {
      if (now - entry.timestamp > 7 * 24 * 60 * 60 * 1000) this.streamCache.delete(key);
    }
  }

  /**
   * Permite scraping SEMPRE, a menos que já exista um scraping em andamento
   * para o mesmo conteúdo (evita requisições simultâneas duplicadas).
   */
  private async shouldAttemptScraping(request: any): Promise<boolean> {
    const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
    if (this.inFlightScraping.has(key)) {
      this.logger.debug(' Scraping já em andamento, aguardando...', { key });
      return false;
    }
    return true;
  }

  /** Marca início do scraping para evitar duplicação simultânea */
  private markScrapingStart(request: any): void {
    const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
    this.inFlightScraping.add(key);
  }

  /** Marca fim do scraping (sucesso ou falha) */
  private markScrapingEnd(request: any): void {
    const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
    this.inFlightScraping.delete(key);
  }

  private async getStreamsFromDatabase(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    if (!imdbId) return [];
    const finalSeason = season ?? request.season;
    const finalEpisode = episode ?? request.episode;

    let entries: any[] = [];
    if (request.type === 'movie') {
      entries = await getImdbIdMovieEntries(imdbId);
    } else if (request.type === 'series' && finalSeason !== undefined) {
      entries = await getImdbIdSeriesEntries(imdbId, finalSeason, finalEpisode);
    }
    if (!entries.length) return [];

    const torrentData = await this.processDatabaseTorrents(entries, request, finalSeason, finalEpisode);
    const sorted = this.sortTorrentsByQuality(torrentData);
    return this.createStreamsFromDbTorrents(sorted, request, finalSeason, finalEpisode);
  }

  private async processDatabaseTorrents(entries: any[], request: any, season?: number, episode?: number): Promise<any[]> {
    const map = new Map<string, any>();
    for (const entry of entries) {
      const torrent = entry.Torrent;
      const magnet = torrent.magnetLink || '';
      const hash = extractHashFromMagnet(magnet);
      if (!hash) continue;
      const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
      const quality = this.qualityDetector.extractBestQuality(torrent.title) || 'HD';
      map.set(hash, {
        torrent, metadata, quality,
        qualityScore: this.getQualityScore(quality),
        seeds: torrent.seeders || 50,
        size: this.formatSize(torrent.size || 0),
        language: torrent.languages || 'PT-BR',
        magnet, magnetHash: hash, title: torrent.title,
        requestType: request.type, season, episode
      });
    }
    return Array.from(map.values());
  }

  private async createStreamsFromDbTorrents(torrents: any[], request: any, season?: number, episode?: number): Promise<Stream[]> {
    const streams: Stream[] = [];
    for (const t of torrents) {
      const formatted = {
        title: t.title, magnet: t.magnet, seeders: t.seeds,
        size: t.size, quality: t.quality, language: t.language
      };
      const streamArrays = this.streamFormatter.createMultipleQualityStreams(
        formatted, request, null, t.requestType, season, episode, undefined, 0
      );
      streams.push(...streamArrays);
    }
    return streams;
  }

  private async getStreamsFromJson(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const curated = this.magnetService.searchMagnets(request);
    if (!curated.length) return [];
    const streams: Stream[] = [];
    for (const magnet of curated) {
      const formatted = {
        title: magnet.title, magnet: magnet.magnet || '',
        seeders: magnet.seeds || 0, size: magnet.size || 'N/A',
        quality: magnet.quality || 'HD', language: magnet.language || 'PT-BR'
      };
      const streamArrays = this.streamFormatter.createMultipleQualityStreams(
        formatted, request, null,
        request.type === 'series' ? 'series' : 'movie',
        season ?? magnet.season, episode ?? magnet.episode, undefined, 0
      );
      streams.push(...streamArrays);
    }
    return streams;
  }

  private removeDuplicatesByInfoHash(streams: Stream[]): Stream[] {
    const seen = new Set<string>();
    const unique: Stream[] = [];
    for (const s of streams) {
      // Usa infoHash, url, ou title como chave de dedup
      const hash = s.infoHash || s.url || s.title || Math.random().toString();
      const quality = this.extractStreamQuality(s);
      const key = `${hash}|${quality}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(s);
    }
    return unique;
  }

  private extractStreamQuality(stream: Stream): string {
    return (stream.behaviorHints as any)?.streamQuality ||
      this.qualityDetector.extractBestQuality(stream.title || '') ||
      'unknown';
  }

  private extractSeasonEpisodeFromRequest(request: any) {
    let season = request.season;
    let episode = request.episode;
    if (!season && request.type === 'series' && request.id) {
      const m = request.id.match(/tt\d+:(\d+):(\d+)/);
      if (m) { season = parseInt(m[1]); episode = parseInt(m[2]); }
    }
    return { season, episode };
  }

  private extractBaseImdbId(id: string): string | null {
    const m = id.match(/^(tt\d+)/);
    return m ? m[1] : null;
  }

  private sortTorrentsByQuality(torrents: any[]): any[] {
    return torrents.sort((a, b) => b.qualityScore - a.qualityScore || b.seeds - a.seeds);
  }

  private getQualityScore(quality: string): number {
    const scores: Record<string, number> = { '2160p': 100, '4k': 100, '1080p': 80, '720p': 60, 'HD': 40, 'SD': 20 };
    return scores[quality] || 30;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  private deduplicateTorrentsByMagnet(torrents: ScrapedTorrent[]): ScrapedTorrent[] {
    const seen = new Set<string>();
    const unique: ScrapedTorrent[] = [];
    for (const t of torrents) {
      const hash = extractHashFromMagnet(t.magnet);
      if (hash && seen.has(hash.toLowerCase())) continue;
      if (hash) seen.add(hash.toLowerCase());
      unique.push(t);
    }
    return unique;
  }

  clearTmdbCache(): void { this.tmdbDataCache.clear(); }

  getStats() {
    return {
      cacheSize: this.streamCache.size,
      inFlightScraping: this.inFlightScraping.size,
      tmdbCacheSize: this.tmdbDataCache.size
    };
  }
}