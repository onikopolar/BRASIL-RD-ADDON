import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { normalizarTexto, isCollectionTitle, extrairNumeroParte, getPotentialSequelNumbers } from './TechnicalWords.js';
import { CacheService } from '../debrid/CacheService.js';

export interface ScoreDetalhes {
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

export interface TokensComAno {
  tokens: string[];
  ano: number | null;
}

export interface ResultadoComparacao {
  match: boolean;
  score: number;
  nivel: 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'vazio' | 'nenhum';
  tituloVencedor?: string;
  detalhes?: ScoreDetalhes;
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

  public static readonly THRESHOLD_PRE_FILTRO = 0.5;
  public static readonly THRESHOLD_FINAL = 0.80;

  public readonly EXTRAS_LEGITIMOS = /^(1080p|720p|480p|2160p|1440p|4k|x264|x265|h264|h265|hevc|dual|dublado|legendado|bluray|webrip|webdl|brrip|hdrip|dvdrip|remux)$/;
  public readonly REGEX_ANO = /^(19|20)\d{2}$/;

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

    this.resultCache = new CacheService({ name: 'sim:result' });
    this.tokenCache = new CacheService({ name: 'sim:token' });
    this.fuzzyCache = new CacheService({ name: 'sim:fuzzy' });
    this.tmdbLocalCache = new CacheService({ name: 'sim:tmdb' });
  }

  //  API PÚBLICA — PRÉ-FILTRO

  compararComTitulos(
    titulosTmdb: string[],
    tituloCandidato: string,
    threshold: number = SimilarityCalculator.THRESHOLD_PRE_FILTRO
  ): ResultadoComparacao {
    const { tokens: tokensCandidato } = this.tokensAnoCache(tituloCandidato);
    if (tokensCandidato.length === 0) {
      return { match: false, score: 0, nivel: 'vazio' };
    }

    let melhor: ScoreDetalhes | null = null;
    let melhorTitulo = '';

    for (const titulo of titulosTmdb) {
      const { tokens: tokensTmdb } = this.tokensAnoCache(titulo);
      if (tokensTmdb.length === 0) continue;

      const detalhes = this.calcularScore(tokensTmdb, tokensCandidato);
      if (!melhor || detalhes.score > melhor.score) {
        melhor = detalhes;
        melhorTitulo = titulo;
      }
    }

    if (!melhor) {
      return { match: false, score: 0, nivel: 'nenhum' };
    }

    return {
      match: melhor.score >= threshold,
      score: melhor.score,
      nivel: melhor.nivel,
      tituloVencedor: melhorTitulo,
      detalhes: melhor,
    };
  }

  pontuarTokens(tmdbTokens: string[], candidatoTokens: string[]): ScoreDetalhes {
    return this.calcularScore(tmdbTokens, candidatoTokens);
  }

  //  API PÚBLICA — FLUXO PRINCIPAL

  async smartTitleContainsCheck(
    torrentTitle: string,
    imdbId: string,
    _torrentMetadata?: { year?: number; season?: number; years?: number[] },
    rawTitleForLanguage?: string,
    preFetchedTmdbData?: ImdbTitles | null
  ): Promise<SmartTitleMatch> {
    const inicio = Date.now();
    const season = _torrentMetadata?.season ?? 0;
    const resultKey = `res|${imdbId}|${season}|${normalizarTexto(torrentTitle)}`;

    const cached = this.resultCache.get<SmartTitleMatch>(resultKey);
    if (cached) {
      this.logger.debug(`cache hit | "${torrentTitle.substring(0, 50)}"`);
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

    const { tokens: torrentTokens, ano: anoTorrentExtraido } = this.tokensAnoCache(torrentTitle);
    if (torrentTokens.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio' };
    }

    const anoTorrent = _torrentMetadata?.year ?? anoTorrentExtraido;
    const years = _torrentMetadata?.years;
    const isCollection = isCollectionTitle(torrentTitle);

    const dentroDoRangeAnos = this.imdbDentroDoRangeAnos(years, movieInfo.year);

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
        this.logger.debug(
          `GATE_ANO rejeitado | "${torrentTitle.substring(0, 50)}" | ` +
          `torrent=${anoTorrent} imdb=${movieInfo.year} years=[${years?.join(',') ?? '-'}]`
        );
        return result;
      }
    }

    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    const seqTorrent = getPotentialSequelNumbers(torrentTitle);

