"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const logger_1 = require("../utils/logger");
class CacheService {
    constructor() {
        this.cache = new Map();
        this.logger = new logger_1.Logger('CacheService');
        this.startCleanupInterval();
    }
    set(key, data, ttl = 3600000) {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            expiresIn: ttl
        });
        this.logger.debug(`Cache set for key: ${key}`, { ttl });
    }
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            this.logger.debug(`Cache miss for key: ${key}`);
            return null;
        }
        const isExpired = Date.now() - cached.timestamp > cached.expiresIn;
        if (isExpired) {
            this.cache.delete(key);
            this.logger.debug(`Cache expired for key: ${key}`);
            return null;
        }
        this.logger.debug(`Cache hit for key: ${key}`);
        return cached.data;
    }
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.logger.debug(`Cache deleted for key: ${key}`);
        }
        return deleted;
    }
    clear() {
        this.cache.clear();
        this.logger.info('Cache cleared');
    }
    startCleanupInterval() {
        setInterval(() => {
            const now = Date.now();
            let cleanedCount = 0;
            for (const [key, value] of this.cache.entries()) {
                if (now - value.timestamp > value.expiresIn) {
                    this.cache.delete(key);
                    cleanedCount++;
                }
            }
            if (cleanedCount > 0) {
                this.logger.debug(`Cache cleanup completed`, { cleanedCount });
            }
        }, 300000);
    }
    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}
exports.CacheService = CacheService;
