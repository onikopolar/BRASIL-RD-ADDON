import { Logger } from '../../utils/logger.js';
import { SmartTitleMatch } from './interfaces.js';
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

    const torrentYear = torrentMetadata?.year || this.extractYearFromTitle(torrentTitle);

    // ═══ NOVA ABORDAGEM: word-by-word dual iteration ═══
    const result = this.wordByWordMatch(torrentTitle, movieInfo);

    if (!result.matches) {
      return result;
    }

    // Validação de ano
    const yearValidation = this.contextualYearValidation(
      movieInfo, torrentYear, torrentTitle, result.similarity, 'alta', torrentMetadata?.season
    );
    if (yearValidation.shouldReject) {
      return { matches: false, similarity: result.similarity * 0.7, reason: yearValidation.reason };
    }

    return result;
  }

  /**
   * CORE: word-by-word com iteração DUPLA.
   * 
   * PASSO 1: Itera palavras do TORRENT
   *   - Se está em ALGUM título TMDB → ok
   *   - Se não está → foreign word (potencialmente perigosa)
   * 
   * PASSO 2: Itera palavras de CADA título TMDB contra o torrent
   *   - Pega o melhor match (mais palavras TMDB encontradas)
   * 
   * DECISÃO baseada em matched/missing/foreign combinados
   */
  private wordByWordMatch(
    torrentTitle: string,
    movieInfo: { allTitles: string[]; mediaType?: 'movie' | 'tv' }
  ): SmartTitleMatch {
    const validTitles = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
    if (validTitles.length === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
    }

    // Normaliza palavras do torrent (>2 chars, não-numéricas)
    const torrentWords = this.normalizeForComparison(torrentTitle, movieInfo.mediaType)
      .split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
    const torrentSet = new Set(torrentWords);

    // Coleta TODAS as palavras de TODOS os títulos TMDB
    const allTmdbWords = new Set<string>();
    for (const title of validTitles) {
      this.normalizeForComparison(title, movieInfo.mediaType)
        .split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w))
        .forEach(w => allTmdbWords.add(w));
    }

    // ═══ PASSO 1: itera TORRENT → coleta foreign words ═══
    const foreignWords: string[] = [];
    for (let i = 0; i < torrentWords.length; i++) {
      const word = torrentWords[i];
      if (!allTmdbWords.has(word)) {
        foreignWords.push(word);
      }
    }

    // ═══ PASSO 2: itera CADA título TMDB → acha o melhor match ═══
    let bestTitle = '';
    let bestMatched = 0;
    let bestTotal = 0;
    let bestMissing: string[] = [];

    for (const title of validTitles) {
      const tmdbWords = this.normalizeForComparison(title, movieInfo.mediaType)
        .split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
      
      let matched = 0;
      const missing: string[] = [];
      for (let j = 0; j < tmdbWords.length; j++) {
        if (torrentSet.has(tmdbWords[j])) {
          matched++;
        } else {
          missing.push(tmdbWords[j]);
        }
      }

      if (matched > bestMatched || (matched === bestMatched && missing.length < bestMissing.length)) {
        bestMatched = matched;
        bestTotal = tmdbWords.length;
        bestMissing = missing;
        bestTitle = title;
      }
    }

    const allTmdbFound = bestMissing.length === 0;
    const ratio = bestTotal > 0 ? bestMatched / bestTotal : 0;

    // ═══ DECISÃO ═══
    if (bestMatched === 0) {
      return { matches: false, similarity: 0, reason: 'Nenhuma palavra TMDB encontrada' };
    }

    // TMDB completo + sem foreign → match perfeito
    if (allTmdbFound && foreignWords.length === 0) {
      return { matches: true, similarity: 1.0, reason: `Match completo: "${bestTitle}"` };
    }

    // TMDB curto (≤2 palavras) + todas batem + foreign → perigoso (sequência/spin-off?)
    if (allTmdbFound && foreignWords.length > 0 && bestTotal <= 2) {
      return { matches: false, similarity: ratio * 0.5, reason: `TMDB curto + palavra estranha: [${foreignWords.join(', ')}]` };
    }

    // TMDB completo + foreign em título longo → aceita (ruído inofensivo)
    if (allTmdbFound && foreignWords.length > 0) {
      return { matches: true, similarity: 0.75, reason: `TMDB completo + extras: [${foreignWords.join(', ')}]` };
    }

    // Faltam TMDB + tem foreign → rejeitar (Korra vs Aang, Clone Wars vs SW)
    if (!allTmdbFound && foreignWords.length > 0) {
      return { matches: false, similarity: ratio * 0.4, reason: `Faltam: [${bestMissing.join(', ')}] + estranhas: [${foreignWords.join(', ')}]` };
    }

    // Faltam TMDB mas sem foreign → borderline (ratio decide)
    if (ratio >= 0.6) {
      return { matches: true, similarity: ratio, reason: `Match parcial: [${bestMatched}/${bestTotal}] "${bestTitle}"` };
    }
    return { matches: false, similarity: ratio, reason: `Match insuficiente: [${bestMatched}/${bestTotal}] "${bestTitle}"` };
  }

  private hasExplicitSeason(title: string, season: number): boolean {
    const lower = title.toLowerCase();
    const patterns = [`s${season.toString().padStart(2, '0')}`, `s${season}`, `season ${season}`, `temporada ${season}`, `temporada ${season}ª`, ` ${season}ª temporada`, `t${season}`, `t${season.toString().padStart(2, '0')}`];
    return patterns.some(p => lower.includes(p));
  }

  private hasExplicitEpisode(title: string): boolean {
    return /\be\d{1,10}\b|\bep\d{1,10}\b|\bepisode \d{1,10}\b|\bepisódio \d{1,10}\b/i.test(title);
  }

  private contextualYearValidation(
    movieInfo: any, torrentYear: number | null, torrentTitle: string,
    semanticSimilarity: number, confidence?: string, targetSeason?: number
  ): { shouldReject: boolean; reason: string } {
    if (!movieInfo.year) return { shouldReject: false, reason: 'TMDB sem ano' };
    if (!torrentYear) {
      if (movieInfo.mediaType === 'tv' && targetSeason && this.hasExplicitSeason(torrentTitle, targetSeason)) {
        if (semanticSimilarity >= 0.65) return { shouldReject: false, reason: `Série com temporada explícita (S${targetSeason})` };
      }
      if (semanticSimilarity >= 0.9) return { shouldReject: false, reason: 'Similaridade alta' };
      return { shouldReject: true, reason: `Requer ano. TMDB: ${movieInfo.year}` };
    }
    if (movieInfo.year !== torrentYear) {
      const yearDiff = Math.abs(movieInfo.year - torrentYear);
      if (yearDiff <= 2 && semanticSimilarity >= 0.85) return { shouldReject: false, reason: `Diferença pequena (${yearDiff} anos)` };
      return { shouldReject: true, reason: `Ano diferente: TMDB ${movieInfo.year} != Torrent ${torrentYear}` };
    }
    return { shouldReject: false, reason: 'Ano válido' };
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

  getStats() {
    return {
      algoritmo: 'word-by-word dual iteration',
      regras: ['match completo', 'TMDB curto + foreign → rejeitar', 'faltam TMDB + foreign → rejeitar']
    };
  }
}

export type { SmartTitleMatch };