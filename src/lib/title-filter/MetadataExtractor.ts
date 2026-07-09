import { Logger } from '../../utils/logger';
import { SeriesMetadata, EnhancedSeriesMetadata } from './interfaces';

export class MetadataExtractor {
  private readonly logger: Logger;
  private readonly metadataCache = new Map<string, { basic: any; enhanced: EnhancedSeriesMetadata; timestamp: number }>();
  private readonly cacheTTL = 30000;

  private readonly COMPLETE_SEASON_PATTERNS = [
    /(\d+)\s*(?:ª|a|°|o)?\s*temporada\s*(?:completa|inteira)/i,
    /temporada\s*(\d+)\s*(?:completa|inteira)/i,
    /season\s*(\d+)\s*(?:complete|full)/i,
    /s(\d+)\s*(?:complete|full)/i
  ];

  private readonly SEASON_PATTERNS = [
    /(\d+)\s*(?:ª|a|°|o)?\s*temporada/i,
    /temporada\s*(\d+)/i,
    /season\s*(\d+)/i,
    /s(\d+)\b(?!e\d)/i
  ];

  private readonly EPISODE_PATTERNS = [
    { pattern: /s(\d+)e(\d+)/i, type: 'sXeX' },
    { pattern: /(\d+)x(\d+)/i, type: 'XxX' },
    { pattern: /s(\d+)e(\d+)[\-_]?e?(\d+)/i, type: 'sXeXeX' },
    { pattern: /(\d+)x(\d+)[\-_](\d+)/i, type: 'XxX-X' },
    { pattern: /temporada[\s\._-]?(\d+)[\s\._-]?epis[oó]dio[\s\._-]?(\d+)/i, type: 'temp_ep' },
    { pattern: /ep(?:isode)?\s*(\d+)/i, type: 'epX' },
    { pattern: /season\s*(\d+)\s*episode\s*(\d+)/i, type: 'seasonXepisodeX' },
    { pattern: /(\d+)\s*-\s*(\d+)/, type: 'X-X' },
    { pattern: /(\d+)of(\d+)/i, type: 'XofX' },
    { pattern: /parte?\s*(\d+)/i, type: 'partX' },
    { pattern: /cap(?:itulo|ítulo)?\s*(\d+)/i, type: 'capX' },
  ];

  private readonly PACKAGE_PATTERNS = [
    /(?:pack|pacote)[\s\._-]?\d+/i,
    /(?:temporada|season)[\s\._-]?\d+[\s\._-]*(?:completa|inteira|full|complete)/i,
    /(?:box|cole[cç][aã]o)[\s\._-]?(?:completa|inteira|series)/i,
    /(?:toda|all|todas)[\s\._-]*(?:as\s+)?temporadas/i
  ];

  private readonly PACKAGE_INDICATORS = ['pack', 'pacote', 'temporada', 'season', 'complete', 'completa', 'full', 'inteira', 'box', 'coleção'];
  private readonly TECHNICAL_TERMS = ['h264', 'h265', 'x264', 'x265', 'hevc', 'avc', 'aac', 'ac3', 'dts', '720p', '1080p', '2160p', '4k', 'hd', 'web-dl', 'webrip', 'bluray', 'mkv', 'mp4', 'avi', 'mpg', 'mpeg', 'mov', 'wmv', 'flv'];

  private readonly QUALITY_PATTERNS = [
    { pattern: /\b(2160p|4k|uhd)\b/i, quality: '2160p' },
    { pattern: /\b(1080p|fullhd|full hd)\b/i, quality: '1080p' },
    { pattern: /\b(720p|hd|high definition)\b/i, quality: '720p' },
    { pattern: /\b(480p|sd|standard definition)\b/i, quality: 'SD' },
  ];

  private static instance: MetadataExtractor;

  public static getInstance(): MetadataExtractor {
    if (!MetadataExtractor.instance) {
      MetadataExtractor.instance = new MetadataExtractor();
    }
    return MetadataExtractor.instance;
  }

  constructor() {
    this.logger = new Logger('MetadataExtractor');
    this.logger.debug('MetadataExtractor ready');
  }

