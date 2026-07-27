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

    // PASSO 1: Normaliza palavras do torrent → Set
    const palavrasTorrent = this.normalizarParaComparacao(tituloTorrent)
      .split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
    const setTorrent = new Set(palavrasTorrent);

    // PASSO 2: UNIÃO de TODAS as palavras de TODOS os títulos TMDB
    //    Não escolhe o "melhor" título — usa o contexto completo.
    const tmdbUniao = new Set<string>();
    let t = 0;
    while (t < titulosValidos.length) {
      const normalizado = this.normalizarParaComparacao(titulosValidos[t]).split(' ');
      let w = 0;
      while (w < normalizado.length) {
        const palavra = normalizado[w];
        if (palavra.length > 2 && !/^\d+$/.test(palavra)) {
          tmdbUniao.add(palavra);
        }
        w++;
      }
      t++;
    }

    // PASSO 3: Palavras estranhas (torrent → união TMDB)
    const palavrasEstranhas: string[] = [];
    let i = 0;
    while (i < palavrasTorrent.length) {
      const palavra = palavrasTorrent[i];
      if (!tmdbUniao.has(palavra)) {
        palavrasEstranhas.push(palavra);
      }
      i++;
    }

    // PASSO 4: Conta matched/missing contra a UNIÃO total
    let encontradas = 0;
    const faltando: string[] = [];
    const uniaoArray = Array.from(tmdbUniao);
    let k = 0;
    while (k < uniaoArray.length) {
      const palavra = uniaoArray[k];
      if (setTorrent.has(palavra)) {
        encontradas++;
      } else {
        faltando.push(palavra);
      }
      k++;
    }

    const tmdbCompleto = faltando.length === 0;
    const totalTmdb = tmdbUniao.size;
    const proporcao = totalTmdb > 0 ? encontradas / totalTmdb : 0;
    const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
    const anoTmdb = movieInfo.year;

    // ═══════════════════════════════════════════
    // REGRAS DE DECISÃO — Checklist (SEM thresholds)
    //
    // Cada dado do TMDB vira um par SIM/NAO.
    // O torrent vai passando conforme os checks batem.
    // Nao existe "nota" ou "porcentagem" — ou bateu, ou nao bateu.
    // ═══════════════════════════════════════════

    // 0. Nenhuma palavra encontrada → rejeicao imediata
    if (encontradas === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhuma palavra TMDB' };
    }

    const anoBate = !!(anoTorrent && anoTmdb && anoTorrent === anoTmdb);
    const anoProximo = !!(anoTorrent && anoTmdb && Math.abs(anoTmdb - anoTorrent) <= 2);
    const temIndicadorPt = this.languageDetector.isPortugueseContent(tituloTorrent);
    const temPalavrasSuficientes = encontradas >= 2;
    const temEpisodioExplicito = !!(temporadaAlvo && this.temEpisodioExplicito(tituloTorrent));

    // 1. Ano bate + PT + 2+ palavras → ACEITA
    if (anoBate && temIndicadorPt && temPalavrasSuficientes) {
      return { matches: true, similarity: proporcao, reason: `Ano bate (${anoTorrent}) + PT + ${encontradas}/${totalTmdb} palavras` };
    }

    // 2. Ano bate + TMDB completo (todas palavras encontradas) → ACEITA
    if (anoBate && tmdbCompleto) {
      return { matches: true, similarity: proporcao, reason: `Ano bate (${anoTorrent}) + match completo ${encontradas}/${totalTmdb}` };
    }

    // 3. Ano proximo + PT + 2+ palavras → ACEITA
    if (anoProximo && temIndicadorPt && temPalavrasSuficientes) {
      return { matches: true, similarity: proporcao, reason: `Ano proximo (${anoTorrent}~=${anoTmdb}) + PT + ${encontradas}/${totalTmdb}` };
    }

    // 4. Serie com temporada explicita + 2+ palavras → ACEITA
    if (movieInfo.mediaType === 'tv' && temTemporada && temPalavrasSuficientes) {
      return { matches: true, similarity: proporcao, reason: `Serie S${temporadaAlvo} explicita + ${encontradas}/${totalTmdb}` };
    }

    // 5. PT + TMDB completo → ACEITA (ex: titulo PT bate inteiro)
    if (temIndicadorPt && tmdbCompleto) {
      return { matches: true, similarity: proporcao, reason: `PT + match completo ${encontradas}/${totalTmdb}` };
    }

    // 6. Ano diferente (sem PT, sem palavras) → REJEITAR
    if (anoTorrent && anoTmdb && anoTorrent !== anoTmdb && !temIndicadorPt) {
      return { matches: false, similarity: proporcao * 0.6, reason: `Ano diferente: TMDB ${anoTmdb} != ${anoTorrent} (sem PT)` };
    }

    // ═══ REGRAS DE PALAVRAS (sem ano, sem PT) ═══

    // 7. Match perfeito
    if (tmdbCompleto && palavrasEstranhas.length === 0) {
      return { matches: true, similarity: 1.0, reason: `Match completo: ${encontradas}/${totalTmdb} palavras` };
    }

    // 8. TMDB curto + estranhas → perigoso
    if (tmdbCompleto && palavrasEstranhas.length > 0 && totalTmdb <= 2) {
      return { matches: false, similarity: 0.5, reason: `TMDB curto + estranha: [${palavrasEstranhas.join(', ')}]` };
    }

    // 9. TMDB completo + estranhas → aceita
    if (tmdbCompleto && palavrasEstranhas.length > 0) {
      return { matches: true, similarity: 0.75, reason: `TMDB completo + extras: [${palavrasEstranhas.join(', ')}]` };
    }

    // 10. Faltam TMDB + tem estranhas → rejeitar
    if (!tmdbCompleto && palavrasEstranhas.length > 0) {
      return { matches: false, similarity: 0.4, reason: `Faltam: [${faltando.join(', ')}] + estranhas: [${palavrasEstranhas.join(', ')}]` };
    }

    // 11. Faltam TMDB mas sem estranhas → borderline
    if (encontradas >= 2) {
      return { matches: true, similarity: proporcao, reason: `Match parcial: [${encontradas}/${totalTmdb}]` };
    }
    return { matches: false, similarity: proporcao, reason: `Match insuficiente: [${encontradas}/${totalTmdb}]` };
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