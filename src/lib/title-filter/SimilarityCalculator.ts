import { Logger } from '../../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService } from '../../services/ImdbScraperService.js';

export class SimilarityCalculator {
  private readonly logger: Logger;
  private readonly tmdbScraper: ImdbScraperService | null;

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

    const torrentYear = torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);

    // ═══ NOVA ABORDAGEM: comparação palavra-por-palavra com ano/temporada inline ═══
    return this.comparacaoPalavraPorPalavra(
      torrentTitle,
      movieInfo,
      torrentYear,
      torrentMetadata?.season
    );
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

    // Coleta TODAS as palavras de TODOS os títulos TMDB
    const todasPalavrasTmdb = new Set<string>();
    for (const titulo of titulosValidos) {
      for (const palavra of this.normalizarParaComparacao(titulo).split(' ')) {
        if (palavra.length > 2 && !/^\d+$/.test(palavra)) {
          todasPalavrasTmdb.add(palavra);
        }
      }
    }

    // ═══ PASSO 2: Palavras estranhas (torrent → TMDB) ═══
    const palavrasEstranhas: string[] = [];
    for (const palavra of palavrasTorrent) {
      if (!todasPalavrasTmdb.has(palavra)) {
        palavrasEstranhas.push(palavra);
      }
    }

    // ═══ PASSO 3: Melhor título TMDB (TMDB → torrent) ═══
    let melhorTitulo = '';
    let melhorEncontradas = 0;
    let melhorTotal = 0;
    let melhorFaltando: string[] = [];

    for (const titulo of titulosValidos) {
      const palavrasTmdb: string[] = [];
      for (const palavra of this.normalizarParaComparacao(titulo).split(' ')) {
        if (palavra.length > 2 && !/^\d+$/.test(palavra)) {
          palavrasTmdb.push(palavra);
        }
      }

      let encontradas = 0;
      const faltando: string[] = [];
      for (const palavra of palavrasTmdb) {
        if (setTorrent.has(palavra)) {
          encontradas++;
        } else {
          faltando.push(palavra);
        }
      }

      if (encontradas > melhorEncontradas || (encontradas === melhorEncontradas && faltando.length < melhorFaltando.length)) {
        melhorEncontradas = encontradas;
        melhorTotal = palavrasTmdb.length;
        melhorFaltando = faltando;
        melhorTitulo = titulo;
      }
    }

    const tmdbCompleto = melhorFaltando.length === 0;
    const proporcao = melhorTotal > 0 ? melhorEncontradas / melhorTotal : 0;
    const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
    const anoTmdb = movieInfo.year;

    // ═══════════════════════════════════════════
    // REGRAS DE DECISÃO (ano + palavras, tudo inline)
    // ═══════════════════════════════════════════

    // 0. Nenhuma palavra encontrada
    if (melhorEncontradas === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhuma palavra TMDB' };
    }

    // 1. Ano diferente → rejeitar (pequena tolerância de 2 anos)
    if (anoTorrent && anoTmdb && anoTorrent !== anoTmdb) {
      const diferenca = Math.abs(anoTmdb - anoTorrent);
      if (diferenca <= 2 && proporcao >= 0.85) {
        return { matches: true, similarity: proporcao, reason: `Match + ano próximo (${diferenca}a): "${melhorTitulo}"` };
      }
      return { matches: false, similarity: proporcao * 0.6, reason: `Ano diferente: TMDB ${anoTmdb} != ${anoTorrent}` };
    }

    // 1.5 ⭐ Ano bate exatamente → sinal fortíssimo, ignora palavras estranhas/faltando
    if (anoTorrent && anoTmdb && anoTorrent === anoTmdb && proporcao >= 0.7) {
      return { matches: true, similarity: proporcao, reason: `Ano bate (${anoTorrent}) + match ${melhorEncontradas}/${melhorTotal}: "${melhorTitulo}"` };
    }

    // 2. Sem ano no torrent
    if (!anoTorrent) {
      // Série com temporada explícita → bypass do ano
      if (movieInfo.mediaType === 'tv' && temTemporada) {
        if (proporcao >= 0.65) {
          return { matches: true, similarity: proporcao, reason: `Série S${temporadaAlvo} explícita: "${melhorTitulo}"` };
        }
        return { matches: false, similarity: proporcao * 0.5, reason: `Série S${temporadaAlvo} com match baixo: ${melhorEncontradas}/${melhorTotal}` };
      }
      // Similaridade muito alta → dispensa ano
      if (proporcao >= 0.9) {
        return { matches: true, similarity: proporcao, reason: 'Similaridade alta sem ano' };
      }
      return { matches: false, similarity: proporcao * 0.7, reason: `Requer ano. TMDB: ${anoTmdb}` };
    }

    // ═══ REGRAS DE PALAVRAS ═══

    // 3. Match perfeito (todas TMDB + zero estranhas)
    if (tmdbCompleto && palavrasEstranhas.length === 0) {
      return { matches: true, similarity: 1.0, reason: `Match completo: "${melhorTitulo}"` };
    }

    // 4. TMDB curto (≤2 palavras) + estranhas → perigoso (sequência/spin-off?)
    if (tmdbCompleto && palavrasEstranhas.length > 0 && melhorTotal <= 2) {
      return { matches: false, similarity: proporcao * 0.5, reason: `TMDB curto + estranha: [${palavrasEstranhas.join(', ')}]` };
    }

    // 5. TMDB completo + estranhas em título longo → aceita (ruído inofensivo)
    if (tmdbCompleto && palavrasEstranhas.length > 0) {
      return { matches: true, similarity: 0.75, reason: `TMDB completo + extras: [${palavrasEstranhas.join(', ')}]` };
    }

    // 6. Faltam TMDB + tem estranhas → rejeitar (Korra vs Aang, Clone Wars vs SW)
    if (!tmdbCompleto && palavrasEstranhas.length > 0) {
      return { matches: false, similarity: proporcao * 0.4, reason: `Faltam: [${melhorFaltando.join(', ')}] + estranhas: [${palavrasEstranhas.join(', ')}]` };
    }

    // 7. Faltam TMDB mas sem estranhas → borderline (proporção decide)
    if (proporcao >= 0.6) {
      return { matches: true, similarity: proporcao, reason: `Match parcial: [${melhorEncontradas}/${melhorTotal}] "${melhorTitulo}"` };
    }
    return { matches: false, similarity: proporcao, reason: `Match insuficiente: [${melhorEncontradas}/${melhorTotal}] "${melhorTitulo}"` };
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