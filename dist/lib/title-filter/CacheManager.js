"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheManager = void 0;
const logger_1 = require("../../utils/logger");
class CacheManager {
    constructor(imdbCacheTTL = 30 * 60 * 1000, dedupCacheTTL = 10 * 60 * 1000, titleCacheTTL = 5 * 60 * 1000) {
        this.imdbTitleCache = new Map();
        this.deduplicationCache = new Map();
        this.processedTimestamps = new Map();
        this.cleanTitleCache = new Map();
        this.portugueseCheckCache = new Map();
        this.logger = new logger_1.Logger('CacheManager');
        this.IMDB_CACHE_TTL = imdbCacheTTL;
        this.DEDUP_CACHE_TTL = dedupCacheTTL;
        this.TITLE_CACHE_TTL = titleCacheTTL;
        this.logger.info('✅ CacheManager inicializado - 100% compatível com original');
    }
    cleanupOldCaches(imdbCacheTTL, dedupCacheTTL, titleCacheTTL) {
        const now = Date.now();
        const imdbTTL = imdbCacheTTL || this.IMDB_CACHE_TTL;
        const dedupTTL = dedupCacheTTL || this.DEDUP_CACHE_TTL;
        const titleTTL = titleCacheTTL || this.TITLE_CACHE_TTL;
        let cleanedCount = 0;
        for (const [key, entry] of this.imdbTitleCache.entries()) {
            if (now - entry.timestamp > imdbTTL) {
                this.imdbTitleCache.delete(key);
                cleanedCount++;
            }
        }
        for (const [key, entry] of this.deduplicationCache.entries()) {
            if (now - entry.timestamp > dedupTTL) {
                this.deduplicationCache.delete(key);
                cleanedCount++;
            }
        }
        for (const [key, timestamp] of this.processedTimestamps.entries()) {
            if (now - timestamp > titleTTL) {
                this.processedTimestamps.delete(key);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0 && Math.random() < 0.01) {
            this.logger.debug('🗑️ Cache limpo (limpeza automática)', {
                itensRemovidos: cleanedCount,
                cacheIMDB: this.imdbTitleCache.size,
                cacheProcessados: this.processedTimestamps.size
            });
        }
    }
    deduplicateTorrents(torrents, logger) {
        if (torrents.length <= 1)
            return torrents;
        const seen = new Set();
        const uniqueTorrents = [];
        let duplicatesRemoved = 0;
        for (const torrent of torrents) {
            const infoHash = this.extractInfoHash(torrent.magnet || torrent);
            const title = torrent.title || 'unknown';
            let key;
            if (infoHash) {
                key = infoHash;
            }
            else {
                const cleanTitle = this.extractCleanTitleForDedupe(title);
                key = cleanTitle;
            }
            if (seen.has(key)) {
                duplicatesRemoved++;
                if (logger) {
                    logger.debug('🗑️ Torrent duplicado removido', {
                        title: title.substring(0, 60),
                        infoHash: infoHash?.substring(0, 8) || 'N/A'
                    });
                }
                continue;
            }
            seen.add(key);
            uniqueTorrents.push(torrent);
        }
        if (duplicatesRemoved > 0 && logger) {
            logger.info('✅ Deduplicação concluída', {
                totalAntes: torrents.length,
                totalDepois: uniqueTorrents.length,
                duplicatasRemovidas: duplicatesRemoved
            });
        }
        return uniqueTorrents;
    }
    isAlreadyProcessed(dedupeKey) {
        if (Math.random() < 0.01) {
            this.cleanupOldCaches();
        }
        return this.processedTimestamps.has(dedupeKey);
    }
    markAsProcessed(dedupeKey) {
        this.processedTimestamps.set(dedupeKey, Date.now());
    }
    getImdbTitlesFromCache(imdbId) {
        const entry = this.imdbTitleCache.get(imdbId);
        if (entry && Date.now() - entry.timestamp < this.IMDB_CACHE_TTL) {
            return entry;
        }
        return null;
    }
    saveImdbTitlesToCache(imdbId, titles) {
        this.imdbTitleCache.set(imdbId, {
            titles,
            timestamp: Date.now()
        });
    }
    getCleanTitleFromCache(fullTitle) {
        const cacheKey = `clean:${fullTitle}`;
        const cached = this.cleanTitleCache.get(cacheKey);
        if (cached) {
            this.logger.debug('📦 Clean title em cache', {
                original: fullTitle.substring(0, 60),
                cleaned: cached.substring(0, 60)
            });
            return cached;
        }
        return null;
    }
    saveCleanTitleToCache(fullTitle, cleanedTitle) {
        const cacheKey = `clean:${fullTitle}`;
        this.cleanTitleCache.set(cacheKey, cleanedTitle);
    }
    getPortugueseCheckFromCache(torrentTitle) {
        const titleCacheKey = torrentTitle.toLowerCase();
        const cached = this.portugueseCheckCache.get(titleCacheKey);
        if (cached !== undefined) {
            this.logger.debug('📦 Resultado em cache', {
                title: torrentTitle.substring(0, 60),
                result: cached ? '✅ Português' : '❌ Não português'
            });
            return cached;
        }
        return null;
    }
    savePortugueseCheckToCache(torrentTitle, isPortuguese) {
        const titleCacheKey = torrentTitle.toLowerCase();
        this.portugueseCheckCache.set(titleCacheKey, isPortuguese);
    }
    extractInfoHash(source) {
        if (typeof source === 'string') {
            const magnetMatch = source.match(/btih:([a-zA-Z0-9]{40})/i);
            return magnetMatch ? magnetMatch[1].toLowerCase() : null;
        }
        else if (source && typeof source === 'object') {
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
    createDedupeKey(torrentTitle, infoHash) {
        const cleanTitle = this.extractCleanTitleForDedupe(torrentTitle).toLowerCase().replace(/\s+/g, '_');
        return infoHash ? `${infoHash}:${cleanTitle}` : cleanTitle;
    }
    extractCleanTitleForDedupe(torrentTitle) {
        return torrentTitle
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    clearAllCaches() {
        this.imdbTitleCache.clear();
        this.deduplicationCache.clear();
        this.processedTimestamps.clear();
        this.cleanTitleCache.clear();
        this.portugueseCheckCache.clear();
        this.logger.info('🗑️ Todos os caches do CacheManager foram limpos');
    }
    getCacheStats() {
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
    setupProcessedCache(cleanupChance = 0.01) {
        this.logger.debug('⚙️ Cache de processamento configurado', {
            cleanupChance,
            ttlIMDB: `${this.IMDB_CACHE_TTL / 60000}min`,
            ttlProcessados: `${this.TITLE_CACHE_TTL / 60000}min`
        });
    }
    checkAndMarkProcessed(torrent) {
        const infoHash = this.extractInfoHash(torrent.magnet || torrent);
        const title = torrent.title || torrent;
        const dedupeKey = this.createDedupeKey(title, infoHash || undefined);
        const alreadyProcessed = this.isAlreadyProcessed(dedupeKey);
        if (!alreadyProcessed) {
            this.markAsProcessed(dedupeKey);
        }
        return { alreadyProcessed, dedupeKey };
    }
    forceCleanup() {
        const initialTotal = this.imdbTitleCache.size +
            this.deduplicationCache.size +
            this.processedTimestamps.size +
            this.cleanTitleCache.size +
            this.portugueseCheckCache.size;
        this.cleanupOldCaches();
        const finalTotal = this.imdbTitleCache.size +
            this.deduplicationCache.size +
            this.processedTimestamps.size +
            this.cleanTitleCache.size +
            this.portugueseCheckCache.size;
        const removed = initialTotal - finalTotal;
        this.logger.info('🧹 Limpeza forçada de caches', {
            removidos: removed,
            restantes: finalTotal
        });
        return { removed };
    }
    getCacheHealth() {
        const now = Date.now();
        let oldestAge = 0;
        for (const entry of this.imdbTitleCache.values()) {
            const age = now - entry.timestamp;
            if (age > oldestAge)
                oldestAge = age;
        }
        for (const timestamp of this.processedTimestamps.values()) {
            const age = now - timestamp;
            if (age > oldestAge)
                oldestAge = age;
        }
        let imdbCacheHealth = 'healthy';
        const imdbSize = this.imdbTitleCache.size;
        if (imdbSize > 1000) {
            imdbCacheHealth = 'warning';
        }
        if (imdbSize > 5000) {
            imdbCacheHealth = 'critical';
        }
        let processedCacheHealth = 'healthy';
        const processedSize = this.processedTimestamps.size;
        if (processedSize > 5000) {
            processedCacheHealth = 'warning';
        }
        if (processedSize > 20000) {
            processedCacheHealth = 'critical';
        }
        return {
            imdbCacheHealth,
            processedCacheHealth,
            totalEntries: imdbSize + processedSize +
                this.cleanTitleCache.size +
                this.portugueseCheckCache.size,
            oldestEntryAge: Math.round(oldestAge / 60000)
        };
    }
    removeFromCache(cacheType, key) {
        let removed = false;
        switch (cacheType) {
            case 'imdb':
                removed = this.imdbTitleCache.delete(key);
                break;
            case 'processed':
                removed = this.processedTimestamps.delete(key);
                break;
            case 'clean':
                removed = this.cleanTitleCache.delete(key);
                break;
            case 'portuguese':
                removed = this.portugueseCheckCache.delete(key);
                break;
        }
        if (removed) {
            this.logger.debug('🔧 Entrada removida manualmente do cache', { cacheType, key });
        }
        return removed;
    }
    exportCacheData() {
        const sampleImdbIds = Array.from(this.imdbTitleCache.keys()).slice(0, 5);
        const sampleProcessedKeys = Array.from(this.processedTimestamps.keys()).slice(0, 5);
        return {
            imdbEntries: this.imdbTitleCache.size,
            processedEntries: this.processedTimestamps.size,
            cleanTitleEntries: this.cleanTitleCache.size,
            portugueseCheckEntries: this.portugueseCheckCache.size,
            sampleImdbIds,
            sampleProcessedKeys
        };
    }
}
exports.CacheManager = CacheManager;
