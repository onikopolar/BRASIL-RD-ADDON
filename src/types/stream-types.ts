// src/types/stream-types.ts
export interface Stream {
  title: string;
  name: string;
  description?: string;
  sources: string[];
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    notWebReady?: boolean;
  };
  infoHash?: string;
  fileIdx?: number;
}

export interface StreamRequest {
  type: 'movie' | 'series';
  id: string;
  apiKey: string;
}

export interface TorrentRecord {
  infoHash: string;
  title: string;
  seeders: number;
  size: number;
  provider: string;
  quality?: string;
  languages?: string[];
}

export interface FileRecord {
  title: string;
  size: number;
  fileIndex?: number;
}