import { Logger } from '../utils/logger.js';
import { CacheData } from '../types/index.js';

export interface CacheServiceOptions {
  /** Nome lógico da instância — usado nos poucos logs que restam. */
  name?: string;
}

export interface CacheServiceStats {
  size: number;
  keys: string[];
  sets: number;
  hits: number;
  misses: number;
  expired: number;
  deletes: number;
}

export class CacheService {
  private cache: Map<string, CacheData<any>> = new Map();
  private logger: Logger;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly name: string;

  // Contadores agregados — substituem os logs por operação.
  private sets = 0;
  private hits = 0;
  private misses = 0;
  private expired = 0;
  private deletes = 0;

  constructor(options: CacheServiceOptions = {}) {
    this.name = options.name ?? 'default';
    this.logger = new Logger('CacheService');
    this.startCleanup();
  }

  /** Remove entradas expiradas a cada 5 min. Loga só quando remove algo. */
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
        this.logger.debug(
          `cleanup[${this.name}] expiradas=${removed} restantes=${this.cache.size} ` +
          `hits=${this.hits} misses=${this.misses} sets=${this.sets}`
        );
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
      ttl,
    });
    this.sets++;
  }

  get<T>(key: string): T | null {
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

  delete(key: string): boolean {
    const deleted = this.cache.delete(key);
    if (deleted) this.deletes++;
    return deleted;
  }

  clear(): void {
    this.cache.clear();
    this.logger.debug(`clear[${this.name}] cache esvaziado`);
  }

  getStats(): CacheServiceStats {
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