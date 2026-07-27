import { Logger } from '../../utils/logger.js';
import { SmartTitleMatch, SeriesConfusion } from './interfaces.js';
import { ImdbScraperService } from '../../services/ImdbScraperService.js';
import { TECHNICAL_WORDS, TECHNICAL_ACRONYMS } from './TechnicalWords.js';

// Escape regex special chars (ex: "5.1" → "5\\.1")
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

// Pré-compila todos os regexes UMA vez no carregamento do módulo
const COMPILED_TECH_WORDS: RegExp[] = TECHNICAL_WORDS
  .filter(t => !/^\d+$/.test(t))
  .map(t => new RegExp(`\\b${escapeRegex(t)}\\b`, 'gi'));

const COMPILED_TECH_ACRONYMS: RegExp[] = TECHNICAL_ACRONYMS
  .map(a => new RegExp(`\\b${escapeRegex(a)}\\b`, 'gi'));

export class SimilarityCalculator {
  private readonly logger: Logger;
  private confusingSeries: SeriesConfusion[];
  private readonly tmdbScraper: ImdbScraperService | null;

  private readonly tmdbCache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;

  private readonly VERSAO = '23.6.1';

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

    this.confusingSeries = [
      { original: 'american horror story', derivative: 'american horror stories', minSimilarity: 0.85 },
      { original: 'stranger things', derivative: 'stranger things stories', minSimilarity: 0.85 }
    ];
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

    const torrentYear = torrentMetadata?.year || this.extractYearFromTitle(torrentTitle);
    const torrentClean = this.normalizeForComparison(torrentTitle, movieInfo.mediaType);

    const matchResult = this.enhancedContextAnalysis(
      torrentClean,
      torrentTitle,
      movieInfo.portugueseTitle,
      movieInfo.originalTitle,
      movieInfo.allTitles,
      movieInfo.year,
      torrentYear,
      movieInfo.mediaType,
      movieInfo.belongsToCollection,
      torrentMetadata?.season
    );

    if (matchResult.matches) {
      const yearValidation = this.contextualYearValidation(
        movieInfo, torrentYear, torrentTitle, matchResult.similarity, matchResult.confidence, torrentMetadata?.season
      );
      if (yearValidation.shouldReject) {
        return { matches: false, similarity: matchResult.similarity * 0.7, reason: yearValidation.reason };
      }

      // Verifica palavras no torrent que NÃO existem em nenhum título TMDB
      // Ex: torrent "Avatar A Lenda de Korra" vs TMDB Aang "Avatar A Lenda de Aang"
      // "korra" não está nos títulos TMDB → penalidade quadrática (1 palavra em 3 = forte)
      const foreignCheck = this.checkForeignWords(torrentClean, movieInfo.allTitles, movieInfo.mediaType);
      if (foreignCheck.hasForeign) {
        // Penalidade quadrática: 1 palavra estranha em 3 (33%) → penalty = 0.44
        //                        1 palavra estranha em 4 (25%) → penalty = 0.56
        const penalty = Math.pow(1 - foreignCheck.foreignRatio, 2);
        const adjustedSimilarity = matchResult.similarity * Math.max(0.25, penalty);
        const effectiveThreshold = movieInfo.mediaType === 'movie' ? 0.65 : 0.55;

        if (adjustedSimilarity < effectiveThreshold) {
          this.logger.debug('Palavras não-TMDB rejeitaram match', {
            torrentTitle: torrentTitle.substring(0, 80),
            foreignWords: foreignCheck.foreignWords,
            originalSimilarity: (matchResult.similarity * 100).toFixed(1) + '%',
            adjustedSimilarity: (adjustedSimilarity * 100).toFixed(1) + '%',
            foreignRatio: (foreignCheck.foreignRatio * 100).toFixed(0) + '%'
          });
          return {
            matches: false,
            similarity: adjustedSimilarity,
            reason: `Palavras estranhas ao TMDB: [${foreignCheck.foreignWords.join(', ')}]`
          };
        }

        matchResult.similarity = adjustedSimilarity;
        matchResult.reason += ` | ⚠️ extra-TMDB: [${foreignCheck.foreignWords.join(', ')}]`;
      }

      return matchResult;
    }

