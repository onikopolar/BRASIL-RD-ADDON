"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RdTorrentCacheService = void 0;
const logger_1 = require("../utils/logger");
class RdTorrentCacheService {
    constructor() {
        this.torrentCache = new Map();
        this.streamLinkCache = new Map();
        this.TORRENT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
        this.STREAM_LINK_TTL = 24 * 60 * 60 * 1000;
        this.processingLocks = new Map();
        this.logger = new logger_1.Logger('RdTorrentCacheService');
        this.logger.info(`RdTorrentCacheService inicializado - Cache inteligente de 2 camadas`);
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
        return `lock:${magnetHash}:${apiKey}`;
    }
    isCacheExpired(cachedAt, ttl) {
        return Date.now() - cachedAt > ttl;
    }
    async getTorrentId(magnetHash, apiKey, rdService) {
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
                const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
                if (existingTorrent && existingTorrent.id) {
                    const cachedTorrent = {
                        torrentId: existingTorrent.id,
                        status: existingTorrent.status,
                        cachedAt: Date.now(),
                        apiKeyPrefix: apiKey.substring(0, 8)
                    };
                    this.torrentCache.set(cacheKey, cachedTorrent);
                    this.logger.info('Torrent salvo no cache', {
                        magnetHash,
                        torrentId: existingTorrent.id,
                        status: existingTorrent.status
                    });
                    return {
                        torrentId: existingTorrent.id,
                        status: existingTorrent.status,
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
    async getStreamLink(torrentId, apiKey, season, episode, rdService) {
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
        if (!rdService) {
            return { streamLink: null, fromCache: false };
        }
        const streamLink = await rdService.getStreamLinkForTorrent(torrentId, apiKey, season, episode);
        if (streamLink) {
            const cachedStream = {
                streamLink,
                cachedAt: Date.now()
            };
            this.streamLinkCache.set(cacheKey, cachedStream);
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
        }
    }
    getStats() {
        return {
            version: '1.0.0',
            torrentCacheSize: this.torrentCache.size,
            streamLinkCacheSize: this.streamLinkCache.size,
            activeLocks: this.processingLocks.size,
            ttlConfig: {
                torrentCache: '30 dias',
                streamLinkCache: '24 horas'
            },
            features: [
                'Cache inteligente de 2 camadas',
                'Lock por magnet hash para evitar duplicatas',
                'Cache compartilhado por hash (diferentes usuários)',
                'Invalidacao automatica ao deletar torrent',
                'Limpeza automatica de cache expirado'
            ]
        };
    }
}
exports.RdTorrentCacheService = RdTorrentCacheService;
