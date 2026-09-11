import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { normalizarTexto, isCollectionTitle } from './TechnicalWords.js';
import { CacheService } from '../debrid/CacheService.js';

interface ScoreDetalhes {
  nivel: 'N1' | 'N2' | 'N3' | 'N4' | 'N5';
  descricao: string;
  score: number;
  tmdbTokens: string[];
  torrentTokens: string[];
  matchedTmdb: string[];
  matchedTorrent: string[];
  unmatchedTmdb: string[];
  unmatchedTorrent: string[];
  ordemOk: boolean;
}

export class SimilarityCalculator {
  private readonly logger: Logger;
  private readonly tmdbScraper: ImdbScraperService | null;
  private readonly languageDetector: LanguageDetector;

  // ── Caches (usa CacheService com TTL e cleanup automático) ──────
  private readonly resultCache: CacheService;
  private readonly tokenCache: CacheService;
  private readonly fuzzyCache: CacheService;
  private readonly tmdbLocalCache: CacheService;

  private readonly RESULT_TTL = 5 * 60 * 1000;   // 5min
  private readonly TOKEN_TTL = 30 * 60 * 1000;   // 30min
  private readonly FUZZY_TTL = 30 * 60 * 1000;   // 30min
  private readonly TMDB_TTL = 10 * 60 * 1000;    // 10min

  private static instance: SimilarityCalculator;

  public static getInstance(): SimilarityCalculator {
    if (!SimilarityCalculator.instance) {
      SimilarityCalculator.instance = new SimilarityCalculator(undefined, true);
    }
    return SimilarityCalculator.instance;
  }

  constructor(_titleCleaner?: any, useTmdbScraper: boolean = true) {
    this.logger = new Logger('SimilarityCalculator');
    this.tmdbScraper = useTmdbScraper ? ImdbScraperService.getInstance() : null;
    this.languageDetector = LanguageDetector.getInstance();

    this.resultCache = new CacheService();
    this.tokenCache = new CacheService();
    this.fuzzyCache = new CacheService();
    this.tmdbLocalCache = new CacheService();
  }

  //  API PÚBLICA

  async smartTitleContainsCheck(
    torrentTitle: string,
    imdbId: string,
    _torrentMetadata?: { year?: number; season?: number },
    rawTitleForLanguage?: string,
    preFetchedTmdbData?: ImdbTitles | null
  ): Promise<SmartTitleMatch> {
    const inicio = Date.now();
    const season = _torrentMetadata?.season ?? 0;
    const resultKey = `res|${imdbId}|${season}|${normalizarTexto(torrentTitle)}`;

    // ── 1. Cache de resultado final ─────────────────────────────
    const cached = this.resultCache.get<SmartTitleMatch>(resultKey);
    if (cached) {
      this.logger.debug(`Cache hit | "${torrentTitle.substring(0, 50)}"`);
      return cached;
    }

    // ── 2. Obtém dados TMDB ─────────────────────────────────────
    const movieInfo = await this.obterMovieInfo(imdbId, season, preFetchedTmdbData);
    if (!movieInfo) {
      return { matches: false, similarity: 0, reason: 'Sem dados do TMDB' };
    }

    // ── 3. Filtro de idioma ─────────────────────────────────────
    const tituloParaIdioma = rawTitleForLanguage || torrentTitle;
    const idiomaPre = this.languageDetector.verificarIdioma(tituloParaIdioma);
    if (idiomaPre.palavrasEn.length > 0 && idiomaPre.palavrasPt.length === 0) {
      const result: SmartTitleMatch = {
        matches: false,
        similarity: 0,
        reason: `Idioma internacional: ${idiomaPre.motivo}`,
        mediaType: movieInfo.mediaType,
      };
      this.resultCache.set(resultKey, result, this.RESULT_TTL);
      return result;
    }

    // ── 4. Tokeniza torrent ─────────────────────────────────────
    const torrentTokens = this.tokenizarCache(torrentTitle);
    if (torrentTokens.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio' };
    }

    // ── 5. Avalia cada título TMDB e escolhe o melhor score ─────
    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    let melhor: ScoreDetalhes | null = null;
    let melhorTitulo = '';

    for (const titulo of titulosValidos) {
      const tmdbTokens = this.tokenizarCache(titulo);
      if (tmdbTokens.length === 0) continue;

      const detalhes = this.calcularScore(tmdbTokens, torrentTokens);
      if (!melhor || detalhes.score > melhor.score) {
        melhor = detalhes;
        melhorTitulo = titulo;
      }
    }

    if (!melhor) {
      return { matches: false, similarity: 0, reason: 'Nenhum título comparável' };
    }

    // ── 6. Guard clause: coleção/franquia ───────────────────────
    if (isCollectionTitle(torrentTitle) && melhor.score >= 0.5) {
      const result: SmartTitleMatch = {
        matches: true,
        similarity: 0.8,
        reason: `Coleção/franquia (score ${melhor.score.toFixed(2)})`,
        mediaType: movieInfo.mediaType,
      };
      this.resultCache.set(resultKey, result, this.RESULT_TTL);
      this.logarResultado(torrentTitle, melhorTitulo, melhor, true, 'coleção', Date.now() - inicio);
      return result;
    }

    // ── 7. Decisão final ────────────────────────────────────────
    const anoTorrent = _torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);
    const anoBate = !!(anoTorrent && movieInfo.year && Math.abs(anoTorrent - movieInfo.year) <= 1);

