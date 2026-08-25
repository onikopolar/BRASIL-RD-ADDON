import { CuratedMagnetService } from '../catalogo/CuratedMagnetService.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { StreamFormatter } from '../stream/streamFormatter.js';
import { Stream } from '../types/index.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';
import { Logger } from '../utils/logger.js';
import { TorrentScraperService } from '../services/scraper/TorrentScraperService.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { TitleFilter } from '../titulos/titleFilter.js';
import { AutoMagnetService } from '../debrid/AutoMagnetService.js';
import { metricsService } from '../catalogo/MetricsService.js';
import { INDICADORES_INTERNACIONAL_TORRENTS, extrairRangeEpisodios } from '../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

interface ScrapedTorrent {
  title: string;
  htmlTitle?: string;
  canonicalName?: string;
  magnetInfoHash?: string;
  originalTitle?: string;
  year?: number;
  magnet: string;
  seeders: number;
  leechers: number;
  size: string;
  quality: string;
  provider: string;
  language: string;
  type: 'movie' | 'series';
  episode?: number;
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
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly titleFilter: TitleFilter;
  private readonly autoMagnetService: AutoMagnetService;

  private readonly streamCache = new Map<string, { streams: Stream[]; timestamp: number; isEmpty: boolean }>();
  private readonly STREAM_TTL = 24 * 60 * 60 * 1000;
  private readonly STREAM_EMPTY_TTL = 10 * 1000;
  private readonly MAX_CACHE_SIZE = 5000;

  private readonly inFlightScraping: Set<string> = new Set();

  private tmdbDataCache = new Map<string, { data: TmdbSearchData; timestamp: number }>();
  private readonly TMDB_CACHE_TTL = 5 * 60 * 1000;
  private readonly MAX_TMDB_CACHE_SIZE = 1000;

