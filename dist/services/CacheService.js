"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheService = void 0;
const logger_js_1 = require("../utils/logger.js");
class CacheService {
    constructor() {
        this.cache = new Map();
        this.logger = new logger_js_1.Logger('CacheService');
    }
    set(key, value, ttl = 3600000) {
        this.cache.set(key, {
            value,
            timestamp: Date.now(),
            ttl
        });
        this.logger.debug('Cache set', { key, ttl });
    }
    get(key) {
        const cached = this.cache.get(key);
        if (!cached) {
            return null;
        }
        const now = Date.now();
        const isExpired = (now - cached.timestamp) > cached.ttl;
        if (isExpired) {
            this.cache.delete(key);
            this.logger.debug('Cache expired', { key });
            return null;
        }
        this.logger.debug('Cache hit', { key });
        return cached.value;
    }
    delete(key) {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.logger.debug('Cache deleted', { key });
        }
        return deleted;
    }
    clear() {
        this.cache.clear();
        this.logger.info('Cache cleared');
    }
    getStats() {
        return {
            size: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }
}
exports.CacheService = CacheService;
