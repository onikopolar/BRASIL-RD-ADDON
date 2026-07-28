import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { getPotentialSequelNumbers } from './TechnicalWords.js';

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

    // Compara palavras do torrent contra cada titulo TMDB e decide com regras unificadas
    const resultado = this.compararTitulos(
      torrentTitle,
      movieInfo,
      torqueYear,
      torrentMetadata?.season
    );
    // Inclui mediaType para que o chamador possa validar movie vs série
    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  /** Compara palavras do torrent contra cada titulo TMDB e escolhe o melhor match */
  private compararTitulos(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    anoTorrent: number | null,
    temporadaAlvo?: number
  ): SmartTitleMatch {
    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    // Quebra titulo do torrent em palavras (sem numeros soltos)
    const palavrasTorrent = this.normalizarParaComparacao(tituloTorrent)
      .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));
    const setTorrent = new Set(palavrasTorrent);

    // Compara contra cada titulo TMDB (PT e EN) e escolhe o melhor
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

      // Palavras do TMDB que estao (ou nao) no torrent
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

      // Palavras do torrent que NAO estao no titulo TMDB
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

      // Criterio: completo > menos extras > mais palavras
      if (t === 0) {
        melhor = score;
      } else if (
        (score.tmdbCompleto && !melhor.tmdbCompleto) ||
        (score.tmdbCompleto === melhor.tmdbCompleto && score.estranhas.length < melhor.estranhas.length) ||
        (score.tmdbCompleto === melhor.tmdbCompleto && score.estranhas.length === melhor.estranhas.length && score.encontradas > melhor.encontradas)
      ) {
        melhor = score;
      }

      t++;
    }

    // Decide se aceita ou rejeita usando as 3 condicoes unificadas (A && B && C)
    const resultado = this.decidirMatch(
      tituloTorrent,
      movieInfo,
      melhor,
      palavrasTorrent,
      titulosValidos,
      anoTorrent,
      temporadaAlvo
    );

    return resultado;
  }


  /** Decide se aceita o torrent com 3 condicoes unificadas (A && B && C). Se qualquer uma falhar, rejeita. */
  private decidirMatch(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    melhor: { titulo: string; encontradas: number; faltando: string[]; estranhas: string[]; totalTmdb: number; tmdbCompleto: boolean; proporcao: number },
    palavrasTorrent: string[],
    titulosValidos: string[],
    anoTorrent: number | null,
    temporadaAlvo?: number
  ): SmartTitleMatch {
    const anoTmdb = movieInfo.year;
    const tipoMidia = movieInfo.mediaType || 'movie';
    const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
    const temIndicadorPt = this.languageDetector.isPortugueseContent(tituloTorrent);

    // Filme tolera 1 ano de diferenca, serie tolera 3
    const toleranciaAno = tipoMidia === 'tv' ? 3 : 1;

    const condicaoA = this.validarPalavrasMinimas(melhor, titulosValidos);
    const condicaoB = this.validarTituloCompleto(melhor);
    const condicaoC = this.validarAnoCompativel(anoTorrent, anoTmdb, toleranciaAno, tipoMidia, temIndicadorPt);
    const condicaoD = this.validarSequencia(tituloTorrent, titulosValidos, anoTorrent);

    const todasPassaram = condicaoA.passou && condicaoB.passou && condicaoC.passou && condicaoD.passou;

    // Monta o motivo juntando as falhas (ou sucessos)
    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoB.passou) partesMotivo.push(condicaoB.motivo);
    if (!condicaoC.passou) partesMotivo.push(condicaoC.motivo);
    if (!condicaoD.passou) partesMotivo.push(condicaoD.motivo);
    if (todasPassaram) {
      partesMotivo.push(`Tudo OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras`);
      if (anoTorrent && anoTmdb) partesMotivo.push(`ano ${anoTorrent}=${anoTmdb}`);
    }

    const similaridade = this.calcularSimilaridade(melhor, anoTorrent, anoTmdb, todasPassaram);

    const resultado: SmartTitleMatch = {
      matches: todasPassaram,
      similarity: similaridade,
      reason: partesMotivo.join(' | '),
    };

    // Log compacto: 1 linha com status das 4 condicoes
    const statusCondicoes = `A:${condicaoA.passou ? 'OK' : 'X'} B:${condicaoB.passou ? 'OK' : 'X'} C:${condicaoC.passou ? 'OK' : 'X'} D:${condicaoD.passou ? 'OK' : 'X'}`;
    if (!todasPassaram) {
      this.logger.debug(`REJEITADO [${statusCondicoes}] sim=${similaridade.toFixed(2)} | "${tituloTorrent.substring(0, 70)}" | ${partesMotivo.filter(p => p.includes('Faltam') || p.includes('insuficientes') || p.includes('divergente') || p.includes('sequencia')).join('; ')}`);
    } else {
      this.logger.debug(`ACEITO [${statusCondicoes}] sim=${similaridade.toFixed(2)} | "${tituloTorrent.substring(0, 70)}"`);
    }

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  /** Exige ao menos 2 palavras do TMDB no torrent (ou 1 se o titulo TMDB for curto) */
  private validarPalavrasMinimas(
    melhor: { encontradas: number; totalTmdb: number; faltando: string[]; estranhas: string[] },
    titulosValidos: string[]
  ): { passou: boolean; motivo: string } {
    // Minimo 2 palavras, mas se TMDB so tem 1 (ex: "Matrix"), reduz para 1
    const minimo = Math.min(2, titulosValidos.reduce((min, t) => {
      const palavras = this.normalizarParaComparacao(t).split(' ').filter(w => w.length > 0 && !(/^\d+$/.test(w)));
      return Math.min(min, palavras.length);
    }, 2));

    if (melhor.encontradas < minimo) {
      return {
        passou: false,
        motivo: `Palavras insuficientes: ${melhor.encontradas}/${melhor.totalTmdb} (minimo ${minimo})`
      };
    }

    return {
      passou: true,
      motivo: `Palavras OK: ${melhor.encontradas}/${melhor.totalTmdb}`
    };
  }

  /** Exige que todas as palavras do titulo TMDB estejam no torrent */
  private validarTituloCompleto(
    melhor: { tmdbCompleto: boolean; faltando: string[]; totalTmdb: number }
  ): { passou: boolean; motivo: string } {
    if (!melhor.tmdbCompleto) {
      return {
        passou: false,
        motivo: `Faltam palavras do TMDB: [${melhor.faltando.join(', ')}]`
      };
    }

    return {
      passou: true,
      motivo: `Titulo completo: ${melhor.totalTmdb}/${melhor.totalTmdb}`
    };
  }

  /** Exige que a diferenca de ano entre torrent e TMDB nao exceda a tolerancia */
  private validarAnoCompativel(
    anoTorrent: number | null,
    anoTmdb: number | undefined,
    tolerancia: number,
    tipoMidia: string,
    temIndicadorPt: boolean
  ): { passou: boolean; motivo: string } {
    // Sem os dois anos para comparar, deixa passar
    if (!anoTorrent || !anoTmdb) {
      return {
        passou: true,
        motivo: `Sem ano para comparar (torrent=${anoTorrent ?? '?'}, tmdb=${anoTmdb ?? '?'})`
      };
    }

    const diferenca = Math.abs(anoTmdb - anoTorrent);

    if (diferenca <= tolerancia) {
      return {
        passou: true,
        motivo: `Ano compativel: ${anoTorrent} vs ${anoTmdb} (dif=${diferenca}, tol=${tolerancia})`
      };
    }

    // Ano muito diferente — rejeita (antes so rejeitava titulos nao-PT, agora sempre)
    return {
      passou: false,
        motivo: `Ano divergente: torrent=${anoTorrent}, TMDB=${anoTmdb} (dif=${diferenca} > tol=${tolerancia}, ${tipoMidia})`
    };
  }

  /** Calcula score final: proporcao de palavras + bonus por titulo completo e ano exato */
  private calcularSimilaridade(
    melhor: { proporcao: number; tmdbCompleto: boolean },
    anoTorrent: number | null,
    anoTmdb: number | undefined,
    todasPassaram: boolean
  ): number {
    if (!todasPassaram) {
      return melhor.proporcao * 0.4;
    }

    let similaridade = melhor.proporcao;

    if (melhor.tmdbCompleto) {
      similaridade = Math.min(1.0, similaridade + 0.15);
    }

    if (anoTorrent && anoTmdb && anoTorrent === anoTmdb) {
      similaridade = Math.min(1.0, similaridade + 0.1);
    }

    return Math.round(similaridade * 100) / 100;
  }

  /**
   * CONDICAO D — Detecta numero de sequencia no titulo
   *
   * Delega a deteccao de contexto tecnico para TechnicalWords.getPotentialSequelNumbers().
   * Numeros que NAO sao tecnicos (audio, qualidade, episodios) e NAO estao nos
   * titulos TMDB sao tratados como indicadores de sequencia.
   */
  private validarSequencia(
    tituloTorrent: string,
    titulosValidos: string[],
    anoTorrent: number | null
  ): { passou: boolean; motivo: string } {
    // TechnicalWords filtra numeros em contexto tecnico (audio, qualidade, range de eps)
    const suspeitos = getPotentialSequelNumbers(tituloTorrent)
      .filter(n => n !== anoTorrent);

    if (suspeitos.length === 0) {
      return { passou: true, motivo: '' };
    }

    // Verifica se algum desses numeros aparece nos titulos TMDB
    const tmdbTemNumero = titulosValidos.some(tv => {
      const norm = this.normalizarParaComparacao(tv);
      const tokensTmdb = norm.split(' ');
      return suspeitos.some(n => tokensTmdb.includes(String(n)));
    });

    if (!tmdbTemNumero) {
      return {
        passou: false,
        motivo: `Numero de sequencia no titulo: ${suspeitos.join(', ')} (nao esta nos titulos TMDB)`
      };
    }

    return { passou: true, motivo: '' };
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
      // Remove termos tecnicos (1080p, 4K, x264, etc)
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
      algoritmo: 'Decisão Unificada (&&) — todas as condições obrigatórias',
      condicoes: [
        'A) Palavras minimas: >=2 palavras do TMDB no torrent (ou >=1 se TMDB curto)',
        'B) Titulo completo: TODAS as palavras do TMDB presentes',
        'C) Ano compativel: |anoTorrent - anoTmdb| <= tolerancia (filme=+-1, serie=+-3)',
        'D) Sem sequencia: numeros 2-19 no titulo que nao estao no TMDB = rejeitar',
      ],
      tolerancias: {
        filme: '±1 ano',
        serie: '±3 anos',
      },
      modelo: 'Unificado com && — se UMA condição falhar, REJEITA',
    };
  }
}

export type { SmartTitleMatch };