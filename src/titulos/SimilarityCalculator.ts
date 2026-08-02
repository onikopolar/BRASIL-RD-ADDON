import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { getPotentialSequelNumbers, extrairRangeEpisodios, isTechnicalWord, isCollectionTitle } from './TechnicalWords.js';

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

    // Early reject: idioma internacional explícito
    const idiomaPre = this.languageDetector.verificarIdioma(torrentTitle);
    if (idiomaPre.palavrasEn.length > 0 && idiomaPre.palavrasPt.length === 0) {
      return { matches: false, similarity: 0, reason: `Idioma internacional: ${idiomaPre.motivo}` };
    }

    const resultado = await this.compararTitulos(
      torrentTitle,
      movieInfo,
      torqueYear,
      torrentMetadata?.season
    );
    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  private async compararTitulos(
    tituloTorrent: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    anoTorrent: number | null,
    temporadaAlvo?: number
  ): Promise<SmartTitleMatch> {
    const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (titulosValidos.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    // Normalização leve: lowercase + split, sem filtro de palavras técnicas
    const tokenizar = (txt: string) => txt.toLowerCase()
      .replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));

    const palavrasTorrent = tokenizar(tituloTorrent);
    if (palavrasTorrent.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio' };
    }

    interface ScoreTitulo {
      titulo: string; palavrasTmdb: string[]; encontradas: number;
      faltando: string[]; totalTmdb: number; proporcao: number;
      extrasTorrent: number;
    }

    let melhor: ScoreTitulo = {
      titulo: '', palavrasTmdb: [], encontradas: 0, faltando: [], totalTmdb: 0, proporcao: 0,
      extrasTorrent: 0,
    };

    for (let t = 0; t < titulosValidos.length; t++) {
      const palavrasTitulo = tokenizar(titulosValidos[t]);

      // Helper: duas palavras são "parecidas"? Match exato OU LCS cobre ≥75% da menor (mín 3 chars)
      const tmdbEhCurto = palavrasTitulo.length <= 2;
      const palavrasParecidas = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (tmdbEhCurto) return false;
        if (a.length < 3 || b.length < 3) return false;
        // Só faz fuzzy se as palavras tiverem tamanhos próximos (dif ≤ 2)
        if (Math.abs(a.length - b.length) > 2) return false;
        const lcs = this.calcularLCS(a, b);
        const minLen = Math.min(a.length, b.length);
        return lcs >= 3 && lcs / minLen >= 0.75;
      };

      // TMDB → Torrent
      let enc = 0;
      const falt: string[] = [];
      for (const palavraTmdb of palavrasTitulo) {
        const match = palavrasTorrent.some(p => palavrasParecidas(palavraTmdb, p));
        if (match) {
          enc += 1;
        } else {
          falt.push(palavraTmdb);
        }
      }

      // Torrent → TMDB: conta palavras extras (não-técnicas, não-match, não-episódio)
      let extras = 0;
      for (const palavraTorrent of palavrasTorrent) {
        if (isTechnicalWord(palavraTorrent)) continue;
        if (palavrasTitulo.some(p => palavrasParecidas(palavraTorrent, p))) continue;
        if (extrairRangeEpisodios(palavraTorrent) !== null) continue;
        if (palavraTorrent.length <= 2) { extras++; continue; }
        extras++;
      }

      const totalTorrent = palavrasTorrent.filter(w => !isTechnicalWord(w)).length || 1;
      const proporcao = (enc + (totalTorrent - extras)) / (palavrasTitulo.length + totalTorrent);

      this.logger.debug(`Match "${titulosValidos[t]}" → torrent`, {
        tmdb: palavrasTitulo.join(' '),
        torrent: palavrasTorrent.join(' '),
        tmdbWords: palavrasTitulo.length,
        torrentWords: totalTorrent,
        scoreTMDBtoTorrent: enc.toFixed(1),
        faltando: falt.join(','),
        extrasTorrent: extras,
        proporcao: (proporcao * 100).toFixed(0) + '%',
      });

      const score: ScoreTitulo = {
        titulo: titulosValidos[t], palavrasTmdb: palavrasTitulo,
        encontradas: enc, faltando: falt, totalTmdb: palavrasTitulo.length,
        proporcao, extrasTorrent: extras,
      };

      if (t === 0 || score.proporcao > melhor.proporcao) {
        melhor = score;
      }
    }

    return this.decidirMatch(
      tituloTorrent, movieInfo, melhor, palavrasTorrent, titulosValidos, anoTorrent, temporadaAlvo
    );
  }

  private calcularLCS(a: string, b: string): number {
    const m = a.length, n = b.length;
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
    melhor: { titulo: string; palavrasTmdb: string[]; encontradas: number; faltando: string[]; totalTmdb: number; proporcao: number },
    palavrasTorrent: string[],
    titulosValidos: string[],
    anoTorrent: number | null,
    temporadaAlvo?: number
  ): SmartTitleMatch {
    const anoTmdb = movieInfo.year;
    const tipoMidia = movieInfo.mediaType || 'movie';

    const isColecao = isCollectionTitle(tituloTorrent);
    const toleranciaAno = isColecao ? 10 : (tipoMidia === 'tv' ? 15 : 2);   // filmes: tolerância de 2 anos

    const condicaoA = this.validarPalavrasMinimas(melhor, anoTorrent, anoTmdb, tituloTorrent);
    const condicaoB = this.validarTituloCompleto(melhor);
    const condicaoC = this.validarAnoCompativel(anoTorrent, anoTmdb, toleranciaAno, tipoMidia, movieInfo, tituloTorrent);
    const condicaoD = isColecao ? { passou: true, motivo: 'Coletânea: sequência ignorada' } : this.validarSequencia(tituloTorrent, titulosValidos, anoTorrent, tipoMidia);
    const condicaoE = this.validarTemporada(tituloTorrent, temporadaAlvo);
    const condicaoF = this.validarOrdemPalavras(palavrasTorrent, melhor.palavrasTmdb);
    const condicaoG = isColecao ? { passou: true, motivo: 'Coletânea: número ignorado' } : this.validarSequenciaNumero(tituloTorrent, palavrasTorrent, titulosValidos);

    const todasPassaram = condicaoA.passou && condicaoC.passou && condicaoD.passou && condicaoE.passou && condicaoF.passou && condicaoG.passou;

    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoB.passou) partesMotivo.push(condicaoB.motivo);
    if (!condicaoC.passou) partesMotivo.push(condicaoC.motivo);
    if (!condicaoD.passou) partesMotivo.push(condicaoD.motivo);
    if (!condicaoE.passou) partesMotivo.push(condicaoE.motivo);
    if (!condicaoF.passou) partesMotivo.push(condicaoF.motivo);
    if (!condicaoG.passou) partesMotivo.push(condicaoG.motivo);
    if (todasPassaram) {
      partesMotivo.push(`Tudo OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras`);
      if (anoTorrent && anoTmdb) partesMotivo.push(`ano ${anoTorrent}=${anoTmdb}`);
    }

    const similaridade = todasPassaram ? 1 : 0;

    const resultado: SmartTitleMatch = {
      matches: todasPassaram,
      similarity: similaridade,
      reason: partesMotivo.join(' | '),
    };

    const statusCondicoes = `A:${condicaoA.passou ? 'OK' : 'X'} C:${condicaoC.passou ? 'OK' : 'X'} D:${condicaoD.passou ? 'OK' : 'X'} E:${condicaoE.passou ? 'OK' : 'X'} F:${condicaoF.passou ? 'OK' : 'X'} G:${condicaoG.passou ? 'OK' : 'X'}`;
    if (!todasPassaram) {
      this.logger.debug(`❌ [${statusCondicoes}] "${tituloTorrent.substring(0, 70)}" | ${partesMotivo.join(' | ')}`);
    } else {
      this.logger.info(`✅ [${statusCondicoes}] "${tituloTorrent.substring(0, 60)}"`);
    }

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  private validarPalavrasMinimas(
    melhor: { titulo: string; palavrasTmdb: string[]; faltando: string[]; encontradas: number; totalTmdb: number; proporcao: number; extrasTorrent?: number },
    anoTorrent?: number | null,
    anoTmdb?: number,
    tituloTorrent?: string
  ): { passou: boolean; motivo: string } {
    if (melhor.totalTmdb === 0) return { passou: false, motivo: 'TMDB sem palavras' };

    const extras = melhor.extrasTorrent ?? 0;
    const semAno = anoTorrent === null || anoTorrent === undefined || anoTmdb === undefined;

    // Coletânea: threshold relaxado
    if (tituloTorrent && isCollectionTitle(tituloTorrent)) {
      if (melhor.encontradas >= 2 && extras <= 3) {
        return { passou: true, motivo: `Coletânea: ${melhor.encontradas}/${melhor.totalTmdb} palavras da franquia${extras > 0 ? ` +${extras} extra(s)` : ''}` };
      }
      if (semAno && extras > 3) {
        return { passou: false, motivo: `Coletânea sem ano + ${extras} palavra(s) extra(s) → título diferente` };
      }
      return { passou: false, motivo: `Coletânea: match baixo ${melhor.encontradas}/${melhor.totalTmdb} palavras. Faltando: [${melhor.faltando.join(', ')}]` };
    }

    if (semAno && extras > 0) {
      return { passou: false, motivo: `Sem ano para validar + ${extras} palavra(s) extra(s) no torrent → título diferente` };
    }

    // Título TMDB curto (≤2 palavras) + ano divergente → NENHUM extra tolerado
    if (!semAno && melhor.totalTmdb <= 2 && anoTorrent !== anoTmdb && extras > 0) {
      return { passou: false, motivo: `Título curto (${melhor.totalTmdb}pal) + ano ${anoTorrent}≠${anoTmdb} + ${extras} extra(s) → provável outro filme` };
    }

    const anoExato = !semAno && Math.abs(anoTorrent - anoTmdb) <= 1;
    let maxExtras = anoExato ? 4 : 2;

    // Títulos TMDB com 1 ou 2 palavras são mais suscetíveis a falsos positivos: reduzir tolerância de extras
    if (melhor.totalTmdb <= 2) {
      maxExtras = anoExato ? 1 : 0;
    }

    if (melhor.faltando.length === 0 && melhor.proporcao >= 0.6 && extras <= maxExtras) {
      return { passou: true, motivo: `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%)${extras > 0 ? ` +${extras} extra(s)` : ''}${anoExato ? ' [ano exato]' : ''}` };
    }

    if (melhor.faltando.length === 1 && melhor.palavrasTmdb.length >= 3 && extras <= 2) {
      if (melhor.faltando[0].length <= 3 && melhor.proporcao >= 0.6) {
        return { passou: true, motivo: `Palavra-cola: "${melhor.faltando[0]}" (≤3), ${melhor.encontradas}/${melhor.totalTmdb} palavras` };
      }
    }

    if (extras > 2) {
      return { passou: false, motivo: `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%). +${extras} extras no torrent` };
    }

    return { passou: false, motivo: `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao * 100).toFixed(0)}%). Faltando: [${melhor.faltando.join(', ')}]` };
  }

  private validarTituloCompleto(
    melhor: { faltando: string[]; encontradas: number; totalTmdb: number }
  ): { passou: boolean; motivo: string } {
    return {
      passou: true,
      motivo: melhor.faltando.length === 0
        ? `Titulo compativel: ${melhor.encontradas}/${melhor.totalTmdb} palavras`
        : `Palavras faltando: [${melhor.faltando.join(', ')}] — validado por A/C/D/E`
    };
  }

  private validarAnoCompativel(
    anoTorrent: number | null,
    anoTmdb: number | undefined,
    tolerancia: number,
    _tipoMidia: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    tituloTorrent: string
  ): { passou: boolean; motivo: string } {
    // TMDB de 1 palavra: verifica ambiguidade
    let minWords = 99;
    let maxWords = 0;
    for (const t of movieInfo.allTitles) {
      const palavras = this.normalizarParaComparacao(t).split(' ').filter(w => w.length > 0 && !(/^\d+$/.test(w)));
      if (palavras.length < minWords) minWords = palavras.length;
      if (palavras.length > maxWords) maxWords = palavras.length;
    }
    if (minWords <= 1 && maxWords <= 1) {
      const tmdbWord = movieInfo.allTitles[0].toLowerCase();
      const palavrasTitulo = this.normalizarParaComparacao(tituloTorrent)
        .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));
      const palavrasEstranhas = palavrasTitulo.filter(w =>
        w !== tmdbWord && !isTechnicalWord(w)
      );
      if (palavrasEstranhas.length > 1) {
        return { passou: false, motivo: `TMDB de 1 palavra ("${tmdbWord}") — palavras extras: [${palavrasEstranhas.join(', ')}]` };
      }
    }
    if (anoTorrent === null || anoTmdb === undefined) {
      return { passou: true, motivo: `Sem ano para comparar` };
    }
    const diff = Math.abs(anoTmdb - anoTorrent);
    const passou = diff <= tolerancia;
    return { passou, motivo: passou ? `Ano compativel: ${anoTorrent}=${anoTmdb}` : `Ano divergente: ${anoTorrent} vs ${anoTmdb} (dif=${diff}>${tolerancia})` };
  }

  private validarSequencia(
    tituloTorrent: string,
    titulosValidos: string[],
    anoTorrent: number | null,
    tipoMidia?: 'movie' | 'tv'
  ): { passou: boolean; motivo: string } {
    if (tipoMidia === 'tv') return { passou: true, motivo: '' };

    const temContextoEp = /\b(?:episodio|episódio|temporada|season|episode|temp)\b/i.test(tituloTorrent);
    if (temContextoEp) return { passou: true, motivo: '' };

    const suspeitos = getPotentialSequelNumbers(tituloTorrent)
      .filter(n => n !== anoTorrent);
    const epRange = extrairRangeEpisodios(tituloTorrent);
    const numsForaRange = suspeitos.filter(n => {
      if (epRange === null) return true;
      return n < epRange.episodeStart || n > epRange.episodeEnd;
    });
    if (numsForaRange.length === 0) {
      return { passou: true, motivo: '' };
    }
    for (const num of numsForaRange) {
      let encontrado = false;
      for (const tv of titulosValidos) {
        const tokens = this.normalizarParaComparacao(tv).split(' ');
        for (const tk of tokens) {
          if (tk === String(num)) { encontrado = true; break; }
        }
        if (encontrado) break;
      }
      if (!encontrado) {
        return { passou: false, motivo: `Numero de sequencia: ${numsForaRange.join(',')} (nao esta nos titulos TMDB)` };
      }
    }
    return { passou: true, motivo: '' };
  }

  private validarTemporada(
    tituloTorrent: string,
    temporadaAlvo?: number
  ): { passou: boolean; motivo: string } {
    const temEpisodio = /\bs\d{1,2}\s*e\d{1,3}\b/i.test(tituloTorrent);
    if (temporadaAlvo === undefined && temEpisodio) {
      return { passou: false, motivo: 'SxxExx em filme — provável episódio de série' };
    }
    if (temporadaAlvo === undefined) return { passou: true, motivo: '' };
    const epRange = extrairRangeEpisodios(tituloTorrent);
    if (epRange) {
      const passou = epRange.season === temporadaAlvo;
      return { passou, motivo: passou ? '' : `Temporada divergente: S${epRange.season} vs S${temporadaAlvo}` };
    }
    const sMatch = tituloTorrent.match(/\bs(\d{1,2})\b(?!\s*e\d)/i);
    if (sMatch) {
      const ts = parseInt(sMatch[1]);
      const passou = ts === temporadaAlvo;
      return { passou, motivo: passou ? '' : `Temporada divergente: S${ts} vs S${temporadaAlvo}` };
    }
    return { passou: true, motivo: '' };
  }

  /** F: Valida se as palavras do título TMDB aparecem na mesma ordem no torrent.
   *    Ignora tudo antes da primeira palavra do título (ex: VACATORRENT). */
  private validarOrdemPalavras(
    palavrasTorrent: string[],
    palavrasTmdb: string[]
  ): { passou: boolean; motivo: string } {
    if (palavrasTmdb.length === 0) {
      this.logger.debug('🔍 [Condição F] TMDB sem palavras, pulando.');
      return { passou: true, motivo: '' };
    }

    // Procura a primeira palavra do título no torrent
    let idxTorrent = palavrasTorrent.findIndex(p => p === palavrasTmdb[0]);
    if (idxTorrent === -1) {
      this.logger.debug(`🔍 [Condição F] Primeira palavra "${palavrasTmdb[0]}" não encontrada no torrent. Ordem falhou.`);
      return { passou: false, motivo: `Ordem das palavras quebrada: esperado [${palavrasTmdb.join(' ')}]` };
    }

    // A partir daí, verifica se as demais aparecem na sequência (match exato)
    let idxTmdb = 1;
    for (let i = idxTorrent + 1; i < palavrasTorrent.length && idxTmdb < palavrasTmdb.length; i++) {
      if (palavrasTorrent[i] === palavrasTmdb[idxTmdb]) {
        idxTmdb++;
      }
    }

    if (idxTmdb === palavrasTmdb.length) {
      this.logger.debug(`🔍 [Condição F] Ordem OK para "${palavrasTmdb.join(' ')}".`);
      return { passou: true, motivo: 'Ordem das palavras OK' };
    } else {
      this.logger.debug(`🔍 [Condição F] Ordem quebrada: esperado [${palavrasTmdb.join(' ')}], torrent: [${palavrasTorrent.join(' ')}]`);
      return { passou: false, motivo: `Ordem das palavras quebrada: esperado [${palavrasTmdb.join(' ')}]` };
    }
  }

  private validarSequenciaNumero(
    tituloTorrent: string,
    palavrasTorrent: string[],
    titulosValidos: string[]
  ): { passou: boolean; motivo: string } {
    const seqNumbers = new Set<number>();
    for (const titulo of titulosValidos) {
      for (const n of getPotentialSequelNumbers(titulo)) {
        seqNumbers.add(n);
      }
    }

    if (seqNumbers.size === 0) return { passou: true, motivo: '' };

    const torrentNumbers = new Set(getPotentialSequelNumbers(tituloTorrent));

    for (const sn of seqNumbers) {
      if (torrentNumbers.has(sn)) return { passou: true, motivo: '' };
    }

    return {
      passou: false,
      motivo: `Sequência TMDB [${[...seqNumbers].join(',')}] ausente no torrent — provável filme original`
    };
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
    return titulo.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
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