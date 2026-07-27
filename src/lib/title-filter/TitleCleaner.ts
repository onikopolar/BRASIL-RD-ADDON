import { Logger } from '../../utils/logger.js';

interface TitleCacheEntry {
  cleaned: string;
  timestamp: number;
}

// Escape regex chars
function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
}

// Pré-compila regexes UMA vez (não a cada chamada do extractCleanTitle)
const COMPILED_TECH_TERMS: RegExp[] = [
  '2160p', '1080p', '720p', '480p', '360p', 'SD', 'HD', 'FHD', 'UHD', '4K', 'HDR',
  'WEB-DL', 'WEBRip', 'WEB-DLRip', 'WEB', 'DL', 'Rip', 'BluRay', 'Blu-ray', 'BRRip', 'BDRip',
  'HDTV', 'PDTV', 'DSR', 'SATRip', 'DVDRip', 'DVD', 'BD', 'BR',
  'x264', 'x265', 'H264', 'H265', 'AVC', 'HEVC', 'XviD', 'DivX',
  'AC3', 'DTS', 'AAC', 'MP3', 'FLAC', 'DD5.1', 'Dolby Digital', 'Dolby',
  'REPACK', 'PROPER', 'READNFO', 'NFO', 'RARBG', 'YTS', 'ETTV', 'EZTV', 'KILLERS', 'GGEZ'
].map(t => new RegExp(`\\b${escRe(t)}\\b`, 'gi'));

const COMPILED_TORRENT_WORDS: RegExp[] = [
  'torrent', 'download', 'baixar', 'baixe'
].map(w => new RegExp(`\\b${escRe(w)}\\b`, 'gi'));

const COMPILED_SEASON_PATTERNS: RegExp[] = [
  /\d+\s*ª?\s*temporada/gi,
  /season\s*\d+/gi,
  /s\d+/gi,
  /\d+\s*epis[oó]dios?/gi,
  /\d+\s*x\s*\d+/gi,
  /s\d+\s*e\d+/gi
];

export class TitleCleaner {
  private readonly logger: Logger;
  private readonly cleanTitleCache = new Map<string, TitleCacheEntry>();
  private readonly TITLE_CACHE_TTL = 5 * 60 * 1000;
  private cleanCallCount = 0;

  private static instance: TitleCleaner;

  public static getInstance(): TitleCleaner {
    if (!TitleCleaner.instance) {
      TitleCleaner.instance = new TitleCleaner();
    }
    return TitleCleaner.instance;
  }

  constructor() {
    this.logger = new Logger('TitleCleaner');
    this.logger.debug('TitleCleaner ready');
  }

