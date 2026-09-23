"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RdTorrentCacheService = void 0;
const logger_js_1 = require("../utils/logger.js");
const MetricsService_js_1 = require("../catalogo/MetricsService.js");
class RdTorrentCacheService {
    constructor() {
        this.torrentCache = new Map();
        this.streamLinkCache = new Map();
        this.TORRENT_CACHE_TTL = 6 * 60 * 60 * 1000;
        this.STREAM_LINK_TTL = 3 * 60 * 60 * 1000;
        this.MAX_TORRENT_CACHE_SIZE = 5000;
        this.MAX_STREAM_LINK_CACHE_SIZE = 10000;
        this.processingLocks = new Map();
        this.cleanupTimer = null;
        this.CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
        this.logger = new logger_js_1.Logger('RdTorrentCacheService');
        this.startCleanupTimer();
        this.logger.debug('RdTorrentCacheService ready');
    }
    startCleanupTimer() {
        if (this.cleanupTimer)
            return;
        this.cleanupTimer = setInterval(() => {
            this.cleanupExpiredCache();
        }, this.CLEANUP_INTERVAL_MS);
        if (this.cleanupTimer.unref)
            this.cleanupTimer.unref();
    }
    getTorrentCacheKey(magnetHash, apiKey) {
        const apiKeyPrefix = apiKey.substring(0, 8);
        return `torrent:${magnetHash}:${apiKeyPrefix}`;
    }
    getStreamLinkCacheKey(torrentId, season, episode) {
        const seasonStr = season !== undefined ? `s${season}` : 'all';
        const episodeStr = episode !== undefined ? `e${episode}` : 'all';
        return `stream:${torrentId}:${seasonStr}:${episodeStr}`;
    }
    getLockKey(magnetHash, apiKey) {
        return `lock:${magnetHash}:${apiKey.substring(0, 8)}`;
    }
    isCacheExpired(cachedAt, ttl) {
        return Date.now() - cachedAt > ttl;
    }
    updateCacheMetrics() {
        MetricsService_js_1.metricsService.setCacheSize(this.torrentCache.size + this.streamLinkCache.size);
    }
    async getTorrentId(magnetHash, apiKey, torboxService) {
        const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
        const lockKey = this.getLockKey(magnetHash, apiKey);
        const existingLock = this.processingLocks.get(lockKey);
        if (existingLock) {
            this.logger.debug('Lock existente encontrado', { magnetHash, lockKey });
            return existingLock;
        }
        const processPromise = (async () => {
            try {
                const cachedTorrent = this.torrentCache.get(cacheKey);
                if (cachedTorrent && !this.isCacheExpired(cachedTorrent.cachedAt, this.TORRENT_CACHE_TTL)) {
                    this.logger.debug('Cache de torrent HIT', {
                        magnetHash,
                        torrentId: cachedTorrent.torrentId,
                        status: cachedTorrent.status
                    });
                    return {
                        torrentId: cachedTorrent.torrentId,
                        status: cachedTorrent.status,
                        fromCache: true
                    };
                }
                this.logger.debug('Cache de torrent MISS', { magnetHash });
                const existingTorrent = await torboxService.findExistingTorrent(magnetHash, apiKey);
                if (existingTorrent && existingTorrent.id) {
                    const tid = String(existingTorrent.id);
                    const cachedData = {
                        torrentId: tid,
                        status: existingTorrent.download_state,
                        cachedAt: Date.now(),
                        apiKeyPrefix: apiKey.substring(0, 8)
                    };
                    this.setTorrentCache(cacheKey, cachedData);
                    this.updateCacheMetrics();
                    this.logger.info('Torrent salvo no cache', {
                        magnetHash,
                        torrentId: tid,
                        status: existingTorrent.download_state
                    });
                    return {
                        torrentId: tid,
                        status: existingTorrent.download_state,
                        fromCache: false
                    };
                }
                return {
                    torrentId: null,
                    status: 'not_found',
                    fromCache: false
                };
            }
            finally {
                this.processingLocks.delete(lockKey);
                this.logger.debug('Lock removido', { magnetHash, lockKey });
            }
        })();
        this.processingLocks.set(lockKey, processPromise);
        this.logger.debug('Novo lock criado', { magnetHash, lockKey });
        return processPromise;
    }
    async getStreamLink(torrentId, apiKey, season, episode, torboxService, quality, cachedInfo) {
        const cacheKey = this.getStreamLinkCacheKey(torrentId, season, episode);
        const cachedStream = this.streamLinkCache.get(cacheKey);
        if (cachedStream && !this.isCacheExpired(cachedStream.cachedAt, this.STREAM_LINK_TTL)) {
            this.logger.debug('Cache de stream link HIT', {
                torrentId,
                season,
                episode,
                streamLink: cachedStream.streamLink.substring(0, 50) + '...'
            });
            return {
                streamLink: cachedStream.streamLink,
                fromCache: true
            };
        }
        this.logger.debug('Cache de stream link MISS', { torrentId, season, episode });
        if (!torboxService) {
            return { streamLink: null, fromCache: false };
        }
        const streamLink = await torboxService.getStreamLinkForTorrent(torrentId, apiKey, season, episode, quality, cachedInfo);
        if (streamLink) {
            const cachedData = {
                streamLink,
                cachedAt: Date.now()
            };
            this.setStreamLinkCache(cacheKey, cachedData);
            this.updateCacheMetrics();
            this.logger.info('Stream link salvo no cache', {
                torrentId,
                season,
                episode,
                streamLink: streamLink.substring(0, 50) + '...'
            });
        }
        return {
            streamLink,
            fromCache: false
        };
    }
    updateTorrentStatus(magnetHash, apiKey, status) {
        const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
        const cachedTorrent = this.torrentCache.get(cacheKey);
        if (cachedTorrent) {
            cachedTorrent.status = status;
            cachedTorrent.cachedAt = Date.now();
            this.torrentCache.set(cacheKey, cachedTorrent);
            this.updateCacheMetrics();
            this.logger.debug('Status do torrent atualizado no cache', {
                magnetHash,
                status
            });
        }
    }
    invalidateTorrent(magnetHash, apiKey) {
        const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
        const torrent = this.torrentCache.get(cacheKey);
        if (torrent) {
            this.torrentCache.delete(cacheKey);
            const streamKeyPrefix = `stream:${torrent.torrentId}:`;
            for (const [key] of this.streamLinkCache) {
                if (key.startsWith(streamKeyPrefix)) {
                    this.streamLinkCache.delete(key);
                }
            }
            this.updateCacheMetrics();
            this.logger.info('Torrent invalidado do cache', {
                magnetHash,
                torrentId: torrent.torrentId
            });
        }
    }
    cleanupExpiredCache() {
        const now = Date.now();
        let torrentsRemoved = 0;
        let streamsRemoved = 0;
        for (const [key, cached] of this.torrentCache) {
            if (this.isCacheExpired(cached.cachedAt, this.TORRENT_CACHE_TTL)) {
                this.torrentCache.delete(key);
                torrentsRemoved++;
            }
        }
        for (const [key, cached] of this.streamLinkCache) {
            if (this.isCacheExpired(cached.cachedAt, this.STREAM_LINK_TTL)) {
                this.streamLinkCache.delete(key);
                streamsRemoved++;
            }
        }
        if (torrentsRemoved > 0 || streamsRemoved > 0) {
            this.logger.debug('Cache expirado limpo', {
                torrentsRemoved,
                streamsRemoved
            });
            this.updateCacheMetrics();
        }
    }
    setTorrentCache(key, data) {
        if (this.torrentCache.size >= this.MAX_TORRENT_CACHE_SIZE) {
            const firstKey = this.torrentCache.keys().next().value;
            if (firstKey)
                this.torrentCache.delete(firstKey);
        }
        this.torrentCache.set(key, data);
    }
    setStreamLinkCache(key, data) {
        if (this.streamLinkCache.size >= this.MAX_STREAM_LINK_CACHE_SIZE) {
            const firstKey = this.streamLinkCache.keys().next().value;
            if (firstKey)
                this.streamLinkCache.delete(firstKey);
        }
        this.streamLinkCache.set(key, data);
    }
    getStats() {
        return {
            version: '2.0.0',
            torrentCacheSize: this.torrentCache.size,
            streamLinkCacheSize: this.streamLinkCache.size,
            activeLocks: this.processingLocks.size,
            ttlConfig: {
                torrentCache: `${this.TORRENT_CACHE_TTL / 3600000} horas`,
                streamLinkCache: `${this.STREAM_LINK_TTL / 3600000} horas`
            },
            features: [
                'Cache local com LRU simples',
                'Lock por magnet hash',
                'Limpeza automática de expirados',
                'Limites de tamanho configuráveis',
                'Métricas integradas'
            ]
        };
    }
}
exports.RdTorrentCacheService = RdTorrentCacheService;
