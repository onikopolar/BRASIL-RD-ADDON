import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';

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
    _torrentMetadata?: { year?: number; season?: number },
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
    }

    if (!movieInfo && this.tmdbScraper) {
      try {
        const season = _torrentMetadata?.season;
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

    const torqueYear = _torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);

    // Filtro de idioma
    const tituloParaIdioma = rawTitleForLanguage || torrentTitle;
    const idiomaPre = this.languageDetector.verificarIdioma(tituloParaIdioma);
    if (idiomaPre.palavrasEn.length > 0 && idiomaPre.palavrasPt.length === 0) {
      return { matches: false, similarity: 0, reason: `Idioma internacional: ${idiomaPre.motivo}` };
    }

    const resultado = await this.compararTitulos(
      torrentTitle,
      movieInfo,
      torqueYear,
      _torrentMetadata?.season
    );
    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  private async compararTitulos(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    anoTorrent: number | null,
    _temporadaAlvo?: number
  ): Promise<SmartTitleMatch> {
    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    const palavrasTorrent = this.tokenizar(tituloTorrent);
    if (palavrasTorrent.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio' };
    }

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

    for (const titulo of titulosValidos) {
      const palavrasTitulo = this.tokenizar(titulo);
      const tmdbEhCurto = palavrasTitulo.length <= 2;

      const palavrasParecidas = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (tmdbEhCurto) return false;
        if (a.length < 3 || b.length < 3) return false;
        if (Math.abs(a.length - b.length) > 2) return false;
        const lcs = this.calcularLCS(a, b);
        const minLen = Math.min(a.length, b.length);
        return lcs >= 3 && lcs / minLen >= 0.75;
      };

      let enc = 0;
      const falt: string[] = [];
      for (const palavraTmdb of palavrasTitulo) {
        const match = palavrasTorrent.some(p => palavrasParecidas(palavraTmdb, p));
        if (match) enc++;
        else falt.push(palavraTmdb);
      }

      let extras = 0;
      for (const palavraTorrent of palavrasTorrent) {
        if (palavrasTitulo.some(p => palavrasParecidas(palavraTorrent, p))) continue;
        extras++;
      }

      const totalTorrent = palavrasTorrent.length || 1;
      const proporcao = (enc + (totalTorrent - extras)) / (palavrasTitulo.length + totalTorrent);

      this.logger.debug(`Match "${titulo}" → torrent`, {
        tmdb: palavrasTitulo.join(' '),
        torrent: palavrasTorrent.join(' '),
        tmdbWords: palavrasTitulo.length,
        torrentWords: totalTorrent,
        scoreTMDBtoTorrent: enc,
        faltando: falt.join(','),
        extrasTorrent: extras,
        proporcao: (proporcao * 100).toFixed(0) + '%',
      });

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
      anoTorrent
    );
  }

  private tokenizar(texto: string): string[] {
    const normalizado = this.normalizarParaComparacao(texto);
    return normalizado.split(' ').filter(w => w.length > 0);
  }

  private calcularLCS(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    let prev = new Array(n + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      const curr = new Array(n + 1).fill(0);
      for (let j = 1; j <= n; j++) {
        curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
      }
      prev = curr;
    }
    return prev[n];
  }

  private decidirMatch(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    melhor: { titulo: string; palavrasTmdb: string[]; encontradas: number; faltando: string[]; totalTmdb: number; proporcao: number; extrasTorrent?: number },
    palavrasTorrent: string[],
    _titulosValidos: string[],
    anoTorrent: number | null
  ): SmartTitleMatch {
    const anoTmdb = movieInfo.year;
    const condicaoA = this.validarPalavrasMinimas(melhor);
    const condicaoF = this.validarOrdemPalavras(palavrasTorrent, melhor.palavrasTmdb);

    const todasPassaram = condicaoA.passou && condicaoF.passou;

    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoF.passou) partesMotivo.push(condicaoF.motivo);
    if (todasPassaram) {
      partesMotivo.push(`Tudo OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras`);
      if (anoTorrent && anoTmdb) partesMotivo.push(`ano ${anoTorrent}=${anoTmdb}`);
    }

    const resultado: SmartTitleMatch = {
      matches: todasPassaram,
      similarity: todasPassaram ? 1 : 0,
      reason: partesMotivo.join(' | '),
    };

    if (!todasPassaram) {
      this.logger.debug(`❌ "${tituloTorrent.substring(0, 70)}" | ${partesMotivo.join(' | ')}`);
    } else {
      this.logger.info(`✅ "${tituloTorrent.substring(0, 60)}"`);
    }

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  private validarPalavrasMinimas(
    melhor: { titulo: string; palavrasTmdb: string[]; faltando: string[]; encontradas: number; totalTmdb: number; proporcao: number; extrasTorrent?: number }
  ): { passou: boolean; motivo: string } {
    if (melhor.totalTmdb === 0) return { passou: false, motivo: 'TMDB sem palavras' };

    const extras = melhor.extrasTorrent ?? 0;

    // Títulos muito curtos (1 palavra) devem ser tratados de forma rigorosa
    if (melhor.totalTmdb === 1) {
      if (melhor.faltando.length === 0 && extras === 0 && melhor.proporcao >= 0.6) {
        return { passou: true, motivo: `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%)` };
      }
      return { passou: false, motivo: `Título de 1 palavra com ruído: ${melhor.encontradas}/${melhor.totalTmdb} palavras, ${extras} extra(s)` };
    }

    // Títulos com 2+ palavras
    if (melhor.faltando.length === 0 && extras <= 2) {
      return { passou: true, motivo: `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%)` };
    }

    if (melhor.faltando.length === 1 && melhor.palavrasTmdb.length >= 3 && melhor.faltando[0].length <= 3 && extras <= 2) {
      return { passou: true, motivo: `Palavra-cola: "${melhor.faltando[0]}" (≤3), ${melhor.encontradas}/${melhor.totalTmdb} palavras` };
    }

    if (extras > 3) {
      return { passou: false, motivo: `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%). +${extras} extras no torrent` };
    }

    return { passou: false, motivo: `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%). Faltando: [${melhor.faltando.join(', ')}]` };
  }

  private validarOrdemPalavras(
    palavrasTorrent: string[],
    palavrasTmdb: string[]
  ): { passou: boolean; motivo: string } {
    if (palavrasTmdb.length === 0) return { passou: true, motivo: '' };

    const idxTorrent = palavrasTorrent.findIndex(p => p === palavrasTmdb[0]);
    if (idxTorrent === -1) {
      return { passou: false, motivo: `Ordem das palavras quebrada: esperado [${palavrasTmdb.join(' ')}]` };
    }

    let idxTmdb = 1;
    for (let i = idxTorrent + 1; i < palavrasTorrent.length && idxTmdb < palavrasTmdb.length; i++) {
      if (palavrasTorrent[i] === palavrasTmdb[idxTmdb]) idxTmdb++;
    }

    if (idxTmdb === palavrasTmdb.length) {
      return { passou: true, motivo: 'Ordem das palavras OK' };
    } else {
      return { passou: false, motivo: `Ordem das palavras quebrada: esperado [${palavrasTmdb.join(' ')}]` };
    }
  }

  private normalizarParaComparacao(titulo: string): string {
    return titulo
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extrairAnoDoTitulo(titulo: string): number | null {
    const anos = titulo.match(/\b(19|20)\d{2}\b/g);
    if (!anos || anos.length === 0) return null;
    const primeiroNumero = titulo.match(/\b\d{4}\b/);
    if (primeiroNumero && anos[0] === primeiroNumero[0] && anos.length > 1) return parseInt(anos[1]);
    return parseInt(anos[0]);
  }
}

export type { SmartTitleMatch };