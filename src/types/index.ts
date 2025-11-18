export interface Stream {
  title: string;
  url: string;
  name?: string;
  description?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    filename?: string;
  };
  status?: string;
  torrentId?: string;
}

export interface RDTorrentInfo {
  id: string;
  filename: string;
  original_filename: string;
  hash: string;
  bytes: number;
  original_bytes: number;
  host: string;
  split: number;
  progress: number;
  status: string;
  added: string;
  files?: RDFile[];
  links?: string[];
}

export interface RDFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

export interface CuratedMagnet {
  imdbId: string;
  title: string;
  magnet: string;
  quality: '4K' | '1080p' | '720p' | 'SD';
  seeds: number;
  addedAt: Date;
  category: string;
  language: 'pt-BR' | 'pt' | 'en';
}

export interface StreamRequest {
  type: 'movie' | 'series';
  id: string;
  title?: string;
  imdbId?: string;
  apiKey?: string;
  config?: {
    quality?: string;
    language?: string;
    streamType?: string;
    maxResults?: string;
    // Novas propriedades para otimização
    enableAggressiveSearch?: boolean;
    minSeeders?: number;
    requireExactMatch?: boolean;
    maxConcurrentTorrents?: number;
  };
}

export interface CacheData<T> {
  data: T;
  timestamp: number;
  expiresIn: number;
}