    // Sequência confirmada quando algum título TMDB declara o mesmo número do torrent.
    const tmdbDeclaraMesmoNumero = seqTorrent.length > 0
      && titulosValidos.some(t => getPotentialSequelNumbers(t).some(n => seqTorrent.includes(n)));

    let melhor: ScoreDetalhes | null = null;
    let melhorTitulo = '';
    let seqBloqueou = false;

    for (const titulo of titulosValidos) {
      const { tokens: tmdbTokens } = this.tokensAnoCache(titulo);
      if (tmdbTokens.length === 0) continue;

      const seqTmdb = getPotentialSequelNumbers(titulo);
      let torrentTokensParaComparar = torrentTokens;

      if (seqTorrent.length > 0) {
        if (seqTmdb.length > 0) {
          const inter = seqTorrent.filter(n => seqTmdb.includes(n));
          if (inter.length === 0) {
            this.logger.debug(`SEQUENCIA divergente | "${torrentTitle.substring(0, 50)}" | torrent=[${seqTorrent.join(',')}] tmdb=[${seqTmdb.join(',')}]`);
            seqBloqueou = true;
            continue;
          }
        } else if (!tmdbDeclaraMesmoNumero) {
          this.logger.debug(`SEQUENCIA rejeitada | "${torrentTitle.substring(0, 50)}" | torrent=[${seqTorrent.join(',')}] tmdb="${titulo.substring(0, 40)}"`);
          seqBloqueou = true;
          continue;
        } else {
          // Sequência confirmada em outro título — remove o número do torrent pra casar com o subtítulo.
          torrentTokensParaComparar = torrentTokens.filter(
            t => !/^\d{1,2}$/.test(t) || !seqTorrent.includes(parseInt(t))
          );
        }
      }

      const detalhes = this.calcularScore(tmdbTokens, torrentTokensParaComparar);
      if (!melhor || detalhes.score > melhor.score) {
        melhor = detalhes;
        melhorTitulo = titulo;
      }
    }

