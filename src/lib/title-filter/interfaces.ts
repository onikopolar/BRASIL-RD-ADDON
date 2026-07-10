import { ImdbTitles } from '../../services/ImdbScraperService.js';

export interface SeriesMetadata {
  season?: number;
  episode?: number;
  isCompleteSeason?: boolean;
  hasEpisodeInfo: boolean;
  matchedPattern?: string;
}

export interface EnhancedSeriesMetadata extends SeriesMetadata {
  year?: number;
  quality?: string;
  language?: string;
  codec?: string;
  source?: string;
  hasMultiEpisode?: boolean;
  episodeRange?: { start: number; end: number };
  mediaType?: 'movie' | 'series' | 'unknown';
}

export interface TitleMatchResult {
  matches: boolean;
  matchedTitle?: string;
  matchedLanguage?: 'original' | 'português';
  similarity: number;
  torrentMetadata: SeriesMetadata;
  reason: string;
}

export interface DeduplicationCacheEntry {
  infoHash?: string;
  magnet: string;
  timestamp: number;
  processed: boolean;
}

export interface ImdbTitleCacheEntry {
  titles: ImdbTitles;
  timestamp: number;
}

export interface SeriesConfusion {
  original: string;
  derivative: string;
  minSimilarity: number;
}

export interface SmartTitleMatch {
  matches: boolean;
  similarity: number;
  reason: string;
}

export interface TitleFilterConfig {
  imdbCacheTTL: number;
  dedupCacheTTL: number;
  titleCacheTTL: number;
  baseThreshold: number;
  seasonThreshold: number;


}

export interface EnhancedSeriesMetadata extends SeriesMetadata {
  year?: number;
  quality?: string;
  language?: string;
  codec?: string;
  source?: string;
  hasMultiEpisode?: boolean;
  episodeRange?: { start: number; end: number };
  mediaType?: 'movie' | 'series' | 'unknown';
  isPackage?: boolean; // NOVO CAMPO
}