  /**
   * Limpa caches antigos
   */
  private cleanupOldCaches(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.cleanTitleCache.entries()) {
      if (now - entry.timestamp > this.TITLE_CACHE_TTL) {
        this.cleanTitleCache.delete(key);
      }
    }
  }

  /**
   * Extrai título limpo - VERSÃO EXATA DO ORIGINAL
   */
  extractCleanTitle(fullTitle: string): string {
    const cacheKey = `clean:${fullTitle}`;
    
    // Limpa caches a cada 200 chamadas (previsível, não aleatório)
    if (++this.cleanCallCount % 200 === 0) {
      this.cleanupOldCaches();
    }
    
    // Verifica cache (igual ao original)
    const cachedEntry = this.cleanTitleCache.get(cacheKey);
    if (cachedEntry) {
      this.logger.debug(' Clean title em cache', {
        original: fullTitle.substring(0, 60),
        cleaned: cachedEntry.cleaned.substring(0, 60)
      });
      return cachedEntry.cleaned;
    }

    this.logger.debug(' Extraindo título limpo', { original: fullTitle });

    // === PASSO 1: Limpeza básica (IGUAL AO ORIGINAL) ===
    let cleaned = fullTitle
      .replace(/&#8211;/g, '-')
      .replace(/&#\d+;/g, ' ')
      .replace(/[\[\]{}()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // === PASSO 2: Remove APENAS termos técnicos (pré-compilado) ===
    COMPILED_TECH_TERMS.forEach(re => { cleaned = cleaned.replace(re, ' '); });

    // === PASSO 3: Remove palavras específicas de torrent (pré-compilado) ===
    COMPILED_TORRENT_WORDS.forEach(re => { cleaned = cleaned.replace(re, ' '); });

    // === PASSO 4: Remove anos (IGUAL AO ORIGINAL) ===
    cleaned = cleaned.replace(/\s*\(\s*\d{4}\s*\)/g, ' ');

    // === PASSO 5: Preserva números com indicadores ordinais (IGUAL AO ORIGINAL) ===
    cleaned = cleaned.replace(/\b(\d{1,2})(ª|º|a|o)\b/gi, '$1$2');

    // === PASSO 6: Preserva padrões de temporada/episódio (pré-compilado) ===
    const hasSeasonInfo = COMPILED_SEASON_PATTERNS.some(pattern => pattern.test(cleaned));

    // === PASSO 7: NÃO REMOVE NÚMEROS SOLTOS quando não tem season info (IGUAL AO ORIGINAL) ===
    // **CRÍTICO:** O original NÃO FAZ NADA aqui quando não tem season info
    // Os números soltos PERMANECEM no título
    // if (!hasSeasonInfo) {
    //   **NO ORIGINAL: Ele não remove números, apenas não processa**
    //   **O código continua sem alterar os números**
    // }

    // === PASSO 8: Limpeza final (IGUAL AO ORIGINAL) ===
    cleaned = cleaned
      .replace(/[._-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // === PASSO 9: Verifica se removeu demais (IGUAL AO ORIGINAL) ===
    const originalWords = fullTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const cleanedWords = cleaned.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    if (cleanedWords.length < originalWords.length * 0.3 && cleanedWords.length > 0) {
      // Fallback: limpeza ultra leve (somente o mais óbvio)
      this.logger.debug(' Limpeza muito agressiva, usando fallback', {
        original: fullTitle.substring(0, 80),
        cleaned: cleaned.substring(0, 80),
        originalWords: originalWords.length,
        cleanedWords: cleanedWords.length
      });
      
      const fallback = fullTitle
        .replace(/&#8211;/g, '-')
        .replace(/&#\d+;/g, ' ')
        .replace(/[\[\]{}()]/g, ' ')
        .replace(/\b(2160p|1080p|720p|480p|SD|HD|4K|WEB-DL|WEBRip|BluRay|x264|x265)\b/gi, ' ')
        .replace(/\b(torrent|download|baixar)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      // Salva fallback no cache
      this.cleanTitleCache.set(cacheKey, {
        cleaned: fallback,
        timestamp: Date.now()
      });
      
      this.logger.debug(' Título limpo extraído (fallback)', {
        original: fullTitle.substring(0, 80),
        cleaned: fallback.substring(0, 80),
        hasSeasonInfo: hasSeasonInfo
      });
      
      return fallback;
    }

    this.logger.debug(' Título limpo extraído', {
      original: fullTitle.substring(0, 80),
      cleaned: cleaned.substring(0, 80),
      hasSeasonInfo: hasSeasonInfo
    });

    // Salva no cache (igual ao original com timestamp)
    this.cleanTitleCache.set(cacheKey, {
      cleaned: cleaned,
      timestamp: Date.now()
    });
    
    return cleaned;
  }

  /**
   * Normaliza título para comparação (IGUAL AO ORIGINAL)
   */
  normalizeForComparison(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Verifica se é sequência numerada (IGUAL AO ORIGINAL)
   */
  isNumberedSequence(torrentTitle: string, imdbTitle: string): boolean {
    const cleanTitle = this.extractCleanTitle(torrentTitle).toLowerCase();
    const cleanImdb = this.extractCleanTitle(imdbTitle).toLowerCase();
    
    if (cleanTitle === cleanImdb) {
      return false;
    }
    
    const imdbWords = cleanImdb.split(' ');
    const titleWords = cleanTitle.split(' ');
    
    if (titleWords.length > imdbWords.length) {
      let matchesStart = true;
      for (let i = 0; i < imdbWords.length; i++) {
        if (titleWords[i] !== imdbWords[i]) {
          matchesStart = false;
          break;
        }
      }
      
      if (matchesStart) {
        const nextWord = titleWords[imdbWords.length];
        const isSequence = /^\d+$/.test(nextWord);
        if (isSequence) {
          this.logger.debug(' Detectada sequência numerada', {
            title: torrentTitle,
            imdbTitle: imdbTitle,
            nextWord: nextWord
          });
        }
        return isSequence;
      }
    }
    
    return false;
  }

  /**
   * Limpa título para deduplicação
   */
  cleanForDeduplication(title: string): string {
    const cleanTitle = this.extractCleanTitle(title);
    return cleanTitle
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s+/g, '_');
  }

  /**
   * Limpa caches
   */
  clearCache(): void {
    this.cleanTitleCache.clear();
    this.logger.info(' Cache do TitleCleaner limpo');
  }

  /**
   * Obtém estatísticas de cache
   */
  getCacheStats(): { cacheSize: number } {
    return { cacheSize: this.cleanTitleCache.size };
  }
}