  constructor(private readonly magnetService: CuratedMagnetService) {
    this.logger = new Logger('CatalogProvider');
    this.qualityDetector = QualityDetector.getInstance();
    this.streamFormatter = StreamFormatter.getInstance();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = ImdbScraperService.getInstance();
    this.titleFilter = TitleFilter.getInstance();
    this.autoMagnetService = new AutoMagnetService();
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
        searchTitle = imdbTitles.allTitles[imdbTitles.allTitles.length - 1] || imdbTitles.allTitles[0];
        seasonYear = imdbTitles.year || null;
        mediaType = imdbTitles.mediaType || null;
      }
    } catch (error) {
      this.logger.warn('Erro ao obter dados TMDB', { imdbId, season, error: error instanceof Error ? error.message : 'Erro' });
    }

    const data: TmdbSearchData = { searchTitle, imdbTitles, seasonYear, mediaType };

    // Aplicar limite de cache LRU simples
    if (this.tmdbDataCache.size >= this.MAX_TMDB_CACHE_SIZE) {
      const firstKey = this.tmdbDataCache.keys().next().value;
      if (firstKey) this.tmdbDataCache.delete(firstKey);
    }
    this.tmdbDataCache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  }

  async getSeasonYear(imdbId: string, season: number): Promise<number | null> {
    const tmdb = await this.getTmdbSearchData(imdbId, season);
    return tmdb.seasonYear;
  }

  async getStreamsFromCatalog(request: any): Promise<Stream[]> {
    const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
    const cacheKey = this.generateCacheKey(request, season, episode);

    const cached = this.getFromCache(cacheKey);
    if (cached !== null) {
      return this.streamFormatter.sortStreamsByQuality(cached);
    }

    // Primeiro tenta catálogo manual (JSON)
    let allStreams = await this.getStreamsFromJson(request, season, episode);
    let uniqueStreams = this.removeDuplicatesByInfoHash(allStreams);

    if (uniqueStreams.length === 0) {
      const shouldScrape = await this.shouldAttemptScraping(request);
      if (!shouldScrape) {
        this.saveToCache(cacheKey, []);
        return [];
      }

      this.markScrapingStart(request);
      try {
        const scraped = await this.performIntelligentScraping(request, season, episode);
        uniqueStreams = this.removeDuplicatesByInfoHash(scraped);
      } finally {
        this.markScrapingEnd(request);
      }
    }

    const sorted = this.streamFormatter.sortStreamsByQuality(uniqueStreams);
    sorted.forEach(s => metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
    this.logger.info('📋 Catálogo', {
      imdbId: request.imdbId || request.id,
      season,
      episode,
      total: sorted.length,
      qualidades: [...new Set(sorted.map(s => this.extractStreamQuality(s)))],
    });
    this.saveToCache(cacheKey, sorted);
    return sorted;
  }

  private async performIntelligentScraping(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const type = request.type;
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    const match = request.id.match(/tt\d+:(\d+):(\d+)/);
    const finalSeason = season ?? (match ? parseInt(match[1]) : undefined);
    const finalEpisode = episode ?? (match ? parseInt(match[2]) : undefined);

    const tmdb = imdbId ? await this.getTmdbSearchData(imdbId, finalSeason) : null;
    if (!tmdb || !tmdb.searchTitle) {
      this.logger.warn('Sem título para scraping', { imdbId });
      return [];
    }

    let searchQuery = tmdb.searchTitle;
    if (type === 'series' && finalSeason) {
      searchQuery = `${searchQuery} Temporada ${finalSeason}`;
    }

    const torrentResults = await this.torrentScraper.searchTorrents(
      searchQuery, type, finalSeason, tmdb.seasonYear ?? undefined, imdbId || undefined
    );

    const uniqueTorrents = await this.deduplicateTorrentsByMagnet(torrentResults);
    const { valid, invalid } = await this.filterAndValidateTorrents(
      uniqueTorrents, imdbId, request, finalSeason, finalEpisode,
      tmdb.imdbTitles
    );

    if (valid.length === 0) {
      this.logger.info('📋 Scraping: todos torrents filtrados — 0 válidos', {
        imdbId, season: finalSeason, episode: finalEpisode,
        totalScraped: uniqueTorrents.length, totalInvalid: invalid.length
      });
      return [];
    }

    const hasExactEpisode = finalEpisode !== undefined && valid.some(t =>
      /s\d+e\d+/i.test(t.title) && this.extractEpisodeNumber(t.title) === finalEpisode
    );
    const hasCompletePack = valid.some(t =>
      /\b(?:temporada completa|season pack|complete pack)\b/i.test(t.title) ||
      (() => {
        const r = extrairRangeEpisodios(t.canonicalName || t.title);
        return r && r.season === finalSeason && r.episodeStart === 0 && r.episodeEnd === 0;
      })()
    );

    let episodeToSave: number | null | undefined = finalEpisode;
    if (!hasExactEpisode && hasCompletePack && finalSeason) {
      episodeToSave = null;
    }

    await this.saveValidTorrentsToCatalog(valid, request, finalSeason, episodeToSave,
      tmdb.imdbTitles, !hasExactEpisode && hasCompletePack);

    return this.processTorrentsWithOptimization(valid, request, finalSeason, finalEpisode);
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

    // Preenche canonicalName e magnetInfoHash via analisarMagnet
    const dadosMagnets = await Promise.all(
      torrents.map(t => analisarMagnet(t.magnet).catch(() => null))
    );
    torrents.forEach((t, i) => {
      if (dadosMagnets[i]?.nome) t.canonicalName = dadosMagnets[i]!.nome!;
      if (dadosMagnets[i]?.infoHash) t.magnetInfoHash = dadosMagnets[i]!.infoHash.toLowerCase();
    });

    const naoLegendado = torrents.filter(t => !(t.language && LEGENDADO_REGEX.test(t.language)));

    const results = await Promise.allSettled(
      naoLegendado.map(async (t) => {
        const tituloParaValidar = t.canonicalName || t.title || t.originalTitle || '';
        const tituloParaIdioma = t.title || t.originalTitle || t.canonicalName || '';
        this.logger.debug(`🔍 Validando: "${tituloParaValidar?.substring(0, 50)}" | alvo S${season ?? '?'}E${episode ?? '?'}`);

        let result = await this.titleFilter.titulosCombinam(
          tituloParaValidar,
          imdbId,
          season,
          episode,
          tituloParaIdioma,
          t.year,
          imdbTitles,
          t.htmlTitle,
          t.episode
        );

        if (!result.matches && t.originalTitle && t.canonicalName && t.canonicalName !== t.originalTitle) {
          const fallbackResult = await this.titleFilter.titulosCombinam(
            t.canonicalName,
            imdbId,
            season,
            episode,
            t.canonicalName,
            t.year,
            imdbTitles,
            t.htmlTitle,
            t.episode
          );
          if (fallbackResult.matches) {
            this.logger.info('🔄 Fallback canonicalName salvou', {
              originalTitle: t.originalTitle?.substring(0, 40),
              canonicalName: t.canonicalName?.substring(0, 40),
              motivoOriginal: result.reason,
              motivoFallback: fallbackResult.reason,
            });
            result = fallbackResult;
          }
        }

        return { torrent: t, result };
      })
    );

    const valid: ScrapedTorrent[] = [];
    const invalid: ScrapedTorrent[] = [];

    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        const { torrent, result } = res.value;
        if (result.matches) {
          this.logger.info('🎯 ACEITO', {
            imdbId,
            alvo: `S${season ?? '?'}E${episode ?? '?'}`,
            torrent: (torrent.canonicalName || torrent.title).substring(0, 70),
            provider: torrent.provider,
            infoHash: torrent.magnetInfoHash?.substring(0, 12) || 'N/A'
          });
          valid.push(torrent);
        } else {
          invalid.push(torrent);
        }
      } else {
        invalid.push(naoLegendado[i]);
      }
    });

    if (invalid.length > 0) {
      const razoes: Record<string, number> = {};
      results.forEach((res, i) => {
        if (res.status === 'fulfilled' && !res.value.result.matches) {
          const motivo = res.value.result.reason?.split('|')[0]?.trim() || 'desconhecido';
          razoes[motivo] = (razoes[motivo] || 0) + 1;
        } else if (res.status === 'rejected') {
          razoes['erro interno'] = (razoes['erro interno'] || 0) + 1;
        }
      });
      const topRazoes = Object.entries(razoes).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `${v}x ${k}`).join(' | ');
      this.logger.info('📋 Rejeitados', {
        imdbId,
        alvo: `S${season ?? '?'}E${episode ?? '?'}`,
        total: invalid.length,
        motivos: topRazoes,
        aceitos: valid.length,
        scraped: torrents.length,
        lendario: torrents.length - naoLegendado.length,
      });
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
    if (process.env.SKIP_DB_WRITE === 'true') return;

    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    if (!imdbId || torrents.length === 0) return;

    const batchSize = 5;
    for (let i = 0; i < torrents.length; i += batchSize) {
      const batch = torrents.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(async torrent => {
        try {
          const episodeValue = isPackFallback ? null : episode;
          await this.autoMagnetService.autoAddMagnet(
            torrent.magnet,
            torrent.canonicalName || torrent.title,
            imdbId,
            request.type,
            torrent.seeders,
            torrent.quality,
            torrent.size,
            season,
            episodeValue,
            torrent.magnetInfoHash,
            torrent.provider,
            torrent.originalTitle,
            torrent.htmlTitle
          );
        } catch (error) {
          this.logger.error('Erro ao salvar magnet', { title: torrent.title.substring(0, 60), error: error instanceof Error ? error.message : 'Erro' });
        }
      }));
    }
  }

  private async processTorrentsWithOptimization(
    torrents: ScrapedTorrent[], request: any, season?: number, episode?: number
  ): Promise<Stream[]> {
    const streams: Stream[] = [];
    const batchSize = 5;
    for (let i = 0; i < torrents.length; i += batchSize) {
      const batch = torrents.slice(i, i + batchSize);
      const batchPromises = batch.map(async torrent => {
        try {
          return await this.streamFormatter.createMultipleQualityStreams(
            torrent, request, null,
            request.type === 'series' ? 'series' : 'movie',
            season, episode, false
          );
        } catch { return []; }
      });
      const results = await Promise.allSettled(batchPromises);
      for (const r of results) {
        if (r.status === 'fulfilled') streams.push(...r.value);
      }
    }
    return streams;
  }

  private generateCacheKey(request: any, season?: number, episode?: number): string {
    return `${request.imdbId || request.id}|${request.type}|${season ?? ''}|${episode ?? ''}`;
  }

  private getFromCache(key: string): Stream[] | null {
    const entry = this.streamCache.get(key);
    if (!entry) {
      metricsService.recordCacheMiss();
      return null;
    }
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
    if (this.streamCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.streamCache.keys().next().value;
      if (firstKey) this.streamCache.delete(firstKey);
    }
    this.streamCache.set(key, { streams, timestamp: Date.now(), isEmpty: streams.length === 0 });
  }

  private async shouldAttemptScraping(request: any): Promise<boolean> {
    const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
    return !this.inFlightScraping.has(key);
  }

  private markScrapingStart(request: any): void {
    const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
    this.inFlightScraping.add(key);
  }

  private markScrapingEnd(request: any): void {
    const key = `${this.extractBaseImdbId(request.imdbId || request.id) || request.id}:${request.type}`;
    this.inFlightScraping.delete(key);
  }

  private async getStreamsFromJson(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const curated = this.magnetService.searchMagnets(request);
    if (!curated.length) return [];

    const streams: Stream[] = [];
    const batchSize = 5;
    for (let i = 0; i < curated.length; i += batchSize) {
      const batch = curated.slice(i, i + batchSize);
      const batchPromises = batch.map(async magnet => {
        const formatted = {
          title: magnet.title,
          magnet: magnet.magnet || '',
          seeders: magnet.seeds || 0,
          size: magnet.size || 'N/A',
          quality: magnet.quality || 'HD',
          language: magnet.language || 'PT-BR'
        };
        try {
          return await this.streamFormatter.createMultipleQualityStreams(
            formatted, request, null,
            request.type === 'series' ? 'series' : 'movie',
            season ?? magnet.season, episode ?? magnet.episode, undefined, 0
          );
        } catch { return []; }
      });
      const results = await Promise.allSettled(batchPromises);
      for (const r of results) {
        if (r.status === 'fulfilled') streams.push(...r.value);
      }
    }
    return streams;
  }

  private removeDuplicatesByInfoHash(streams: Stream[]): Stream[] {
    const seen = new Set<string>();
    const unique: Stream[] = [];

    for (const s of streams) {
      let hash = (s.infoHash || '').toLowerCase();

      // Extrai hash da URL se não existir (aceita base32/hex)
      if (!hash && s.url) {
        const m = s.url.match(/\/resolve\/torbox\/[^/]+\/([a-z0-9]+)/i);
        if (m) hash = m[1].toLowerCase();
      }

      // Fallback final: use title ou name
      if (!hash) hash = (s.title || s.name || 'unknown').toLowerCase();

      // Qualidade
      let quality = (s.behaviorHints as any)?.streamQuality || '';
      if (!quality && s.name) {
        const qm = s.name.match(/\b(\d{3,4}p|4k|uhd|hd|sd)\b/i);
        if (qm) quality = qm[1].toLowerCase();
      }
      if (!quality && s.title) {
        quality = this.qualityDetector.extractBestQuality(s.title) || 'unknown';
      }
      if (!quality) quality = 'unknown';

      const key = `${hash}_${quality}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(s);
    }

    return unique;
  }

  private extractStreamQuality(stream: Stream): string {
    return (stream.behaviorHints as any)?.streamQuality ||
      this.qualityDetector.extractBestQuality(stream.name || stream.title || '') ||
      'unknown';
  }

  private extractSeasonEpisodeFromRequest(request: any) {
    let season = request.season;
    let episode = request.episode;
    if (!season && request.type === 'series' && request.id) {
      const m = request.id.match(/tt\d+:(\d+):(\d+)/);
      if (m) {
        season = parseInt(m[1]);
        episode = parseInt(m[2]);
      }
    }
    return { season, episode };
  }

  private extractBaseImdbId(id: string): string | null {
    const m = id.match(/^(tt\d+)/);
    return m ? m[1] : null;
  }

  private async deduplicateTorrentsByMagnet(torrents: ScrapedTorrent[]): Promise<ScrapedTorrent[]> {
    const seen = new Set<string>();
    const unique: ScrapedTorrent[] = [];

    // Garante que magnetInfoHash esteja preenchido
    const missing = torrents.filter(t => !t.magnetInfoHash);
    if (missing.length > 0) {
      const results = await Promise.all(missing.map(t => analisarMagnet(t.magnet).catch(() => null)));
      missing.forEach((t, i) => {
        if (results[i]?.infoHash) t.magnetInfoHash = results[i]!.infoHash.toLowerCase();
      });
    }

    for (const t of torrents) {
      const hash = t.magnetInfoHash;
      if (hash) {
        const h = hash.toLowerCase();
        if (seen.has(h)) continue;
        seen.add(h);
      } else {
        // Se não tem hash, deduplica por título normalizado
        const titleKey = (t.title || t.canonicalName || '').toLowerCase().trim();
        if (seen.has(titleKey)) continue;
        seen.add(titleKey);
      }
      unique.push(t);
    }

    return unique;
  }

  clearTmdbCache(): void {
    this.tmdbDataCache.clear();
  }

  getStats() {
    return {
      cacheSize: this.streamCache.size,
      inFlightScraping: this.inFlightScraping.size,
      tmdbCacheSize: this.tmdbDataCache.size
    };
  }
}