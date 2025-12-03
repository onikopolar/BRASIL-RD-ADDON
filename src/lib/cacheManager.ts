interface CachedTorrent {
  torrentId: string;
  files: any[];
  torrentInfo: any;
  timestamp: number;
  magnetHash: string;
}

interface SeasonCacheEntry {
  torrentId: string;
  files: any[];
  addedAt: number;
  magnetHash: string;
}

export class CacheManager {
  private readonly torrentCache = new Map<string, CachedTorrent>();
  private readonly seasonCache = new Map<string, SeasonCacheEntry>();
  private readonly torrentCacheTTL = 60 * 60 * 1000; // 1 hora

  getTorrentCache(key: string): CachedTorrent | undefined {
    const cached = this.torrentCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.torrentCacheTTL) {
      return cached;
    }
    return undefined;
  }

  setTorrentCache(key: string, data: CachedTorrent): void {
    this.torrentCache.set(key, { ...data, timestamp: Date.now() });
  }

  getSeasonCache(key: string): SeasonCacheEntry | undefined {
    const cached = this.seasonCache.get(key);
    if (cached && (Date.now() - cached.addedAt) < this.torrentCacheTTL) {
      return cached;
    }
    return undefined;
  }

  setSeasonCache(key: string, data: Omit<SeasonCacheEntry, 'addedAt'>): void {
    this.seasonCache.set(key, { ...data, addedAt: Date.now() });
  }

  invalidateRelatedCache(imdbId: string): void {
    // Remove torrents relacionados ao imdbId
    const torrentKeys = Array.from(this.torrentCache.keys()).filter(key => 
      key.includes(imdbId)
    );
    
    for (const key of torrentKeys) {
      this.torrentCache.delete(key);
    }

    // Remove season caches relacionados
    const seasonCacheKeys = Array.from(this.seasonCache.keys()).filter(key => 
      key.includes(imdbId)
    );
    
    for (const key of seasonCacheKeys) {
      this.seasonCache.delete(key);
    }
  }

  clearAll(): void {
    this.torrentCache.clear();
    this.seasonCache.clear();
  }

  getStats(): {
    torrentCache: { size: number; entries: string[] };
    seasonCache: { size: number; entries: string[] };
  } {
    return {
      torrentCache: {
        size: this.torrentCache.size,
        entries: Array.from(this.torrentCache.keys())
      },
      seasonCache: {
        size: this.seasonCache.size,
        entries: Array.from(this.seasonCache.keys())
      }
    };
  }
}