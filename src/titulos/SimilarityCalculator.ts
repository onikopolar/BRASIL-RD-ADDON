import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';

export class SimilarityCalculator {
  private readonly logger: Logger;
  private readonly tmdbScraper: ImdbScraperService | null;
  private readonly languageDetector: LanguageDetector;

  private readonly tmdbCache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;

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
  }

  async smartTitleContainsCheck(
    torrentTitle: string,
    imdbId: string,
    torrentMetadata?: { year?: number; season?: number }
  ): Promise<SmartTitleMatch> {
    let movieInfo: {
      portugueseTitle: string | null;
      originalTitle: string;
      year?: number;
      allTitles: string[];
      mediaType?: 'movie' | 'tv';
      belongsToCollection?: any;
    } | null = null;

    if (this.tmdbScraper) {
      try {
        const season = torrentMetadata?.season;
        const cacheKey = season ? `tmdb-${imdbId}:s${season}` : `tmdb-${imdbId}`;
        const cached = this.tmdbCache.get(cacheKey);
        let tmdbData;
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
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
          belongsToCollection: tmdbData.belongsToCollection
        };
      } catch (error) {
        this.logger.error('Erro ao buscar TMDB', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
      }
    }

    if (!movieInfo) {
      return { matches: false, similarity: 0, reason: 'Sem dados do TMDB' };
    }

    const torqueYear = torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);

    // ═══ NOVA ABORDAGEM: comparação palavra-por-palavra com ano/temporada inline ═══
    const resultado = this.comparacaoPalavraPorPalavra(
      torrentTitle,
      movieInfo,
      torqueYear,
      torrentMetadata?.season
    );
    // Inclui mediaType para que o chamador possa validar movie vs série
    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  /**
   * CORE: comparação palavra-por-palavra com ano e temporada inline.
   * 
   * PASSO 1: Itera palavras do TORRENT → coleta palavras estranhas
   * PASSO 2: Itera CADA título TMDB → acha o melhor match
   * DECISÃO: ano + temporada + palavras → tudo unificado
   */
  private comparacaoPalavraPorPalavra(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    anoTorrent: number | null,
    temporadaAlvo?: number
  ): SmartTitleMatch {
    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    // PASSO 1: Normaliza palavras do torrent → Set (sem limite de tamanho)
    const palavrasTorrent = this.normalizarParaComparacao(tituloTorrent)
      .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));
    const setTorrent = new Set(palavrasTorrent);

    // PASSO 2: Compara contra CADA titulo TMDB individualmente (PT e EN separados)
    // Usa o MELHOR score — evita o problema da uniao PT+EN onde um torrent PT sempre "faltava" palavras EN e vice-versa.
    interface ScoreTitulo {
      titulo: string;
      encontradas: number;
      faltando: string[];
      estranhas: string[];
      totalTmdb: number;
      tmdbCompleto: boolean;
      proporcao: number;
    }

    let melhor: ScoreTitulo = {
      titulo: '',
      encontradas: 0,
      faltando: [],
      estranhas: [],
      totalTmdb: 0,
      tmdbCompleto: false,
      proporcao: 0,
    };

    let t = 0;
    while (t < titulosValidos.length) {
      const normalizado = this.normalizarParaComparacao(titulosValidos[t])
        .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));
      const setTitulo = new Set(normalizado);

      // Conta encontradas/faltando: itera palavras do TITULO TMDB contra setTorrent
      let enc = 0;
      const falt: string[] = [];
      const tituloArray = Array.from(setTitulo);
      let k = 0;
      while (k < tituloArray.length) {
        const palavra = tituloArray[k];
        if (setTorrent.has(palavra)) {
          enc++;
        } else {
          falt.push(palavra);
        }
        k++;
      }

      // Conta estranhas: itera palavras do TORRENT contra setTitulo
      const estr: string[] = [];
      let i = 0;
      while (i < palavrasTorrent.length) {
        const palavra = palavrasTorrent[i];
        if (!setTitulo.has(palavra)) {
          estr.push(palavra);
        }
        i++;
      }

      const total = setTitulo.size;
      const completo = falt.length === 0;
      const prop = total > 0 ? enc / total : 0;

      const score: ScoreTitulo = {
        titulo: titulosValidos[t].substring(0, 40),
        encontradas: enc,
        faltando: falt,
        estranhas: estr,
        totalTmdb: total,
        tmdbCompleto: completo,
        proporcao: prop,
      };

      // Seleciona o melhor: titulo completo > menos estranhas > mais encontradas
      if (t === 0) {
        melhor = score;
      } else if (
        (score.tmdbCompleto && !melhor.tmdbCompleto) ||
        (score.tmdbCompleto === melhor.tmdbCompleto && score.estranhas.length < melhor.estranhas.length) ||
        (score.tmdbCompleto === melhor.tmdbCompleto && score.estranhas.length === melhor.estranhas.length && score.encontradas > melhor.encontradas)
      ) {
        melhor = score;
      }

      // // DEBUG: score individual de cada titulo TMDB
      // this.logger.debug('Score por titulo TMDB', {
      //   titulo: score.titulo,
      //   encontradas: `${score.encontradas}/${score.totalTmdb}`,
      //   completo: score.tmdbCompleto,
      //   faltando: score.faltando.join(' ') || '(nenhuma)',
      //   estranhas: score.estranhas.join(' ') || '(nenhuma)',
      //   proporcao: score.proporcao.toFixed(2),
      //   escolhido: melhor === score ? 'SIM' : 'nao',
      // });

      t++;
    }

    // PASSO 3: fallback — se nenhum titulo teve match, usa o ultimo (melhor.encontradas === 0)
    const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
    const anoTmdb = movieInfo.year;

    // ═══════════════════════════════════════════
    // REGRAS DE DECISAO — if/else if em decadencia
    //
    // Ordem: rejeicoes primeiro, depois aceitacoes fortes,
    //        depois contextuais, depois rejeicoes finais.
    // Cada regra tem peso proprio — a primeira que bater vence.
    // ═══════════════════════════════════════════

    const anoBate = !!(anoTorrent && anoTmdb && anoTorrent === anoTmdb);
    const anoProximo = !!(anoTorrent && anoTmdb && Math.abs(anoTmdb - anoTorrent) <= 2);
    const temIndicadorPt = this.languageDetector.isPortugueseContent(tituloTorrent);

    // ── REGRAS DE DECISAO — if/else if em decadencia ──────────────────

    let resultado: SmartTitleMatch;

    if (melhor.encontradas === 0) {
      resultado = { matches: false, similarity: 0, reason: 'Nenhuma palavra TMDB' };
    }
    else if (!melhor.tmdbCompleto && melhor.estranhas.length > 0) {
      resultado = { matches: false, similarity: 0.4, reason: `Faltam: [${melhor.faltando.join(', ')}] + estranhas: [${melhor.estranhas.join(', ')}]` };
    }
    else if (melhor.tmdbCompleto && melhor.estranhas.length > 0 && melhor.totalTmdb <= 2) {
      resultado = { matches: false, similarity: 0.5, reason: `TMDB curto + estranha: [${melhor.estranhas.join(', ')}]` };
    }
    else if (anoBate && temIndicadorPt && melhor.encontradas >= 2) {
      resultado = { matches: true, similarity: melhor.proporcao, reason: `Ano bate (${anoTorrent}) + PT + ${melhor.encontradas}/${melhor.totalTmdb} palavras` };
    }
    else if (anoBate && melhor.tmdbCompleto) {
      resultado = { matches: true, similarity: melhor.proporcao, reason: `Ano bate (${anoTorrent}) + match completo ${melhor.encontradas}/${melhor.totalTmdb}` };
    }
    else if (anoProximo && temIndicadorPt && melhor.encontradas >= 2) {
      resultado = { matches: true, similarity: melhor.proporcao, reason: `Ano proximo (${anoTorrent}~=${anoTmdb}) + PT + ${melhor.encontradas}/${melhor.totalTmdb}` };
    }
    else if (melhor.tmdbCompleto && melhor.estranhas.length === 0) {
      resultado = { matches: true, similarity: 1.0, reason: `Match completo: ${melhor.encontradas}/${melhor.totalTmdb} palavras` };
    }
    else if (melhor.tmdbCompleto && melhor.estranhas.length > 0) {
      resultado = { matches: true, similarity: 0.75, reason: `TMDB completo + extras: [${melhor.estranhas.join(', ')}]` };
    }
    else if (movieInfo.mediaType === 'tv' && temTemporada && melhor.estranhas.length === 0) {
      resultado = { matches: true, similarity: melhor.proporcao, reason: `Serie S${temporadaAlvo} explicita + ${melhor.encontradas}/${melhor.totalTmdb} (sem estranhas)` };
    }
    else if (temIndicadorPt && melhor.tmdbCompleto) {
      resultado = { matches: true, similarity: melhor.proporcao, reason: `PT + match completo ${melhor.encontradas}/${melhor.totalTmdb}` };
    }
    else if (anoTorrent && anoTmdb && anoTorrent !== anoTmdb && !temIndicadorPt) {
      resultado = { matches: false, similarity: melhor.proporcao * 0.6, reason: `Ano diferente: TMDB ${anoTmdb} != ${anoTorrent} (sem PT)` };
    }
    else if (melhor.encontradas < 2) {
      resultado = { matches: false, similarity: melhor.proporcao, reason: `Match insuficiente: [${melhor.encontradas}/${melhor.totalTmdb}]` };
    }
    else {
      resultado = { matches: true, similarity: melhor.proporcao, reason: `Match parcial: [${melhor.encontradas}/${melhor.totalTmdb}]` };
    }

    // // ── DEBUG: log completo da comparacao ─────────────────────────────
    // this.logger.debug('Similaridade calculada', {
    //   torrent: tituloTorrent.substring(0, 60),
    //   palavrasTorrent: palavrasTorrent.join(' '),
    //   tituloVencedor: melhor.titulo || 'N/A',
    //   palavrasTmdb: Array.from(new Set(
    //     titulosValidos.flatMap(tv =>
    //       this.normalizarParaComparacao(tv).split(' ').filter(w => w.length > 0)
    //     )
    //   )).join(' '),
    //   encontradas: melhor.encontradas,
    //   totalTmdb: melhor.totalTmdb,
    //   faltando: melhor.faltando.join(' '),
    //   estranhas: melhor.estranhas.join(' '),
    //   anoBate,
    //   anoProximo,
    //   temPt: temIndicadorPt,
    //   temTemporada,
    //   mediaType: movieInfo.mediaType || 'N/A',
    //   resultado: resultado.matches ? 'ACEITO' : 'REJEITADO',
    //   motivo: resultado.reason
    // });

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  private temTemporadaExplicita(titulo: string, temporada: number): boolean {
    const lower = titulo.toLowerCase();
    const padroes = [`s${temporada.toString().padStart(2, '0')}`, `s${temporada}`, `season ${temporada}`, `temporada ${temporada}`, `temporada ${temporada}ª`, ` ${temporada}ª temporada`, `t${temporada}`, `t${temporada.toString().padStart(2, '0')}`];
    return padroes.some(p => lower.includes(p));
  }

  private temEpisodioExplicito(titulo: string): boolean {
    return /\be\d{1,10}\b|\bep\d{1,10}\b|\bepisode \d{1,10}\b|\bepisódio \d{1,10}\b/i.test(titulo);
  }

  normalizarParaComparacao(titulo: string): string {
    return titulo
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&[AEIOUYaeiouy](?:grave|acute|circ|tilde|uml|ring|cedil|slash);/g, ' ')
      .replace(/&(?:ndash|mdash|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|hellip);/g, ' ')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[\/\.\-_:]/g, ' ')
      // Remove padrões técnicos que não são palavras puras
      .replace(/\b\d{3,4}[pi]\b/gi, ' ').replace(/\b[0-9]+k\b/gi, ' ').replace(/\b[hx]\d{3}\b/gi, ' ')
      .replace(/\b\d+\.\d+(?:ch)?\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extrairAnoDoTitulo(titulo: string): number | null {
    const m = titulo.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : null;
  }

  getStats() {
    return {
      algoritmo: 'comparação palavra-por-palavra com ano/temporada inline',
      regras: [
        'ano bate → match forte (>=70%)',
        'ano diferente → rejeitar (tolerância ±2a)',
        'temporada explícita → bypass ano',
        'match completo + estranhas → aceitar',
        'faltam TMDB + estranhas → rejeitar'
      ]
    };
  }
}

export type { SmartTitleMatch };