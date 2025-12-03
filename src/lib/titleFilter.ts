import { Logger } from '../utils/logger';
import { ImdbScraperService, ImdbTitles } from '../services/ImdbScraperService';

export interface SeriesMetadata {
  season?: number;
  episode?: number;
  isCompleteSeason?: boolean;
  hasEpisodeInfo: boolean;
  matchedPattern?: string;
}

export interface TitleMatchResult {
  matches: boolean;
  matchedTitle?: string;
  matchedLanguage?: 'original' | 'português';
  similarity: number;
  torrentMetadata: SeriesMetadata;
  reason: string;
}

// Interface para cache de deduplicação
interface DeduplicationCacheEntry {
  infoHash?: string;
  magnet: string;
  timestamp: number;
  processed: boolean;
}

// Interface para cache de títulos IMDB
interface ImdbTitleCacheEntry {
  titles: ImdbTitles;
  timestamp: number;
}

// Configurações de séries confusas (derivadas vs originais)
interface SeriesConfusion {
  original: string;
  derivative: string;
  minSimilarity: number;
}

export class TitleFilter {
  private readonly logger: Logger;
  private imdbScraper: ImdbScraperService;
  
  // Caches
  private readonly imdbTitleCache = new Map<string, ImdbTitleCacheEntry>();
  private readonly deduplicationCache = new Map<string, DeduplicationCacheEntry>();
  private readonly processedTimestamps = new Map<string, number>();
  private readonly cleanTitleCache = new Map<string, string>();
  private readonly portugueseCheckCache = new Map<string, boolean>();
  
  // Configurações
  private readonly IMDB_CACHE_TTL = 30 * 60 * 1000;
  private readonly DEDUP_CACHE_TTL = 10 * 60 * 1000;
  private readonly TITLE_CACHE_TTL = 5 * 60 * 1000;
  
  // Séries confusas (derivadas vs originais) - FIX CRÍTICO
  private readonly CONFUSING_SERIES: SeriesConfusion[] = [
    {
      original: 'american horror story',
      derivative: 'american horror stories',
      minSimilarity: 0.8 // 80% para evitar confusão
    },
    {
      original: 'stranger things',
      derivative: 'stranger things stories',
      minSimilarity: 0.8
    },
    {
      original: 'black mirror',
      derivative: 'black mirror interactive',
      minSimilarity: 0.8
    }
  ];

  constructor() {
    this.logger = new Logger('TitleFilter');
    this.logger.info('✅ TitleFilter inicializado com logs ativados - BRASIL RD');
    this.imdbScraper = new ImdbScraperService();
  }

  // ==================== SISTEMA DE DEDUPLICAÇÃO ====================

  /**
   * Limpa caches antigos
   */
  private cleanupOldCaches(): void {
    const now = Date.now();
    
    for (const [key, entry] of this.imdbTitleCache.entries()) {
      if (now - entry.timestamp > this.IMDB_CACHE_TTL) {
        this.imdbTitleCache.delete(key);
      }
    }
    
    for (const [key, entry] of this.deduplicationCache.entries()) {
      if (now - entry.timestamp > this.DEDUP_CACHE_TTL) {
        this.deduplicationCache.delete(key);
      }
    }
    
    for (const [key, timestamp] of this.processedTimestamps.entries()) {
      if (now - timestamp > this.TITLE_CACHE_TTL) {
        this.processedTimestamps.delete(key);
      }
    }
  }

  /**
   * Extrai infoHash
   */
  private extractInfoHash(source: string | any): string | null {
    if (typeof source === 'string') {
      const magnetMatch = source.match(/btih:([a-zA-Z0-9]{40})/i);
      return magnetMatch ? magnetMatch[1].toLowerCase() : null;
    } else if (source && typeof source === 'object') {
      if (source.infoHash) {
        return source.infoHash.toLowerCase();
      }
      if (source.magnet && typeof source.magnet === 'string') {
        const magnetMatch = source.magnet.match(/btih:([a-zA-Z0-9]{40})/i);
        return magnetMatch ? magnetMatch[1].toLowerCase() : null;
      }
    }
    return null;
  }

  /**
   * Cria chave de deduplicação
   */
  private createDedupeKey(torrentTitle: string, infoHash?: string): string {
    const cleanTitle = this.extractCleanTitle(torrentTitle).toLowerCase().replace(/\s+/g, '_');
    return infoHash ? `${infoHash}:${cleanTitle}` : cleanTitle;
  }

  /**
   * Verifica se já foi processado
   */
  private isAlreadyProcessed(torrent: any): boolean {
    const infoHash = this.extractInfoHash(torrent.magnet || torrent);
    const title = torrent.title || torrent;
    const dedupeKey = this.createDedupeKey(title, infoHash || undefined);
    
    if (Math.random() < 0.01) {
      this.cleanupOldCaches();
    }
    
    if (this.processedTimestamps.has(dedupeKey)) {
      this.logger.debug('📦 Torrent já processado anteriormente', {
        title: typeof title === 'string' ? title.substring(0, 50) : 'N/A',
        infoHash: infoHash?.substring(0, 8) || 'N/A'
      });
      return true;
    }
    
    this.processedTimestamps.set(dedupeKey, Date.now());
    return false;
  }

  /**
   * Deduplica torrents
   */
  deduplicateTorrents(torrents: any[]): any[] {
    if (torrents.length <= 1) return torrents;
    
    const seen = new Set<string>();
    const uniqueTorrents: any[] = [];
    let duplicatesRemoved = 0;
    
    for (const torrent of torrents) {
      const infoHash = this.extractInfoHash(torrent.magnet || torrent);
      const title = torrent.title || 'unknown';
      
      let key: string;
      if (infoHash) {
        key = infoHash;
      } else {
        const cleanTitle = this.extractCleanTitle(title).toLowerCase();
        key = cleanTitle;
      }
      
      if (seen.has(key)) {
        duplicatesRemoved++;
        this.logger.debug('🗑️ Torrent duplicado removido', {
          title: title.substring(0, 60),
          infoHash: infoHash?.substring(0, 8) || 'N/A'
        });
        continue;
      }
      
      seen.add(key);
      uniqueTorrents.push(torrent);
    }
    
    if (duplicatesRemoved > 0) {
      this.logger.info('✅ Deduplicação concluída', {
        totalAntes: torrents.length,
        totalDepois: uniqueTorrents.length,
        duplicatasRemovidas: duplicatesRemoved
      });
    }
    
    return uniqueTorrents;
  }

  // ==================== FILTRO DE PORTUGUÊS (CORRIGIDO) ====================

