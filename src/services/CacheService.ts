import { Logger } from '../utils/logger';
import { CacheData } from '../types/index';

export class CacheService {
  private cache: Map<string, CacheData<any>> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CacheService');
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