import { Cacheable } from 'cacheable';
import { Logger } from '../utils/logger.js';
import { metricsService } from './MetricsService.js';

export interface CacheEntry<T = any> {
  value: T;
  timestamp: number;
  ttl: number;
  staleUntil?: number;
  lastAccessed: number;
}

export class AdvancedCacheService {
  private cache: Cacheable;
  private logger: Logger;
  private namespace: string;
  
  // Cache separado para stale-while-revalidate
  private staleCache: Map<string, CacheEntry> = new Map();
  
  constructor(namespace: string = 'default', options: {
    maxAge?: number;
    staleWhileRevalidate?: number;
    maxSize?: number;
  } = {}) {
    this.logger = new Logger('AdvancedCacheService');
    this.namespace = namespace;
    
    const cacheableOptions = {
      ttl: options.maxAge || 3600000, // 1 hora padrão
      staleWhileRevalidate: options.staleWhileRevalidate || 300000, // 5 minutos extra
      max: options.maxSize || 1000, // Máximo 1000 entradas
    };
    
    this.cache = new Cacheable(cacheableOptions);
  }
  
  /**
   * Get com stale-while-revalidate
   */
  async get<T>(key: string): Promise<T | null> {
    const fullKey = `${this.namespace}:${key}`;
    
    try {
      // Tenta pegar do cache principal
      const cached = await this.cache.get(fullKey);
      
      if (cached !== undefined) {
        // Cache hit - registra métrica
        metricsService.recordCacheHit();
        this.logger.debug('Cache hit', { namespace: this.namespace, key });
        return cached as T;
      }
      
      // Cache miss - verifica se tem stale
      const staleEntry = this.staleCache.get(fullKey);
      if (staleEntry && !this.isExpired(staleEntry, true)) {
        // Stale hit - serve enquanto revalida em background
        metricsService.recordCacheHit();
        this.logger.debug('Stale cache hit', { namespace: this.namespace, key });
        
        // Dispara revalidação em background (não bloqueia)
        this.revalidateInBackground(fullKey, key);
        
        return staleEntry.value;
      }
      
      // Cache miss completo
      metricsService.recordCacheMiss();
      this.logger.debug('Cache miss', { namespace: this.namespace, key });
      return null;
      
    } catch (error) {
      this.logger.error('Erro ao buscar no cache', {
        namespace: this.namespace,
        key,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }
  
  /**
   * Set com TTL e stale time
   */
  async set<T>(
    key: string, 
    value: T, 
    options: {
      ttl?: number;
      staleWhileRevalidate?: number;
    } = {}
  ): Promise<void> {
    const fullKey = `${this.namespace}:${key}`;
    
    try {
      // Salva no cache principal
      await this.cache.set(fullKey, value, options.ttl);
      
      // Se tiver stale time, salva também no stale cache
      if (options.staleWhileRevalidate) {
        const staleEntry: CacheEntry<T> = {
          value,
          timestamp: Date.now(),
          ttl: options.ttl || 3600000,
          staleUntil: Date.now() + (options.staleWhileRevalidate || 300000),
          lastAccessed: Date.now()
        };
        
        this.staleCache.set(fullKey, staleEntry);
      }
      
      // Atualiza métricas
      metricsService.setCacheSize(this.staleCache.size);
      this.logger.debug('Cache set', { 
        namespace: this.namespace, 
        key,
        ttl: options.ttl || 'default'
      });
      
    } catch (error) {
      this.logger.error('Erro ao salvar no cache', {
        namespace: this.namespace,
        key,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }
  }
  
  /**
   * Delete
   */
  async delete(key: string): Promise<boolean> {
    const fullKey = `${this.namespace}:${key}`;
    
    try {
      await this.cache.delete(fullKey);
      this.staleCache.delete(fullKey);
      
      this.logger.debug('Cache deleted', { namespace: this.namespace, key });
      return true;
      
    } catch (error) {
      this.logger.error('Erro ao deletar do cache', {
        namespace: this.namespace,
        key,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return false;
    }
  }
  
  /**
   * Clear all
   */
  async clear(): Promise<void> {
    await this.cache.clear();
    this.staleCache.clear();
    
    this.logger.info('Cache cleared', { namespace: this.namespace });
  }
  
  /**
   * Revalidação em background para stale-while-revalidate
   */
  private async revalidateInBackground(fullKey: string, originalKey: string): Promise<void> {
    // Em implementação real, aqui chamaria a função de revalidação
    // Por enquanto só log
    this.logger.debug('Revalidação em background iniciada', {
      namespace: this.namespace,
      key: originalKey
    });
  }
  
  /**
   * Verifica se cache está expirado
   */
  private isExpired(entry: CacheEntry, checkStale: boolean = false): boolean {
    const now = Date.now();
    
    if (checkStale && entry.staleUntil && now < entry.staleUntil) {
      return false; // Ainda dentro do stale period
    }
    
    return (now - entry.timestamp) > entry.ttl;
  }
  
  /**
   * Limpa cache expirado
   */
  cleanupExpired(): void {
    const now = Date.now();
    let removed = 0;
    
    for (const [key, entry] of this.staleCache) {
      if (this.isExpired(entry, false)) { // Não considerar stale para limpeza
        this.staleCache.delete(key);
        removed++;
      }
    }
    
    if (removed > 0) {
      this.logger.debug('Stale cache limpo', {
        namespace: this.namespace,
        removed
      });
      metricsService.setCacheSize(this.staleCache.size);
    }
  }
  
  /**
   * Estatísticas
   */
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

// Instâncias pré-configuradas para diferentes usos
export const torrentCacheService = new AdvancedCacheService('torrents', {
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias
  staleWhileRevalidate: 60 * 60 * 1000, // 1 hora
  maxSize: 5000
});

export const streamCacheService = new AdvancedCacheService('streams', {
  maxAge: 24 * 60 * 60 * 1000, // 24 horas
  staleWhileRevalidate: 30 * 60 * 1000, // 30 minutos
  maxSize: 10000
});

export const metadataCacheService = new AdvancedCacheService('metadata', {
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 dias
  staleWhileRevalidate: 2 * 60 * 60 * 1000, // 2 horas
  maxSize: 2000
});
