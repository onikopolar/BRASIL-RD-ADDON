export interface Stream {
  title: string;
  name?: string;
  description?: string;
  sources?: string[];
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    filename?: string;
    streamQuality?: string;
    packageContent?: boolean;
    // Permite campos extras para funcionalidades customizadas
    [key: string]: any;
  };
  status?: string;
  torrentId?: string;
  infoHash?: string;
  fileIdx?: number;
  magnet?: string;
  url?: string;
}

export interface StreamRequest {
  type: 'movie' | 'series';
  id: string;
  title?: string;
  imdbId?: string;
  apiKey?: string;
  authSource?: string;
  config?: {
    quality?: string;
    language?: string;
    streamType?: string;
    maxResults?: string;
    enableAggressiveSearch?: boolean;
    minSeeders?: number;
    requireExactMatch?: boolean;
    maxConcurrentTorrents?: number;
  };
}

export interface CuratedMagnet {
  imdbId: string;
  title: string;
  magnet: string;
  quality: string;
  seeds: number;
  size?: string;
  category: string;
  language: string;
  addedAt: string;
  season?: number;
  episode?: number;
}

export interface RDFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

export interface CacheData<T = any> {
  value: T;
  timestamp: number;
  ttl: number;
}

export interface RDTorrentInfo {
  id: string;
  filename: string;
  status: string;
  progress: number;
  files: RDFile[];
  links?: string[];
  hash?: string;
}