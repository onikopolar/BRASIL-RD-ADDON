"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const logger_js_1 = require("../utils/logger.js");
class CacheService {
    constructor(options = {}) {
        this.cache = new Map();
        this.cleanupTimer = null;
        this.sets = 0;
        this.hits = 0;
        this.misses = 0;
        this.expired = 0;
        this.deletes = 0;
        this.name = options.name ?? 'default';
        this.logger = new logger_js_1.Logger('CacheService');
        this.startCleanup();
    }
    startCleanup() {
        this.cleanupTimer = setInterval(() => {
            const now = Date.now();
            let removed = 0;
            for (const [key, entry] of this.cache.entries()) {
                if ((now - entry.timestamp) > entry.ttl) {
                    this.cache.delete(key);
                    removed++;
                }
            }
            if (removed > 0) {
                this.logger.debug(`cleanup[${this.name}] expiradas=${removed} restantes=${this.cache.size} ` +
                    `hits=${this.hits} misses=${this.misses} sets=${this.sets}`);
            }
        }, 5 * 60 * 1000);
        if (this.cleanupTimer.unref)
            this.cleanupTimer.unref();
    }
    destroy() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        this.cache.clear();
    }
    set(key, value, ttl = 3600000) {
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl,
        });
        this.sets++;
    }
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            this.misses++;
            return null;
        }
        const now = Date.now();
        if ((now - cached.timestamp) > cached.ttl) {
            this.cache.delete(key);
            this.expired++;
            return null;
        }
        this.hits++;
        return cached.value;
    }
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted)
            this.deletes++;
        return deleted;
    }
    clear() {
        this.cache.clear();
        this.logger.debug(`clear[${this.name}] cache esvaziado`);
    }
    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys()),
            sets: this.sets,
            hits: this.hits,
            misses: this.misses,
            expired: this.expired,
            deletes: this.deletes,
        };
    }
}
exports.CacheService = CacheService;
