import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import {
  getPotentialSequelNumbers,
  extrairRangeEpisodios,
  isTechnicalWord,
} from './TechnicalWords.js';

const MAX_WORD_LEN = 50;
const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000;

export class SimilarityCalculator {
  private readonly logger: Logger;
  private readonly tmdbScraper: ImdbScraperService | null;
  private readonly languageDetector: LanguageDetector;

  private readonly tmdbCache = new Map<string, { data: ImdbTitles; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

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
    this.startCacheCleanup();
  }

  private startCacheCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.tmdbCache.entries()) {
        if (now - entry.timestamp > this.cacheTTL) {
          this.tmdbCache.delete(key);
        }
      }
    }, CACHE_CLEANUP_INTERVAL);
    this.cleanupTimer.unref?.();
  }

  async smartTitleContainsCheck(
    torrentTitle: string,
    imdbId: string,
    torrentMetadata?: { year?: number; season?: number },
    rawTitleForLanguage?: string,
    preFetchedTmdbData?: ImdbTitles | null
  ): Promise<SmartTitleMatch> {
    let movieInfo: {
      portugueseTitle: string | null;
      originalTitle: string;
      year?: number;
      allTitles: string[];
      mediaType?: 'movie' | 'tv';
      belongsToCollection?: any;
    } | null = null;

    if (preFetchedTmdbData) {
      movieInfo = {
        portugueseTitle: preFetchedTmdbData.portugueseTitle,
        originalTitle: preFetchedTmdbData.originalTitle,
        year: preFetchedTmdbData.year,
        allTitles: preFetchedTmdbData.allTitles,
        mediaType: preFetchedTmdbData.mediaType,
        belongsToCollection: undefined,
      };
      this.logger.debug('Usando dados TMDB pré‑carregados', {
        imdbId,
        year: movieInfo.year,
        titles: movieInfo.allTitles.join(', ').substring(0, 80),
      });
    }

    if (!movieInfo && this.tmdbScraper) {
      try {
        const season = torrentMetadata?.season;
        const cacheKey = season ? `tmdb-${imdbId}:s${season}` : `tmdb-${imdbId}`;
        const cached = this.tmdbCache.get(cacheKey);
        let tmdbData: ImdbTitles;
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
          tmdbData = cached.data;
        } else {
          tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
          this.tmdbCache.set(cacheKey, { data: tmdbData, timestamp: Date.now() });
        }
        movieInfo = {
          portugueseTitle: tmdbData.portugueseTitle,
          originalTitle: tmdbData.originalTitle,
          year: tmdbData.year,
          allTitles: tmdbData.allTitles,
          mediaType: tmdbData.mediaType,
          belongsToCollection: undefined,
        };
      } catch (error) {
        this.logger.error('Erro ao buscar TMDB', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
      }
    }

    if (!movieInfo) {
      return { matches: false, similarity: 0, reason: 'Sem dados do TMDB' };
    }

    const torqueYear = torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);

    const tituloParaIdioma = rawTitleForLanguage || torrentTitle;
    const idiomaPre = this.languageDetector.verificarIdioma(tituloParaIdioma);
    if (idiomaPre.palavrasEn.length > 0 && idiomaPre.palavrasPt.length === 0) {
      return { matches: false, similarity: 0, reason: `Idioma internacional: ${idiomaPre.motivo}` };
    }

    const resultado = await this.compararTitulos(
      torrentTitle,
      movieInfo,
      torqueYear,
      torrentMetadata?.season,
      rawTitleForLanguage
    );
    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  private async compararTitulos(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    anoTorrent: number | null,
    temporadaAlvo?: number,
    tituloBruto?: string
  ): Promise<SmartTitleMatch> {
    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    const tokenizar = (txt: string) =>
      txt
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(w => w.length > 0 && !isTechnicalWord(w));

    const sequelTorrent = getPotentialSequelNumbers(tituloTorrent);
    const palavrasTorrent = [...tokenizar(tituloTorrent), ...sequelTorrent.map(String)];
    if (palavrasTorrent.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio' };
    }
    const setTorrentExact = new Set(palavrasTorrent);

    interface ScoreTitulo {
      titulo: string;
      palavrasTmdb: string[];
      encontradas: number;
      faltando: string[];
      totalTmdb: number;
      proporcao: number;
      extrasTorrent: number;
    }

    let melhor: ScoreTitulo = {
      titulo: '',
      palavrasTmdb: [],
      encontradas: 0,
      faltando: [],
      totalTmdb: 0,
      proporcao: 0,
      extrasTorrent: 0,
    };

    let lcsCurr: number[] | null = null;
    let lcsPrev: number[] | null = null;

    const palavrasParecidas = (a: string, b: string, tmdbEhCurto: boolean): boolean => {
      if (a === b) return true;
      if (tmdbEhCurto) return false;
      if (a.length < 3 || b.length < 3) return false;
      if (Math.abs(a.length - b.length) > 2) return false;
      const lcs = this.calcularLCSComBuffer(a, b, lcsCurr!, lcsPrev!);
      const minLen = Math.min(a.length, b.length);
      return lcs >= 3 && lcs / minLen >= 0.75;
    };

    for (const titulo of titulosValidos) {
      const sequelTmdb = getPotentialSequelNumbers(titulo);
      const palavrasTitulo = [...tokenizar(titulo), ...sequelTmdb.map(String)];

      if (!lcsCurr || !lcsPrev) {
        let maxLen = MAX_WORD_LEN;
        for (const w of palavrasTitulo) maxLen = Math.max(maxLen, w.length);
        for (const w of palavrasTorrent) maxLen = Math.max(maxLen, w.length);
        lcsCurr = new Array(maxLen + 1);
        lcsPrev = new Array(maxLen + 1);
      }

      const tmdbEhCurto = palavrasTitulo.length <= 2;

      let enc = 0;
      const falt: string[] = [];
      for (const palavraTmdb of palavrasTitulo) {
        const match =
          setTorrentExact.has(palavraTmdb) ||
          palavrasTorrent.some(p => palavrasParecidas(palavraTmdb, p, tmdbEhCurto));
        if (match) enc++;
        else falt.push(palavraTmdb);
      }

      let extras = 0;
      for (const palavraTorrent of palavrasTorrent) {
        if (isTechnicalWord(palavraTorrent)) continue;
        if (palavrasTitulo.some(p => palavrasParecidas(p, palavraTorrent, tmdbEhCurto))) continue;
        if (extrairRangeEpisodios(palavraTorrent) !== null) continue;
        if (palavraTorrent.length <= 2) {
          extras++;
          continue;
        }
        extras++;
      }

      const totalTorrent = palavrasTorrent.filter(w => !isTechnicalWord(w)).length || 1;
      const proporcao = (enc + (totalTorrent - extras)) / (palavrasTitulo.length + totalTorrent);

      const score: ScoreTitulo = {
        titulo,
        palavrasTmdb: palavrasTitulo,
        encontradas: enc,
        faltando: falt,
        totalTmdb: palavrasTitulo.length,
        proporcao,
        extrasTorrent: extras,
      };

      if (!melhor.titulo || score.proporcao > melhor.proporcao) {
        melhor = score;
      }
    }

    return this.decidirMatch(
      tituloTorrent,
      movieInfo,
      melhor,
      palavrasTorrent,
      titulosValidos,
      anoTorrent,
      temporadaAlvo,
      tituloBruto
    );
  }

  private calcularLCSComBuffer(a: string, b: string, curr: number[], prev: number[]): number {
    const lenA = a.length;
    const lenB = b.length;
    for (let j = 0; j <= lenB; j++) prev[j] = 0;
    for (let i = 1; i <= lenA; i++) {
      curr[0] = 0;
      for (let j = 1; j <= lenB; j++) {
        curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
      }
      const tmp = prev;
      prev = curr;
      curr = tmp;
    }
    return prev[lenB];
  }

  private decidirMatch(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    melhor: {
      titulo: string;
      palavrasTmdb: string[];
      encontradas: number;
      faltando: string[];
      totalTmdb: number;
      proporcao: number;
      extrasTorrent?: number;
    },
    palavrasTorrent: string[],
    titulosValidos: string[],
    anoTorrent: number | null,
    temporadaAlvo?: number,
    tituloBruto?: string
  ): SmartTitleMatch {
    const anoTmdb = movieInfo.year;
    const tipoMidia = movieInfo.mediaType || 'movie';
    const toleranciaAno = 0;

    const condicaoA = this.validarPalavrasMinimas(melhor, anoTorrent, anoTmdb, tituloTorrent, temporadaAlvo);
    const condicaoC = this.validarAnoCompativel(anoTorrent, anoTmdb, toleranciaAno, tipoMidia, movieInfo, tituloTorrent);
    const condicaoE = { passou: true, motivo: '' };

    this.logger.debug('Decidindo match', {
      similaridade: tituloTorrent.substring(0, 60),
      alvo: `S${temporadaAlvo}`,
      condicaoA: condicaoA.passou ? 'OK' : 'X',
      condicaoC: condicaoC.passou ? 'OK' : 'X',
      condicaoE: 'OK',
    });

    const todasPassaram = condicaoA.passou && condicaoC.passou && condicaoE.passou;

    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoC.passou) partesMotivo.push(condicaoC.motivo);
    if (todasPassaram) {
      partesMotivo.push(`Tudo OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras`);
      if (anoTorrent && anoTmdb) partesMotivo.push(`ano ${anoTorrent}=${anoTmdb}`);
    }

    const resultado: SmartTitleMatch = {
      matches: todasPassaram,
      similarity: todasPassaram ? 1 : 0,
      reason: partesMotivo.join(' | '),
    };

    const statusCondicoes = `A:${condicaoA.passou ? 'OK' : 'X'} C:${condicaoC.passou ? 'OK' : 'X'} E:OK`;
    if (!todasPassaram) {
      this.logger.debug(`❌ [${statusCondicoes}] "${tituloTorrent.substring(0, 70)}" | ${partesMotivo.join(' | ')}`);
    } else {
      this.logger.info(`✅ [${statusCondicoes}] "${tituloTorrent.substring(0, 60)}" | ${partesMotivo.join(' | ')}`);
    }

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  // ─── MÉTODOS DE VALIDAÇÃO ───

  private validarPalavrasMinimas(
    melhor: {
      titulo: string;
      palavrasTmdb: string[];
      faltando: string[];
      encontradas: number;
      totalTmdb: number;
      proporcao: number;
      extrasTorrent?: number;
    },
    anoTorrent?: number | null,
    anoTmdb?: number,
    tituloTorrent?: string,
    temporadaAlvo?: number
  ): { passou: boolean; motivo: string } {
    if (melhor.totalTmdb === 0) return { passou: false, motivo: 'TMDB sem palavras' };

    const extras = melhor.extrasTorrent ?? 0;
    const semAno = anoTorrent === null || anoTorrent === undefined || anoTmdb === undefined;

    // Pack temporada sem ano (mantido por compatibilidade)
    if (semAno && extras > 0 && temporadaAlvo !== undefined && tituloTorrent) {
      if (this.temTemporadaExplicita(tituloTorrent, temporadaAlvo)) {
        if (extras <= 3 && melhor.encontradas >= melhor.totalTmdb) {
          const motivo = `Pack temporada S${temporadaAlvo} sem ano — ${extras} extras aceitas`;
          this.logger.debug(`Pack aceito: ${motivo}`);
          return { passou: true, motivo };
        }
      }
    }

    // Sem ano e com extras -> rejeitar (título provavelmente diferente)
    if (semAno && extras > 0) {
      const motivo = `Sem ano para validar + ${extras} palavra(s) extra(s) no torrent → título diferente`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    // Título curto (1-2 palavras) com ano divergente e extras -> rejeitar
    if (!semAno && melhor.totalTmdb <= 2 && anoTorrent !== anoTmdb && extras > 0) {
      const motivo = `Título curto (${melhor.totalTmdb}pal) + ano ${anoTorrent}≠${anoTmdb} + ${extras} extra(s) → provável outro filme`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    const anoExato = !semAno && Math.abs(anoTorrent! - anoTmdb!) <= 1;

    // ═══ CORREÇÃO: se todas as palavras do TMDB foram encontradas e o ano é exato,
    // aceitamos independentemente da proporção. ═══
    if (melhor.faltando.length === 0 && anoExato) {
      const motivo = `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%)${extras > 0 ? ` +${extras} extra(s)` : ''} [ano exato]`;
      this.logger.debug(`Aceito (match completo, ignorando extras): ${motivo}`);
      return { passou: true, motivo };
    }

    // Se todas as palavras do TMDB foram encontradas, mesmo sem ano, aceitamos se proporção >= 0.5
    if (melhor.faltando.length === 0 && melhor.proporcao >= 0.5) {
      const motivo = `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%)${extras > 0 ? ` +${extras} extra(s)` : ''}`;
      this.logger.debug(`Aceito (match completo, sem ano): ${motivo}`);
      return { passou: true, motivo };
    }

    // Título curto (1-2 palavras) com ano divergente e sem ano exato -> rejeitar
    if (!semAno && melhor.totalTmdb <= 2 && anoTorrent !== anoTmdb && !anoExato) {
      const motivo = `Título curto (${melhor.totalTmdb}pal) + ano divergente: ${anoTorrent}≠${anoTmdb} → conteúdo diferente`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    // Palavra-cola (uma palavra faltante <= 3 letras, títulos com 3+ palavras, proporção >= 0.6)
    if (melhor.faltando.length === 1 && melhor.palavrasTmdb.length >= 3 && extras <= 2) {
      const palavra = melhor.faltando[0];
      const isNumero = /^\d+$/.test(palavra);
      if (!isNumero && palavra.length <= 3 && melhor.proporcao >= 0.6) {
        const motivo = `Palavra-cola: "${palavra}" (<=3), ${melhor.encontradas}/${melhor.totalTmdb} palavras`;
        this.logger.debug(`Aceito por palavra-cola: ${motivo}`);
        return { passou: true, motivo };
      }
    }

    // Ano exato, sem extras, faltando <=2, ao menos 2 palavras encontradas
    if (anoExato && extras === 0 && melhor.faltando.length <= 2 && melhor.encontradas >= 2) {
      const motivo = `Ano exato (${anoTorrent}=${anoTmdb}): ${melhor.encontradas}/${melhor.totalTmdb} palavras`;
      this.logger.debug(`Aceito por ano exato: ${motivo}`);
      return { passou: true, motivo };
    }

    // Caso geral: rejeita se faltou palavra ou proporção muito baixa
    const motivo = `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%). Faltando: [${melhor.faltando.join(', ')}]`;
    this.logger.debug(`Rejeitado: ${motivo}`);
    return { passou: false, motivo };
  }

  private validarAnoCompativel(
    anoTorrent: number | null,
    anoTmdb: number | undefined,
    tolerancia: number,
    _tipoMidia: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    tituloTorrent: string
  ): { passou: boolean; motivo: string } {
    let minWords = 99;
    let maxWords = 0;
    for (const t of movieInfo.allTitles) {
      const palavras = this.normalizarParaComparacao(t)
        .split(' ')
        .filter(w => w.length > 0 && !/^\d+$/.test(w));
      if (palavras.length < minWords) minWords = palavras.length;
      if (palavras.length > maxWords) maxWords = palavras.length;
    }
    if (minWords <= 1 && maxWords <= 1) {
      const tmdbWord = movieInfo.allTitles[0].toLowerCase();
      const palavrasTitulo = this.normalizarParaComparacao(tituloTorrent)
        .split(' ')
        .filter(w => w.length > 0 && !/^\d+$/.test(w));
      const palavrasEstranhas = palavrasTitulo.filter(w => w !== tmdbWord && !isTechnicalWord(w));
      if (palavrasEstranhas.length > 1) {
        return {
          passou: false,
          motivo: `TMDB de 1 palavra ("${tmdbWord}") — palavras extras: [${palavrasEstranhas.join(', ')}]`,
        };
      }
    }

    if (anoTorrent === null || anoTmdb === undefined) {
      return { passou: true, motivo: 'Sem ano para comparar' };
    }

    const diff = Math.abs(anoTmdb - anoTorrent);
    const passou = diff <= tolerancia;
    return {
      passou,
      motivo: passou ? `Ano compativel: ${anoTorrent}=${anoTmdb}` : `Ano divergente: ${anoTorrent} vs ${anoTmdb} (dif=${diff}>${tolerancia})`,
    };
  }

  private temTemporadaExplicita(titulo: string, temporada: number): boolean {
    const range = extrairRangeEpisodios(titulo);
    if (!range) return false;
    if (range.episodeStart > 0 || range.episodeEnd > 0) return false;
    return range.season === temporada;
  }

  private normalizarParaComparacao(titulo: string): string {
    return titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extrairAnoDoTitulo(titulo: string): number | null {
    const anos = titulo.match(/\b(19|20)\d{2}\b/g);
    if (!anos || anos.length === 0) return null;
    const primeiroNumero = titulo.match(/\b\d{4}\b/);
    if (primeiroNumero && anos[0] === primeiroNumero[0] && anos.length > 1) {
      return parseInt(anos[1]);
    }
    return parseInt(anos[0]);
  }
}

export type { SmartTitleMatch };