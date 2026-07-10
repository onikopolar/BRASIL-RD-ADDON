"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadataCacheService = exports.streamCacheService = exports.torrentCacheService = exports.AdvancedCacheService = void 0;
const cacheable_1 = require("cacheable");
const logger_js_1 = require("../utils/logger.js");
const MetricsService_js_1 = require("./MetricsService.js");
class AdvancedCacheService {
    constructor(namespace = 'default', options = {}) {
        this.staleCache = new Map();
        this.logger = new logger_js_1.Logger('AdvancedCacheService');
        this.namespace = namespace;
        const cacheableOptions = {
            ttl: options.maxAge || 3600000,
            staleWhileRevalidate: options.staleWhileRevalidate || 300000,
            max: options.maxSize || 1000,
        };
        this.cache = new cacheable_1.Cacheable(cacheableOptions);
    }
    async get(key) {
        const fullKey = `${this.namespace}:${key}`;
        try {
            const cached = await this.cache.get(fullKey);
            if (cached !== undefined) {
                MetricsService_js_1.metricsService.recordCacheHit();
                this.logger.debug('Cache hit', { namespace: this.namespace, key });
                return cached;
            }
            const staleEntry = this.staleCache.get(fullKey);
            if (staleEntry && !this.isExpired(staleEntry, true)) {
                MetricsService_js_1.metricsService.recordCacheHit();
                this.logger.debug('Stale cache hit', { namespace: this.namespace, key });
                this.revalidateInBackground(fullKey, key);
                return staleEntry.value;
            }
            MetricsService_js_1.metricsService.recordCacheMiss();
            this.logger.debug('Cache miss', { namespace: this.namespace, key });
            return null;
        }
        catch (error) {
            this.logger.error('Erro ao buscar no cache', {
                namespace: this.namespace,
                key,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async set(key, value, options = {}) {
        const fullKey = `${this.namespace}:${key}`;
        try {
            await this.cache.set(fullKey, value, options.ttl);
            if (options.staleWhileRevalidate) {
                const staleEntry = {
                    value,
                    timestamp: Date.now(),
                    ttl: options.ttl || 3600000,
                    staleUntil: Date.now() + (options.staleWhileRevalidate || 300000),
                    lastAccessed: Date.now()
                };
                this.staleCache.set(fullKey, staleEntry);
            }
            MetricsService_js_1.metricsService.setCacheSize(this.staleCache.size);
            this.logger.debug('Cache set', {
                namespace: this.namespace,
                key,
                ttl: options.ttl || 'default'
            });
        }
        catch (error) {
            this.logger.error('Erro ao salvar no cache', {
                namespace: this.namespace,
                key,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
    }
    async delete(key) {
        const fullKey = `${this.namespace}:${key}`;
        try {
            await this.cache.delete(fullKey);
            this.staleCache.delete(fullKey);
            this.logger.debug('Cache deleted', { namespace: this.namespace, key });
            return true;
        }
        catch (error) {
            this.logger.error('Erro ao deletar do cache', {
                namespace: this.namespace,
                key,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return false;
        }
    }
    async clear() {
        await this.cache.clear();
        this.staleCache.clear();
        this.logger.info('Cache cleared', { namespace: this.namespace });
    }
    async revalidateInBackground(fullKey, originalKey) {
        this.logger.debug('Revalidação em background iniciada', {
            namespace: this.namespace,
            key: originalKey
        });
    }
    isExpired(entry, checkStale = false) {
        const now = Date.now();
        if (checkStale && entry.staleUntil && now < entry.staleUntil) {
            return false;
        }
        return (now - entry.timestamp) > entry.ttl;
    }
    cleanupExpired() {
        const now = Date.now();
        let removed = 0;
        for (const [key, entry] of this.staleCache) {
            if (this.isExpired(entry, false)) {
                this.staleCache.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            this.logger.debug('Stale cache limpo', {
                namespace: this.namespace,
                removed
            });
            MetricsService_js_1.metricsService.setCacheSize(this.staleCache.size);
        }
    }
    getStats() {
        return {
            namespace: this.namespace,
            cacheSize: this.staleCache.size,
            cacheableSize: 'Disponível via Cacheable',
            features: [
                'Cache em memória com LRU',
                'Stale-while-revalidate',
                'Métricas integradas',
                'TTL configurável',
                'Limpeza automática'
            ]
        };
    }
}
exports.AdvancedCacheService = AdvancedCacheService;
exports.torrentCacheService = new AdvancedCacheService('torrents', {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    staleWhileRevalidate: 60 * 60 * 1000,
    maxSize: 5000
});
exports.streamCacheService = new AdvancedCacheService('streams', {
    maxAge: 24 * 60 * 60 * 1000,
    staleWhileRevalidate: 30 * 60 * 1000,
    maxSize: 10000
});
exports.metadataCacheService = new AdvancedCacheService('metadata', {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    staleWhileRevalidate: 2 * 60 * 60 * 1000,
    maxSize: 2000
});
