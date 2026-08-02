import { Logger } from '../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
import { ImdbScraperService } from '../catalogo/ImdbScraperService.js';
import { LanguageDetector } from './LanguageDetector.js';
import { getPotentialSequelNumbers, extrairRangeEpisodios, isTechnicalWord, TECHNICAL_STRIP_WORDS, isCollectionTitle } from './TechnicalWords.js';
import fs from 'fs';
import path from 'path';

// Cache: palavra → existe em algum título no TMDB?
const omdbWordCache = new Map<string, boolean>();
const STRIP_WORDS_PATH = path.resolve(process.cwd(), 'data', 'strip-words.txt');

// Fila global de background: processa 1 palavra por vez, sem duplicatas
const stripQueue: Set<string> = new Set();
let stripQueueRunning = false;

/** Detecta tokens que são lixo de magnet/tracker — nunca devem virar strip */
function isJunkToken(token: string): boolean {
  // Hashes hex (SHA1=40, MD5=32, SHA256=64 — comprimentos comuns em magnets)
  if (/^[0-9a-f]{32}$/i.test(token)) return true;
  if (/^[0-9a-f]{40}$/i.test(token)) return true;
  if (/^[0-9a-f]{64}$/i.test(token)) return true;
  // Trackers e parâmetros URL que escapam dos scrapers
  if (/^(?:udp|http|https|wss):\/\//i.test(token)) return true;
  if (/^[?&]/.test(token)) return true; // parâmetros URL soltos
  return false;
}

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

    // ═══ EARLY REJECT: Idioma internacional explícito (ANTES do matching pesado) ═══
    // Delega 100% ao LanguageDetector — ele já classifica via INDICADORES_INTERNACIONAL_TORRENTS
    // Rejeita se há indicadores internacionais (hindi, english, turg, legendado...) SEM nenhum PT
    const idiomaPre = this.languageDetector.verificarIdioma(torrentTitle);
    if (idiomaPre.palavrasEn.length > 0 && idiomaPre.palavrasPt.length === 0) {
      return { matches: false, similarity: 0, reason: `Idioma internacional: ${idiomaPre.motivo}` };
    }

    // Compara palavras do torrent contra cada titulo TMDB e decide com regras unificadas
    const resultado = await this.compararTitulos(
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

    // Normalizacao leve: lowercase + split, sem filtro de palavras tecnicas
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
      extrasTorrent: number; // palavras do torrent sem match no TMDB
    }

    let melhor: ScoreTitulo = {
      titulo: '', palavrasTmdb: [], encontradas: 0, faltando: [], totalTmdb: 0, proporcao: 0,
      extrasTorrent: 0,
    };

    for (let t = 0; t < titulosValidos.length; t++) {
      const palavrasTitulo = tokenizar(titulosValidos[t]);

      // Helper: duas palavras são "parecidas"? Match exato OU LCS cobre ≥75% da menor (mín 3 chars)
      const palavrasParecidas = (a: string, b: string): boolean => {
        if (a === b) return true;
        if (a.length < 3 || b.length < 3) return false; // stopwords não fazem fuzzy
        const lcs = this.calcularLCS(a, b);
        const minLen = Math.min(a.length, b.length);
        return lcs >= 3 && lcs / minLen >= 0.75; // ex: lemda↔lenda (4/5=0.80), mas carro↔park (2/4=0.50)
      };

      // ── TMDB → Torrent ──
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

      // ── Torrent → TMDB ──
      let extras = 0;
      const pendingStripCheck: string[] = [];
      for (const palavraTorrent of palavrasTorrent) {
        if (isTechnicalWord(palavraTorrent)) continue;
        if (palavrasTitulo.some(p => palavrasParecidas(palavraTorrent, p))) continue;
        if (palavraTorrent.length <= 2) { extras++; continue; }
        // Episódio/temporada (S06E05, 2x04...) → ignora
        if (extrairRangeEpisodios(palavraTorrent) !== null) continue;
        // Lixo de magnet link: hashes (32/40/64 hex), trackers, parâmetros URL
        if (isJunkToken(palavraTorrent)) continue;
        // Cache hit? Decide na hora. Senão, conta como extra e verifica depois.
        if (omdbWordCache.has(palavraTorrent)) {
          if (!omdbWordCache.get(palavraTorrent)) {
            this.autoAprenderStripWord(palavraTorrent);
          }
        } else {
          pendingStripCheck.push(palavraTorrent);
        }
        extras++;
      }

      // Dispara verificação em background (não bloqueia a resposta)
      if (pendingStripCheck.length > 0) {
        this.enfileirarStripWords(pendingStripCheck);
      }

      // Score bidirecional
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

  /** Longest Common Subsequence entre 2 strings */
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


  /** Decide se aceita o torrent com 3 condicoes unificadas (A && B && C). Se qualquer uma falhar, rejeita. */
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

    // Coletânea: relaxa ano (pode cobrir 2003-2011) e ignora número de sequência
    const isColecao = isCollectionTitle(tituloTorrent);
    const toleranciaAno = isColecao ? 10 : (tipoMidia === 'tv' ? 15 : 1);

    const condicaoA = this.validarPalavrasMinimas(melhor, anoTorrent, anoTmdb, tituloTorrent);
    const condicaoB = this.validarTituloCompleto(melhor);
    const condicaoC = this.validarAnoCompativel(anoTorrent, anoTmdb, toleranciaAno, tipoMidia, movieInfo, tituloTorrent);
    // Coletânea: "4 Filmes" não é sequência do filme 4
    const condicaoD = isColecao ? { passou: true, motivo: 'Coletânea: sequência ignorada' } : this.validarSequencia(tituloTorrent, titulosValidos, anoTorrent, tipoMidia);
    const condicaoE = this.validarTemporada(tituloTorrent, temporadaAlvo);
    const condicaoG = isColecao ? { passou: true, motivo: 'Coletânea: número ignorado' } : this.validarSequenciaNumero(tituloTorrent, palavrasTorrent, titulosValidos);

    const todasPassaram = condicaoA.passou && condicaoC.passou && condicaoD.passou && condicaoE.passou && condicaoG.passou;

    // Monta o motivo juntando as falhas (ou sucessos)
    const partesMotivo: string[] = [];
    if (!condicaoA.passou) partesMotivo.push(condicaoA.motivo);
    if (!condicaoB.passou) partesMotivo.push(condicaoB.motivo);
    if (!condicaoC.passou) partesMotivo.push(condicaoC.motivo);
    if (!condicaoD.passou) partesMotivo.push(condicaoD.motivo);
    if (!condicaoE.passou) partesMotivo.push(condicaoE.motivo);
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

    const statusCondicoes = `A:${condicaoA.passou?'OK':'X'} C:${condicaoC.passou?'OK':'X'} D:${condicaoD.passou?'OK':'X'} E:${condicaoE.passou?'OK':'X'} G:${condicaoG.passou?'OK':'X'}`;
    if (!todasPassaram) {
      this.logger.debug(`❌ [${statusCondicoes}] "${tituloTorrent.substring(0, 70)}" | ${partesMotivo.join(' | ')}`);
    } else {
      this.logger.info(`✅ [${statusCondicoes}] "${tituloTorrent.substring(0, 60)}"`);
    }

    resultado.mediaType = movieInfo.mediaType;
    return resultado;
  }

  /** A: Score bidirecional (match exato + fuzzy ≥75%). Sem ano → exige 0 extras.
   *     Coletâneas (trilogia, quadrilogia, etc.) têm threshold relaxado. */
  private validarPalavrasMinimas(
    melhor: { titulo: string; palavrasTmdb: string[]; faltando: string[]; encontradas: number; totalTmdb: number; proporcao: number; extrasTorrent?: number },
    anoTorrent?: number | null,
    anoTmdb?: number,
    tituloTorrent?: string
  ): { passou: boolean; motivo: string } {
    if (melhor.totalTmdb === 0) return { passou: false, motivo: 'TMDB sem palavras' };

    const extras = melhor.extrasTorrent ?? 0;
    const semAno = anoTorrent === null || anoTorrent === undefined || anoTmdb === undefined;

    // ── Coletânea (trilogia, quadrilogia, etc.): threshold relaxado ──
    // Torrents de pack contêm o filme mas não o subtítulo completo.
    // Ex: "Quadrilogia Piratas do Caribe" → só bate "piratas do caribe" (3-4/8 palavras)
    if (tituloTorrent && isCollectionTitle(tituloTorrent)) {
      // ≥2 palavras da franquia bastam (ex: "Jogos Vorazes" = 2 palavras)
      if (melhor.encontradas >= 2 && extras <= 3) {
        return { passou: true, motivo: `Coletânea: ${melhor.encontradas}/${melhor.totalTmdb} palavras da franquia${extras > 0 ? ` +${extras} extra(s)` : ''}` };
      }
      if (semAno && extras > 3) {
        return { passou: false, motivo: `Coletânea sem ano + ${extras} palavra(s) extra(s) → título diferente` };
      }
      return { passou: false, motivo: `Coletânea: match baixo ${melhor.encontradas}/${melhor.totalTmdb} palavras. Faltando: [${melhor.faltando.join(', ')}]` };
    }

    // Se não tem ano pra validar → NENHUM extra tolerado
    if (semAno && extras > 0) {
      return { passou: false, motivo: `Sem ano para validar + ${extras} palavra(s) extra(s) no torrent → título diferente` };
    }

    // Todas palavras TMDB batem: threshold relaxado. Se ano bate exato, tolera mais extras.
    const anoExato = !semAno && anoTorrent === anoTmdb;
    const maxExtras = anoExato ? 4 : 2;
    if (melhor.faltando.length === 0 && melhor.proporcao >= 0.6 && extras <= maxExtras) {
      return { passou: true, motivo: `Match OK: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao*100).toFixed(0)}%)${extras > 0 ? ` +${extras} extra(s)` : ''}${anoExato ? ' [ano exato]' : ''}` };
    }

    // Tolera 1 palavra curta (≤3 chars) com score baixo
    if (melhor.faltando.length === 1 && melhor.palavrasTmdb.length >= 3 && extras <= 2) {
      if (melhor.faltando[0].length <= 3 && melhor.proporcao >= 0.6) {
        return { passou: true, motivo: `Palavra-cola: "${melhor.faltando[0]}" (≤3), ${melhor.encontradas}/${melhor.totalTmdb} palavras` };
      }
    }

    if (extras > 2) {
      return { passou: false, motivo: `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao*100).toFixed(0)}%). +${extras} extras no torrent` };
    }

    return { passou: false, motivo: `Match baixo: ${melhor.encontradas}/${melhor.totalTmdb} palavras (${(melhor.proporcao*100).toFixed(0)}%). Faltando: [${melhor.faltando.join(', ')}]` };
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
    // TMDB de 1 palavra → verifica ambiguidade (ex: "Soul" em "Don't Tell a Soul 2021")
    // Só quando TODOS os títulos TMDB são 1 palavra — se há título multi-palavra
    // (ex: "Aliens: O Resgate" + "Aliens"), o título maior legitima o match
    // Tolera +1 palavra extra (termos técnicos: 1080p, DUAL, etc)
    let minWords = 99;
    let maxWords = 0;
    for (const t of movieInfo.allTitles) {
      const palavras = this.normalizarParaComparacao(t).split(' ').filter(w => w.length > 0 && !(/^\d+$/.test(w)));
      if (palavras.length < minWords) minWords = palavras.length;
      if (palavras.length > maxWords) maxWords = palavras.length;
    }
    const temSxxExx = /\bs\d{1,2}\s*e\d{1,3}\b/i.test(tituloTorrent);
    if (minWords <= 1 && maxWords <= 1) {
      // Pra títulos TMDB de 1 palavra: só permite palavras técnicas extras
      // Qualquer palavra NÃO-técnica além do título TMDB → ambiguidade (ex: "Dexter Ressurreição")
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

  /** D: Nenhum número de sequência fora do esperado pelo TMDB.
   *    Ignora números em contexto de episódio/temporada. Pula para séries (tv). */
  private validarSequencia(
    tituloTorrent: string,
    titulosValidos: string[],
    anoTorrent: number | null,
    tipoMidia?: 'movie' | 'tv'
  ): { passou: boolean; motivo: string } {
    // Séries têm números de temporada legítimos — não são "sequências"
    if (tipoMidia === 'tv') return { passou: true, motivo: '' };
    
    // Se título menciona episódio/temporada, números são de episódio, não sequência
    const temContextoEp = /\b(?:episodio|episódio|temporada|season|episode|temp)\b/i.test(tituloTorrent);
    if (temContextoEp) return { passou: true, motivo: '' };

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

  /** E: Temporada do torrent deve bater com o alvo.
   *    Se TMDB é filme e torrent tem SxxExx → rejeita (filme não tem episódio). */
  private validarTemporada(
    tituloTorrent: string,
    temporadaAlvo?: number
  ): { passou: boolean; motivo: string } {
    // Se torrent tem SxxExx mas não é série (sem temporadaAlvo) → suspeito
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
    // Fallback: Sxx sem Exx
    const sMatch = tituloTorrent.match(/\bs(\d{1,2})\b(?!\s*e\d)/i);
    if (sMatch) {
      const ts = parseInt(sMatch[1]);
      const passou = ts === temporadaAlvo;
      return { passou, motivo: passou ? '' : `Temporada divergente: S${ts} vs S${temporadaAlvo}` };
    }
    return { passou: true, motivo: '' };
  }

  /** G: Se TMDB tem número de sequência (2, 3, 4...), torrent também precisa ter.
   *    Evita que o filme original infiltre em scraping de sequências. */
  private validarSequenciaNumero(
    tituloTorrent: string,
    palavrasTorrent: string[],
    titulosValidos: string[]
  ): { passou: boolean; motivo: string } {
    // Extrai números de sequência dos títulos TMDB usando getPotentialSequelNumbers
    const seqNumbers = new Set<number>();
    for (const titulo of titulosValidos) {
      for (const n of getPotentialSequelNumbers(titulo)) {
        seqNumbers.add(n);
      }
    }

    // Se TMDB não tem número de sequência, não é sequência → OK
    if (seqNumbers.size === 0) return { passou: true, motivo: '' };

    // Extrai números do torrent via getPotentialSequelNumbers (inclui romanos)
    const torrentNumbers = new Set(getPotentialSequelNumbers(tituloTorrent));

    // Pelo menos um número de sequência TMDB precisa estar no torrent
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

  /** Delega normalização para TechnicalWords — remove só palavras técnicas, mantém SxxExx */
  normalizarParaComparacao(titulo: string): string {
    // Mantido por compatibilidade com chamadores externos (catalogProvider)
    return titulo.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private extrairAnoDoTitulo(titulo: string): number | null {
    // Extrai todos os anos (19xx ou 20xx)
    const anos = titulo.match(/\b(19|20)\d{2}\b/g);
    if (!anos || anos.length === 0) return null;
    const primeiroNumero = titulo.match(/\b\d{4}\b/);
    if (primeiroNumero && anos[0] === primeiroNumero[0] && anos.length > 1) {
      return parseInt(anos[1]);
    }
    return parseInt(anos[0]);
  }

  /** Verifica no TMDB (HTML scraper) se uma palavra existe em algum título.
   *  Tenta pt-BR primeiro, depois inglês. */
  private async palavraExisteNoOmdb(word: string): Promise<boolean> {
    if (omdbWordCache.has(word)) return omdbWordCache.get(word)!;

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html',
    };

    try {
      // 1) Tenta pt-BR
      let url = `https://www.themoviedb.org/search?query=${encodeURIComponent(word)}&language=pt-BR`;
      let resp = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { ...headers, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
      let html = await resp.text();
      if (/\/movie\/\d+/.test(html) || /\/tv\/\d+/.test(html)) {
        omdbWordCache.set(word, true);
        return true;
      }

      // 2) Tenta inglês como fallback
      url = `https://www.themoviedb.org/search?query=${encodeURIComponent(word)}&language=en-US`;
      resp = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { ...headers, 'Accept-Language': 'en-US,en;q=0.9' } });
      html = await resp.text();
      const existe = /\/movie\/\d+/.test(html) || /\/tv\/\d+/.test(html);
      omdbWordCache.set(word, existe);
      return existe;
    } catch {
      // Erro/timeout → conservador: assume que existe (evita poluir strip com títulos reais)
      omdbWordCache.set(word, true);
      return true;
    }
  }

  /** Auto-aprender: adiciona palavra ao strip-words.txt */
  private autoAprenderStripWord(word: string): void {
    try {
      const existing = new Set<string>();
      if (fs.existsSync(STRIP_WORDS_PATH)) {
        const content = fs.readFileSync(STRIP_WORDS_PATH, 'utf8');
        for (const line of content.split('\n')) {
          const w = line.trim().toLowerCase();
          if (w) existing.add(w);
        }
      }
      if (!existing.has(word.toLowerCase())) {
        fs.appendFileSync(STRIP_WORDS_PATH, word.toLowerCase() + '\n');
        // Atualiza a memória IMEDIATAMENTE pra já valer na sessão atual
        TECHNICAL_STRIP_WORDS.add(word.toLowerCase());
        this.logger.info(`📝 Strip-word aprendida: "${word}" → data/strip-words.txt`);
      }
    } catch (err) {
      this.logger.error(`❌ Erro ao salvar strip-word "${word}": ${err instanceof Error ? err.message : err}`);
    }
  }

  /** Adiciona palavras na fila global de background (1 por vez, sem duplicatas) */
  private enfileirarStripWords(words: string[]): void {
    for (const w of words) {
      if (!omdbWordCache.has(w)) stripQueue.add(w);
    }
    if (!stripQueueRunning) {
      this.processarFilaStrip().catch(err => {
        this.logger.error('❌ Erro na fila de strip:', err);
        stripQueueRunning = false;
      });
    }
  }

  /** Processa a fila global sequencialmente: 1 palavra por vez, 3s delay, 2 tentativas */
  private async processarFilaStrip(): Promise<void> {
    stripQueueRunning = true;
    const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
    this.logger.info(`🔄 Fila de strip iniciada: ${stripQueue.size} palavras pendentes`);

    while (stripQueue.size > 0) {
      const word = stripQueue.values().next().value!;
      stripQueue.delete(word);
      if (omdbWordCache.has(word)) continue;

      let existe = true;
      for (let tentativa = 0; tentativa < 2; tentativa++) {
        try {
          await delay(3000);
          existe = await this.palavraExisteNoOmdb(word);
          break;
        } catch { /* timeout → retry */ }
      }

      if (!existe) {
        this.autoAprenderStripWord(word);
      }
    }
    this.logger.info('✅ Fila de strip concluída');
    stripQueueRunning = false;
  }
}

export type { SmartTitleMatch };