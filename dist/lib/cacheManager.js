"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
class CacheManager {
    constructor() {
        this.torrentCache = new Map();
        this.seasonCache = new Map();
        this.torrentCacheTTL = 60 * 60 * 1000;
    }
    getTorrentCache(key) {
        const cached = this.torrentCache.get(key);
        if (cached && (Date.now() - cached.timestamp) < this.torrentCacheTTL) {
            return cached;
        }
        return undefined;
    }
    setTorrentCache(key, data) {
        this.torrentCache.set(key, { ...data, timestamp: Date.now() });
    }
    getSeasonCache(key) {
        const cached = this.seasonCache.get(key);
        if (cached && (Date.now() - cached.addedAt) < this.torrentCacheTTL) {
            return cached;
        }
        return undefined;
    }
    setSeasonCache(key, data) {
        this.seasonCache.set(key, { ...data, addedAt: Date.now() });
    }
    invalidateRelatedCache(imdbId) {
        const torrentKeys = Array.from(this.torrentCache.keys()).filter(key => key.includes(imdbId));
        for (const key of torrentKeys) {
            this.torrentCache.delete(key);
        }
        const seasonCacheKeys = Array.from(this.seasonCache.keys()).filter(key => key.includes(imdbId));
        for (const key of seasonCacheKeys) {
            this.seasonCache.delete(key);
        }
    }
    clearAll() {
        this.torrentCache.clear();
        this.seasonCache.clear();
    }
    getStats() {
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
exports.CacheManager = CacheManager;