    if (!melhor) {
      const result: SmartTitleMatch = {
        matches: false,
        similarity: 0,
        reason: seqBloqueou ? `Sequência sem par: [${seqTorrent.join(',')}]` : 'Nenhum título comparável',
        mediaType: movieInfo.mediaType,
      };
      this.resultCache.set(resultKey, result, this.RESULT_TTL);
      return result;
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

    const THRESHOLD = SimilarityCalculator.THRESHOLD_FINAL;
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

  //  API PÚBLICA — SIMILARIDADE DE TOKENS

  jaccardSimilarity(tokensA: string[], tokensB: string[]): number {
    if (tokensA.length === 0 && tokensB.length === 0) return 0;
    const setA = new Set(tokensA);
    const setB = new Set(tokensB);

    let intersecao = 0;
    for (const t of setA) {
      if (setB.has(t)) intersecao++;
    }
    const uniao = setA.size + setB.size - intersecao;
    return uniao > 0 ? intersecao / uniao : 0;
  }

  tokensContidos(sub: string[], sup: string[]): boolean {
    if (sub.length === 0) return false;
    const setSup = new Set(sup);
    for (const t of sub) {
      if (!setSup.has(t)) return false;
    }
    return true;
  }

  //  API PÚBLICA — TMDB

  async obterMovieInfo(
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

  calcularScore(tmdbTokens: string[], torrentTokens: string[]): ScoreDetalhes {
    // Guarda: se ambos declaram número de parte e diferem, rejeita direto sem fuzzy.
    const parteTmdb = extrairNumeroParte(tmdbTokens.join(' '));
    const parteTorrent = extrairNumeroParte(torrentTokens.join(' '));
    if (parteTmdb !== null && parteTorrent !== null && parteTmdb !== parteTorrent) {
      return this.montarDetalhes(
        'N5',
        `Parte divergente: ${parteTorrent} vs ${parteTmdb}`,
        0,
        tmdbTokens,
        torrentTokens,
        [],
        []
      );
    }

    if (this.matchCurtoSuspeito(tmdbTokens, torrentTokens)) {
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

  matchCurtoSuspeito(tmdbTokens: string[], torrentTokens: string[]): boolean {
    if (tmdbTokens.length !== 1) return false;

    const tokenTmdb = tmdbTokens[0];
    if (tokenTmdb.length > 3) return false;  // só guarda tokens curtos/ambíguos (it, up, us, her)

    if (torrentTokens.length < 3) return false;

    const extras = torrentTokens.filter(t => t !== tokenTmdb);
    if (extras.length < 2) return false;

    const todosLegitimos = extras.every(t => this.EXTRAS_LEGITIMOS.test(t));
    return !todosLegitimos;
  }

  montarDetalhes(
    nivel: ScoreDetalhes['nivel'],
    descricao: string,
    score: number,
    tmdbTokens: string[],
    torrentTokens: string[],
    matchedSet: string[],
    _unmatchedSet: string[]
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

  contemConsecutivo(haystack: string[], needle: string[]): boolean {
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

  contemSubsequencia(haystack: string[], needle: string[]): boolean {
    if (needle.length === 0) return false;
    let j = 0;
    for (let i = 0; i < haystack.length && j < needle.length; i++) {
      if (haystack[i] === needle[j]) j++;
    }
    return j === needle.length;
  }

  calcularF1(tmdbTokens: string[], torrentTokens: string[]): ScoreDetalhes {
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

  extrairTokensAno(texto: string): TokensComAno {
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

    if (semAno.length === 0 && todos.length > 0) {
      return { tokens: todos, ano: null };
    }

    return { tokens: semAno, ano: anos.length > 0 ? anos[0] : null };
  }

  tokensAnoCache(texto: string): TokensComAno {
    const key = `tokano|${texto}`;
    const cached = this.tokenCache.get<TokensComAno>(key);
    if (cached) return cached;

    const resultado = this.extrairTokensAno(texto);
    this.tokenCache.set(key, resultado, this.TOKEN_TTL);
    return resultado;
  }

  //  FUZZY

  fuzzyRatioCache(a: string, b: string): number {
    const [x, y] = a < b ? [a, b] : [b, a];
    const key = `fz|${x}|${y}`;
    const cached = this.fuzzyCache.get<number>(key);
    if (cached !== null && cached !== undefined) return cached;

    const ratio = this.fuzzyRatio(a, b);
    this.fuzzyCache.set(key, ratio, this.FUZZY_TTL);
    return ratio;
  }

  fuzzyRatio(a: string, b: string): number {
    if (a === b) return 1;
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = this.levenshtein(a, b);
    return 1 - dist / maxLen;
  }

  levenshtein(a: string, b: string): number {
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

  //  GATE DE ANO

  imdbDentroDoRangeAnos(years: number[] | undefined, anoImdb: number | undefined): boolean {
    if (!years || years.length === 0 || anoImdb === undefined) return false;

    if (years.length > 1) {
      const minYear = Math.min(...years);
      const maxYear = Math.max(...years);
      return anoImdb >= minYear && anoImdb <= maxYear;
    }

    return Math.abs(years[0] - anoImdb) <= 1;
  }

  //  LOGS OBJETIVOS

  logarResultado(
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