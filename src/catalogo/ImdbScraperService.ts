import { Logger } from '../utils/logger.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { getTmdbTitlesViaHtml } from './TmdbHtmlScraper.js';
import { ImdbTitleCache } from '../database/models.js';

const logger = new Logger('TMDBScraper');

// DNS bypass igual aos outros scrapers.
dns.setServers(['8.8.8.8', '1.1.1.1']);
class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      const sock = tls.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined;
  }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupImdb = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

export interface ImdbTitles {
  originalTitle: string;
  portugueseTitle: string | null;
  portugueseTitleRaw: string | null;
  allTitles: string[];
  foundInPortuguese: boolean;
  year?: number;
  mediaType?: 'movie' | 'tv';
  portuguesePriority: boolean;
  episodeTitles?: Array<{ episodeNumber: number; namePt?: string; nameEn?: string }> | null;
}

interface GlobalCacheEntry {
  data: ImdbTitles;
  timestamp: number;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
}

export class ImdbScraperService {
  private readonly tmdbBaseUrl = 'https://api.themoviedb.org/3';
  private readonly tmdbApiKey: string;
  private readonly language = 'pt-BR';

  private static globalCache = new Map<string, GlobalCacheEntry>();

  private readonly cacheTTL = 5 * 60 * 1000;
  private static readonly MAX_CACHE_SIZE = 1000;
  private static cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;

  // TTL do cache em banco — mesma janela usada pelo resolveRoutes.
  private static readonly DB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  private static instance: ImdbScraperService;

  public static getInstance(): ImdbScraperService {
    if (!ImdbScraperService.instance) {
      ImdbScraperService.instance = new ImdbScraperService();
    }
    return ImdbScraperService.instance;
  }

  constructor() {
    this.tmdbApiKey = process.env.TMDB_API_KEY || '';
    logger.debug('🔑 TMDB_API_KEY carregada?', { exists: !!this.tmdbApiKey, length: this.tmdbApiKey.length, cwd: process.cwd() });

    if (!this.tmdbApiKey) {
      logger.warn('TMDB_API_KEY não configurada! Metadados em português não estarão disponíveis. Obtenha uma key gratuita em: https://www.themoviedb.org/settings/api');
    }

    ImdbScraperService.startCleanupTimer();
    logger.debug('TMDB Scraper ready');
  }

  // Limpa entradas expiradas do cache em memória a cada 5min.
  private static startCleanupTimer(): void {
    if (ImdbScraperService.cleanupTimer) return;

    ImdbScraperService.cleanupTimer = setInterval(() => {
      const now = Date.now();

      for (const [key, entry] of ImdbScraperService.globalCache.entries()) {
        if (now - entry.timestamp > ImdbScraperService.prototype.cacheTTL) {
          ImdbScraperService.globalCache.delete(key);
        }
      }

      if (ImdbScraperService.globalCache.size === 0) return;

      logger.debug(`🧹 TMDB cache cleanup: ${ImdbScraperService.globalCache.size} entradas restantes`);
    }, ImdbScraperService.CACHE_CLEANUP_INTERVAL);

    if (ImdbScraperService.cleanupTimer.unref) {
      ImdbScraperService.cleanupTimer.unref();
    }
  }

  // Devolve do cache em memória se ainda estiver dentro do TTL.
  private static getFromCache(key: string): GlobalCacheEntry | undefined {
    const cached = ImdbScraperService.globalCache.get(key);
    if (!cached) return undefined;

    const ttl = ImdbScraperService.prototype.cacheTTL;
    if (Date.now() - cached.timestamp > ttl) {
      ImdbScraperService.globalCache.delete(key);
      return undefined;
    }

    return cached;
  }

  // Grava no cache em memória com eviction simples (FIFO) quando passa do limite.
  private static setCache(key: string, entry: GlobalCacheEntry): void {
    if (ImdbScraperService.globalCache.size >= ImdbScraperService.MAX_CACHE_SIZE) {
      const firstKey = ImdbScraperService.globalCache.keys().next().value;
      if (firstKey) ImdbScraperService.globalCache.delete(firstKey);
    }

    ImdbScraperService.globalCache.set(key, entry);
  }

