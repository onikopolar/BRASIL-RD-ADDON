import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { getPotentialSequelNumbers, extrairRangeEpisodios, normalizarTituloTorrent } from './TechnicalWords.js';

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

    // Quebra titulo do torrent em palavras (sem numeros soltos, sem SxxExx)
    const palavrasTorrent = this.normalizarParaComparacao(tituloTorrent)
      .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w) && !/^s\d{1,2}e\d{1,3}$/i.test(w));

    // Titulo vazio depois da normalizacao = lixo (ex: "Download" stripado)
    if (palavrasTorrent.length === 0) {
      return { matches: false, similarity: 0, reason: 'Título vazio após normalização' };
    }

    const setTorrent = new Set(palavrasTorrent);

    // Compara contra cada titulo TMDB (PT e EN) e escolhe o melhor
    interface ScoreTitulo {
      titulo: string;
      palavrasTmdb: string[];
      encontradas: number;
      faltando: string[];
      totalTmdb: number;
      tmdbCompleto: boolean;
      proporcao: number;
    }

    let melhor: ScoreTitulo = {
      titulo: '',
      palavrasTmdb: [],
      encontradas: 0,
      faltando: [],
      totalTmdb: 0,
      tmdbCompleto: false,
      proporcao: 0,
    };

    let t = 0;
    while (t < titulosValidos.length) {
      const palavrasTitulo = this.normalizarParaComparacao(titulosValidos[t])
        .split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));

      const setTitulo = new Set(palavrasTitulo);
      let enc = 0;
      const falt: string[] = [];
      for (const palavra of palavrasTitulo) {
        if (setTorrent.has(palavra)) { enc++; }
        else { falt.push(palavra); }
      }

      const total = setTitulo.size;

      const score: ScoreTitulo = {
        titulo: titulosValidos[t],
        palavrasTmdb: palavrasTitulo,
        encontradas: enc,
        faltando: falt,
        totalTmdb: total,
        tmdbCompleto: falt.length === 0,
        proporcao: total > 0 ? enc / total : 0,
      };

      // Criterio: mais palavras TMDB encontradas
      if (t === 0 || score.encontradas > melhor.encontradas) {
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
    melhor: { titulo: string; palavrasTmdb: string[]; encontradas: number; faltando: string[]; totalTmdb: number; tmdbCompleto: boolean; proporcao: number },
    palavrasTorrent: string[],
    titulosValidos: string[],
    anoTorrent: number | null,
    temporadaAlvo?: number
  ): SmartTitleMatch {
    const anoTmdb = movieInfo.year;
    const tipoMidia = movieInfo.mediaType || 'movie';
    const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
    const temIndicadorPt = this.languageDetector.isPortugueseContent(tituloTorrent);

    // Filme tolera 2 anos de diferenca, serie tolera 3
    const toleranciaAno = tipoMidia === 'tv' ? 3 : 2;

    const condicaoA = this.validarPalavrasMinimas(melhor);
    const condicaoB = this.validarTituloCompleto(melhor);
    const condicaoC = this.validarAnoCompativel(anoTorrent, anoTmdb, toleranciaAno, tipoMidia, movieInfo, tituloTorrent);
    const condicaoD = this.validarSequencia(tituloTorrent, titulosValidos, anoTorrent);
    const condicaoE = this.validarTemporada(tituloTorrent, temporadaAlvo);

    const todasPassaram = condicaoA.passou && condicaoB.passou && condicaoC.passou && condicaoD.passou && condicaoE.passou;

    // Monta o motivo juntando as falhas (ou sucessos)
    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoB.passou) partesMotivo.push(condicaoB.motivo);
    if (!condicaoC.passou) partesMotivo.push(condicaoC.motivo);
    if (!condicaoD.passou) partesMotivo.push(condicaoD.motivo);
    if (!condicaoE.passou) partesMotivo.push(condicaoE.motivo);
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

    // Log compacto: 1 linha com status das 5 condicoes
    const statusCondicoes = `A:${condicaoA.passou?'OK':'X'} B:${condicaoB.passou?'OK':'X'} C:${condicaoC.passou?'OK':'X'} D:${condicaoD.passou?'OK':'X'} E:${condicaoE.passou?'OK':'X'}`;
    if (!todasPassaram) {
      this.logger.debug(`REJEITADO [${statusCondicoes}] | "${tituloTorrent.substring(0, 70)}" | ${partesMotivo.filter(p => p.includes('Faltam') || p.includes('insuficientes') || p.includes('divergente') || p.includes('sequencia')).join('; ')}`);
    } else {
      this.logger.debug(`ACEITO [${statusCondicoes}] | "${tituloTorrent.substring(0, 70)}"`);
    }

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  /** A: Palavras do TMDB precisam existir no torrent (faltando, nao estranhas).
   *    Edge-gap: tolera 1 palavra faltando se estiver na ponta do titulo TMDB. */
  private validarPalavrasMinimas(
    melhor: { titulo: string; palavrasTmdb: string[]; faltando: string[]; encontradas: number; totalTmdb: number }
  ): { passou: boolean; motivo: string } {
    if (melhor.faltando.length === 0) {
      return {
        passou: true,
        motivo: `Vocabulario OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras`
      };
    }

    // Edge-gap: tolera 1 palavra consecutiva na ponta esquerda ou direita
    if (melhor.faltando.length === 1 && melhor.palavrasTmdb.length >= 2) {
      const idx = melhor.palavrasTmdb.indexOf(melhor.faltando[0]);
      if (idx === 0 || idx === melhor.palavrasTmdb.length - 1) {
        const ponta = idx === 0 ? 'esquerda' : 'direita';
        return {
          passou: true,
          motivo: `Edge-gap: "${melhor.faltando[0]}" na ponta ${ponta}, ${melhor.encontradas}/${melhor.totalTmdb}`
        };
      }
    }

    return {
      passou: false,
      motivo: `Palavras faltando: [${melhor.faltando.join(', ')}] (${melhor.encontradas}/${melhor.totalTmdb})`
    };
  }

  /** B: Reporta palavras do TMDB faltando no torrent.
   *    NAO rejeita — A, C (ano), D (sequencia) e E (temporada) fazem essa validacao. */
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

  /** C: Ano do torrent deve ser compativel com TMDB */
  private validarAnoCompativel(
    anoTorrent: number | null,
    anoTmdb: number | undefined,
    tolerancia: number,
    _tipoMidia: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv'; year?: number },
    tituloTorrent: string
  ): { passou: boolean; motivo: string } {
    // TMDB 1 palavra sem ano nem SxxExx → rejeita
    let minWords = 99;
    for (const t of movieInfo.allTitles) {
      const palavras = this.normalizarParaComparacao(t).split(' ').filter(w => w.length > 0 && !(/^\d+$/.test(w)));
      if (palavras.length < minWords) minWords = palavras.length;
    }
    const temSxxExx = /\bs\d{1,2}\s*e\d{1,3}\b/i.test(tituloTorrent);
    if (anoTorrent === null && minWords <= 1 && !temSxxExx) {
      return { passou: false, motivo: `TMDB de 1 palavra sem ano nem SxxExx — ambiguo` };
    }
    if (anoTorrent === null || anoTmdb === undefined) {
      return { passou: true, motivo: `Sem ano para comparar` };
    }
    const diff = Math.abs(anoTmdb - anoTorrent);
    const passou = diff <= tolerancia;
    return { passou, motivo: passou ? `Ano compativel: ${anoTorrent}=${anoTmdb}` : `Ano divergente: ${anoTorrent} vs ${anoTmdb} (dif=${diff}>${tolerancia})` };
  }

  /** D: Nenhum número de sequência fora do esperado pelo TMDB */
  private validarSequencia(
    tituloTorrent: string,
    titulosValidos: string[],
    anoTorrent: number | null
  ): { passou: boolean; motivo: string } {
    const suspeitos = getPotentialSequelNumbers(tituloTorrent)
      .filter(n => n !== anoTorrent);
    // Filtra números dentro do range de episódios
    const epRange = extrairRangeEpisodios(tituloTorrent);
    const numsForaRange = suspeitos.filter(n => {
      if (epRange === null) return true;
      return n < epRange.episodeStart || n > epRange.episodeEnd;
    });
    if (numsForaRange.length === 0) {
      return { passou: true, motivo: '' };
    }
    // Verifica se os números suspeitos existem em algum título TMDB
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

  /** E: Temporada do torrent deve bater com o alvo */
  private validarTemporada(
    tituloTorrent: string,
    temporadaAlvo?: number
  ): { passou: boolean; motivo: string } {
    if (temporadaAlvo === undefined) return { passou: true, motivo: '' };
    const epRange = extrairRangeEpisodios(tituloTorrent);
    if (epRange) {
      const passou = epRange.season === temporadaAlvo;
      return { passou, motivo: passou ? '' : `Temporada divergente: S${epRange.season} vs S${temporadaAlvo}` };
    }
    // Fallback: Sxx sem Exx
    const sMatch = tituloTorrent.match(/\bs(\d{1,2})\b(?!\s*e\d)/i);
    if (sMatch) {
      const ts = parseInt(sMatch[1]);
      const passou = ts === temporadaAlvo;
      return { passou, motivo: passou ? '' : `Temporada divergente: S${ts} vs S${temporadaAlvo}` };
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

  /** Delega normalização para TechnicalWords — remove só palavras técnicas, mantém SxxExx */
  normalizarParaComparacao(titulo: string): string {
    return normalizarTituloTorrent(titulo);
  }

  private extrairAnoDoTitulo(titulo: string): number | null {
    // Extrai todos os anos (19xx ou 20xx)
    const anos = titulo.match(/\b(19|20)\d{2}\b/g);
    if (!anos || anos.length === 0) return null;
    // Se o primeiro número do título é um ano E é igual ao ano extraído,
    // pode ser nome de filme (ex: "1917"), não ano de lançamento.
    // Nesse caso, usa o SEGUNDO ano encontrado (se houver)
    const primeiroNumero = titulo.match(/\b\d{4}\b/);
    if (primeiroNumero && anos[0] === primeiroNumero[0] && anos.length > 1) {
      return parseInt(anos[1]);
    }
    return parseInt(anos[0]);
  }
}

export type { SmartTitleMatch };