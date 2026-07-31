import { CuratedMagnetService } from '../catalogo/CuratedMagnetService.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { StreamFormatter } from '../stream/streamFormatter.js';
import { Stream } from '../types/index.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';
import { Logger } from '../utils/logger.js';
import { MetadataExtractor } from '../titulos/MetadataExtractor.js';
import { TorrentScraperService } from '../services/scraper/TorrentScraperService.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { TitleFilter } from '../titulos/titleFilter.js';
import { AutoMagnetService } from '../debrid/AutoMagnetService.js';
import { metricsService } from '../catalogo/MetricsService.js';
import { TorrentioService, TorrentioResult } from '../catalogo/TorrentioService.js';

interface ScrapedTorrent {
  title: string;
  canonicalName?: string; // nome do magnet (dn) via parse-torrent — fonte CANÔNICA
  magnetInfoHash?: string; // infoHash do magnet (cache — evita re-parse)
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
        this.logger.info('📋 Catálogo: 0 streams (scraping bloqueado)', { imdbId: request.imdbId || request.id, season, episode });
        return [];
      }

      this.markScrapingStart(request);
      try {
        this.logger.debug(` Iniciando scraping para ${request.imdbId || request.id}`);
        const scraped = await this.performIntelligentScraping(request, season, episode);
        const scrapedUnique = this.removeDuplicatesByInfoHash(scraped);
        scrapedUnique.forEach(s => metricsService.recordStreamReturned(request.type, this.extractStreamQuality(s)));
        this.logger.info('📋 Catálogo (scraped)', {
          imdbId: request.imdbId || request.id, season, episode,
          total: scrapedUnique.length,
          qualidades: [...new Set(scrapedUnique.map(s => this.extractStreamQuality(s)))],
        });
        this.saveToCache(cacheKey, scrapedUnique);
        return scrapedUnique;
      } finally {
        this.markScrapingEnd(request);
      }
    }

    this.logger.info('📋 Catálogo (cached)', {
      imdbId: request.imdbId || request.id, season, episode,
      total: uniqueStreams.length,
      qualidades: [...new Set(uniqueStreams.map(s => this.extractStreamQuality(s)))],
    });
    this.saveToCache(cacheKey, uniqueStreams);
    return uniqueStreams;
  }

  private async performIntelligentScraping(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const type = request.type;
    const imdbId = this.extractBaseImdbId(request.imdbId || request.id);
    const match = request.id.match(/tt\d+:(\d+):(\d+)/);
    const finalSeason = season ?? (match ? parseInt(match[1]) : undefined);
    const finalEpisode = episode ?? (match ? parseInt(match[2]) : undefined);

    // Cache local: busca TMDB UMA vez e reusa
    const tmdb = imdbId ? await this.getTmdbSearchData(imdbId, finalSeason) : null;
    if (!tmdb || !tmdb.searchTitle) {
      this.logger.warn('Sem título para scraping', { imdbId });
      return [];
    }

    let searchQuery = tmdb.searchTitle;
    const seasonYear = tmdb.seasonYear;

    if (type === 'series' && finalSeason) {
      searchQuery = `${searchQuery} Temporada ${finalSeason}`;
    }

    const torrentResults = await this.torrentScraper.searchTorrents(
      searchQuery, type, finalSeason, seasonYear ?? undefined, imdbId || undefined
    );

    // ═══ FASE 1: Prioridade (Comando, BLUDV, Starck) ═══
    let uniqueTorrents = await this.deduplicateTorrentsByMagnet(torrentResults);
    let { valid, invalid } = await this.filterAndValidateTorrents(
      uniqueTorrents, imdbId, request, finalSeason, finalEpisode,
      tmdb.imdbTitles
    );

    // ═══ FASE 2: Se 0 válidos, chama fallback (HDR, TPB, RARGB) ═══
    if (valid.length === 0) {
      this.logger.info('Prioritarios sem resultados validos — acionando fallback (HDR, TPB, RARGB)');
      const fallbackResults = await this.torrentScraper.searchTorrents(
        searchQuery, type, finalSeason, seasonYear ?? undefined, imdbId || undefined,
        true // skipPriority
      );
      if (fallbackResults.length > 0) {
        const fallbackUnique = await this.deduplicateTorrentsByMagnet(fallbackResults);
        const fallbackValidated = await this.filterAndValidateTorrents(
          fallbackUnique, imdbId, request, finalSeason, finalEpisode,
          tmdb.imdbTitles
        );
        if (fallbackValidated.valid.length > 0) {
          uniqueTorrents = fallbackUnique;
          valid = fallbackValidated.valid;
          invalid = [...invalid, ...fallbackValidated.invalid];
        }
      }
    }

    if (valid.length === 0) {
      this.logger.info('📋 Scraping: todos torrents filtrados — 0 válidos', {
        imdbId, season: finalSeason, episode: finalEpisode,
        totalScraped: uniqueTorrents.length, totalInvalid: invalid.length
      });
      return [];
    }

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
      tmdb.imdbTitles, !hasExactEpisode && hasCompletePack);

    const streams = await this.processTorrentsWithOptimization(valid, request, finalSeason, finalEpisode);
    return this.streamFormatter.sortStreamsByQuality(streams);
  }

  private extractEpisodeNumber(title: string): number | null {
    const match = title.match(/e(\d+)/i);
    return match ? parseInt(match[1]) : null;
  }

  private extrairEpisodioDoTitulo(title: string): string | null {
    const m = title.match(/S(\d+)\s*[Ee](\d+)/i);
    return m ? `S${m[1]}E${m[2]}` : null;
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

    // ═══ PASSO 1: Parse de TODOS os magnets (via parse-torrent) ═══
    // Injeta canonicalName ANTES de qualquer filtro — o magnet é a fonte da verdade
    const dadosMagnets = await Promise.all(
      torrents.map(t => analisarMagnet(t.magnet).catch(() => null))
    );
    torrents.forEach((t, i) => {
      if (dadosMagnets[i]?.nome) t.canonicalName = dadosMagnets[i]!.nome!;
      if (dadosMagnets[i]?.infoHash) t.magnetInfoHash = dadosMagnets[i]!.infoHash;
    });

    // ═══ PASSO 1.5: Filtra episódios de série quando request é movie ═══
    if (request.type === 'movie') {
      const antes = torrents.length;
      torrents = torrents.filter(t => {
        const nome = t.canonicalName || t.title;
        const temEpisodio = /\bs\d{1,2}\s*e\d{1,3}\b/i.test(nome);
        if (temEpisodio) {
          this.logger.debug('Ignorado episodio em filme', { titulo: nome.substring(0, 60) });
          return false;
        }
        return true;
      });
      if (torrents.length < antes) {
        this.logger.info('Filtrado episodios de filme', { removidos: antes - torrents.length, restantes: torrents.length });
      }
    }

    // ═══ PASSO 2: Pre-filtro PT-BR usando canonicalName (magnet) ═══
    // Verifica APENAS indicadores explicitos de idioma (dual, dublado, grupos BR).
    // NAO usa TMDB — nomes de magnet e titulos TMDB nao tem relacao direta.
    // O dn do magnet ja contem o idioma real do torrent.
    const ptTorrents = torrents.filter(t => {
      const nome = t.canonicalName || t.title;
      const resultado = this.titleFilter.verificarIdiomaDetalhado(nome);
      const ehPt = resultado.ehPortugues;

      if (/liga da justi[cç]|ponto de igni[cç]|brasil|dublado(?!.*dual)/.test(nome.toLowerCase())) {
        this.logger.debug('Detalhe PT-BR', {
          nome: nome.substring(0, 70),
          ehPt,
          motivo: resultado.motivo,
          palavrasPt: resultado.palavrasPt?.join(','),
          palavrasEn: resultado.palavrasEn?.join(','),
        });
      }
      return ehPt;
    });
    const falsoPositivo = torrents.filter(t =>
      !ptTorrents.includes(t) && t.canonicalName
    );
    if (falsoPositivo.length > 0) {
      this.logger.info('🧹 Magnet revelou falso-positivo PT-BR', {
        imdbId,
        count: falsoPositivo.length,
        nomes: falsoPositivo.map(t => t.canonicalName?.substring(0, 60)),
      });
    }

    // ═══ PASSO 3: Validação de título (similaridade com TMDB) ═══
    // Usa canonicalName do magnet quando disponível, scraper title como fallback
    const results = await Promise.allSettled(
      ptTorrents.map((t) => {
        const tituloParaValidar = t.canonicalName || t.title;
        return this.titleFilter.titulosCombinam(tituloParaValidar, imdbId, season, episode);
      })
    );

    const valid: ScrapedTorrent[] = [];
    const invalid: ScrapedTorrent[] = torrents.filter(t => !ptTorrents.includes(t));

    results.forEach((result, i) => {
      const torrent = ptTorrents[i];
      if (result.status === 'fulfilled' && result.value.matches) {
        const epExtraido = this.extrairEpisodioDoTitulo(torrent.title);
        this.logger.info('🎯 EPISÓDIO ACEITO', {
          imdbId,
          alvo: `S${season || '?'}E${episode || '?'}`,
          torrent: (torrent.canonicalName || torrent.title).substring(0, 70),
          canonical: !!torrent.canonicalName,
          episodioTorrent: epExtraido || 'N/A',
          provider: torrent.provider,
          infoHash: dadosMagnets[torrents.indexOf(torrent)]?.infoHash?.substring(0, 12) || 'N/A'
        });
        valid.push(torrent);
      } else {
        invalid.push(torrent);
      }
    });

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

    // Batch de 5 para evitar SQLITE_BUSY com muitas escritas simultâneas
    const batchSize = 5;
    for (let i = 0; i < torrents.length; i += batchSize) {
      const batch = torrents.slice(i, i + batchSize);
      await Promise.allSettled(batch.map(async torrent => {
        try {
          const episodeValue = isPackFallback ? null : episode;
          await this.autoMagnetService.autoAddMagnet(
            torrent.magnet, torrent.canonicalName || torrent.title, imdbId, request.type,
            torrent.seeders, torrent.quality, torrent.size, season, episodeValue,
            torrent.magnetInfoHash, torrent.provider
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
        } catch {
          return [];
        }
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

  private async getStreamsFromJson(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const curated = this.magnetService.searchMagnets(request);
    if (!curated.length) return [];
    const streams: Stream[] = [];
    const batchSize = 5;
    for (let i = 0; i < curated.length; i += batchSize) {
      const batch = curated.slice(i, i + batchSize);
      const batchPromises = batch.map(async magnet => {
        const formatted = {
          title: magnet.title, magnet: magnet.magnet || '',
          seeders: magnet.seeds || 0, size: magnet.size || 'N/A',
          quality: magnet.quality || 'HD', language: magnet.language || 'PT-BR'
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
      // Extrai infoHash do stream ou da URL lazy (/resolve/torbox/.../INFOHASH/...)
      let hash = s.infoHash;
      if (!hash && s.url) {
        const m = s.url.match(/\/resolve\/torbox\/[^/]+\/([a-f0-9]{40})\//i);
        if (m) hash = m[1];
      }
      if (!hash) hash = s.title || Math.random().toString();
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

  private async deduplicateTorrentsByMagnet(torrents: ScrapedTorrent[]): Promise<ScrapedTorrent[]> {
    const seen = new Set<string>();
    const seenTitles = new Set<string>();
    const unique: ScrapedTorrent[] = [];
    const packRe = /\b(?:temporada completa|season pack|complete pack)\b/i;

    // Passo 1: resolve infoHashes faltantes em paralelo
    const missing = torrents.filter(t => !t.magnetInfoHash);
    if (missing.length > 0) {
      const results = await Promise.all(missing.map(t => analisarMagnet(t.magnet).catch(() => null)));
      missing.forEach((t, i) => {
        if (results[i]?.infoHash) t.magnetInfoHash = results[i]!.infoHash;
      });
    }

    // Passo 2: dedup síncrono (sem awaits)
    for (const t of torrents) {
      const hash = t.magnetInfoHash;
      if (hash && seen.has(hash.toLowerCase())) continue;
      if (hash) seen.add(hash.toLowerCase());
      // Para packs, dedup também por título normalizado (ignora SxxExx)
      if (packRe.test(t.title)) {
        const tituloNormalizado = t.title.replace(/\s*\(?\s*S\d{1,2}\s*[Ee]\d{1,2}\s*\)?\s*$/g, '').trim().toLowerCase();
        if (seenTitles.has(tituloNormalizado)) continue;
        seenTitles.add(tituloNormalizado);
      }
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