  // Lê do banco se a entrada é recente, tem episodeTitles quando precisa, não tem mojibake
  // e não é uma entrada legacy (gravada antes do fix que separa titlesPt/titlesEn).
  private async getFromDbCache(imdbId: string, season: number): Promise<ImdbTitles | null> {
    try {
      const row: any = await ImdbTitleCache.findOne({
        where: { imdbId, season },
        attributes: ['titlesPt', 'titlesEn', 'year', 'episodeTitles', 'updatedAt'],
        raw: true,
      });

      if (!row) return null;

      const ageMs = Date.now() - new Date(row.updatedAt).getTime();
      if (ageMs > ImdbScraperService.DB_CACHE_TTL_MS) return null;

      // Série precisa ter episodeTitles salvos; senão deixa a API buscar de novo.
      if (season > 0 && !row.episodeTitles) return null;

      // Entrada com mojibake é ignorada — próxima request regrava limpo.
      if (this.temMojibake(row.episodeTitles) || this.temMojibake(row.titlesPt) || this.temMojibake(row.titlesEn)) {
        logger.debug('DB_CACHE_MOJIBAKE_SKIP', { imdbId, season });
        return null;
      }

      // Entrada legacy: titlesPt === titlesEn (bug histórico do saveToDbCache que
      // gravava o mesmo array nas duas colunas). Força re-fetch pra regravar com o fix.
      if (this.ehEntradaLegacy(row.titlesPt, row.titlesEn)) {
        logger.debug('DB_CACHE_LEGACY_SKIP', { imdbId, season });
        return null;
      }

      return this.reconstruirImdbTitles(row);
    } catch (err) {
      logger.debug('DB_CACHE_READ_FAIL', { imdbId, season, error: err instanceof Error ? err.message : 'Erro' });
      return null;
    }
  }

  // Detecta entrada gravada antes do fix: as duas colunas idênticas (mesmo array, mesma ordem).
  private ehEntradaLegacy(titlesPt: any, titlesEn: any): boolean {
    if (!Array.isArray(titlesPt) || !Array.isArray(titlesEn)) return false;
    if (titlesPt.length === 0 && titlesEn.length === 0) return false;
    if (titlesPt.length !== titlesEn.length) return false;
    return titlesPt.every((t: string, i: number) => t === titlesEn[i]);
  }

  // Reconstrói o ImdbTitles a partir dos campos salvos.
  // titlesEn[0] é o título original; titlesPt[0] é o PT-BR (quando existe).
  private reconstruirImdbTitles(row: any): ImdbTitles {
    const pt: string[] = Array.isArray(row.titlesPt) ? row.titlesPt : [];
    const en: string[] = Array.isArray(row.titlesEn) ? row.titlesEn : [];

    const portugueseTitle = pt[0] || null;
    const originalTitle = en[0] || portugueseTitle || '';

    const allTitles: string[] = [];
    if (portugueseTitle) allTitles.push(portugueseTitle);
    if (originalTitle && originalTitle !== portugueseTitle) allTitles.push(originalTitle);
    for (const t of pt) if (t && !allTitles.includes(t)) allTitles.push(t);
    for (const t of en) if (t && !allTitles.includes(t)) allTitles.push(t);

    const hasPortuguese = !!portugueseTitle && portugueseTitle !== originalTitle;

    return {
      originalTitle,
      portugueseTitle: hasPortuguese ? portugueseTitle : null,
      portugueseTitleRaw: hasPortuguese ? portugueseTitle : null,
      allTitles,
      foundInPortuguese: hasPortuguese,
      year: row.year ?? undefined,
      mediaType: undefined,
      portuguesePriority: hasPortuguese,
      episodeTitles: row.episodeTitles || null,
    };
  }

  // Detecta mojibake — UTF-8 lido como Latin-1 gera "Ã" seguido de caractere não-espaço.
  private temMojibake(value: any): boolean {
    if (!value) return false;
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return /Ã[^\s]/.test(str);
  }

