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

interface TokensComAno {
  tokens: string[];
  ano: number | null;
}

export class SimilarityCalculator {
  private readonly logger: Logger;
  private readonly tmdbScraper: ImdbScraperService | null;
  private readonly languageDetector: LanguageDetector;

  private readonly resultCache: CacheService;
  private readonly tokenCache: CacheService;
  private readonly fuzzyCache: CacheService;
  private readonly tmdbLocalCache: CacheService;

  private readonly RESULT_TTL = 5 * 60 * 1000;
  private readonly TOKEN_TTL = 30 * 60 * 1000;
  private readonly FUZZY_TTL = 30 * 60 * 1000;
  private readonly TMDB_TTL = 10 * 60 * 1000;

  // Tokens que podem sobrar no torrent sem indicar título diferente (técnicos)
  // Coloquei essa regex aqui pra não travar N1 em torrents tipo "superman 1080p dual"
  // Ano saiu daqui porque agora é tratado em passo próprio (extrairTokensAno)
  private readonly EXTRAS_LEGITIMOS = /^(1080p|720p|480p|2160p|1440p|4k|x264|x265|h264|h265|hevc|dual|dublado|legendado|bluray|webrip|webdl|brrip|hdrip|dvdrip|remux)$/;

  // Regex do que conta como ano válido pra extrair do título
  private readonly REGEX_ANO = /^(19|20)\d{2}$/;

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
    // Mexi aqui pra receber years[] do TitleFilter, que sabe quando o torrent é coleção com faixa de anos
    _torrentMetadata?: { year?: number; season?: number; years?: number[] },
    rawTitleForLanguage?: string,
    preFetchedTmdbData?: ImdbTitles | null
  ): Promise<SmartTitleMatch> {
    const inicio = Date.now();
    const season = _torrentMetadata?.season ?? 0;
    const resultKey = `res|${imdbId}|${season}|${normalizarTexto(torrentTitle)}`;

    const cached = this.resultCache.get<SmartTitleMatch>(resultKey);
    if (cached) {
      this.logger.debug(`Cache hit | "${torrentTitle.substring(0, 50)}"`);
      return cached;
    }

    const movieInfo = await this.obterMovieInfo(imdbId, season, preFetchedTmdbData);
    if (!movieInfo) {
      return { matches: false, similarity: 0, reason: 'Sem dados do TMDB' };
    }

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

    // Mexi aqui pra extrair tokens e ano de uma vez só, tirando o ano da comparação textual
    const { tokens: torrentTokens, ano: anoTorrentExtraido } = this.tokensAnoCache(torrentTitle);
    if (torrentTokens.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio' };
    }

    const anoTorrent = _torrentMetadata?.year ?? anoTorrentExtraido;
    const years = _torrentMetadata?.years;
    const isCollection = isCollectionTitle(torrentTitle);

    // Mexi aqui pro gate respeitar o range de anos quando o scraper declara uma coleção
    // Sem isso, "Ice Age" com years=[2002,2012] e IMDb=2006 era rejeitado por anoTorrent=2002
    const dentroDoRangeAnos = this.imdbDentroDoRangeAnos(years, movieInfo.year);

    // Mexi aqui pra ano ser gate duro e não mais bônus/penalidade no fim
    // Coleções explícitas e ranges válidos escapam do gate
    if (!isCollection && !dentroDoRangeAnos && anoTorrent !== null && movieInfo.year !== undefined) {
      const diverge = Math.abs(anoTorrent - movieInfo.year) > 1;
      if (diverge) {
        const result: SmartTitleMatch = {
          matches: false,
          similarity: 0,
          reason: `Ano divergente: torrent=${anoTorrent} imdb=${movieInfo.year}`,
          mediaType: movieInfo.mediaType,
        };
        this.resultCache.set(resultKey, result, this.RESULT_TTL);
        this.logger.debug(`GATE_ANO | torrent="${torrentTitle.substring(0, 50)}" | anoTorrent=${anoTorrent} | anoImdb=${movieInfo.year} | years=${years?.join(',') ?? '-'} → REJEITADO`);
        return result;
      }
    }

    // Mexi aqui pra logar quando o gate foi bypassado por range de coleção
    if (dentroDoRangeAnos && !isCollection) {
      this.logger.debug(`GATE_ANO_BYPASS | torrent="${torrentTitle.substring(0, 50)}" | years=[${years?.join(',')}] | anoImdb=${movieInfo.year} → dentro do range`);
    }

    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    let melhor: ScoreDetalhes | null = null;
    let melhorTitulo = '';

    for (const titulo of titulosValidos) {
      // Título do TMDB passa pelo mesmo destilador, senão "1917" seria tratado como vazio
      const { tokens: tmdbTokens } = this.tokensAnoCache(titulo);
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

    if (isCollection && melhor.score >= 0.5) {
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

    // Mexi aqui pra decisão final ficar limpa: só score textual, sem bônus de ano
    // Ano já foi usado como gate duro antes; se chegou aqui, é porque passou
    const THRESHOLD = 0.80;
    const matches = melhor.score >= THRESHOLD;
    const motivo = matches
      ? `score ${melhor.score.toFixed(2)} ≥ ${THRESHOLD}`
      : `score ${melhor.score.toFixed(2)} < ${THRESHOLD}`;

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

  // Mexi aqui pra centralizar a regra de "IMDb dentro do range de anos declarado pelo torrent"
  // Ranges (2+ anos) usam min/max; ano único usa tolerância ±1
  private imdbDentroDoRangeAnos(years: number[] | undefined, anoImdb: number | undefined): boolean {
    if (!years || years.length === 0 || anoImdb === undefined) return false;

    if (years.length > 1) {
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      return anoImdb >= minYear && anoImdb <= maxYear;
    }

    return Math.abs(years[0] - anoImdb) <= 1;
  }

  //  OBTENÇÃO DE DADOS TMDB

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

  //  NÚCLEO DE SIMILARIDADE — 5 NÍVEIS EM CASCATA

  /**
   * N1: TMDB ⊂ torrent (consecutivo)  → 1.00
   * N2: torrent ⊂ TMDB (consecutivo)  → 0.95
   * N3: TMDB ⊂ torrent (subsequência) → 0.90
   * N4: torrent ⊂ TMDB (subsequência) → 0.85
   * N5: F1 com fuzzy                  → 0.00–0.84
   */
  private calcularScore(tmdbTokens: string[], torrentTokens: string[]): ScoreDetalhes {
    // Guarda nova: TMDB curto + torrent com extras não-técnicos cai direto pro F1
    // Sem isso, "superman" dava 1.0 contra "superman and lois" (bug do falso positivo)
    if (this.matchCurtoSuspeito(tmdbTokens, torrentTokens)) {
      this.logger.debug(`GUARDA_MATCH_CURTO | tmdb=[${tmdbTokens.join(' ')}] torrent=[${torrentTokens.join(' ')}] → F1`);
      return this.calcularF1(tmdbTokens, torrentTokens);
    }

    if (this.contemConsecutivo(torrentTokens, tmdbTokens)) {
      return this.montarDetalhes('N1', 'TMDB ⊂ torrent (consecutivo)', 1.0, tmdbTokens, torrentTokens, tmdbTokens, []);
    }

    if (this.contemConsecutivo(tmdbTokens, torrentTokens)) {
      return this.montarDetalhes('N2', 'torrent ⊂ TMDB (consecutivo)', 0.95, tmdbTokens, torrentTokens, torrentTokens, []);
    }

    if (this.contemSubsequencia(torrentTokens, tmdbTokens)) {
      return this.montarDetalhes('N3', 'TMDB ⊂ torrent (subsequência)', 0.90, tmdbTokens, torrentTokens, tmdbTokens, []);
    }

    if (this.contemSubsequencia(tmdbTokens, torrentTokens)) {
      return this.montarDetalhes('N4', 'torrent ⊂ TMDB (subsequência)', 0.85, tmdbTokens, torrentTokens, torrentTokens, []);
    }

    return this.calcularF1(tmdbTokens, torrentTokens);
  }

  /**
   * Detecta match estruturalmente suspeito: TMDB com 1 token só e torrent com
   * tokens extras que NÃO são metadado técnico.
   *
   * "superman" vs "superman and lois"    → suspeito → F1
   * "superman" vs "superman returns"     → suspeito → F1
   * "superman" vs "superman 1080p"       → ok       → N1
   * "superman" vs "superman 1080p dual"  → ok       → N1
   */
  private matchCurtoSuspeito(tmdbTokens: string[], torrentTokens: string[]): boolean {
    if (tmdbTokens.length !== 1) return false;
    if (torrentTokens.length <= 1) return false;

    const tokenTmdb = tmdbTokens[0];
    const extras = torrentTokens.filter(t => t !== tokenTmdb);
    if (extras.length === 0) return false;

    // Se todos os extras são legítimos (técnicos), não é suspeito
    const todosLegitimos = extras.every(t => this.EXTRAS_LEGITIMOS.test(t));
    return !todosLegitimos;
  }

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

  private contemSubsequencia(haystack: string[], needle: string[]): boolean {
    if (needle.length === 0) return false;
    let j = 0;
    for (let i = 0; i < haystack.length && j < needle.length; i++) {
      if (haystack[i] === needle[j]) j++;
    }
    return j === needle.length;
  }

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

  //  TOKENIZAÇÃO COM EXTRAÇÃO DE ANO

  /**
   * Extrai tokens e ano separadamente.
   * Ano sai dos tokens textuais pra não poluir a comparação (N1–N5).
   *
   * "superman 1978"       → { tokens: [superman], ano: 1978 }
   * "1917 2019"           → { tokens: [1917],    ano: 2019 }
   * "1917"                → { tokens: [1917],    ano: null }   (título é o próprio número)
   * "superman"            → { tokens: [superman], ano: null }
   */
  private extrairTokensAno(texto: string): TokensComAno {
    const todos = normalizarTexto(texto).split(' ').filter(w => w.length > 0);
    const semAno: string[] = [];
    const anos: number[] = [];

    for (const t of todos) {
      if (this.REGEX_ANO.test(t)) {
        anos.push(parseInt(t));
      } else {
        semAno.push(t);
      }
    }

    // Fallback: título é só um número tipo "1917" ou "2012" — trata como nome
    if (semAno.length === 0 && todos.length > 0) {
      return { tokens: todos, ano: null };
    }

    return { tokens: semAno, ano: anos.length > 0 ? anos[0] : null };
  }

  private tokensAnoCache(texto: string): TokensComAno {
    const key = `tokano|${texto}`;
    const cached = this.tokenCache.get<TokensComAno>(key);
    if (cached) return cached;

    const resultado = this.extrairTokensAno(texto);
    this.tokenCache.set(key, resultado, this.TOKEN_TTL);
    return resultado;
  }

  //  FUZZY

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