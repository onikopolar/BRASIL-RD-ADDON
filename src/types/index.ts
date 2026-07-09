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

export interface TorboxFile {
  id: number;
  name: string;
  size: number;
  short_name?: string;
  mimetype?: string;
}

export interface TorboxTorrentInfo {
  id: number;
  name: string;
  hash: string;
  download_state: string;
  progress: number;        // 0-1 (Torbox usa fração, não %)
  files: TorboxFile[];
  size?: number;
  download_speed?: number;
  upload_speed?: number;
  created_at?: string;
  download_present?: boolean;
  active?: boolean;
}

export interface CacheData<T = any> {
  value: T;
  timestamp: number;
  ttl: number;
}