  extractSeriesMetadata(torrentTitle: string): SeriesMetadata {
    const basic = this.extractBasicMetadataInternal(torrentTitle);
    return {
      season: basic.season,
      episode: basic.episode,
      isCompleteSeason: basic.isCompleteSeason,
      hasEpisodeInfo: !!(basic.season || basic.episode || basic.isCompleteSeason),
      matchedPattern: undefined
    };
  }

  extractBasicMetadata(torrentTitle: string): {
    season?: number;
    episode?: number;
    isCompleteSeason?: boolean;
    isPackage?: boolean;
    quality?: string;
    mediaType?: 'movie' | 'series' | 'unknown';
  } {
    const cacheKey = `basic-${torrentTitle}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      return cached.basic;
    }

    const metadata = this.extractBasicMetadataInternal(torrentTitle);
    this.metadataCache.set(cacheKey, { basic: metadata, enhanced: null as any, timestamp: Date.now() });
    return metadata;
  }

  private extractBasicMetadataInternal(torrentTitle: string): {
    season?: number;
    episode?: number;
    isCompleteSeason?: boolean;
    isPackage?: boolean;
    quality?: string;
    mediaType?: 'movie' | 'series' | 'unknown';
  } {
    const title = torrentTitle.toLowerCase();
    const completeSeasonResult = this.extractCompleteSeason(title);
    if (completeSeasonResult) {
      return {
        season: completeSeasonResult.season,
        isCompleteSeason: true,
        isPackage: true,
        quality: this.extractQuality(torrentTitle),
        mediaType: 'series'
      };
    }

    const seasonResult = this.extractSeason(title);
    const episodeResult = this.extractEpisode(title);
    const isPackage = this.isPackageTitle(title);

    return {
      season: seasonResult?.season || episodeResult?.season,
      episode: episodeResult?.episode,
      isCompleteSeason: false,
      isPackage,
      quality: this.extractQuality(torrentTitle),
      mediaType: this.detectMediaType(torrentTitle)
    };
  }

  extractEnhancedMetadata(torrentTitle: string): EnhancedSeriesMetadata {
    const cacheKey = `enhanced-${torrentTitle}`;
    const cached = this.metadataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
      return cached.enhanced;
    }

    const basicMetadata = this.extractBasicMetadata(torrentTitle);
    const enhancedMetadata: EnhancedSeriesMetadata = {
      season: basicMetadata.season,
      episode: basicMetadata.episode,
      isCompleteSeason: basicMetadata.isCompleteSeason,
      isPackage: basicMetadata.isPackage,
      quality: basicMetadata.quality,
      mediaType: basicMetadata.mediaType,
      year: this.extractYear(torrentTitle) || undefined,
      language: this.extractLanguage(torrentTitle),
      codec: this.extractCodec(torrentTitle),
      source: this.extractSource(torrentTitle),
      hasMultiEpisode: this.hasMultiEpisode(torrentTitle),
      episodeRange: this.extractEpisodeRange(torrentTitle) || undefined,
      hasEpisodeInfo: !!(basicMetadata.season || basicMetadata.episode || basicMetadata.isCompleteSeason),
      matchedPattern: undefined
    };

    this.metadataCache.set(cacheKey, { basic: basicMetadata, enhanced: enhancedMetadata, timestamp: Date.now() });
    return enhancedMetadata;
  }

  detectMediaType(title: string): 'movie' | 'series' | 'unknown' {
    const seriesIndicators = [
      /s\d+e\d+/i, /season/i, /temporada/i, /episode/i, /episodio/i,
      /\d+x\d+/i, /parte?\s*\d+/i, /cap(?:itulo|ítulo)?\s*\d+/i,
      /s\d+\b/i,
      /\bseason\s+\d+\s+episode\s+\d+/i
    ];
    
    const movieIndicators = [
      /\b\d{4}\b(?!\s*(?:h|x|hevc|avc))/i,
      /\b(?:dvdrip|bluray|web[\s\._-]?dl)\b/i,
      /full movie/i
    ];
    
    const hasSeriesIndicators = seriesIndicators.some(pattern => pattern.test(title));
    const hasMovieIndicators = movieIndicators.some(pattern => pattern.test(title));
    
    if (hasSeriesIndicators) return 'series';
    if (hasMovieIndicators) return 'movie';
    return 'unknown';
  }

  private extractYear(title: string): number | null {
    const yearMatch = title.match(/\b(19|20)\d{2}\b(?!\s*(?:h|x|hevc|avc))/i);
    if (yearMatch) {
      const year = parseInt(yearMatch[0]);
      if (year >= 1900 && year <= 2100) return year;
    }
    return null;
  }

  extractQuality(title: string): string {
    for (const { pattern, quality } of this.QUALITY_PATTERNS) {
      if (pattern.test(title)) return quality;
    }
    return 'unknown';
  }

  private extractLanguage(title: string): string {
    const langPatterns = [
      { pattern: /dublado|dublada|dublagem|pt[-_\s]?br|portugu[eê]s/i, lang: 'PT-BR' },
      { pattern: /dual\s*audio|dual\s*language/i, lang: 'Dual' },
      { pattern: /legendado|legenda|subtitle/i, lang: 'Legendado' },
      { pattern: /eng|english|ingl[eê]s/i, lang: 'EN' }
    ];
    
    for (const { pattern, lang } of langPatterns) {
      if (pattern.test(title)) return lang;
    }
    return 'unknown';
  }

  private extractCodec(title: string): string {
    const codecPatterns = [
      { pattern: /h\.?265|x265|hevc/i, codec: 'H.265' },
      { pattern: /h\.?264|x264|avc/i, codec: 'H.264' },
      { pattern: /av1|vp9/i, codec: 'AV1/VP9' }
    ];
    
    for (const { pattern, codec } of codecPatterns) {
      if (pattern.test(title)) return codec;
    }
    return 'unknown';
  }

  private extractSource(title: string): string {
    const sourcePatterns = [
      { pattern: /web[\s\._-]?dl/i, source: 'WEB-DL' },
      { pattern: /webrip|web[\s\._-]?rip/i, source: 'WEBRip' },
      { pattern: /blu[\s\._-]?ray|bdrip|brrip/i, source: 'BluRay' },
      { pattern: /dvdrip|dvd/i, source: 'DVD' },
      { pattern: /hdtv|tvrip/i, source: 'HDTV' }
    ];
    
    for (const { pattern, source } of sourcePatterns) {
      if (pattern.test(title)) return source;
    }
    return 'unknown';
  }

  private hasMultiEpisode(title: string): boolean {
    const multiPatterns = [
      /s\d+e\d+[-_]?e?\d+/i,
      /\d+x\d+[-_]\d+/i,
      /ep(?:isode)?s?\s*\d+\s*[-~&]\s*\d+/i
    ];
    return multiPatterns.some(pattern => pattern.test(title));
  }

  private extractEpisodeRange(title: string): { start: number; end: number } | null {
    const multiMatch = title.match(/s(\d+)e(\d+)[\-_]?e?(\d+)/i);
    if (multiMatch) {
      const start = parseInt(multiMatch[2]);
      const end = parseInt(multiMatch[3]);
      if (!isNaN(start) && !isNaN(end) && start < end) return { start, end };
    }
    
    const rangeMatch = title.match(/(\d+)x(\d+)[\-_](\d+)/i);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[2]);
      const end = parseInt(rangeMatch[3]);
      if (!isNaN(start) && !isNaN(end) && start < end) return { start, end };
    }
    
    return null;
  }

  private extractCompleteSeason(title: string): { season: number; pattern: string } | null {
    for (const pattern of this.COMPLETE_SEASON_PATTERNS) {
      const match = title.match(pattern);
      if (match) {
        const season = parseInt(match[1]);
        if (!isNaN(season) && season > 0) return { season, pattern: match[0] };
      }
    }
    return null;
  }

  private extractSeason(title: string): { season: number; pattern: string } | null {
    for (const pattern of this.SEASON_PATTERNS) {
      const match = title.match(pattern);
      if (match) {
        const season = parseInt(match[1]);
        if (!isNaN(season) && season > 0) return { season, pattern: match[0] };
      }
    }
    return null;
  }

  private extractEpisode(title: string): { season?: number; episode: number; pattern: string } | null {
    for (const { pattern, type } of this.EPISODE_PATTERNS) {
      const match = title.match(pattern);
      if (match) {
        let season: number | undefined;
        let episode: number;

        switch (type) {
          case 'sXeX':
            season = parseInt(match[1]);
            episode = parseInt(match[2]);
            break;
          case 'XxX':
            season = parseInt(match[1]);
            episode = parseInt(match[2]);
            break;
          case 'sXeXeX':
            season = parseInt(match[1]);
            episode = parseInt(match[2]);
            break;
          case 'XxX-X':
            season = parseInt(match[1]);
            episode = parseInt(match[2]);
            break;
          case 'temp_ep':
            season = parseInt(match[1]);
            episode = parseInt(match[2]);
            break;
          case 'seasonXepisodeX':
            season = parseInt(match[1]);
            episode = parseInt(match[2]);
            break;
          case 'epX':
          case 'XofX':
          case 'partX':
          case 'capX':
            episode = parseInt(match[1]);
            break;
          case 'X-X':
            const num1 = parseInt(match[1]);
            const num2 = parseInt(match[2]);
            if (this.looksLikeYearRange(num1, num2)) continue;
            season = num1;
            episode = num2;
            break;
          default:
            continue;
        }

        if (!isNaN(episode) && episode > 0) {
          const matchedText = match[0].toLowerCase();
          const isTechnicalTerm = this.TECHNICAL_TERMS.some(term => matchedText.includes(term.toLowerCase()));
          if (isTechnicalTerm) continue;

          if (type === 'X-X' || type === 'epX' || type === 'XofX' || type === 'partX' || type === 'capX') {
            const surroundingText = this.getSurroundingText(title, match.index || 0, match[0].length);
            const looksLikeCodec = this.looksLikeCodecOrQuality(surroundingText);
            if (looksLikeCodec) continue;
          }

          return { season, episode, pattern: match[0] };
        }
      }
    }
    return null;
  }

  private looksLikeYearRange(num1: number, num2: number): boolean {
    return (num1 >= 1900 && num1 <= 2100 && num2 >= 1900 && num2 <= 2100 && Math.abs(num2 - num1) <= 3);
  }

  private getSurroundingText(text: string, startIndex: number, matchLength: number): string {
    const before = text.substring(Math.max(0, startIndex - 10), startIndex);
    const after = text.substring(startIndex + matchLength, Math.min(text.length, startIndex + matchLength + 10));
    return (before + '[' + text.substring(startIndex, startIndex + matchLength) + ']' + after).trim();
  }

  private looksLikeCodecOrQuality(text: string): boolean {
    const codecPatterns = [
      /h\.?265|x265|hevc/i, /h\.?264|x264|avc/i,
      /\d+p/i, /4k/i, /hd/i, /uhd/i,
      /web[\s\._-]?dl/i, /blu[\s\._-]?ray/i, /dvdrip/i
    ];
    return codecPatterns.some(pattern => pattern.test(text));
  }

  isPackageTitle(title: string): boolean {
    const titleLower = title.toLowerCase();
    for (const pattern of this.PACKAGE_PATTERNS) {
      if (pattern.test(titleLower)) return true;
    }
    return this.PACKAGE_INDICATORS.some(indicator => titleLower.includes(indicator));
  }

  quickExtract(torrentTitle: string) {
    return this.extractBasicMetadata(torrentTitle);
  }

  getPackageInfo(torrentTitle: string) {
    const titleLower = torrentTitle.toLowerCase();
    return {
      isPackage: this.isPackageTitle(titleLower),
      season: this.extractSeason(titleLower)?.season,
      isCompleteSeason: !!this.extractCompleteSeason(titleLower)
    };
  }

  getQualityInfo(torrentTitle: string) {
    return {
      quality: this.extractQuality(torrentTitle),
      codec: this.extractCodec(torrentTitle),
      source: this.extractSource(torrentTitle)
    };
  }

  clearCache(): void {
    this.metadataCache.clear();
  }

  getCacheStats() {
    return {
      cacheSize: this.metadataCache.size,
      cacheTTL: this.cacheTTL,
      version: '1.4.0'
    };
  }
}