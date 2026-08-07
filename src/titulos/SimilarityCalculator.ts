import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import {
  getPotentialSequelNumbers,
  extrairRangeEpisodios,
  isTechnicalWord,
  isCollectionTitle,
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

  /**
   * Verifica se o título do torrent corresponde ao IMDb ID fornecido.
   *
   * @param torrentTitle   título principal do torrent (ex: canonicalName)
   * @param imdbId         identificador IMDb
   * @param torrentMetadata opcionais: year e season
   * @param rawTitleForLanguage título alternativo para checagem de idioma
   * @param preFetchedTmdbData dados TMDB pré‑obtidos (evita nova chamada à API)
   */
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

    // ── 1. Usar dados TMDB já prontos (evita chamada redundante) ──
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

    // ── 2. Fallback: buscar do TMDB (apenas se não houver dados prontos) ──
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

    // Validação de idioma (apenas PT)
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

    // Tokenização aprimorada: NÚMEROS são mantidos, confiando em isTechnicalWord
    const tokenizar = (txt: string) =>
      txt
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(w => w.length > 0 && !isTechnicalWord(w));  // números passam

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
    const tituloParaTemporada = tituloBruto || tituloTorrent;
    const condicaoE = this.validarTemporada(tituloParaTemporada, temporadaAlvo);

    this.logger.debug('Decidindo match', {
      similaridade: tituloTorrent.substring(0, 60),
      temporadaValidadaCom: tituloParaTemporada.substring(0, 60),
      alvo: `S${temporadaAlvo}`,
      condicaoA: condicaoA.passou ? 'OK' : 'X',
      condicaoC: condicaoC.passou ? 'OK' : 'X',
      condicaoE: condicaoE.passou ? 'OK' : 'X',
    });

    const todasPassaram = condicaoA.passou && condicaoC.passou && condicaoE.passou;

    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoC.passou) partesMotivo.push(condicaoC.motivo);
    if (!condicaoE.passou) partesMotivo.push(condicaoE.motivo);
    if (todasPassaram) {
      partesMotivo.push(`Tudo OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras`);
      if (anoTorrent && anoTmdb) partesMotivo.push(`ano ${anoTorrent}=${anoTmdb}`);
    }

    const resultado: SmartTitleMatch = {
      matches: todasPassaram,
      similarity: todasPassaram ? 1 : 0,
      reason: partesMotivo.join(' | '),
    };

    const statusCondicoes = `A:${condicaoA.passou ? 'OK' : 'X'} C:${condicaoC.passou ? 'OK' : 'X'} E:${condicaoE.passou ? 'OK' : 'X'}`;
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

    if (tituloTorrent && isCollectionTitle(tituloTorrent)) {
      if (melhor.encontradas >= 2 && extras <= 4) {
        const motivo = `Coletânea: ${melhor.encontradas}/${melhor.totalTmdb} palavras da franquia${extras > 0 ? ` +${extras} extra(s)` : ''}${semAno ? ' [sem ano]' : ''}`;
        this.logger.debug(`Coletânea aceita: ${motivo}`);
        return { passou: true, motivo };
      }
      const motivo = `Coletânea: match baixo ${melhor.encontradas}/${melhor.totalTmdb} palavras. Faltando: [${melhor.faltando.join(', ')}]`;
      this.logger.debug(`Coletânea rejeitada: ${motivo}`);
      return { passou: false, motivo };
    }

    if (semAno && extras > 0 && temporadaAlvo !== undefined && tituloTorrent) {
      if (this.temTemporadaExplicita(tituloTorrent, temporadaAlvo)) {
        if (extras <= 3 && melhor.encontradas >= melhor.totalTmdb) {
          const motivo = `Pack temporada S${temporadaAlvo} sem ano — ${extras} extras aceitas`;
          this.logger.debug(`Pack aceito: ${motivo}`);
          return { passou: true, motivo };
        }
      }
    }

    if (semAno && extras > 0) {
      const motivo = `Sem ano para validar + ${extras} palavra(s) extra(s) no torrent → título diferente`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    if (!semAno && melhor.totalTmdb <= 2 && anoTorrent !== anoTmdb && extras > 0) {
      const motivo = `Título curto (${melhor.totalTmdb}pal) + ano ${anoTorrent}≠${anoTmdb} + ${extras} extra(s) → provável outro filme`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    const anoExato = !semAno && Math.abs(anoTorrent! - anoTmdb!) <= 1;
    let maxExtras = anoExato ? 4 : 2;

    if (melhor.totalTmdb <= 2) {
      maxExtras = anoExato ? 1 : 0;
    }

    if (!semAno && melhor.totalTmdb <= 2 && anoTorrent !== anoTmdb && !anoExato) {
      const motivo = `Título curto (${melhor.totalTmdb}pal) + ano divergente: ${anoTorrent}≠${anoTmdb} → conteúdo diferente`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    if (melhor.faltando.length === 0 && melhor.proporcao >= 0.6 && extras <= maxExtras) {
      const motivo = `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%)${extras > 0 ? ` +${extras} extra(s)` : ''}${anoExato ? ' [ano exato]' : ''}`;
      this.logger.debug(`Aceito: ${motivo}`);
      return { passou: true, motivo };
    }

    if (melhor.faltando.length === 1 && melhor.palavrasTmdb.length >= 3 && extras <= 2) {
      const palavra = melhor.faltando[0];
      const isNumero = /^\d+$/.test(palavra);
      if (!isNumero && palavra.length <= 3 && melhor.proporcao >= 0.6) {
        const motivo = `Palavra-cola: "${palavra}" (<=3), ${melhor.encontradas}/${melhor.totalTmdb} palavras`;
        this.logger.debug(`Aceito por palavra-cola: ${motivo}`);
        return { passou: true, motivo };
      }
    }

    if (extras > 2) {
      const motivo = `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%). +${extras} extras no torrent`;
      this.logger.debug(`Rejeitado: ${motivo}`);
      return { passou: false, motivo };
    }

    if (anoExato && extras === 0 && melhor.faltando.length <= 2 && melhor.encontradas >= 2) {
      const motivo = `Ano exato (${anoTorrent}=${anoTmdb}): ${melhor.encontradas}/${melhor.totalTmdb} palavras`;
      this.logger.debug(`Aceito por ano exato: ${motivo}`);
      return { passou: true, motivo };
    }

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

  /**
   * Validação de temporada – agora delegando ao TechnicalWords
   * extrairRangeEpisodios para detectar indicadores como "2ª Temporada".
   */
  private validarTemporada(
    tituloTorrent: string,
    temporadaAlvo?: number
  ): { passou: boolean; motivo: string } {
    this.logger.debug(`Validando temporada para: "${tituloTorrent.substring(0, 70)}" alvo S${temporadaAlvo}`);

    // --- FILME (temporadaAlvo undefined) ---
    if (temporadaAlvo === undefined) {
      // Usa extrairRangeEpisodios para capturar "2ª Temporada", "Season 2", etc.
      const range = extrairRangeEpisodios(tituloTorrent);
      if (range && range.season > 0) {
        return {
          passou: false,
          motivo: `Indicador de temporada (S${range.season}) em filme`,
        };
      }
      // Mantém a verificação antiga para SxxExx explícito
      const temEpisodio = /\bs\d{1,2}\s*e\d{1,3}\b/i.test(tituloTorrent);
      if (temEpisodio) {
        return { passou: false, motivo: 'SxxExx em filme — provável episódio de série' };
      }
      return { passou: true, motivo: '' };
    }

    // --- SÉRIE (temporadaAlvo definida) ---
    const epRange = extrairRangeEpisodios(tituloTorrent);
    if (epRange) {
      const passou = epRange.season === temporadaAlvo;
      if (!passou) {
        this.logger.debug(`Temporada detectada: S${epRange.season} vs alvo S${temporadaAlvo}`);
      }
      return {
        passou,
        motivo: passou ? '' : `Temporada divergente: S${epRange.season} vs S${temporadaAlvo}`,
      };
    }

    const sMatch = tituloTorrent.match(/\bs(\d{1,2})\b(?!\s*e\d)/i);
    if (sMatch) {
      const ts = parseInt(sMatch[1]);
      if (ts !== temporadaAlvo) {
        this.logger.debug(`Temporada via regex: S${ts} vs alvo S${temporadaAlvo}`);
      }
      return {
        passou: ts === temporadaAlvo,
        motivo: ts !== temporadaAlvo ? `Temporada divergente: S${ts} vs S${temporadaAlvo}` : '',
      };
    }

    return { passou: true, motivo: '' };
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