import { Logger } from '../utils/logger.js';
import { CacheData } from '../types/index.js';
export class CacheService {
  private cache: Map<string, CacheData<any>> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CacheService');
    this.startCleanupInterval();
  }

  set<T>(key: string, data: T, ttl: number = 3600000): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresIn: ttl
    });
    this.logger.debug(`Cache set for key: ${key}`, { ttl });
  }

  get<T>(key: string): T | null {
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

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) {
      this.logger.debug(`Cache deleted for key: ${key}`);
    }
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.logger.info('Cache cleared');
  }

  private startCleanupInterval(): void {
    // Limpa cache expirado a cada 5 minutos
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
    }, 300000); // 5 minutos
  }

  getStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}