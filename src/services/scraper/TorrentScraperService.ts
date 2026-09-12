import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { ImdbScraperService } from '../../catalogo/ImdbScraperService.js';
import { WordPressScraper } from './wordpressScraper.js';
import { BludvScraper } from './bludvScraper.js';
import { searchStarck } from './starckScraper.js';
import { searchHdr } from './hdrScraper.js';
import { extrairRangeEpisodios } from '../../titulos/TechnicalWords.js';

const logger = new Logger('TorrentScraperService');

interface CommonTorrentParams {
  title: string;
  htmlTitle?: string;
  magnet: string;
  seeders: number;
  leechers?: number;
  size: string;
  quality: string;
  provider: string;
  language: string;
  type: 'movie' | 'series';
  season?: number;
  episode?: number;
  originalTitle?: string;
  year?: number;
  canonicalName?: string;
  infoHash?: string;
  imdbConfirmed?: boolean;
  confidence?: number;
  relevanceScore?: number;
  sizeInBytes?: number;
}

interface ScraperRun {
  nome: string;
  results: TorrentResult[];
  duration: number;
}

// Lê o scrapers-state.json pra saber quais scrapers estão ligados.
function isScraperAtivo(nome: string): boolean {
  const arquivo = path.join(process.cwd(), 'scrapers-state.json');
  if (!existsSync(arquivo)) return true;
  try {
    const estado = JSON.parse(readFileSync(arquivo, 'utf8'));
    return estado[nome.toLowerCase()] !== false;
  } catch {
    return true;
  }
}

// Remove duplicatas mantendo o primeiro que aparece.
function dedupBy<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const vistos = new Set<string>();
  return arr.filter(item => {
    const key = keyFn(item);
    if (vistos.has(key)) return false;
    vistos.add(key);
    return true;
  });
}

// Aplica mapper que pode devolver null e descarta os nulos.
function mapAndFilter<T, R>(arr: T[], fn: (item: T) => R | null): R[] {
  const out: R[] = [];
  for (const item of arr) {
    const mapped = fn(item);
    if (mapped !== null) out.push(mapped);
  }
  return out;
}

export class TorrentScraperService {
  private readonly qualityDetector: QualityDetector;
  private readonly tmdbScraper: ImdbScraperService;
  private readonly wpScraper: WordPressScraper;
  private readonly bludvScraper: BludvScraper;

  constructor(tmdbScraper?: ImdbScraperService) {
    this.qualityDetector = QualityDetector.getInstance();
    this.tmdbScraper = tmdbScraper || ImdbScraperService.getInstance();
    this.wpScraper = new WordPressScraper();
    this.bludvScraper = new BludvScraper();
  }