    const THRESHOLD = 0.80;
    const THRESHOLD_COM_ANO = 0.65;

    let matches = false;
    let motivo = '';

    if (melhor.score >= THRESHOLD) {
      matches = true;
      motivo = `score ${melhor.score.toFixed(2)} ≥ ${THRESHOLD}`;
    } else if (
      melhor.score >= THRESHOLD_COM_ANO &&
      anoBate &&
      melhor.tmdbTokens.length >= 3
    ) {
      matches = true;
      motivo = `score ${melhor.score.toFixed(2)} + ano ${anoTorrent}=${movieInfo.year}`;
    } else {
      motivo = `score ${melhor.score.toFixed(2)} < ${THRESHOLD}`;
    }

    const result: SmartTitleMatch = {
      matches,
      similarity: matches ? Number(melhor.score.toFixed(3)) : 0,
      reason: motivo,
      mediaType: movieInfo.mediaType,
    };

    this.resultCache.set(resultKey, result, this.RESULT_TTL);
    this.logarResultado(torrentTitle, melhorTitulo, melhor, matches, motivo, Date.now() - inicio);

    return result;
  }

  //  OBTENÇÃO DE DADOS TMDB (com cache local)

  private async obterMovieInfo(
    imdbId: string,
    season: number,
    preFetched?: ImdbTitles | null
  ): Promise<{
    portugueseTitle: string | null;
    originalTitle: string;
    year?: number;
    allTitles: string[];
    mediaType?: 'movie' | 'tv';
  } | null> {
    if (preFetched) {
      return {
        portugueseTitle: preFetched.portugueseTitle,
        originalTitle: preFetched.originalTitle,
        year: preFetched.year,
        allTitles: preFetched.allTitles,
        mediaType: preFetched.mediaType,
      };
    }

    if (!this.tmdbScraper) return null;

    const key = `tmdb|${imdbId}|${season}`;
    const cachedTmdb = this.tmdbLocalCache.get<ImdbTitles>(key);
    if (cachedTmdb) {
      return {
        portugueseTitle: cachedTmdb.portugueseTitle,
        originalTitle: cachedTmdb.originalTitle,
        year: cachedTmdb.year,
        allTitles: cachedTmdb.allTitles,
        mediaType: cachedTmdb.mediaType,
      };
    }

    try {
      const tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
      this.tmdbLocalCache.set(key, tmdbData, this.TMDB_TTL);
      return {
        portugueseTitle: tmdbData.portugueseTitle,
        originalTitle: tmdbData.originalTitle,
        year: tmdbData.year,
        allTitles: tmdbData.allTitles,
        mediaType: tmdbData.mediaType,
      };
    } catch (error) {
      this.logger.error('Erro ao buscar TMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro',
      });
      return null;
    }
  }

  //  NOVO NÚCLEO DE SIMILARIDADE IRADA — 5 NÍVEIS EM CASCATA

  /**
   * Calcula o score entre tokens TMDB e tokens do torrent.
   *
   * Cascata de níveis (do mais forte ao mais fraco):
   *   N1: TMDB ⊂ torrent (consecutivo)  → 1.00
   *   N2: torrent ⊂ TMDB (consecutivo)  → 0.95
   *   N3: TMDB ⊂ torrent (subsequência) → 0.90
   *   N4: torrent ⊂ TMDB (subsequência) → 0.85
   *   N5: F1 com fuzzy                  → 0.00–0.84
   */
  private calcularScore(tmdbTokens: string[], torrentTokens: string[]): ScoreDetalhes {
    // N1: TMDB inteiro consecutivo dentro do torrent
    if (this.contemConsecutivo(torrentTokens, tmdbTokens)) {
      return this.montarDetalhes('N1', 'TMDB ⊂ torrent (consecutivo)', 1.0, tmdbTokens, torrentTokens, tmdbTokens, []);
    }

    // N2: torrent inteiro consecutivo dentro do TMDB
    if (this.contemConsecutivo(tmdbTokens, torrentTokens)) {
      return this.montarDetalhes('N2', 'torrent ⊂ TMDB (consecutivo)', 0.95, tmdbTokens, torrentTokens, torrentTokens, []);
    }

    // N3: TMDB como subsequência ordenada do torrent
    if (this.contemSubsequencia(torrentTokens, tmdbTokens)) {
      return this.montarDetalhes('N3', 'TMDB ⊂ torrent (subsequência)', 0.90, tmdbTokens, torrentTokens, tmdbTokens, []);
    }

    // N4: torrent como subsequência ordenada do TMDB
    if (this.contemSubsequencia(tmdbTokens, torrentTokens)) {
      return this.montarDetalhes('N4', 'torrent ⊂ TMDB (subsequência)', 0.85, tmdbTokens, torrentTokens, torrentTokens, []);
    }

    // N5: F1 com fuzzy matching
    return this.calcularF1(tmdbTokens, torrentTokens);
  }

  /** Monta ScoreDetalhes para os níveis de containment (N1–N4) */
  private montarDetalhes(
    nivel: ScoreDetalhes['nivel'],
    descricao: string,
    score: number,
    tmdbTokens: string[],
    torrentTokens: string[],
    matchedSet: string[],
    unmatchedSet: string[]
  ): ScoreDetalhes {
    const matchedTmdb = nivel === 'N1' || nivel === 'N3' ? tmdbTokens : [];
    const matchedTorrent = nivel === 'N2' || nivel === 'N4' ? torrentTokens : [];

    const unmatchedTmdb = nivel === 'N1' || nivel === 'N3' ? [] : tmdbTokens.filter(t => !matchedSet.includes(t));
    const unmatchedTorrent = nivel === 'N2' || nivel === 'N4' ? [] : torrentTokens.filter(t => !matchedSet.includes(t));

    return {
      nivel,
      descricao,
      score,
      tmdbTokens,
      torrentTokens,
      matchedTmdb: matchedTmdb.length ? matchedTmdb : matchedSet,
      matchedTorrent: matchedTorrent.length ? matchedTorrent : matchedSet,
      unmatchedTmdb,
      unmatchedTorrent,
      ordemOk: true,
    };
  }

  /** Verifica se `needle` aparece em `haystack` de forma consecutiva */
  private contemConsecutivo(haystack: string[], needle: string[]): boolean {
    if (needle.length === 0 || needle.length > haystack.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i++) {
      let ok = true;
      for (let j = 0; j < needle.length; j++) {
        if (haystack[i + j] !== needle[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
    return false;
  }

  /** Verifica se `needle` aparece em `haystack` na ordem (gaps permitidos) */
  private contemSubsequencia(haystack: string[], needle: string[]): boolean {
    if (needle.length === 0) return false;
    let j = 0;
    for (let i = 0; i < haystack.length && j < needle.length; i++) {
      if (haystack[i] === needle[j]) j++;
    }
    return j === needle.length;
  }

  /** F1 com fuzzy matching — último nível da cascata */
  private calcularF1(tmdbTokens: string[], torrentTokens: string[]): ScoreDetalhes {
    const matchedTmdb: string[] = [];
    const matchedTorrent: string[] = [];
    const unmatchedTmdb: string[] = [];
    const unmatchedTorrent: string[] = [];
    const posicoes: number[] = [];

    const torrentUsados = new Set<number>();

    for (const tmdbTok of tmdbTokens) {
      let melhorRatio = 0;
      let melhorIdx = -1;
      for (let i = 0; i < torrentTokens.length; i++) {
        if (torrentUsados.has(i)) continue;
        const ratio = this.fuzzyRatioCache(tmdbTok, torrentTokens[i]);
        if (ratio > melhorRatio) {
          melhorRatio = ratio;
          melhorIdx = i;
        }
      }
      if (melhorRatio >= 0.75 && melhorIdx !== -1) {
        matchedTmdb.push(tmdbTok);
        matchedTorrent.push(torrentTokens[melhorIdx]);
        posicoes.push(melhorIdx);
        torrentUsados.add(melhorIdx);
      } else {
        unmatchedTmdb.push(tmdbTok);
      }
    }

    for (let i = 0; i < torrentTokens.length; i++) {
      if (!torrentUsados.has(i)) unmatchedTorrent.push(torrentTokens[i]);
    }

    const coverage = tmdbTokens.length > 0 ? matchedTmdb.length / tmdbTokens.length : 0;
    const precision = torrentTokens.length > 0 ? matchedTorrent.length / torrentTokens.length : 0;
    const f1 = (coverage + precision) > 0
      ? (2 * coverage * precision) / (coverage + precision)
      : 0;

    // Verifica ordem das palavras casadas
    let ordemOk = true;
    for (let i = 1; i < posicoes.length; i++) {
      if (posicoes[i] < posicoes[i - 1]) {
        ordemOk = false;
        break;
      }
    }

    const scoreFinal = ordemOk ? f1 : f1 * 0.85;

    return {
      nivel: 'N5',
      descricao: `F1 fuzzy (cov=${coverage.toFixed(2)}, prec=${precision.toFixed(2)}${ordemOk ? '' : ', ordem quebrada'})`,
      score: scoreFinal,
      tmdbTokens,
      torrentTokens,
      matchedTmdb,
      matchedTorrent,
      unmatchedTmdb,
      unmatchedTorrent,
      ordemOk,
    };
  }

  //  TOKENIZAÇÃO E FUZZY (com cache)

  private tokenizarCache(texto: string): string[] {
    const key = `tok|${texto}`;
    const cached = this.tokenCache.get<string[]>(key);
    if (cached) return cached;

    const tokens = normalizarTexto(texto).split(' ').filter(w => w.length > 0);
    this.tokenCache.set(key, tokens, this.TOKEN_TTL);
    return tokens;
  }

  private fuzzyRatioCache(a: string, b: string): number {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `fz|${x}|${y}`;
    const cached = this.fuzzyCache.get<number>(key);
    if (cached !== null && cached !== undefined) return cached;

    const ratio = this.fuzzyRatio(a, b);
    this.fuzzyCache.set(key, ratio, this.FUZZY_TTL);
    return ratio;
  }

  private fuzzyRatio(a: string, b: string): number {
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = this.levenshtein(a, b);
    return 1 - dist / maxLen;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prev = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;

    for (let i = 1; i <= m; i++) {
      const curr = new Array(n + 1);
      curr[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        curr[j] = Math.min(
          prev[j] + 1,
          curr[j - 1] + 1,
          prev[j - 1] + cost
        );
      }
      prev = curr;
    }
    return prev[n];
  }

  //  LOGS OBJETIVOS

  private logarResultado(
    torrentTitle: string,
    tmdbTitle: string,
    detalhes: ScoreDetalhes,
    matches: boolean,
    motivo: string,
    tempoMs: number
  ): void {
    const icone = matches ? '✅' : '❌';
    const torrentShort = torrentTitle.substring(0, 60);
    const tmdbShort = tmdbTitle.substring(0, 60);

    const linha = `${icone} ${detalhes.nivel} score=${detalhes.score.toFixed(3)} | ` +
      `torrent="${torrentShort}" (${detalhes.torrentTokens.length}t) | ` +
      `tmdb="${tmdbShort}" (${detalhes.tmdbTokens.length}t) | ` +
      `${detalhes.descricao} | ${motivo} | ${tempoMs}ms`;

    if (matches) {
      this.logger.info(linha);
    } else {
      this.logger.debug(linha);
    }
  }

  private extrairAnoDoTitulo(titulo: string): number | null {
    const anos = titulo.match(/\b(19|20)\d{2}\b/g);
    if (!anos || anos.length === 0) return null;
    const primeiroNumero = titulo.match(/\b\d{4}\b/);
    if (primeiroNumero && anos[0] === primeiroNumero[0] && anos.length > 1) return parseInt(anos[1]);
    return parseInt(anos[0]);
  }

  //  UTILITÁRIOS DE CACHE

  clearCaches(): void {
    this.resultCache.clear();
    this.tokenCache.clear();
    this.fuzzyCache.clear();
    this.tmdbLocalCache.clear();
  }

  getCacheStats() {
    return {
      result: this.resultCache.getStats().size,
      token: this.tokenCache.getStats().size,
      fuzzy: this.fuzzyCache.getStats().size,
      tmdb: this.tmdbLocalCache.getStats().size,
    };
  }
}

export type { SmartTitleMatch };