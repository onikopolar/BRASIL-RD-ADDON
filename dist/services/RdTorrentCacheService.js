"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RdTorrentCacheService = void 0;
const logger_1 = require("../utils/logger");
const AdvancedCacheService_1 = require("./AdvancedCacheService");
const MetricsService_1 = require("./MetricsService");
class RdTorrentCacheService {
    constructor() {
        this.torrentCache = new Map();
        this.streamLinkCache = new Map();
        this.TORRENT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
        this.STREAM_LINK_TTL = 24 * 60 * 60 * 1000;
        this.processingLocks = new Map();
        this.logger = new logger_1.Logger('RdTorrentCacheService');
        this.logger.debug('RdTorrentCacheService ready');
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
                const advancedCacheKey = `torrent:${magnetHash}:${apiKey.substring(0, 8)}`;
                const cachedFromAdvanced = await AdvancedCacheService_1.torrentCacheService.get(advancedCacheKey);
                if (cachedFromAdvanced) {
                    if (!this.isCacheExpired(cachedFromAdvanced.cachedAt, this.TORRENT_CACHE_TTL)) {
                        this.logger.debug('Cache avançado de torrent HIT', {
                            magnetHash,
                            torrentId: cachedFromAdvanced.torrentId,
                            status: cachedFromAdvanced.status
                        });
                        return {
                            torrentId: cachedFromAdvanced.torrentId,
                            status: cachedFromAdvanced.status,
                            fromCache: true
                        };
                    }
                }
                const cachedTorrent = this.torrentCache.get(cacheKey);
                if (cachedTorrent && !this.isCacheExpired(cachedTorrent.cachedAt, this.TORRENT_CACHE_TTL)) {
                    this.logger.debug('Cache de torrent HIT', {
                        magnetHash,
                        torrentId: cachedTorrent.torrentId,
                        status: cachedTorrent.status
                    });
                    this.updateAdvancedCacheInBackground(advancedCacheKey, cachedTorrent);
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
                    const cachedTorrent = {
                        torrentId: tid,
                        status: existingTorrent.download_state,
                        cachedAt: Date.now(),
                        apiKeyPrefix: apiKey.substring(0, 8)
                    };
                    await AdvancedCacheService_1.torrentCacheService.set(advancedCacheKey, cachedTorrent, {
                        ttl: this.TORRENT_CACHE_TTL,
                        staleWhileRevalidate: 60 * 60 * 1000
                    });
                    this.torrentCache.set(cacheKey, cachedTorrent);
                    MetricsService_1.metricsService.setCacheSize(this.torrentCache.size);
                    this.logger.info('Torrent salvo no cache avançado', {
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
    async getStreamLink(torrentId, apiKey, season, episode, torboxService) {
        const cacheKey = this.getStreamLinkCacheKey(torrentId, season, episode);
        const advancedCacheKey = `stream:${torrentId}:${season || 'all'}:${episode || 'all'}`;
        const cachedFromAdvanced = await AdvancedCacheService_1.streamCacheService.get(advancedCacheKey);
        if (cachedFromAdvanced) {
            if (!this.isCacheExpired(cachedFromAdvanced.cachedAt, this.STREAM_LINK_TTL)) {
                this.logger.debug('Cache avançado de stream link HIT', {
                    torrentId,
                    season,
                    episode,
                    streamLink: cachedFromAdvanced.streamLink.substring(0, 50) + '...'
                });
                return {
                    streamLink: cachedFromAdvanced.streamLink,
                    fromCache: true
                };
            }
        }
        const cachedStream = this.streamLinkCache.get(cacheKey);
        if (cachedStream && !this.isCacheExpired(cachedStream.cachedAt, this.STREAM_LINK_TTL)) {
            this.logger.debug('Cache de stream link HIT', {
                torrentId,
                season,
                episode,
                streamLink: cachedStream.streamLink.substring(0, 50) + '...'
            });
            this.updateAdvancedCacheInBackground(advancedCacheKey, cachedStream);
            return {
                streamLink: cachedStream.streamLink,
                fromCache: true
            };
        }
        this.logger.debug('Cache de stream link MISS', { torrentId, season, episode });
        if (!torboxService) {
            return { streamLink: null, fromCache: false };
        }
        const streamLink = await torboxService.getStreamLinkForTorrent(torrentId, apiKey, season, episode);
        if (streamLink) {
            const cachedStream = {
                streamLink,
                cachedAt: Date.now()
            };
            await AdvancedCacheService_1.streamCacheService.set(advancedCacheKey, cachedStream, {
                ttl: this.STREAM_LINK_TTL,
                staleWhileRevalidate: 30 * 60 * 1000
            });
            this.streamLinkCache.set(cacheKey, cachedStream);
            MetricsService_1.metricsService.setCacheSize(this.streamLinkCache.size);
            this.logger.info('Stream link salvo no cache avançado', {
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
    async updateAdvancedCacheInBackground(key, data) {
        setImmediate(async () => {
            try {
                if (key.startsWith('torrent:')) {
                    await AdvancedCacheService_1.torrentCacheService.set(key, data, {
                        ttl: this.TORRENT_CACHE_TTL,
                        staleWhileRevalidate: 60 * 60 * 1000
                    });
                }
                else if (key.startsWith('stream:')) {
                    await AdvancedCacheService_1.streamCacheService.set(key, data, {
                        ttl: this.STREAM_LINK_TTL,
                        staleWhileRevalidate: 30 * 60 * 1000
                    });
                }
                this.logger.debug('Cache avançado atualizado em background', { key });
            }
            catch (error) {
                this.logger.debug('Erro ao atualizar cache avançado em background', {
                    key,
                    error: error instanceof Error ? error.message : 'Erro desconhecido'
                });
            }
        });
    }
    updateTorrentStatus(magnetHash, apiKey, status) {
        const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
        const advancedCacheKey = `torrent:${magnetHash}:${apiKey.substring(0, 8)}`;
        const cachedTorrent = this.torrentCache.get(cacheKey);
        if (cachedTorrent) {
            cachedTorrent.status = status;
            cachedTorrent.cachedAt = Date.now();
            this.torrentCache.set(cacheKey, cachedTorrent);
            this.updateAdvancedCacheInBackground(advancedCacheKey, cachedTorrent);
            this.logger.debug('Status do torrent atualizado no cache', {
                magnetHash,
                status
            });
        }
    }
    invalidateTorrent(magnetHash, apiKey) {
        const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
        const advancedCacheKey = `torrent:${magnetHash}:${apiKey.substring(0, 8)}`;
        const torrent = this.torrentCache.get(cacheKey);
        if (torrent) {
            AdvancedCacheService_1.torrentCacheService.delete(advancedCacheKey);
            this.torrentCache.delete(cacheKey);
            const streamKeyPrefix = `stream:${torrent.torrentId}:`;
            for (const [key] of this.streamLinkCache) {
                if (key.startsWith(streamKeyPrefix)) {
                    this.streamLinkCache.delete(key);
                    AdvancedCacheService_1.streamCacheService.delete(`stream:${torrent.torrentId}:${key.split(':').slice(2).join(':')}`);
                }
            }
            this.logger.info('Torrent invalidado do cache avançado', {
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
            MetricsService_1.metricsService.setCacheSize(this.torrentCache.size + this.streamLinkCache.size);
        }
    }
    getStats() {
        return {
            version: '1.1.0',
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
                'Limpeza automatica de cache expirado',
                'Cache avançado com stale-while-revalidate',
                'LRU automático para gerenciamento de memória',
                'Métricas integradas com Prometheus'
            ]
        };
    }
}
exports.RdTorrentCacheService = RdTorrentCacheService;
