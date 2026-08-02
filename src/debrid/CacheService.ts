import { Logger } from '../utils/logger.js';
import { CacheData } from '../types/index.js';

export class CacheService {
  private cache: Map<string, CacheData<any>> = new Map();
  private logger: Logger;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.logger = new Logger('CacheService');
    this.startCleanup();
  }

  /** Remove entradas expiradas a cada 5 minutos para evitar memory leak */
  private startCleanup(): void {
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
        this.logger.debug(`🧹 Cache cleanup: ${removed} entradas expiradas removidas (${this.cache.size} restantes)`);
      }
    }, 5 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.cache.clear();
  }

  set<T>(key: string, value: T, ttl: number = 3600000): void {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl
    });
    this.logger.debug('Cache set', { key, ttl });
  }

  get<T>(key: string): T | null {
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

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.logger.debug('Cache deleted', { key });
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}