  // Reverte mojibake — dado ruim esporádico da TMDB. Roda recursivo em strings/arrays/objetos.
  private corrigirMojibake(value: any): any {
    if (!value) return value;
    if (Array.isArray(value)) return value.map(v => this.corrigirMojibake(v));
    if (typeof value === 'object') {
      const out: any = {};
      for (const k of Object.keys(value)) out[k] = this.corrigirMojibake(value[k]);
      return out;
    }
    if (typeof value === 'string' && /Ã[^\s]/.test(value)) {
      try {
        return Buffer.from(value, 'latin1').toString('utf8');
      } catch {
        return value;
      }
    }
    return value;
  }

  // Grava no banco. Separa títulos PT e EN em colunas distintas pra reconstrução correta.
  // Corrige mojibake antes de gravar. Falha vira debug.
  private async saveToDbCache(imdbId: string, season: number, data: ImdbTitles): Promise<void> {
    try {
      const origClean = this.corrigirMojibake(data.originalTitle || '');
      const ptClean = data.portugueseTitle ? this.corrigirMojibake(data.portugueseTitle) : null;
      const allClean = (data.allTitles || []).map(t => this.corrigirMojibake(t));

      // titlesPt: apenas o título em português (quando existe).
      const titlesPt: string[] = ptClean ? [ptClean] : [];

      // titlesEn: original primeiro (posição 0 é o que reconstruirImdbTitles lê),
      // seguido dos demais títulos que não sejam o PT nem duplicatas do original.
      const titlesEnRaw = [origClean, ...allClean];
      const titlesEn: string[] = [];
      for (const t of titlesEnRaw) {
        if (!t) continue;
        if (t === ptClean) continue;
        if (titlesEn.includes(t)) continue;
        titlesEn.push(t);
      }

      const episodeTitlesLimpos = this.corrigirMojibake(data.episodeTitles ?? null);

      await ImdbTitleCache.upsert({
        imdbId,
        season,
        titlesPt,
        titlesEn,
        year: data.year ?? null,
        episodeTitles: episodeTitlesLimpos,
        updatedAt: new Date(),
      } as any);
    } catch (err) {
      logger.debug('DB_CACHE_WRITE_FAIL', { imdbId, season, error: err instanceof Error ? err.message : 'Erro' });
    }
  }