  async searchTorrents(
    query: string,
    type: 'movie' | 'series' = 'movie',
    targetSeason?: number,
    targetYear?: number,
    imdbId?: string
  ): Promise<TorrentResult[]> {
    const startTime = Date.now();

    try {
      const tmdbData = imdbId ? await this.getTmdbData(imdbId, targetSeason) : null;
      const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);

      logger.debug(`🔍 Buscando torrents para: "${query}" | alvo S${targetSeason ?? '?'}E? | imdbId: ${imdbId ?? 'N/A'}`);
      logger.debug(`🔍 Queries geradas: ${searchQueries.length}`, {
        queries: searchQueries.slice(0, 10),
        total: searchQueries.length,
      });

      // Os 4 scrapers rodam em paralelo. runScraper cuida de enabled + catch + timing.
      const runs = await Promise.all([
        this.runScraper('BLUDV', isScraperAtivo('bludv'), async () => {
          const raw = await this.bludvScraper.search(query, type, targetSeason, searchQueries, imdbId);
          return dedupBy(raw, r => r.magnet);
        }),
        this.runScraper('WP', isScraperAtivo('wordpress'), async () => {
          const raw = await this.wpScraper.search(query, type, targetSeason, searchQueries, imdbId);
          return dedupBy(raw, r => r.magnet);
        }),
        this.runScraper('Starck', isScraperAtivo('starck'), async () => {
          const raw = await searchStarck(query, type, targetSeason, searchQueries);
          const deduped = dedupBy(raw, r => r.infoHash);
          return mapAndFilter(deduped, r => this.mapStarckResult(r, type));
        }),
        this.runScraper('HDR', isScraperAtivo('hdr'), async () => {
          const raw = await searchHdr(query, type, targetSeason, searchQueries, targetYear, imdbId);
          const deduped = dedupBy(raw, r => r.infoHash);
          return mapAndFilter(deduped, r => this.mapHdrResult(r, type));
        }),
      ]);

      const allResults = runs.flatMap(r => r.results);
      const duration = Date.now() - startTime;

      // Uma linha com tudo: total + contagem e tempo por scraper.
      const detalhes = runs.map(r => `${r.nome}=${r.results.length}(${r.duration}ms)`).join(', ');
      logger.debug(`📊 ${allResults.length} torrents em ${duration}ms | ${detalhes}`);

      if (duration > 5000) {
        logger.warn('Coleta de torrents lenta', {
          tempo: `${duration}ms`,
          resultados: allResults.length,
          queries: searchQueries.length,
        });
      }

      return allResults;
    } catch (error) {
      logger.error('Erro na coleta de torrents', {
        erro: error instanceof Error ? error.message : 'Erro desconhecido',
        tempo: `${Date.now() - startTime}ms`,
      });
      return [];
    }
  }

  // Roda um scraper: respeita o toggle, mede tempo, engole erro. Devolve TorrentResult[].
  private async runScraper(
    nome: string,
    ativo: boolean,
    fn: () => Promise<TorrentResult[]>
  ): Promise<ScraperRun> {
    if (!ativo) return { nome, results: [], duration: 0 };

    const start = Date.now();
    try {
      const results = await fn();
      return { nome, results, duration: Date.now() - start };
    } catch (err) {
      logger.debug(`[${nome}] falhou: ${err instanceof Error ? err.message : 'erro'}`);
      return { nome, results: [], duration: Date.now() - start };
    }
  }

  private async getTmdbData(imdbId: string, season?: number): Promise<any> {
    try {
      return await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
    } catch (err) {
      logger.debug(`TMDB falhou para ${imdbId}: ${err instanceof Error ? err.message : 'erro'}`);
      return null;
    }
  }

  private generateSearchQueries(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    targetYear?: number,
    tmdbData?: any
  ): string[] {
    if (type === 'series' && targetSeason !== undefined && tmdbData?.allTitles?.length > 0) {
      return this.generateSeriesQueries(query, targetSeason, tmdbData);
    }
    if (tmdbData?.originalTitle) {
      return this.generateMovieQueries(query, targetYear, tmdbData);
    }
    return this.generateFallbackQueries(query, targetYear);
  }

  private generateSeriesQueries(query: string, season: number, tmdbData: any): string[] {
    // Coleta todos os títulos disponíveis e pega os 2 primeiros únicos.
    const titulos = this.coletarTitulosUnicos(
      ...(tmdbData.allTitles || []),
      tmdbData.portugueseTitle,
      tmdbData.portugueseTitleRaw,
    );
    const selecionados = titulos.length > 0 ? titulos.slice(0, 2) : [query];
    const queries = selecionados.map(t => `${t} ${season}ª temporada`);
    return [...new Set(queries.filter(q => q && q.trim().length > 3))];
  }

  private generateMovieQueries(query: string, targetYear: number | undefined, tmdbData: any): string[] {
    const yearToUse = targetYear || tmdbData.year;
    const titulos = this.coletarTitulosUnicos(
      tmdbData.originalTitle,
      tmdbData.portugueseTitle,
      ...(tmdbData.allTitles || []),
    );
    const selecionados = titulos.slice(0, 2);

    const queries = [...selecionados];
    if (yearToUse) {
      for (const t of selecionados) queries.push(`${t} ${yearToUse}`);
    }
    return [...new Set(queries.filter(q => q && q.trim().length > 3))];
  }

  private generateFallbackQueries(query: string, targetYear?: number): string[] {
    const queries = [query];
    if (targetYear) queries.push(`${query} ${targetYear}`);
    return [...new Set(queries.filter(q => q && q.trim().length > 3))];
  }

  // Junta títulos, remove vazios/curtos/duplicados, preservando a ordem de entrada.
  private coletarTitulosUnicos(...titulos: (string | null | undefined)[]): string[] {
    const vistos = new Set<string>();
    const unicos: string[] = [];
    for (const t of titulos) {
      if (!t) continue;
      const limpo = t.trim();
      if (limpo.length <= 3) continue;
      const chave = limpo.toLowerCase();
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      unicos.push(limpo);
    }
    return unicos;
  }

  private buildTorrentResult(params: CommonTorrentParams): TorrentResult {
    return {
      title: params.title,
      htmlTitle: params.htmlTitle,
      magnet: params.magnet,
      seeders: params.seeders,
      leechers: params.leechers ?? 0,
      size: params.size,
      quality: params.quality,
      provider: params.provider,
      language: params.language,
      type: params.type,
      relevanceScore: params.relevanceScore ?? 0,
      sizeInBytes: params.sizeInBytes ?? 0,
      season: params.season,
      episode: params.episode,
      lastUpdated: new Date(),
      confidence: params.confidence ?? 0.7,
      originalTitle: params.originalTitle,
      year: params.year,
      canonicalName: params.canonicalName,
      infoHash: params.infoHash,
      imdbConfirmed: params.imdbConfirmed,
    };
  }

  // Mexi aqui porque o magnet sem &dn= fazia essa função devolver o magnet inteiro, virando título depois
  // Agora devolve undefined quando não tem dn, deixando o fallback por title acontecer
  private extractDnFromMagnet(magnet: string): string | undefined {
    const dnMatch = magnet.match(/dn=([^&]+)/i);
    if (!dnMatch) return undefined;
    return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
  }

  private mapHdrResult(
    r: {
      title: string;
      htmlTitle?: string;
      magnet: string;
      infoHash: string;
      seeders: number;
      size: string;
      language: string;
      originalTitle?: string;
      year?: number;
      canonicalName?: string;
      imdbConfirmed?: boolean;
      season?: number;
      episode?: number;
    },
    type: 'movie' | 'series'
  ): TorrentResult | null {
    if (!r.magnet) return null;

    const dnDoMagnet = this.extractDnFromMagnet(r.magnet);
    const temDn = dnDoMagnet !== undefined;
    // Ordem de prioridade: canonicalName do scraper, senão dn do magnet, senão title do post
    const magnetName = r.canonicalName || dnDoMagnet || r.title;
    const quality = this.qualityDetector.extractQualityFromFilename(magnetName);
    const range = extrairRangeEpisodios(magnetName);
    const season = r.season ?? range?.seasonStart ?? undefined;
    const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);
    const language = r.language ? this.mapHdrLanguage(r.language) : 'desconhecido';

    // Log pra ver de onde saiu o canonicalName do HDR após o fix
    logger.debug(`HDR_MAP | temDn=${temDn} | canon="${(r.canonicalName || '').substring(0, 40)}" | dn="${(dnDoMagnet || '').substring(0, 40)}" | fallbackTitle="${r.title.substring(0, 40)}" | escolhido="${magnetName.substring(0, 50)}"`);

    return this.buildTorrentResult({
      title: r.title,
      htmlTitle: r.htmlTitle,
      magnet: r.magnet,
      seeders: r.seeders,
      leechers: 0,
      size: r.size || 'N/A',
      quality: quality || 'HD',
      provider: 'HDR Torrent',
      imdbConfirmed: r.imdbConfirmed,
      language,
      type,
      season,
      episode,
      originalTitle: r.originalTitle,
      year: r.year,
      canonicalName: magnetName,
      infoHash: r.infoHash,
      confidence: 0.70,
      relevanceScore: 0,
      sizeInBytes: this.calculateSizeInBytes(r.size),
    });
  }

  private mapStarckResult(
    r: {
      magnet: string;
      infoHash: string;
      originalTitle?: string;
      year?: number;
      canonicalName?: string;
      language?: string;
      quality?: string;
      qualityHint?: string;
      format?: string;
      size?: string;
      season?: number;
      episode?: number;
    },
    type: 'movie' | 'series'
  ): TorrentResult | null {
    if (!r.magnet) return null;

    const dnDoMagnet = this.extractDnFromMagnet(r.magnet);
    const temDn = dnDoMagnet !== undefined;
    const displayName = r.canonicalName || dnDoMagnet;

    // FIX 3: cadeia de prioridade pra qualidade — do mais específico ao mais genérico
    // 1. canonicalName do magnet (dn=)
    // 2. quality do botão (Starck manda "1080p" direto do <span class="text">)
    // 3. qualityHint (parentText)
    let quality = this.qualityDetector.extractQualityFromFilename(displayName || '');

    if (quality === 'HD' && r.quality) {
      const q = this.qualityDetector.extractQualityFromFilename(r.quality);
      if (q !== 'HD') quality = q;
    }

    if (quality === 'HD' && r.qualityHint) {
      const hintQuality = this.qualityDetector.extractQualityFromFilename(r.qualityHint);
      if (hintQuality !== 'HD') quality = hintQuality;
    }

    const range = displayName ? extrairRangeEpisodios(displayName) : null;
    const season = r.season ?? range?.seasonStart ?? undefined;
    const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);

    const titleFinal = r.canonicalName || r.originalTitle || displayName || 'Starck Torrent';

    logger.debug(`STARCK_MAP | temDn=${temDn} | canon="${(r.canonicalName || '').substring(0, 40)}" | dn="${(dnDoMagnet || '').substring(0, 40)}" | qualityBotao="${(r.quality || '').substring(0, 20)}" | originalTitle="${(r.originalTitle || '').substring(0, 40)}" | escolhido="${titleFinal.substring(0, 50)}" | qualidadeFinal=${quality}`);

    return this.buildTorrentResult({
      title: titleFinal,
      magnet: r.magnet,
      seeders: 0,
      leechers: 0,
      size: r.size || 'N/A',
      quality: quality || 'HD',
      provider: 'Starck',
      language: r.language || 'desconhecido',
      type,
      season,
      episode,
      originalTitle: r.originalTitle,
      year: r.year,
      canonicalName: r.canonicalName || dnDoMagnet,
      infoHash: r.infoHash,
      confidence: 0.70,
      relevanceScore: 0,
    });
  }

  private mapHdrLanguage(label: string): string {
    switch (label) {
      case 'Dual Áudio': return 'Dual Áudio';
      case 'Dublado': return 'Dublado';
      case 'Legendado': return 'Legendado';
      case 'Nacional': return 'Nacional';
      default: return 'desconhecido';
    }
  }

  private calculateSizeInBytes(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'Tamanho não especificado') return 1.5 * 1024 ** 3;
    const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
    if (!match) return 1.5 * 1024 ** 3;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB' || unit === 'G') return value * 1024 ** 3;
    if (unit === 'MB' || unit === 'M') return value * 1024 ** 2;
    return 1.5 * 1024 ** 3;
  }

  getStats() {
    const nomes = ['bludv', 'wordpress', 'starck', 'hdr'];
    return {
      provedoresAtivos: nomes.filter(isScraperAtivo).length,
    };
  }
}