    return matchResult;
  }

  private contextualYearValidation(
    movieInfo: any, torrentYear: number | null, torrentTitle: string,
    semanticSimilarity: number, confidence?: string, targetSeason?: number
  ): { shouldReject: boolean; reason: string } {
    if (!movieInfo.year) return { shouldReject: false, reason: 'TMDB sem ano' };

    if (!torrentYear) {
      if (movieInfo.mediaType === 'tv' && targetSeason && this.hasExplicitSeason(torrentTitle, targetSeason)) {
        const bonus = this.hasExplicitEpisode(torrentTitle) ? 0.15 : 0.1;
        if (semanticSimilarity + bonus >= 0.65) return { shouldReject: false, reason: `Série com temporada explícita (S${targetSeason})` };
      }
      if (semanticSimilarity >= 0.9 || confidence === 'alta') return { shouldReject: false, reason: 'Similaridade/confiança altas' };
      return { shouldReject: true, reason: `Requer ano. TMDB: ${movieInfo.year}` };
    }

    if (movieInfo.year !== torrentYear) {
      const yearDiff = Math.abs(movieInfo.year - torrentYear);
      if (yearDiff <= 2 && semanticSimilarity >= 0.85) return { shouldReject: false, reason: `Diferença pequena (${yearDiff} anos) com contexto forte` };
      return { shouldReject: true, reason: `Ano diferente: TMDB ${movieInfo.year} != Torrent ${torrentYear}` };
    }
    return { shouldReject: false, reason: 'Ano válido' };
  }

  private enhancedContextAnalysis(
    torrentClean: string, originalTorrentTitle: string,
    portugueseTitle: string | null, originalTitle: string, allTmdbTitles: string[],
    tmdbYear: number | undefined, torrentYear: number | null,
    mediaType?: 'movie' | 'tv', belongsToCollection?: any, targetSeason?: number
  ): SmartTitleMatch & { matchedTmdbTitle?: string; confidence?: string; contextAnalysis?: string } {
    const validTmdbTitles = this.filterValidTmdbTitles(allTmdbTitles, originalTitle);
    if (validTmdbTitles.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB válido' };
    }

    let bestMatch = { similarity: 0, confidence: 'baixa' as 'baixa' | 'média' | 'alta', title: '', reason: '', matchedTmdbTitle: '', contextAnalysis: '' };

    for (const tmdbTitle of validTmdbTitles) {
      const tmdbClean = this.normalizeForComparison(tmdbTitle, mediaType);
      const contextResult = this.smartContextAnalysis(torrentClean, tmdbClean, mediaType, belongsToCollection, targetSeason, originalTorrentTitle);
      if (contextResult.similarity > bestMatch.similarity) {
        bestMatch = { ...contextResult, matchedTmdbTitle: tmdbTitle, title: tmdbTitle };
      }
    }

    const threshold = mediaType === 'movie' ? 0.70 : 0.65;
    const tmdbTitleLength = validTmdbTitles[0]?.length || 0;
    const effectiveThreshold = tmdbTitleLength <= 3 ? threshold * 0.7 : threshold;

    if (bestMatch.similarity >= effectiveThreshold) {
      return { matches: true, similarity: bestMatch.similarity, reason: bestMatch.reason, matchedTmdbTitle: bestMatch.matchedTmdbTitle, confidence: bestMatch.confidence, contextAnalysis: bestMatch.contextAnalysis };
    }
    return { matches: false, similarity: bestMatch.similarity, reason: bestMatch.reason || 'Similaridade insuficiente' };
  }

  private filterValidTmdbTitles(allTitles: string[], originalTitle: string): string[] {
    const valid = allTitles.filter(t => t && t.trim().length > 0 && !['n/a', 'não encontrado', 'not found', 'unknown'].includes(t.toLowerCase().trim()));
    return valid.length ? valid : [originalTitle];
  }

  private smartContextAnalysis(
    torrentClean: string, tmdbClean: string, mediaType?: 'movie' | 'tv',
    belongsToCollection?: any, targetSeason?: number, originalTorrentTitle?: string
  ): { similarity: number; confidence: 'baixa' | 'média' | 'alta'; reason: string; contextAnalysis: string } {
    const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
    const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);

    if (mediaType === 'movie') {
      const seqCheck = this.checkSequenceCompatibility(torrentClean, tmdbClean, belongsToCollection, originalTorrentTitle);
      if (!seqCheck.compatible) return { similarity: seqCheck.similarity, confidence: 'baixa', reason: seqCheck.reason, contextAnalysis: 'sequência_incompatível' };
    }

    if (tmdbWords.length === 1) return this.analyzeSingleWordTitle(tmdbClean, torrentClean, mediaType, targetSeason, originalTorrentTitle);
    if (tmdbWords.length === 2) return this.analyzeDoubleWordTitle(tmdbClean, torrentClean, mediaType, belongsToCollection, targetSeason, originalTorrentTitle);
    return this.normalContextAnalysis(torrentClean, tmdbClean, mediaType, targetSeason, originalTorrentTitle);
  }

  private checkSequenceCompatibility(torrentClean: string, tmdbClean: string, belongsToCollection?: any, originalTorrentTitle?: string) {
    const torrentSeq = this.extractSequenceNumber(torrentClean);
    const tmdbSeq = this.extractSequenceNumber(tmdbClean);
    if (!torrentSeq && tmdbSeq) {
      // TMDB tem sequência mas torrent não — verifica no título ORIGINAL (pré-limpeza)
      // Ex: "Toy Story 5" vs "Toy Story 5 Dublado 1080p" — o 5 foi removido na normalização
      const originalLower = (originalTorrentTitle || torrentClean).toLowerCase();
      if (originalLower.includes(tmdbSeq) || originalLower.includes(' ' + tmdbSeq)) {
        return { compatible: true, similarity: 0.75, reason: `Número ${tmdbSeq} encontrado no título original` };
      }
      if (belongsToCollection && (tmdbSeq === '1' || tmdbSeq === 'i')) return { compatible: true, similarity: 0.8, reason: `TMDB é primeira sequência em coleção` };
      return { compatible: false, similarity: 0.15, reason: `TMDB tem sequência ${tmdbSeq} mas torrent não` };
    }
    if (torrentSeq && !tmdbSeq) {
      if (belongsToCollection && (torrentSeq === '1' || torrentSeq === 'i')) return { compatible: true, similarity: 0.8, reason: `Primeira sequência em coleção` };
      return { compatible: false, similarity: 0.1, reason: `Torrent tem sequência ${torrentSeq} mas TMDB não` };
    }
    if (torrentSeq && tmdbSeq) {
      if (torrentSeq === tmdbSeq) return { compatible: true, similarity: 1, reason: `Números iguais: ${torrentSeq}` };
      return { compatible: false, similarity: 0.1, reason: `Números diferentes: Torrent ${torrentSeq} vs TMDB ${tmdbSeq}` };
    }
    return { compatible: true, similarity: 1, reason: 'Nenhum número de sequência' };
  }

  private static readonly ROMAN_MAP: Record<string, string> = {
    i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10',
    xi:'11', xii:'12', xiii:'13', xiv:'14', xv:'15', xvi:'16', xvii:'17', xviii:'18', xix:'19', xx:'20'
  };

  private static readonly SEQ_PATTERNS = [
    /part[ée]?\s*(\d+)/i, /pt\.?\s*(\d+)/i, /volume\s*(\d+)/i, /vol\.?\s*(\d+)/i,
    /filme\s*(\d+)/i, /movie\s*(\d+)/i, /edição\s*(\d+)/i, /edition\s*(\d+)/i, /seq(\d+)/i
  ];

  private extractSequenceNumber(title: string): string | null {
    const words = title.split(' ').filter(w => w.length > 0);
    if (!words.length) return null;

    const isValidSeq = (n: number) => n >= 1 && n <= 20;

    const seqMatch = title.match(/seq(\d+)/i);
    if (seqMatch && isValidSeq(parseInt(seqMatch[1]))) return seqMatch[1];

    const lastWord = words[words.length - 1].toLowerCase();
    if (/^\d+$/.test(lastWord) && isValidSeq(parseInt(lastWord))) return lastWord;
    if (SimilarityCalculator.ROMAN_MAP[lastWord]) return SimilarityCalculator.ROMAN_MAP[lastWord];

    for (const w of words) {
      const lower = w.toLowerCase();
      if (SimilarityCalculator.ROMAN_MAP[lower]) return SimilarityCalculator.ROMAN_MAP[lower];
      if (/^\d+$/.test(w) && isValidSeq(parseInt(w))) return w;
    }

    for (const p of SimilarityCalculator.SEQ_PATTERNS) {
      const m = title.match(p);
      if (m && m[1] && isValidSeq(parseInt(m[1]))) return m[1];
    }
    return null;
  }

  private analyzeSingleWordTitle(
    tmdbWord: string, torrentClean: string, mediaType?: 'movie' | 'tv',
    targetSeason?: number, originalTorrentTitle?: string
  ): { similarity: number; confidence: 'baixa' | 'média' | 'alta'; reason: string; contextAnalysis: string } {
    const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
    const containsWord = torrentWords.some(w => w === tmdbWord);
    if (!containsWord) return { similarity: 0, confidence: 'baixa', reason: `Palavra "${tmdbWord}" não encontrada`, contextAnalysis: 'título_curto_não_contém' };

    if (mediaType === 'tv' && targetSeason !== undefined && originalTorrentTitle) {
      const hasSeason = this.hasExplicitSeason(originalTorrentTitle, targetSeason);
      const hasEpisode = this.hasExplicitEpisode(originalTorrentTitle);
      if (hasSeason && hasEpisode) {
        // Extrai o número do episódio para garantir que corresponde ao target (já validado pelo TitleFilter)
        return {
          similarity: 0.7,
          confidence: 'média',
          reason: `Série com temporada e episódio explícitos (S${targetSeason})`,
          contextAnalysis: 'série_com_sxxexx'
        };
      }
      if (hasSeason) {
        return {
          similarity: 0.65,
          confidence: 'média',
          reason: `Série com temporada explícita (S${targetSeason})`,
          contextAnalysis: 'série_com_temporada'
        };
      }
    }

    const densityAnalysis = this.analyzeSemanticDensity([tmdbWord], torrentWords);
    if (densityAnalysis.isExcessive) {
      return { similarity: 0.1, confidence: 'baixa', reason: `Densidade excessiva: ${torrentWords.length} vs 1 palavras`, contextAnalysis: 'densidade_excessiva_imediata' };
    }

    const contextAnalysisGlobal = this.analyzeGlobalContext(tmdbWord, torrentWords);
    if (!contextAnalysisGlobal.hasStrongContext) {
      return { similarity: 0.2, confidence: 'baixa', reason: `Contexto fraco: ${contextAnalysisGlobal.reason}`, contextAnalysis: 'contexto_fraco_imediato' };
    }

    const wordPosition = torrentWords.findIndex(w => w === tmdbWord);
    const isFirstWord = wordPosition === 0;
    const extraWords = torrentWords.length - 1;
    let penalty = extraWords === 0 ? 1.0 : extraWords === 1 ? 0.7 : extraWords === 2 ? 0.5 : extraWords === 3 ? 0.3 : Math.max(0.1, 1.0 - extraWords * 0.2);
    if (!isFirstWord) penalty *= Math.max(0.1, 1.0 - wordPosition * 0.4);

    let finalSimilarity = 1.0 * penalty;
    if (torrentClean.startsWith(tmdbWord + ' ') && isFirstWord && extraWords <= 1) finalSimilarity = Math.min(0.9, finalSimilarity * 1.1);
    if (tmdbWord.length <= 3 && extraWords === 0) finalSimilarity = Math.min(1.0, finalSimilarity * 1.05);

    const confidence = finalSimilarity >= 0.85 ? 'alta' : finalSimilarity >= 0.7 ? 'média' : 'baixa';
    let reason = confidence === 'alta' ? `Match forte: ${(finalSimilarity * 100).toFixed(1)}%` : confidence === 'média' ? `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%` : `Similaridade baixa: ${(finalSimilarity * 100).toFixed(1)}%`;
    reason += ` (palavra única "${tmdbWord}" com ${extraWords} palavras extras)`;

    return { similarity: finalSimilarity, confidence, reason, contextAnalysis: `título_curto_1_palavra:penalidade_${penalty.toFixed(2)}` };
  }

  private analyzeDoubleWordTitle(
    tmdbClean: string, torrentClean: string, mediaType?: 'movie' | 'tv',
    belongsToCollection?: any, targetSeason?: number, originalTorrentTitle?: string
  ): { similarity: number; confidence: 'baixa' | 'média' | 'alta'; reason: string; contextAnalysis: string } {
    const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
    const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
    if (!tmdbWords.every(w => torrentWords.some(tw => tw === w))) {
      const missing = tmdbWords.filter(w => !torrentWords.some(tw => tw === w));
      return { similarity: 0.1, confidence: 'baixa', reason: `Palavras faltando: ${missing.join(', ')}`, contextAnalysis: 'título_duas_palavras_faltando' };
    }

    // Override contextual para séries (mantém similaridade razoável)
    if (mediaType === 'tv' && targetSeason !== undefined && originalTorrentTitle && this.hasExplicitSeason(originalTorrentTitle, targetSeason)) {
      const bonus = this.hasExplicitEpisode(originalTorrentTitle) ? 0.15 : 0.1;
      const densityAnalysis = this.analyzeSemanticDensity(tmdbWords, torrentWords);
      if (densityAnalysis.isExcessive) {
        return { similarity: 0.6 + bonus, confidence: 'média', reason: `Série com temporada explícita (densidade alta ajustada)`, contextAnalysis: 'série_com_temporada_densidade' };
      }
    }

    const densityAnalysis = this.analyzeSemanticDensity(tmdbWords, torrentWords);
    if (densityAnalysis.isExcessive) {
      return { similarity: 0.15, confidence: 'baixa', reason: `Densidade excessiva: ${torrentWords.length} vs ${tmdbWords.length} palavras`, contextAnalysis: 'densidade_excessiva_imediata' };
    }

    const basicSimilarity = this.calculateWordSimilarity(tmdbClean, torrentClean);
    const extraWords = torrentWords.length - tmdbWords.length;
    let penalty = extraWords === 0 ? 1.0 : extraWords === 1 ? 0.9 : extraWords === 2 ? 0.8 : extraWords === 3 ? 0.7 : Math.max(0.5, 1.0 - extraWords * 0.12);
    if (densityAnalysis.isExcessive) penalty *= 0.4;

    const startsWithBonus = torrentClean.startsWith(tmdbWords.join(' ') + ' ');
    let finalSimilarity = basicSimilarity * penalty;
    if (startsWithBonus && extraWords <= 3) finalSimilarity = Math.min(1.0, finalSimilarity * 1.25);
    if (tmdbWords.every(w => w.length <= 3) && extraWords <= 2) finalSimilarity = Math.min(1.0, finalSimilarity * 1.15);

    const confidence = finalSimilarity >= 0.85 ? 'alta' : finalSimilarity >= 0.7 ? 'média' : 'baixa';
    let reason = confidence === 'alta' ? `Match forte: ${(finalSimilarity * 100).toFixed(1)}%` : confidence === 'média' ? `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%` : `Similaridade baixa: ${(finalSimilarity * 100).toFixed(1)}%`;
    return { similarity: finalSimilarity, confidence, reason, contextAnalysis: `título_duas_palavras:penalidade_${penalty.toFixed(2)}` };
  }

  private analyzeSemanticDensity(tmdbWords: string[], torrentWords: string[]) {
    if (!tmdbWords.length) return { isExcessive: false, ratio: 0, reason: 'TMDB sem palavras' };
    const ratio = torrentWords.length / tmdbWords.length;
    const isExcessive = ratio >= 2.0 || (tmdbWords.length === 1 && torrentWords.length >= 2) || (tmdbWords.length === 2 && torrentWords.length >= 4);
    return { isExcessive, ratio, reason: isExcessive ? `Densidade excessiva: ${torrentWords.length} vs ${tmdbWords.length}` : `Densidade normal` };
  }

  private analyzeGlobalContext(tmdbWord: string, torrentWords: string[]) {
    const idx = torrentWords.indexOf(tmdbWord);
    if (idx === -1) return { hasStrongContext: false, reason: 'Palavra TMDB não encontrada' };
    if (tmdbWord.length <= 3 && torrentWords.length >= 2) return { hasStrongContext: false, reason: `Título muito curto (${tmdbWord.length} letras) com contexto expandido` };
    if (tmdbWord.length <= 5 && torrentWords.length >= 3) return { hasStrongContext: false, reason: `Título curto com muito contexto adicional` };
    if (torrentWords.length >= 3) return { hasStrongContext: false, reason: 'Contexto muito expandido para título único' };
    return { hasStrongContext: true, reason: 'Contexto apropriado' };
  }

  private normalContextAnalysis(
    torrentClean: string, tmdbClean: string, mediaType?: 'movie' | 'tv',
    targetSeason?: number, originalTorrentTitle?: string
  ): { similarity: number; confidence: 'baixa' | 'média' | 'alta'; reason: string; contextAnalysis: string } {
    const basicSimilarity = this.calculateEnhancedSimilarity(torrentClean, tmdbClean);
    const density = this.analyzeWordDensity(torrentClean, tmdbClean);
    const containment = this.analyzeIntelligentContainment(torrentClean, tmdbClean);
    let finalSimilarity = basicSimilarity;
    if (density.hasExcessiveWords) finalSimilarity *= 0.6;
    if (containment.contains) finalSimilarity = Math.min(1.0, finalSimilarity + 0.2);
    else if (containment.contained) finalSimilarity = Math.min(1.0, finalSimilarity + (mediaType === 'movie' && this.extractSequenceNumber(tmdbClean) ? 0.05 : 0.15));
    if (density.hasGoodContext) finalSimilarity = Math.min(1.0, finalSimilarity + 0.1);

    if (mediaType === 'tv' && targetSeason && originalTorrentTitle) {
      if (this.hasExplicitSeason(originalTorrentTitle, targetSeason)) {
        finalSimilarity = Math.min(1.0, finalSimilarity + 0.1 + (this.hasExplicitEpisode(originalTorrentTitle) ? 0.05 : 0));
      }
    }

    const confidence = finalSimilarity >= 0.85 ? 'alta' : finalSimilarity >= 0.7 ? 'média' : 'baixa';
    let reason = `Match ${confidence}: ${(finalSimilarity * 100).toFixed(1)}%`;
    if (density.hasExcessiveWords) reason += ` (muitas palavras extras)`;
    if (containment.contains) reason += ' (torrent contém TMDB)';
    else if (containment.contained) reason += ' (TMDB contém torrent)';
    if (mediaType === 'tv' && targetSeason && originalTorrentTitle && this.hasExplicitSeason(originalTorrentTitle, targetSeason)) reason += ` [TEMPORADA: S${targetSeason} explícita]`;

    return { similarity: finalSimilarity, confidence, reason, contextAnalysis: `normal:${(basicSimilarity * 100).toFixed(1)}` };
  }

  private hasExplicitSeason(title: string, season: number): boolean {
    const lower = title.toLowerCase();
    const patterns = [`s${season.toString().padStart(2, '0')}`, `s${season}`, `season ${season}`, `temporada ${season}`, `temporada ${season}ª`, ` ${season}ª temporada`, `t${season}`, `t${season.toString().padStart(2, '0')}`];
    return patterns.some(p => lower.includes(p));
  }

  private hasExplicitEpisode(title: string): boolean {
    return /\be\d{1,10}\b|\bep\d{1,10}\b|\bepisode \d{1,10}\b|\bepisódio \d{1,10}\b/i.test(title);
  }

  private calculateEnhancedSimilarity(str1: string, str2: string): number {
    const w1 = str1.split(' ').filter(w => w.length > 0);
    const w2 = str2.split(' ').filter(w => w.length > 0);
    if (!w1.length || !w2.length) return 0;
    const set1 = new Set(w1);
    let total = 0;
    w2.forEach((w, i) => { if (set1.has(w)) total += i < 2 ? 1.3 : 1.0; });
    const maxPossible = w2.reduce((s, _, i) => s + (i < 2 ? 1.3 : 1.0), 0);
    return maxPossible > 0 ? total / maxPossible : 0;
  }

  private analyzeWordDensity(torrentClean: string, tmdbClean: string) {
    const tw = torrentClean.split(' ').filter(w => w.length > 2);
    const tmw = tmdbClean.split(' ').filter(w => w.length > 2);
    if (!tmw.length) return { hasExcessiveWords: false, hasGoodContext: false, wordRatio: 0, torrentWords: tw.length, tmdbWords: 0 };
    const ratio = tw.length / tmw.length;
    return { hasExcessiveWords: ratio > 2.0, hasGoodContext: tw.length >= 3 && ratio <= 1.8, wordRatio: ratio, torrentWords: tw.length, tmdbWords: tmw.length };
  }

  private analyzeIntelligentContainment(torrentClean: string, tmdbClean: string) {
    const contains = torrentClean.includes(tmdbClean);
    const contained = tmdbClean.includes(torrentClean);
    const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 2);
    return { contains: contains && tmdbWords.length > 2, contained };
  }

  normalizeForComparison(title: string, mediaType?: 'movie' | 'tv'): string {
    let clean = title
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&[AEIOUYaeiouy](?:grave|acute|circ|tilde|uml|ring|cedil|slash);/g, ' ') // À, É, etc
      .replace(/&(?:ndash|mdash|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|hellip);/g, ' ')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Preserva número de sequência em filmes (ex: "Matrix 2" → "matrix 2")
    let seqSuffix = '';
    if (mediaType === 'movie') {
      const match = clean.match(/^(.+?)\s+(\d+|i{1,3}|iv|v|vi{0,3}|ix|x)$/i);
      if (match) {
        const seq = match[2].toLowerCase();
        const romanMap: Record<string, string> = { i:'1', ii:'2', iii:'3', iv:'4', v:'5', vi:'6', vii:'7', viii:'8', ix:'9', x:'10' };
        const arabic = romanMap[seq] || seq;
        if (/^\d+$/.test(arabic) && parseInt(arabic) <= 20) {
          seqSuffix = ` ${arabic}`;
          clean = match[1];
        }
      }
    }

    clean = clean.replace(/[\/\.\-_:]/g, ' ');
    // Usa regexes pré-compilados (não recompila a cada chamada)
    COMPILED_TECH_WORDS.forEach(re => { clean = clean.replace(re, ''); });
    COMPILED_TECH_ACRONYMS.forEach(re => { clean = clean.replace(re, ''); });
    clean = clean.replace(/\b\d{3,4}[pi]\b/gi, '').replace(/\b[0-9]+k\b/gi, '').replace(/\b[hx]\d{3}\b/gi, '').replace(/\b\d+\.\d+(?:ch)?\b/gi, '');
    clean = clean.replace(/\b\d{1,3}\b/g, '').replace(/\b\d{5,}\b/g, '');
    clean = clean.replace(/\b(19|20)\d{2}\b/g, ''); // remove anos
    clean = clean.replace(/\bs\d{1,3}e\d{1,3}\b/gi, ''); // remove S01E01
    clean = clean.replace(/\s+/g, ' ').trim();

    return clean + seqSuffix;
  }

  private extractYearFromTitle(title: string): number | null {
    const m = title.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : null;
  }

  /**
   * Verifica se o torrent contém palavras significativas que não aparecem
   * em nenhum título TMDB do IMDB solicitado.
   * Ex: "Korra" num torrent quando o TMDB é do Aang.
   */
  private checkForeignWords(
    torrentClean: string,
    allTmdbTitles: string[],
    mediaType?: 'movie' | 'tv'
  ): { hasForeign: boolean; foreignWords: string[]; foreignRatio: number } {
    // Filtra palavras >2 chars e ignora números puros (anos, 1917, etc)
    const torrentWords = torrentClean.split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
    if (torrentWords.length === 0) {
      return { hasForeign: false, foreignWords: [], foreignRatio: 0 };
    }

    // Coleta todas as palavras de todos os títulos TMDB (normalizados)
    const tmdbWords = new Set<string>();
    for (const title of allTmdbTitles) {
      this.normalizeForComparison(title, mediaType)
        .split(' ')
        .filter(w => w.length > 2 && !/^\d+$/.test(w))
        .forEach(w => tmdbWords.add(w));
    }

    // Palavras do torrent que não estão em NENHUM título TMDB
    const foreignWords = torrentWords.filter(w => !tmdbWords.has(w));
    const foreignRatio = foreignWords.length / torrentWords.length;

    return {
      hasForeign: foreignWords.length > 0,
      foreignWords,
      foreignRatio
    };
  }

  calculateWordSimilarity(str1: string, str2: string): number {
    const w1 = str1.split(' ').filter(w => w.length > 0);
    const w2 = str2.split(' ').filter(w => w.length > 0);
    if (!w1.length || !w2.length) return 0;
    if (w1.length === 1 && w2.includes(w1[0])) return 1.0;
    const set1 = new Set(w1);
    const common = w2.filter(w => set1.has(w)).length;
    return common / Math.max(w1.length, w2.length);
  }

  smartTitleContainsCheckSync(torrentTitle: string, imdbTitle: string): SmartTitleMatch {
    const nt = this.normalizeForComparison(torrentTitle);
    const ni = this.normalizeForComparison(imdbTitle);
    const sim = this.calculateWordSimilarity(nt, ni);
    return sim >= 0.5 ? { matches: true, similarity: sim, reason: `Similaridade: ${(sim * 100).toFixed(1)}%` } : { matches: false, similarity: sim, reason: 'Similaridade insuficiente' };
  }

  detectConfusingSeries(torrentTitle: string, imdbTitle: string) {
    const tl = torrentTitle.toLowerCase(), il = imdbTitle.toLowerCase();
    for (const c of this.confusingSeries) {
      if (tl.includes(c.derivative) && il.includes(c.original)) return { isConfusing: true, minSimilarity: c.minSimilarity };
    }
    return { isConfusing: false, minSimilarity: 0 };
  }

  addConfusingSeries(original: string, derivative: string, minSimilarity = 0.8) {
    this.confusingSeries.push({ original: original.toLowerCase(), derivative: derivative.toLowerCase(), minSimilarity });
  }

  listConfusingSeries() { return this.confusingSeries; }
  clearCache() { this.tmdbCache.clear(); }

  suggestSearchQuery(baseTitle: string, type: 'movie' | 'series', season?: number): string {
    const clean = this.normalizeForComparison(baseTitle).trim() || baseTitle;
    return type === 'series' && season !== undefined ? `${clean} s${season.toString().padStart(2, '0')} dual OR dublado` : `${clean} dual OR dublado`;
  }

  getLanguageSearchTerms(): string[] {
    return ['dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio', 'legendado', 'legendada', 'legenda', 'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br', 'português', 'brazilian', 'multi'];
  }

  getStats() {
    return {
      versão: this.VERSAO,
      limiarFilmes: '0.75',
      limiarSéries: '0.65',
      melhorias: ['Override contextual para séries com SxxExx', 'Remoção de logs excessivos']
    };
  }
}

export type { SmartTitleMatch, SeriesConfusion };