  // Ponto de entrada — memória → banco → API, nessa ordem.
  async getTitlesFromImdbId(imdbId: string, season?: number): Promise<ImdbTitles> {
    try {
      const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
      const cached = ImdbScraperService.getFromCache(cacheKey);
      if (cached) {
        logger.debug('TMDB cache hit (mem)', { imdbId, season });
        return cached.data;
      }

      // Checa o banco antes de martelar a API — compartilhado entre stream, resolve e rescrape.
      const seasonKey = season ?? 0;
      const fromDb = await this.getFromDbCache(imdbId, seasonKey);
      if (fromDb) {
        logger.debug('TMDB cache hit (db)', { imdbId, season: seasonKey });
        ImdbScraperService.setCache(cacheKey, { data: fromDb, timestamp: Date.now() });
        return fromDb;
      }

      const tmdbInfo = await this.findInTMDB(imdbId);

      if (!tmdbInfo) {
        // Fallback 1: TMDB HTML scraper (OMDB → TMDB search → scrape).
        logger.debug('TMDB API offline, usando fallback HTML', { imdbId });
        const htmlResult = await getTmdbTitlesViaHtml(imdbId);
        if (htmlResult) {
          ImdbScraperService.setCache(cacheKey, { data: htmlResult, timestamp: Date.now() });
          await this.saveToDbCache(imdbId, seasonKey, htmlResult);
          return htmlResult;
        }

        // Fallback 2: IMDb HTML (só título original).
        logger.debug('TMDB HTML fallback falhou, tentando IMDb HTML', { imdbId });
        const imdbResult = await this.scrapeImdbTitle(imdbId);
        ImdbScraperService.setCache(cacheKey, { data: imdbResult, timestamp: Date.now() });
        await this.saveToDbCache(imdbId, seasonKey, imdbResult);
        return imdbResult;
      }

      const { tmdbId: tmdbIdNum, mediaType } = tmdbInfo;

      const resolved = await this.resolveTitleFromTMDB(tmdbIdNum, mediaType, imdbId, season);

      // Título original fora do alfabeto latino cai pro inglês (animes, etc).
      let finalOriginal = resolved.originalTitle;
      if (finalOriginal && !/^[a-z0-9\s\-\.':,!]+$/i.test(finalOriginal)) {
        finalOriginal = await this.getEnglishTitle(tmdbIdNum, mediaType) || finalOriginal;
      }

      const normalizedOriginal = this.normalizeTitle(finalOriginal);
      const normalizedPortuguese = resolved.portugueseTitle ? this.normalizeTitle(resolved.portugueseTitle) : '';

      const hasPortuguese = !!normalizedPortuguese && normalizedPortuguese !== normalizedOriginal;
      const portuguesePriority = hasPortuguese;

      const allTitles: string[] = [];

      if (hasPortuguese) {
        allTitles.push(normalizedPortuguese);
        allTitles.push(normalizedOriginal);
      } else {
        allTitles.push(normalizedOriginal);
      }

      // OMDB complementa com título em inglês quando faz sentido.
      const englishTitle = await this.getEnglishTitleFromOmdb(imdbId);
      if (englishTitle) {
        const normalizedEn = this.normalizeTitle(englishTitle);
        if (normalizedEn && normalizedEn !== normalizedOriginal && normalizedEn !== normalizedPortuguese) {
          allTitles.push(normalizedEn);
        }
      }

      const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));

      const result: ImdbTitles = {
        originalTitle: normalizedOriginal,
        portugueseTitle: hasPortuguese ? normalizedPortuguese : null,
        portugueseTitleRaw: hasPortuguese ? resolved.portugueseTitle : null,
        allTitles: uniqueTitles,
        foundInPortuguese: hasPortuguese,
        year: resolved.year,
        mediaType,
        portuguesePriority,
        episodeTitles: mediaType === 'tv' && season !== undefined && season > 0
          ? await this.fetchEpisodeTitles(tmdbIdNum, season).catch(() => [])
          : [],
      };

      ImdbScraperService.setCache(cacheKey, {
        data: result,
        timestamp: Date.now(),
        tmdbId: tmdbIdNum,
        mediaType,
      });

      // Grava no banco pra próximas requests (outro processo, restart, etc).
      await this.saveToDbCache(imdbId, seasonKey, result);

      logger.debug('Títulos TMDB obtidos', {
        imdbId,
        tmdbId: tmdbIdNum,
        year: resolved.year,
        mediaType,
        season,
        portugues: hasPortuguese ? 'SIM' : 'NÃO',
        tituloOriginal: normalizedOriginal.substring(0, 50),
      });

      return result;
    } catch (error) {
      logger.error('TMDB erro geral', {
        imdbId,
        season,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });

      const empty = this.createEmptyResult(imdbId);
      const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
      ImdbScraperService.setCache(cacheKey, { data: empty, timestamp: Date.now() });
      return empty;
    }
  }

  // Resolve títulos a partir do tmdbId + mediaType — chamado só depois do find.
  private async resolveTitleFromTMDB(
    tmdbId: number,
    mediaType: 'movie' | 'tv',
    imdbId: string,
    season?: number
  ): Promise<{ originalTitle: string; portugueseTitle: string | null; year?: number }> {
    if (mediaType === 'movie') {
      const details = await this.fetchDetailsFromTMDB(tmdbId, 'movie');
      if (details) {
        return {
          originalTitle: details.original_title || details.title || '',
          portugueseTitle: details.title || null,
          year: details.release_date ? parseInt(details.release_date.substring(0, 4)) : undefined,
        };
      }
    }

    if (mediaType === 'tv') {
      // Tenta dados da temporada, se aplicável.
      let year: number | undefined;
      if (season !== undefined && season > 0) {
        try {
          const seasonData = await this.fetchSeasonFromTMDB(tmdbId, season);
          if (seasonData?.air_date) {
            year = parseInt(seasonData.air_date.substring(0, 4));
          }
        } catch (seasonError) {
          logger.warn('TMDB erro temporada, usando dados da série', { imdbId, season, error: seasonError instanceof Error ? seasonError.message : 'Erro' });
        }
      }

      const seriesDetails = await this.fetchDetailsFromTMDB(tmdbId, 'tv');
      if (seriesDetails) {
        return {
          originalTitle: seriesDetails.original_name || seriesDetails.name || '',
          portugueseTitle: seriesDetails.name || null,
          year: year ?? (seriesDetails.first_air_date ? parseInt(seriesDetails.first_air_date.substring(0, 4)) : undefined),
        };
      }
    }

    return { originalTitle: '', portugueseTitle: null };
  }

  // Busca o título em inglês no TMDB pra títulos não-latinos.
  private async getEnglishTitle(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<string | null> {
    const enDetails = await this.fetchDetailsFromTMDB(tmdbId, mediaType, 'en-US');
    if (!enDetails) return null;

    return mediaType === 'tv' ? enDetails.name : enDetails.title;
  }

  // Busca título em inglês no OMDB como complemento.
  private async getEnglishTitleFromOmdb(imdbId: string): Promise<string> {
    try {
      const omdbUrl = `http://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY || 'trilogy'}`;
      const omdbResp = await axios.get(omdbUrl, { timeout: 5000 });
      if (omdbResp.data?.Response === 'True' && omdbResp.data?.Title) {
        return omdbResp.data.Title;
      }
    } catch {
      // OMDB offline, sem problema.
    }
    return '';
  }

  // Localiza o tmdbId a partir do imdbId. null significa fallback HTML.
  private async findInTMDB(imdbId: string): Promise<{ tmdbId: number; mediaType: 'movie' | 'tv' } | null> {
    try {
      const response = await axios.get(`${this.tmdbBaseUrl}/find/${imdbId}`, {
        params: {
          api_key: this.tmdbApiKey,
          external_source: 'imdb_id',
          language: this.language,
        },
        timeout: 10000,
      });

      if (response.data.movie_results && response.data.movie_results.length > 0) {
        return { tmdbId: response.data.movie_results[0].id, mediaType: 'movie' };
      }

      if (response.data.tv_results && response.data.tv_results.length > 0) {
        return { tmdbId: response.data.tv_results[0].id, mediaType: 'tv' };
      }

      return null;
    } catch (error) {
      logger.debug('TMDB find falhou, fallback HTML será usado', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
      return null;
    }
  }

  // Detalhes do filme ou série no idioma pedido.
  private async fetchDetailsFromTMDB(tmdbId: number, mediaType: 'movie' | 'tv', langOverride?: string): Promise<any> {
    try {
      const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
      const response = await axios.get(`${this.tmdbBaseUrl}/${endpoint}/${tmdbId}`, {
        params: { api_key: this.tmdbApiKey, language: langOverride || this.language },
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      logger.debug('TMDB detalhes falhou', { tmdbId, mediaType, error: error instanceof Error ? error.message : 'Erro' });
      return null;
    }
  }

  // Dados da temporada — inclui episodes.
  private async fetchSeasonFromTMDB(tmdbId: number, season: number, langOverride?: string): Promise<any> {
    try {
      const response = await axios.get(`${this.tmdbBaseUrl}/tv/${tmdbId}/season/${season}`, {
        params: { api_key: this.tmdbApiKey, language: langOverride || this.language },
        timeout: 10000,
      });
      return response.data;
    } catch (error) {
      logger.debug('TMDB temporada falhou', { tmdbId, season, error: error instanceof Error ? error.message : 'Erro' });
      throw error;
    }
  }

  // Busca nomes de episódios em pt-BR e en-US em paralelo e junta por episode_number.
  private async fetchEpisodeTitles(tmdbId: number, season: number): Promise<Array<{ episodeNumber: number; namePt?: string; nameEn?: string }>> {
    const result: Array<{ episodeNumber: number; namePt?: string; nameEn?: string }> = [];
    try {
      const [ptData, enData] = await Promise.all([
        this.fetchSeasonFromTMDB(tmdbId, season, 'pt-BR').catch(() => null),
        this.fetchSeasonFromTMDB(tmdbId, season, 'en-US').catch(() => null),
      ]);

      const episodes = ptData?.episodes || enData?.episodes || [];
      for (const ep of episodes) {
        const episodeNumber = ep.episode_number;
        if (!episodeNumber) continue;
        const namePt = ptData?.episodes?.find((e: any) => e.episode_number === episodeNumber)?.name;
        const nameEn = enData?.episodes?.find((e: any) => e.episode_number === episodeNumber)?.name;
        if (namePt || nameEn) {
          result.push({ episodeNumber, namePt, nameEn });
        }
      }
    } catch (error) {
      logger.warn('TMDB episódios falhou', { tmdbId, season, error: error instanceof Error ? error.message : 'Erro' });
    }
    return result;
  }

  // Fallback: scrape IMDb HTML quando TMDB não conhece o ID.
  private async scrapeImdbTitle(imdbId: string): Promise<ImdbTitles> {
    try {
      const url = `https://www.imdb.com/title/${imdbId}/`;
      const res = await axios.get(url, {
        timeout: 10000,
        httpsAgent: dnsAgent,
        lookup: lookupImdb,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        },
      });

      const $ = cheerio.load(res.data);
      const rawTitle = $('title').text().replace(/\s*-\s*IMDb\s*$/i, '').trim();
      const yearMatch = rawTitle.match(/\((\d{4})\)/);
      const year = yearMatch ? parseInt(yearMatch[1]) : undefined;
      const cleanTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, '').trim();
      const normalized = this.normalizeTitle(cleanTitle);

      if (!normalized || normalized.length < 2) {
        return this.createEmptyResult(imdbId);
      }

      logger.debug('IMDb HTML fallback OK', { imdbId, title: cleanTitle.substring(0, 50), year });

      return {
        originalTitle: normalized,
        portugueseTitle: null,
        portugueseTitleRaw: null,
        allTitles: [normalized],
        foundInPortuguese: false,
        portuguesePriority: false,
        year,
        mediaType: undefined,
      };
    } catch (err: any) {
      logger.warn('IMDb HTML fallback falhou', { imdbId, error: err.message });
      return this.createEmptyResult(imdbId);
    }
  }

  // Resultado vazio — usado quando tudo falha.
  private createEmptyResult(imdbId: string): ImdbTitles {
    logger.debug('Resultado vazio gerado', { imdbId });
    return {
      originalTitle: `Unknown Title (${imdbId})`,
      portugueseTitle: null,
      portugueseTitleRaw: null,
      allTitles: [],
      foundInPortuguese: false,
      portuguesePriority: false,
    };
  }

  // Normaliza pra comparação — lowercase, sem acento, sem pontuação.
  private normalizeTitle(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Compatibilidade — só devolve o título principal.
  async getTitleFromImdbId(imdbId: string): Promise<string | null> {
    try {
      const titles = await this.getTitlesFromImdbId(imdbId);
      return titles.portugueseTitle || titles.originalTitle || null;
    } catch (error) {
      logger.error('TMDB erro compatibilidade', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
      return null;
    }
  }

  // Limpa o cache global em memória.
  static clearGlobalCache(): void {
    ImdbScraperService.globalCache.clear();
    logger.info('TMDB cache limpo');
  }

  // Estatísticas do cache em memória.
  static getGlobalCacheStats() {
    return {
      size: ImdbScraperService.globalCache.size,
      entries: Array.from(ImdbScraperService.globalCache.keys()),
    };
  }

  clearInstanceCache(): void {
    ImdbScraperService.clearGlobalCache();
  }

  getStats() {
    return {
      cacheSize: ImdbScraperService.globalCache.size,
      cacheTTL: this.cacheTTL,
      version: '2.5.0',
      feature: 'Fallback HTML + cache memória + cache banco (R12) + correção mojibake (R16b) + separação PT/EN no DB (R17)',
    };
  }
}