  /**
   * VERIFICA SE O CONTEÚDO ESTÁ EM PORTUGUÊS
   */
  isPortugueseContent(torrentTitle: string): boolean {
    const titleCacheKey = torrentTitle.toLowerCase();
    
    this.logger.debug('🔍 Verificando se conteúdo está em português', {
      title: torrentTitle.substring(0, 80)
    });
    
    if (this.portugueseCheckCache.has(titleCacheKey)) {
      const cached = this.portugueseCheckCache.get(titleCacheKey)!;
      this.logger.debug('📦 Resultado em cache', {
        title: torrentTitle.substring(0, 60),
        result: cached ? '✅ Português' : '❌ Não português'
      });
      return cached;
    }

    const titleLower = torrentTitle.toLowerCase();
    
    // ✅ INDICADORES FORTES DE PORTUGUÊS
    const PORTUGUES_INDICATORS = [
      'dublado', 'dublada', 'dublagem', 'dubladores',
      'português', 'portugues', 'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br',
      'legendado', 'legendada', 'legenda', 'legendas', 'legenda pt-br',
      'áudio português', 'audio portugues', 'audio pt-br',
      'brasil', 'brazil', 'br',
      'dual', 'dual áudio', 'dual audio', 'dual-audio',
      'multi', 'multilíngue', 'multilinguagem', 'multilanguage',
      'bludv', 'blu-dv', 'blu.dv', 'blu dv',
      'starck', 'stark', 'starkfilmes',
      'baixafilmes', 'baixa-filmes', 'baixafilmesbr',
      'comandotorrents', 'comando-torrents',
      'jumanji', 'jumanjitorrent',
      'downflix',
      'megalobitz', 'mega-lobitz',
      'hdtvbr', 'hdtv-br',
      'nacional', 'lançamento', 'lancamento', 'versão brasileira'
    ];
    
    // 🚫 INDICADORES DE INGLÊS PURO
    const ENGLISH_ONLY_INDICATORS = [
      '(eng)', '[eng]', '{eng}', '|eng|', '.eng.', '_eng_',
      'english', 'inglês', 'ingles',
      'english audio', 'inglês audio', 'ingles audio',
      'only eng', 'somente inglês', 'apenas inglês',
      'no portuguese', 'sem português', 'without portuguese',
      'eng only', 'english only',
      /\(eng[^)]*\)/i,
      /\[eng[^\]]*\]/i,
    ];
    
    // 1. Verifica inglês puro
    const hasEnglishOnly = ENGLISH_ONLY_INDICATORS.some(indicator => {
      if (typeof indicator === 'string') {
        return titleLower.includes(indicator);
      } else if (indicator instanceof RegExp) {
        return indicator.test(titleLower);
      }
      return false;
    });
    
    if (hasEnglishOnly) {
      this.logger.debug('❌ REJEITADO - Inglês puro detectado', {
        torrentTitle: torrentTitle.substring(0, 80),
        reason: 'Contém indicador de inglês exclusivo'
      });
      this.portugueseCheckCache.set(titleCacheKey, false);
      return false;
    }
    
    // 2. Verifica português
    const hasPortuguese = PORTUGUES_INDICATORS.some(indicator =>
      titleLower.includes(indicator)
    );
    
    if (hasPortuguese) {
      this.logger.debug('✅ ACEITO - Português detectado', {
        torrentTitle: torrentTitle.substring(0, 80),
        reason: 'Contém indicador de português ou dual audio'
      });
      this.portugueseCheckCache.set(titleCacheKey, true);
      return true;
    }
    
    // 3. Termina com (eng) → REJEITA
    if (titleLower.match(/\(eng\)$|\[eng\]$|\{eng\}$|\.eng$/)) {
      this.logger.debug('❌ REJEITADO - Termina com indicador de inglês', {
        torrentTitle: torrentTitle.substring(0, 80),
        reason: 'Termina com (eng), [eng] ou .eng'
      });
      this.portugueseCheckCache.set(titleCacheKey, false);
      return false;
    }
    
    // 4. Grupo internacional + tags inglesas → REJEITA
    const internationalGroups = ['yts', 'rarbg', 'ettv', 'eztv', 'skgtv', 'rartv', 'turbotorrent'];
    const commonEnglishTags = ['webrip', 'web-dl', 'hdtv', 'bluray', 'x264', 'x265', 'h264', 'h265'];
    
    const hasInternationalGroup = internationalGroups.some(group => titleLower.includes(group));
    const hasEnglishTags = commonEnglishTags.some(tag => titleLower.includes(tag));
    
    if (hasInternationalGroup && hasEnglishTags) {
      this.logger.debug('❌ REJEITADO - Grupo internacional sem português', {
        torrentTitle: torrentTitle.substring(0, 80),
        reason: 'Grupo de release internacional sem indicadores de português'
      });
      this.portugueseCheckCache.set(titleCacheKey, false);
      return false;
    }
    
    // 5. CORREÇÃO: Análise contextual para benefício da dúvida
    // Verifica se tem padrões comuns em releases BR
    const brPatterns = [
      /\d+\s*ª?\s*temporada/i,  // Xª Temporada
      /completa\s*\d+\s*temporada/i,
      /season\s*\d+\s*complete/i,
      /\d+\s*epis[oó]dios/i
    ];
    
    const hasBRPatterns = brPatterns.some(pattern => pattern.test(titleLower));
    
    if (hasBRPatterns) {
      // Tem padrão BR, dá benefício da dúvida
      this.logger.debug('⚠️ ACEITO - Benefício da dúvida (padrão BR)', {
        torrentTitle: torrentTitle.substring(0, 80),
        reason: 'Tem padrões comuns de releases brasileiros'
      });
      this.portugueseCheckCache.set(titleCacheKey, true);
      return true;
    }
    
    // 6. FIX CRÍTICO: Verificação mais inteligente de palavras-chave
    // Não aceitar títulos com "stories" quando buscamos "story"
    const keywordChecks = [
      {
        keywords: ['horror story', 'historia de horror'],
        description: 'Título relevante para American Horror Story'
      },
      {
        keywords: ['breaking bad', 'breaking bad'],
        description: 'Título relevante para Breaking Bad'
      }
    ];
    
    let hasRelevantKeywords = false;
    for (const check of keywordChecks) {
      if (check.keywords.some(keyword => titleLower.includes(keyword))) {
        hasRelevantKeywords = true;
        this.logger.debug('✅ Palavras-chave relevantes encontradas', {
          torrentTitle: torrentTitle.substring(0, 80),
          keywords: check.keywords,
          description: check.description
        });
        break;
      }
    }
    
    // Se não tem indicadores claros E não tem palavras-chave relevantes → REJEITA
    if (!hasRelevantKeywords) {
      this.logger.debug('❌ REJEITADO - Título irrelevante', {
        torrentTitle: torrentTitle.substring(0, 80),
        reason: 'Sem indicadores de português e sem palavras-chave relevantes'
      });
      this.portugueseCheckCache.set(titleCacheKey, false);
      return false;
    }
    
    // 7. FIX: Verificar séries confusas
    for (const confusion of this.CONFUSING_SERIES) {
      const hasDerivative = titleLower.includes(confusion.derivative);
      if (hasDerivative) {
        this.logger.debug('⚠️ Possível série derivada confusa', {
          torrentTitle: torrentTitle.substring(0, 80),
          derivative: confusion.derivative,
          original: confusion.original,
          warning: 'Será exigida similaridade mais alta'
        });
        // Continua, mas será exigida similaridade mais alta
      }
    }
    
    // Se tem palavras-chave relevantes, dá benefício da dúvida
    this.logger.debug('⚠️ ACEITO - Benefício da dúvida (palavras-chave)', {
      torrentTitle: torrentTitle.substring(0, 80),
      reason: 'Tem palavras-chave relevantes para o conteúdo buscado'
    });
    this.portugueseCheckCache.set(titleCacheKey, true);
    return true;
  }

  // ==================== UTILITÁRIOS DE TÍTULO ====================

  /**
   * Normaliza título para comparação
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
   * Extrai título limpo
   */
  extractCleanTitle(fullTitle: string): string {
    const cacheKey = `clean:${fullTitle}`;
    if (this.cleanTitleCache.has(cacheKey)) {
      const cached = this.cleanTitleCache.get(cacheKey)!;
      this.logger.debug('📦 Clean title em cache', {
        original: fullTitle.substring(0, 60),
        cleaned: cached.substring(0, 60)
      });
      return cached;
    }

    this.logger.debug('🧹 Extraindo título limpo', {
      original: fullTitle
    });

    // Passo 1: Limpeza básica
    let cleaned = fullTitle
      .replace(/&#8211;/g, '-')
      .replace(/&#\d+;/g, ' ')
      .replace(/[\[\]{}()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Passo 2: Remove APENAS termos técnicos
    const technicalTerms = [
      // Qualidades
      '2160p', '1080p', '720p', '480p', '360p', 'SD', 'HD', 'FHD', 'UHD', '4K', 'HDR',
      // Formatos
      'WEB-DL', 'WEBRip', 'WEB-DLRip', 'WEB', 'DL', 'Rip', 'BluRay', 'Blu-ray', 'BRRip', 'BDRip',
      'HDTV', 'PDTV', 'DSR', 'SATRip', 'DVDRip', 'DVD', 'BD', 'BR',
      // Codecs
      'x264', 'x265', 'H264', 'H265', 'AVC', 'HEVC', 'XviD', 'DivX',
      // Áudio (exceto Dual/Audio)
      'AC3', 'DTS', 'AAC', 'MP3', 'FLAC', 'DD5.1', 'Dolby Digital', 'Dolby',
      // Outros técnicos
      'REPACK', 'PROPER', 'READNFO', 'NFO', 'RARBG', 'YTS', 'ETTV', 'EZTV', 'KILLERS', 'GGEZ'
    ];

    // Remove termos técnicos
    technicalTerms.forEach(term => {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      cleaned = cleaned.replace(regex, ' ');
    });

    // Passo 3: Remove palavras específicas de torrent
    const torrentWords = [
      'torrent', 'download', 'baixar', 'baixe'
    ];
    
    torrentWords.forEach(word => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      cleaned = cleaned.replace(regex, ' ');
    });

    // Passo 4: Remove anos
    cleaned = cleaned.replace(/\s*\(\s*\d{4}\s*\)/g, ' ');

    // Passo 5: Preserva números com indicadores ordinais
    cleaned = cleaned.replace(/\b(\d{1,2})(ª|º|a|o)\b/gi, '$1$2');

    // Passo 6: Preserva padrões de temporada/episódio
    const seasonPatterns = [
      /\d+\s*ª?\s*temporada/gi,
      /season\s*\d+/gi,
      /s\d+/gi,
      /\d+\s*epis[oó]dios?/gi,
      /\d+\s*x\s*\d+/gi,
      /s\d+\s*e\d+/gi
    ];
    
    const hasSeasonInfo = seasonPatterns.some(pattern => pattern.test(cleaned));
    
    if (!hasSeasonInfo) {
      cleaned = cleaned.replace(/\b(\d{1,2})\b(?!(?:ª|º|a|o|th|nd|rd|st))/g, ' ');
    }

    // Passo 7: Limpeza final
    cleaned = cleaned
      .replace(/[._-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Passo 8: Verifica se removeu demais
    const originalWords = fullTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const cleanedWords = cleaned.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    
    if (cleanedWords.length < originalWords.length * 0.3 && cleanedWords.length > 0) {
      // Fallback: limpeza ultra leve
      this.logger.debug('⚠️ Limpeza muito agressiva, usando fallback', {
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
      
      this.cleanTitleCache.set(cacheKey, fallback);
      return fallback;
    }

    this.logger.debug('✅ Título limpo extraído', {
      original: fullTitle.substring(0, 80),
      cleaned: cleaned.substring(0, 80),
      hasSeasonInfo: hasSeasonInfo
    });

    this.cleanTitleCache.set(cacheKey, cleaned);
    return cleaned;
  }

  /**
   * Verifica se é sequência numerada
   */
  private isNumberedSequence(title: string, imdbTitle: string): boolean {
    const cleanTitle = this.extractCleanTitle(title).toLowerCase();
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
          this.logger.debug('⚠️ Detectada sequência numerada', {
            title: title,
            imdbTitle: imdbTitle,
            nextWord: nextWord
          });
        }
        return isSequence;
      }
    }
    
    return false;
  }

  // ==================== EXTRATOR DE METADADOS ====================

  /**
   * Extrai metadados de série
   */
  extractSeriesMetadata(torrentTitle: string): SeriesMetadata {
    this.logger.debug('📊 Extraindo metadados de série', {
      torrentTitle: torrentTitle.substring(0, 80)
    });
    
    const title = torrentTitle.toLowerCase();
    const metadata: SeriesMetadata = {
      hasEpisodeInfo: false
    };

    // Temporada completa
    const completeSeasonPatterns = [
      /(\d+)\s*(?:ª|a|°|o)?\s*temporada\s*(?:completa|inteira)/i,
      /temporada\s*(\d+)\s*(?:completa|inteira)/i,
      /season\s*(\d+)\s*(?:complete|full)/i,
      /s(\d+)\s*(?:complete|full)/i
    ];

    for (const pattern of completeSeasonPatterns) {
      const match = title.match(pattern);
      if (match) {
        const season = parseInt(match[1]);
        if (!isNaN(season) && season > 0) {
          this.logger.debug('🎯 Temporada completa detectada', {
            torrentTitle: torrentTitle.substring(0, 60),
            season: season,
            pattern: match[0]
          });
          return {
            season,
            isCompleteSeason: true,
            hasEpisodeInfo: true,
            matchedPattern: match[0]
          };
        }
      }
    }

    // Temporada
    let seasonFound: number | undefined;
    const seasonPatterns = [
      /(\d+)\s*(?:ª|a|°|o)?\s*temporada/i,
      /temporada\s*(\d+)/i,
      /season\s*(\d+)/i,
      /s(\d+)\b(?!e\d)/i
    ];

    for (const pattern of seasonPatterns) {
      const match = title.match(pattern);
      if (match) {
        const season = parseInt(match[1]);
        if (!isNaN(season) && season > 0) {
          seasonFound = season;
          metadata.season = season;
          metadata.matchedPattern = match[0];
          this.logger.debug('📺 Temporada detectada', {
            torrentTitle: torrentTitle.substring(0, 60),
            season: season,
            pattern: match[0]
          });
          break;
        }
      }
    }

    // Episódio
    const episodePatterns = [
      /s(\d+)e(\d+)/i,
      /(\d+)x(\d+)/i,
      /temporada[\s\._-]?(\d+)[\s\._-]?epis[oó]dio[\s\._-]?(\d+)/i,
      /ep(?:isode)?\s*(\d+)/i,
      /(\d+)\s*-\s*(\d+)/,
      /\b(\d)(\d{2})\b/
    ];

    for (const pattern of episodePatterns) {
      const match = title.match(pattern);
      if (match) {
        let season = seasonFound;
        let episode: number;

        if (pattern.source === 's(\\d+)e(\\d+)') {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source === '(\\d+)x(\\d+)') {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('temporada') && pattern.source.includes('epis')) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          episode = parseInt(match[1]);
        } else if (pattern.source === '(\\d+)\\s*-\\s*(\\d+)') {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source === '\\b(\\d)(\\d{2})\\b') {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else {
          continue;
        }

        if (!isNaN(episode) && episode > 0) {
          if (season && !isNaN(season) && season > 0) {
            metadata.season = season;
          }
          metadata.episode = episode;
          metadata.hasEpisodeInfo = true;
          metadata.matchedPattern = match[0];
          
          this.logger.debug('🎬 Episódio detectado', {
            torrentTitle: torrentTitle.substring(0, 60),
            season: season || 'N/A',
            episode: episode,
            pattern: match[0]
          });
          break;
        }
      }
    }

    if (metadata.season && !metadata.hasEpisodeInfo) {
      metadata.hasEpisodeInfo = true;
      this.logger.debug('📺 Temporada sem episódio específico', {
        torrentTitle: torrentTitle.substring(0, 60),
        season: metadata.season
      });
    }

    return metadata;
  }

  // ==================== COMPARAÇÃO DE TÍTULOS ====================

  /**
   * Obtém títulos do IMDB com cache
   */
  private async getImdbTitlesWithCache(imdbId: string): Promise<ImdbTitles | null> {
    this.logger.debug('🎬 Buscando títulos do IMDB', { imdbId });
    
    const cacheEntry = this.imdbTitleCache.get(imdbId);
    if (cacheEntry && Date.now() - cacheEntry.timestamp < this.IMDB_CACHE_TTL) {
      this.logger.debug('📦 Títulos do IMDB em cache', { imdbId });
      return cacheEntry.titles;
    }
    
    try {
      const titles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
      if (titles.allTitles.length > 0) {
        this.logger.debug('✅ Títulos do IMDB obtidos', {
          imdbId,
          originalTitle: titles.originalTitle,
          portugueseTitle: titles.portugueseTitle,
          totalTitles: titles.allTitles.length
        });
        
        this.imdbTitleCache.set(imdbId, {
          titles,
          timestamp: Date.now()
        });
        return titles;
      } else {
        this.logger.warn('⚠️ Nenhum título encontrado no IMDB', { imdbId });
      }
    } catch (error) {
      this.logger.error('❌ Erro ao obter títulos do IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
    
    return null;
  }

  /**
   * FIX CRÍTICO: Detecta séries confusas (derivadas vs originais)
   */
  private detectConfusingSeries(torrentTitle: string, imdbTitle: string): { isConfusing: boolean; minSimilarity: number } {
    const torrentLower = torrentTitle.toLowerCase();
    const imdbLower = imdbTitle.toLowerCase();
    
    for (const confusion of this.CONFUSING_SERIES) {
      const hasDerivative = torrentLower.includes(confusion.derivative);
      const hasOriginal = imdbLower.includes(confusion.original);
      
      if (hasDerivative && hasOriginal) {
        this.logger.debug('⚠️ Série derivada confusa detectada', {
          torrentTitle: torrentTitle.substring(0, 60),
          imdbTitle: imdbTitle,
          derivative: confusion.derivative,
          original: confusion.original,
          minSimilarity: confusion.minSimilarity
        });
        return { isConfusing: true, minSimilarity: confusion.minSimilarity };
      }
    }
    
    return { isConfusing: false, minSimilarity: 0 };
  }

  /**
   * Comparação inteligente português/inglês
   */
  private smartTitleContainsCheck(torrentTitle: string, imdbTitle: string): { matches: boolean; similarity: number; reason: string } {
    this.logger.debug('🔍 Comparação inteligente de títulos', {
      torrentTitle: torrentTitle.substring(0, 80),
      imdbTitle: imdbTitle.substring(0, 60)
    });
    
    // FIX CRÍTICO: Verifica séries confusas primeiro
    const confusionCheck = this.detectConfusingSeries(torrentTitle, imdbTitle);
    
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);
    
    // 1. Verificação direta (contains)
    if (normTorrent.includes(normImdb) && normImdb.length >= 5) {
      this.logger.debug('✅ Match direto - IMDB contido no torrent', {
        torrentTitle: normTorrent,
        imdbTitle: normImdb
      });
      return {
        matches: true,
        similarity: 0.95,
        reason: 'Título do IMDB encontrado no torrent'
      };
    }
    
    if (normImdb.includes(normTorrent) && normTorrent.length >= 5) {
      this.logger.debug('✅ Match direto - torrent contido no IMDB', {
        torrentTitle: normTorrent,
        imdbTitle: normImdb
      });
      return {
        matches: true,
        similarity: 0.90,
        reason: 'Título do torrent encontrado no IMDB'
      };
    }
    
    // 2. Comparação com títulos limpos
    const cleanTorrent = this.extractCleanTitle(torrentTitle);
    const cleanImdb = this.extractCleanTitle(imdbTitle);
    
    const normCleanTorrent = this.normalizeForComparison(cleanTorrent);
    const normCleanImdb = this.normalizeForComparison(cleanImdb);
    
    if (normCleanTorrent.includes(normCleanImdb) && normCleanImdb.length >= 3) {
      this.logger.debug('✅ Match clean - IMDB contido no torrent (clean)', {
        cleanTorrent: normCleanTorrent,
        cleanImdb: normCleanImdb
      });
      return {
        matches: true,
        similarity: 0.85,
        reason: 'Título limpo do IMDB no torrent'
      };
    }
    
    if (normCleanImdb.includes(normCleanTorrent) && normCleanTorrent.length >= 3) {
      this.logger.debug('✅ Match clean - torrent contido no IMDB (clean)', {
        cleanTorrent: normCleanTorrent,
        cleanImdb: normCleanImdb
      });
      return {
        matches: true,
        similarity: 0.80,
        reason: 'Título limpo do torrent no IMDB'
      };
    }
    
    // 3. Verificação de palavras-chave
    const torrentWords = new Set(normCleanTorrent.split(' ').filter(w => w.length > 2));
    const imdbWords = normCleanImdb.split(' ').filter(w => w.length > 2);
    
    const commonWords = imdbWords.filter(word => torrentWords.has(word));
    const similarityRatio = imdbWords.length > 0 ? commonWords.length / imdbWords.length : 0;
    
    // FIX: Ajusta threshold baseado em séries confusas
    const baseThreshold = 0.4;
    const adjustedThreshold = confusionCheck.isConfusing ? 
      Math.max(baseThreshold, confusionCheck.minSimilarity) : 
      baseThreshold;
    
    // DEBUG: Log para análise
    this.logger.debug('📐 Threshold ajustado', {
      baseThreshold,
      adjustedThreshold,
      isConfusing: confusionCheck.isConfusing,
      minSimilarity: confusionCheck.minSimilarity,
      similarityRatio
    });
    
    if (similarityRatio >= adjustedThreshold) {
      this.logger.debug('✅ Match por palavras em comum', {
        torrentWords: Array.from(torrentWords),
        imdbWords: imdbWords,
        commonWords: commonWords,
        similarity: `${(similarityRatio * 100).toFixed(1)}%`,
        threshold: `${(adjustedThreshold * 100).toFixed(1)}%`
      });
      return {
        matches: true,
        similarity: similarityRatio,
        reason: `Palavras em comum: ${commonWords.length}/${imdbWords.length}`
      };
    } else if (confusionCheck.isConfusing) {
      this.logger.debug('❌ Série derivada com similaridade insuficiente', {
        torrentTitle: torrentTitle.substring(0, 60),
        imdbTitle: imdbTitle,
        similarity: `${(similarityRatio * 100).toFixed(1)}%`,
        required: `${(confusionCheck.minSimilarity * 100).toFixed(1)}%`
      });
      return { 
        matches: false, 
        similarity: similarityRatio, 
        reason: `Série derivada precisa de ${confusionCheck.minSimilarity * 100}% de similaridade` 
      };
    }
    
    this.logger.debug('❌ Nenhum match encontrado', {
      torrentTitle: torrentTitle.substring(0, 60),
      imdbTitle: imdbTitle,
      similarity: `${(similarityRatio * 100).toFixed(1)}%`,
      threshold: `${(adjustedThreshold * 100).toFixed(1)}%`
    });
    
    return { matches: false, similarity: 0, reason: '' };
  }

  /**
   * **CORREÇÃO COMPLETA:** Verifica se títulos combinam
   */
  async doTitlesMatch(
    torrentTitle: string,
    imdbId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<TitleMatchResult> {
    this.logger.debug('🎯 Iniciando verificação completa de títulos', {
      torrentTitle: torrentTitle.substring(0, 100),
      imdbId,
      targetSeason,
      targetEpisode
    });
    
    try {
      // 1. Verificação obrigatória de português
      this.logger.debug('🇧🇷 Verificando se conteúdo está em português...');
      const isPortuguese = this.isPortugueseContent(torrentTitle);
      
      if (!isPortuguese) {
        const metadata = this.extractSeriesMetadata(torrentTitle);
        this.logger.warn('❌ Conteúdo rejeitado - não está em português', {
          torrentTitle: torrentTitle.substring(0, 80),
          metadata: {
            season: metadata.season,
            episode: metadata.episode,
            hasEpisodeInfo: metadata.hasEpisodeInfo
          }
        });
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadata,
          reason: '❌ Conteúdo não está em português (regra BRASIL RD)'
        };
      }
      
      this.logger.debug('✅ Conteúdo está em português, continuando...');

      // 2. Obtém títulos do IMDB
      this.logger.debug('🎬 Buscando títulos do IMDB...');
      const imdbTitles = await this.getImdbTitlesWithCache(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const metadata = this.extractSeriesMetadata(torrentTitle);
        this.logger.warn('❌ Nenhum título encontrado no IMDB', {
          imdbId,
          torrentTitle: torrentTitle.substring(0, 80)
        });
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: metadata,
          reason: `Nenhum título encontrado no IMDB para ${imdbId}`
        };
      }

      // 3. Validação de série
      const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
      
      // **FIX MELHORADO:** Validação inteligente para episódios
      if (targetSeason !== undefined) {
        // Se busca episódio específico...
        if (targetEpisode !== undefined) {
          // E torrent é temporada completa → ACEITA (Real-Debrid vai extrair o episódio)
          if (torrentMetadata.isCompleteSeason) {
            this.logger.debug('⚠️ Temporada completa - Real-Debrid vai extrair episódio', {
              torrentTitle: torrentTitle.substring(0, 80),
              targetSeason,
              targetEpisode,
              torrentIsComplete: true
            });
            // Continua verificação - não rejeita
          }
          
          // E torrent tem episódio diferente → REJEITA
          else if (torrentMetadata.episode && torrentMetadata.episode !== targetEpisode) {
            this.logger.warn('❌ Episódio diferente', {
              torrentTitle: torrentTitle.substring(0, 80),
              torrentEpisode: torrentMetadata.episode,
              targetEpisode
            });
            return {
              matches: false,
              similarity: 0,
              torrentMetadata,
              reason: `❌ Episódio diferente: Torrent E${torrentMetadata.episode} vs E${targetEpisode}`
            };
          }
          
          // **FIX MELHORADO:** Se torrent NÃO especifica episódio mas buscamos específico
          else if (!torrentMetadata.episode && !torrentMetadata.isCompleteSeason) {
            // Verifica se é um PACOTE que pode conter o episódio
            const hasPackageIndicators = torrentTitle.toLowerCase().includes('pack') || 
                                         torrentTitle.toLowerCase().includes('pacote') ||
                                         torrentTitle.toLowerCase().includes('temporada') ||
                                         torrentTitle.toLowerCase().includes('season') ||
                                         torrentTitle.toLowerCase().includes('complete') ||
                                         torrentTitle.toLowerCase().includes('completa') ||
                                         torrentTitle.toLowerCase().includes('full') ||
                                         torrentTitle.toLowerCase().includes('inteira');
            
            if (!hasPackageIndicators) {
              this.logger.warn('❌ Torrent não especifica episódio', {
                torrentTitle: torrentTitle.substring(0, 80),
                targetEpisode
              });
              return {
                matches: false,
                similarity: 0,
                torrentMetadata,
                reason: '❌ Busca episódio específico mas torrent não especifica episódio'
              };
            } else {
              this.logger.debug('⚠️ Pacote de temporada - pode conter episódio', {
                torrentTitle: torrentTitle.substring(0, 80),
                targetEpisode,
                indicators: ['pack', 'pacote', 'temporada', 'season', 'complete', 'completa', 'full', 'inteira'].filter(ind => 
                  torrentTitle.toLowerCase().includes(ind)
                )
              });
              // Continua verificação - não rejeita
            }
          }
        }
        
        // Validação de temporada
        if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
          this.logger.warn('❌ Temporada diferente', {
            torrentTitle: torrentTitle.substring(0, 80),
            torrentSeason: torrentMetadata.season,
            targetSeason
          });
          return {
            matches: false,
            similarity: 0,
            torrentMetadata,
            reason: `❌ Temporada diferente: Torrent S${torrentMetadata.season} vs S${targetSeason}`
          };
        }
      }

      // 4. Compara com todos os títulos do IMDB
      let bestMatch = {
        similarity: 0,
        matchedTitle: '',
        matchedLanguage: 'original' as 'original' | 'português',
        reason: ''
      };

      const titlesToTry = [];
      if (imdbTitles.portugueseTitle) {
        titlesToTry.push({
          title: imdbTitles.portugueseTitle,
          language: 'português' as const
        });
      }
      titlesToTry.push({
        title: imdbTitles.originalTitle,
        language: 'original' as const
      });

      this.logger.debug('🔍 Comparando com títulos do IMDB', {
        totalTitlesToTry: titlesToTry.length,
        titles: titlesToTry.map(t => t.title)
      });

      for (const { title: imdbTitle, language } of titlesToTry) {
        this.logger.debug(`🔍 Tentando título (${language}): ${imdbTitle}`);
        const smartMatch = this.smartTitleContainsCheck(torrentTitle, imdbTitle);
        if (smartMatch.matches && smartMatch.similarity > bestMatch.similarity) {
          bestMatch = {
            similarity: smartMatch.similarity,
            matchedTitle: imdbTitle,
            matchedLanguage: language,
            reason: smartMatch.reason
          };
          this.logger.debug(`✅ Novo melhor match encontrado`, {
            similarity: bestMatch.similarity,
            language: bestMatch.matchedLanguage,
            reason: bestMatch.reason
          });
        }
      }

      // 5. FIX: Threshold dinâmico baseado em confusão de séries
      let baseThreshold = targetSeason !== undefined ? 0.3 : 0.4;
      
      // Aumenta threshold se for série derivada confusa
      const confusionCheck = this.detectConfusingSeries(torrentTitle, bestMatch.matchedTitle || '');
      if (confusionCheck.isConfusing) {
        baseThreshold = Math.max(baseThreshold, confusionCheck.minSimilarity);
        this.logger.debug('⚠️ Threshold aumentado para série derivada', {
          originalThreshold: targetSeason !== undefined ? 0.3 : 0.4,
          newThreshold: baseThreshold,
          minSimilarityRequired: confusionCheck.minSimilarity
        });
      }
      
      const matches = bestMatch.similarity >= baseThreshold;

      const result = {
        matches,
        matchedTitle: bestMatch.matchedTitle,
        matchedLanguage: bestMatch.matchedLanguage,
        similarity: bestMatch.similarity,
        torrentMetadata,
        reason: matches ?
          `✅ ${bestMatch.reason} (${(bestMatch.similarity * 100).toFixed(1)}%)` :
          `❌ Similaridade insuficiente: ${(bestMatch.similarity * 100).toFixed(1)}% < ${baseThreshold * 100}%`
      };

      this.logger.debug('📊 Resultado final da comparação', result);
      return result;

    } catch (error) {
      this.logger.error('💥 Erro ao comparar títulos', {
        torrentTitle,
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        stack: error instanceof Error ? error.stack : 'No stack'
      });

      return {
        matches: false,
        similarity: 0,
        torrentMetadata: this.extractSeriesMetadata(torrentTitle),
        reason: `Erro ao processar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  /**
   * Versão síncrona
   */
  doTitlesMatchSync(
    torrentTitle: string,
    imdbTitle: string,
    targetSeason?: number,
    targetEpisode?: number
  ): boolean {
    this.logger.debug('⚡ Comparação síncrona de títulos', {
      torrentTitle: torrentTitle.substring(0, 80),
      imdbTitle: imdbTitle.substring(0, 60),
      targetSeason,
      targetEpisode
    });
    
    if (!this.isPortugueseContent(torrentTitle)) {
      this.logger.debug('❌ Conteúdo não está em português (sync)');
      return false;
    }

    // FIX: Verifica séries confusas primeiro
    const confusionCheck = this.detectConfusingSeries(torrentTitle, imdbTitle);
    const baseThreshold = 0.4;
    const adjustedThreshold = confusionCheck.isConfusing ? 
      Math.max(baseThreshold, confusionCheck.minSimilarity) : 
      baseThreshold;

    const smartMatch = this.smartTitleContainsCheck(torrentTitle, imdbTitle);
    if (smartMatch.matches && smartMatch.similarity >= adjustedThreshold) {
      this.logger.debug('✅ Match encontrado (sync)', {
        similarity: smartMatch.similarity,
        threshold: adjustedThreshold
      });
      return true;
    }

    // Validação de série
    if (targetSeason !== undefined) {
      const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
      
      if (torrentMetadata.hasEpisodeInfo) {
        if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
          this.logger.debug('❌ Temporada diferente (sync)');
          return false;
        }
        
        if (targetEpisode !== undefined && torrentMetadata.episode) {
          if (torrentMetadata.episode !== targetEpisode) {
            this.logger.debug('❌ Episódio diferente (sync)');
            return false;
          }
        }
        
        if (targetEpisode !== undefined && torrentMetadata.isCompleteSeason) {
          // **FIX:** Temporada completa pode conter o episódio
          this.logger.debug('⚠️ Temporada completa - pode conter episódio (sync)');
          // Continua verificação
        }
      }
    }

    // Similaridade como fallback
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);
    const similarity = this.calculateSequenceSimilarity(normTorrent, normImdb);
    
    const result = similarity >= adjustedThreshold;
    this.logger.debug(`📊 Similaridade: ${(similarity * 100).toFixed(1)}% → ${result ? '✅ Aceito' : '❌ Rejeitado'}`);
    return result;
  }

  /**
   * Calcula similaridade por sequência
   */
  private calculateSequenceSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ').filter(w => w.length > 0);
    const words2 = str2.split(' ').filter(w => w.length > 0);

    if (words1.length === 0 || words2.length === 0) return 0;

    let maxCommonLength = 0;

    for (let i = 0; i < words1.length; i++) {
      for (let j = 0; j < words2.length; j++) {
        let common = 0;
        let k = 0;

        while (i + k < words1.length && j + k < words2.length &&
               words1[i + k] === words2[j + k]) {
          common++;
          k++;
        }

        if (common > maxCommonLength) {
          maxCommonLength = common;
        }
      }
    }

    const maxLength = Math.max(words1.length, words2.length);
    const similarity = maxCommonLength / maxLength;
    
    this.logger.debug('📐 Cálculo de similaridade por sequência', {
      str1: str1.substring(0, 50),
      str2: str2.substring(0, 50),
      maxCommonLength,
      maxLength,
      similarity: `${(similarity * 100).toFixed(1)}%`
    });
    
    return similarity;
  }

  // ==================== APLICAÇÃO DE FILTRO ====================

  /**
   * Filtra torrents baseado no IMDB ID
   */
  async applyTitleFilter(
    torrents: any[],
    imdbId: string,
    requestId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<any[]> {
    const startTime = Date.now();
    
    this.logger.info('🚀 APLICANDO FILTRO DE TÍTULO (BRASIL RD)', {
      requestId,
      imdbId,
      targetSeason,
      targetEpisode,
      totalTorrents: torrents.length
    });

    // 1. Deduplicação
    const uniqueTorrents = this.deduplicateTorrents(torrents);
    
    const results = {
      included: [] as any[],
      excluded: [] as any[],
      reasons: [] as string[],
      duplicatesRemoved: torrents.length - uniqueTorrents.length
    };

    // 2. Filtro de português
    this.logger.debug('🇧🇷 Aplicando filtro de português...');
    const portugueseTorrents = uniqueTorrents.filter(torrent => {
      if (this.isAlreadyProcessed(torrent)) {
        results.excluded.push(torrent);
        results.reasons.push(`⏭️  "${torrent.title}" → Já processado`);
        return false;
      }

      const isPortuguese = this.isPortugueseContent(torrent.title);
      if (!isPortuguese) {
        results.excluded.push(torrent);
        results.reasons.push(`❌ "${torrent.title}" → Não português`);
      }
      return isPortuguese;
    });

    this.logger.info('📊 Resultado filtro português', {
      totalAntes: uniqueTorrents.length,
      portugueses: portugueseTorrents.length,
      excluidosNaoPortugues: uniqueTorrents.length - portugueseTorrents.length
    });

    if (portugueseTorrents.length === 0) {
      this.logger.warn('⚠️ Nenhum torrent em português encontrado', {
        requestId,
        imdbId,
        totalTorrents: uniqueTorrents.length
      });
      return [];
    }

    // 3. Obtém títulos do IMDB
    this.logger.debug('🎬 Obtendo títulos do IMDB...');
    let imdbTitles: ImdbTitles | null;
    try {
      imdbTitles = await this.getImdbTitlesWithCache(imdbId);
      if (!imdbTitles) {
        this.logger.error('❌ Não foi possível obter títulos do IMDB', { imdbId });
        return [];
      }
    } catch (error) {
      this.logger.error('💥 Erro ao obter títulos do IMDB', {
        requestId,
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return [];
    }

    // 4. Processa cada torrent
    this.logger.debug(`🔍 Processando ${portugueseTorrents.length} torrents em português...`);
    for (const torrent of portugueseTorrents) {
      const torrentMetadata = this.extractSeriesMetadata(torrent.title);
      let bestMatch = { 
        similarity: 0, 
        matchedTitle: '', 
        matchedLanguage: 'original' as 'original' | 'português' 
      };

      const titlesToTry = [];
      if (imdbTitles.portugueseTitle) {
        titlesToTry.push({ title: imdbTitles.portugueseTitle, language: 'português' as const });
      }
      titlesToTry.push({ title: imdbTitles.originalTitle, language: 'original' as const });

      for (const { title: imdbTitle, language } of titlesToTry) {
        const match = this.smartTitleContainsCheck(torrent.title, imdbTitle);
        if (match.matches && match.similarity > bestMatch.similarity) {
          bestMatch = {
            similarity: match.similarity,
            matchedTitle: imdbTitle,
            matchedLanguage: language
          };
        }
      }

      // **FIX:** Threshold dinâmico baseado em confusão de séries
      let threshold = targetSeason !== undefined ? 0.3 : 0.4;
      
      // Verifica se é série confusa
      const confusionCheck = this.detectConfusingSeries(torrent.title, bestMatch.matchedTitle || '');
      if (confusionCheck.isConfusing) {
        threshold = Math.max(threshold, confusionCheck.minSimilarity);
      }
      
      if (bestMatch.similarity >= threshold) {
        results.included.push(torrent);
        results.reasons.push(`✅ "${torrent.title}" → "${bestMatch.matchedTitle}" (${(bestMatch.similarity * 100).toFixed(1)}%) [${bestMatch.matchedLanguage}]`);
      } else {
        results.excluded.push(torrent);
        results.reasons.push(`❌ "${torrent.title}" (${(bestMatch.similarity * 100).toFixed(1)}% < ${threshold * 100}%)`);
      }
    }

    const processingTime = Date.now() - startTime;

    this.logger.info('🎉 RESULTADO FINAL DO FILTRO', {
      requestId,
      imdbId,
      targetSeason,
      targetEpisode,
      totalOriginal: torrents.length,
      duplicatasRemovidas: results.duplicatesRemoved,
      portugueses: portugueseTorrents.length,
      incluidos: results.included.length,
      excluidos: results.excluded.length,
      processingTime: `${processingTime}ms`,
      efficiencyRate: torrents.length > 0 ?
        `${((results.included.length / torrents.length) * 100).toFixed(1)}%` : '0%'
    });

    // Log detalhado
    if (results.reasons.length > 0 && results.reasons.length <= 15) {
      this.logger.debug('📝 Decisões detalhadas do filtro', {
        requestId,
        reasons: results.reasons
      });
    }

    return results.included;
  }

  /**
   * Versão síncrona
   */
  applyTitleFilterSync(
    torrents: any[],
    imdbTitle: string,
    requestId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): any[] {
    const startTime = Date.now();
    
    this.logger.info('⚡ APLICANDO FILTRO DE TÍTULO (SYNC)', {
      requestId,
      imdbTitle: imdbTitle.substring(0, 60),
      targetSeason,
      targetEpisode,
      totalTorrents: torrents.length
    });
    
    const uniqueTorrents = this.deduplicateTorrents(torrents);
    
    const results = {
      included: [] as any[],
      excluded: [] as any[],
      reasons: [] as string[],
      duplicatesRemoved: torrents.length - uniqueTorrents.length
    };

    for (const torrent of uniqueTorrents) {
      if (!this.isPortugueseContent(torrent.title)) {
        results.excluded.push(torrent);
        results.reasons.push(`❌ "${torrent.title}" → Não português`);
        continue;
      }

      const matches = this.doTitlesMatchSync(
        torrent.title,
        imdbTitle,
        targetSeason,
        targetEpisode
      );

      if (matches) {
        results.included.push(torrent);
        results.reasons.push(`✅ "${torrent.title}" → "${imdbTitle}"`);
      } else {
        results.excluded.push(torrent);
        results.reasons.push(`❌ "${torrent.title}" → Não match`);
      }
    }

    const processingTime = Date.now() - startTime;

    this.logger.info('📊 Resultado filtro sync', {
      requestId,
      totalOriginal: torrents.length,
      duplicatasRemovidas: results.duplicatesRemoved,
      incluidos: results.included.length,
      processingTime: `${processingTime}ms`
    });

    return results.included;
  }

  // ==================== MÉTODOS AUXILIARES ====================

  /**
   * Teste de título específico
   */
  async testTitleMatch(
    torrentTitle: string,
    imdbId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<TitleMatchResult> {
    this.logger.info('🧪 TESTE DE TÍTULO', {
      torrentTitle,
      imdbId,
      targetSeason,
      targetEpisode
    });
    
    return await this.doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode);
  }

  /**
   * Teste síncrono
   */
  testTitleMatchSync(
    torrentTitle: string,
    imdbTitle: string,
    targetSeason?: number,
    targetEpisode?: number
  ): {
    matches: boolean;
    normalizedTorrent: string;
    normalizedImdb: string;
    contains: boolean;
    contained: boolean;
    similarity: number;
    metadata: SeriesMetadata;
    isPortuguese: boolean;
  } {
    const isPortuguese = this.isPortugueseContent(torrentTitle);
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);
    const metadata = this.extractSeriesMetadata(torrentTitle);

    const contains = normTorrent.includes(normImdb);
    const contained = normImdb.includes(normTorrent);
    const similarity = this.calculateSequenceSimilarity(normTorrent, normImdb);

    // FIX: Threshold dinâmico para séries confusas
    const confusionCheck = this.detectConfusingSeries(torrentTitle, imdbTitle);
    const baseThreshold = 0.4;
    const adjustedThreshold = confusionCheck.isConfusing ? 
      Math.max(baseThreshold, confusionCheck.minSimilarity) : 
      baseThreshold;

    let matches = isPortuguese && (contains || contained || similarity >= adjustedThreshold);

    // **FIX:** Validação mais flexível para temporadas
    if (targetSeason !== undefined && metadata.hasEpisodeInfo) {
      if (metadata.season && metadata.season !== targetSeason) {
        matches = false;
      }
      if (targetEpisode !== undefined && metadata.episode && metadata.episode !== targetEpisode) {
        matches = false;
      }
      // Temporada completa e pacotes são aceitos
    }

    this.logger.debug('🧪 Resultado teste sync', {
      matches,
      similarity: `${(similarity * 100).toFixed(1)}%`,
      isPortuguese,
      contains,
      contained,
      threshold: adjustedThreshold
    });

    return {
      matches,
      normalizedTorrent: normTorrent,
      normalizedImdb: normImdb,
      contains,
      contained,
      similarity,
      metadata,
      isPortuguese
    };
  }

  /**
   * Limpa caches
   */
  clearAllCaches(): void {
    this.imdbTitleCache.clear();
    this.deduplicationCache.clear();
    this.processedTimestamps.clear();
    this.cleanTitleCache.clear();
    this.portugueseCheckCache.clear();
    this.logger.info('🗑️ Todos os caches do TitleFilter foram limpos');
  }

  /**
   * Estatísticas de cache
   */
  getCacheStats(): {
    imdbCacheSize: number;
    dedupCacheSize: number;
    processedTimestampsSize: number;
    cleanTitleCacheSize: number;
    portugueseCheckCacheSize: number;
  } {
    const stats = {
      imdbCacheSize: this.imdbTitleCache.size,
      dedupCacheSize: this.deduplicationCache.size,
      processedTimestampsSize: this.processedTimestamps.size,
      cleanTitleCacheSize: this.cleanTitleCache.size,
      portugueseCheckCacheSize: this.portugueseCheckCache.size
    };
    
    this.logger.debug('📊 Estatísticas de cache', stats);
    
    return stats;
  }

  /**
   * Adiciona série confusa à lista
   */
  addConfusingSeries(original: string, derivative: string, minSimilarity: number = 0.8): void {
    this.CONFUSING_SERIES.push({
      original: original.toLowerCase(),
      derivative: derivative.toLowerCase(),
      minSimilarity
    });
    this.logger.info('➕ Série confusa adicionada', {
      original,
      derivative,
      minSimilarity
    });
  }

  /**
   * Lista séries confusas configuradas
   */
  listConfusingSeries(): SeriesConfusion[] {
    return this.CONFUSING_SERIES;
  }
}