import { Logger } from '../../utils/logger';
import { ImdbTitles } from '../../services/ImdbScraperService';
import {
  ImdbTitleCacheEntry,
  DeduplicationCacheEntry,
  SeriesConfusion
} from './interfaces';

export class CacheManager {
  private readonly logger: Logger;
  
  // Caches - IGUAL AO ORIGINAL
  private readonly imdbTitleCache = new Map<string, ImdbTitleCacheEntry>();
  private readonly deduplicationCache = new Map<string, DeduplicationCacheEntry>();
  private readonly processedTimestamps = new Map<string, number>();
  private readonly cleanTitleCache = new Map<string, string>();
  private readonly portugueseCheckCache = new Map<string, boolean>();
  
  // Configurações - IGUAL AO ORIGINAL
  private readonly IMDB_CACHE_TTL: number;
  private readonly DEDUP_CACHE_TTL: number;
  private readonly TITLE_CACHE_TTL: number;

  private static instance: CacheManager;

  public static getInstance(): CacheManager {
    if (!CacheManager.instance) {
      CacheManager.instance = new CacheManager();
    }
    return CacheManager.instance;
  }
  
  constructor(
    imdbCacheTTL: number = 30 * 60 * 1000,    // 30 minutos
    dedupCacheTTL: number = 10 * 60 * 1000,   // 10 minutos
    titleCacheTTL: number = 5 * 60 * 1000     // 5 minutos
  ) {
    this.logger = new Logger('CacheManager');
    this.IMDB_CACHE_TTL = imdbCacheTTL;
    this.DEDUP_CACHE_TTL = dedupCacheTTL;
    this.TITLE_CACHE_TTL = titleCacheTTL;
    this.logger.debug('CacheManager ready');
  }

  /**
   * Limpa caches antigos - IGUAL AO ORIGINAL
   */
  cleanupOldCaches(imdbCacheTTL?: number, dedupCacheTTL?: number, titleCacheTTL?: number): void {
    const now = Date.now();
    const imdbTTL = imdbCacheTTL || this.IMDB_CACHE_TTL;
    const dedupTTL = dedupCacheTTL || this.DEDUP_CACHE_TTL;
    const titleTTL = titleCacheTTL || this.TITLE_CACHE_TTL;
    
    let cleanedCount = 0;
    
    // Limpa cache de títulos IMDB
    for (const [key, entry] of this.imdbTitleCache.entries()) {
      if (now - entry.timestamp > imdbTTL) {
        this.imdbTitleCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Limpa cache de deduplicação
    for (const [key, entry] of this.deduplicationCache.entries()) {
      if (now - entry.timestamp > dedupTTL) {
        this.deduplicationCache.delete(key);
        cleanedCount++;
      }
    }
    
    // Limpa timestamps processados - IGUAL AO ORIGINAL
    for (const [key, timestamp] of this.processedTimestamps.entries()) {
      if (now - timestamp > titleTTL) {
        this.processedTimestamps.delete(key);
        cleanedCount++;
      }
    }
    
    // Limpeza ocasional com log - IGUAL AO ORIGINAL
    if (cleanedCount > 0 && Math.random() < 0.01) {
      this.logger.debug(' Cache limpo (limpeza automática)', { 
        itensRemovidos: cleanedCount,
        cacheIMDB: this.imdbTitleCache.size,
        cacheProcessados: this.processedTimestamps.size
      });
    }
  }

  /**
   * Deduplica torrents - IGUAL AO ORIGINAL
   */
  deduplicateTorrents(torrents: any[], logger?: Logger): any[] {
    if (torrents.length <= 1) return torrents;
    
    const seen = new Set<string>();
    const uniqueTorrents: any[] = [];
    let duplicatesRemoved = 0;
    
    for (const torrent of torrents) {
      const infoHash = this.extractInfoHash(torrent.magnet || torrent);
      const title = torrent.title || 'unknown';
      
      let key: string;
      if (infoHash) {
        key = infoHash;
      } else {
        const cleanTitle = this.extractCleanTitleForDedupe(title);
        key = cleanTitle;
      }
      
      if (seen.has(key)) {
        duplicatesRemoved++;
        if (logger) {
          logger.debug(' Torrent duplicado removido', {
            title: title.substring(0, 60),
            infoHash: infoHash?.substring(0, 8) || 'N/A'
          });
        }
        continue;
      }
      
      seen.add(key);
      uniqueTorrents.push(torrent);
    }
    
    if (duplicatesRemoved > 0 && logger) {
      logger.info(' Deduplicação concluída', {
        totalAntes: torrents.length,
        totalDepois: uniqueTorrents.length,
        duplicatasRemovidas: duplicatesRemoved
      });
    }
    
    return uniqueTorrents;
  }

  /**
   * Verifica se já foi processado - IGUAL AO ORIGINAL
   */
  isAlreadyProcessed(dedupeKey: string): boolean {
    // Limpeza periódica - IGUAL AO ORIGINAL (1% chance)
    if (Math.random() < 0.01) {
      this.cleanupOldCaches();
    }
    
    return this.processedTimestamps.has(dedupeKey);
  }

  /**
   * Marca como processado - IGUAL AO ORIGINAL
   */
  markAsProcessed(dedupeKey: string): void {
    this.processedTimestamps.set(dedupeKey, Date.now());
  }

  /**
   * Obtém títulos do IMDB do cache - IGUAL AO ORIGINAL
   */
getImdbTitlesFromCache(imdbId: string): ImdbTitleCacheEntry | null {
  const entry = this.imdbTitleCache.get(imdbId);
  if (entry && Date.now() - entry.timestamp < this.IMDB_CACHE_TTL) {
    return entry; // Retorna a ENTRY completa (com timestamp)
  }
  return null;
}

  /**
   * Salva títulos do IMDB no cache - IGUAL AO ORIGINAL
   */
  saveImdbTitlesToCache(imdbId: string, titles: ImdbTitles): void {
    this.imdbTitleCache.set(imdbId, {
      titles,
      timestamp: Date.now()
    });
  }

  /**
   * Verifica cache de título limpo - IGUAL AO ORIGINAL
   */
  getCleanTitleFromCache(fullTitle: string): string | null {
    const cacheKey = `clean:${fullTitle}`;
    const cached = this.cleanTitleCache.get(cacheKey);
    
    if (cached) {
      this.logger.debug(' Clean title em cache', {
        original: fullTitle.substring(0, 60),
        cleaned: cached.substring(0, 60)
      });
      return cached;
    }
    
    return null;
  }

  /**
   * Salva título limpo no cache - IGUAL AO ORIGINAL
   */
  saveCleanTitleToCache(fullTitle: string, cleanedTitle: string): void {
    const cacheKey = `clean:${fullTitle}`;
    this.cleanTitleCache.set(cacheKey, cleanedTitle);
  }

  /**
   * Verifica cache de português - IGUAL AO ORIGINAL
   */
  getPortugueseCheckFromCache(torrentTitle: string): boolean | null {
    const titleCacheKey = torrentTitle.toLowerCase();
    const cached = this.portugueseCheckCache.get(titleCacheKey);
    
    if (cached !== undefined) {
      this.logger.debug(' Resultado em cache', {
        title: torrentTitle.substring(0, 60),
        result: cached ? ' Português' : ' Não português'
      });
      return cached;
    }
    
    return null;
  }

  /**
   * Salva verificação de português no cache - IGUAL AO ORIGINAL
   */
  savePortugueseCheckToCache(torrentTitle: string, isPortuguese: boolean): void {
    const titleCacheKey = torrentTitle.toLowerCase();
    this.portugueseCheckCache.set(titleCacheKey, isPortuguese);
  }

  /**
   * Extrai infoHash - EXATAMENTE IGUAL AO ORIGINAL
   */
  extractInfoHash(source: string | any): string | null {
    if (typeof source === 'string') {
      const magnetMatch = source.match(/btih:([a-zA-Z0-9]{40})/i);
      return magnetMatch ? magnetMatch[1].toLowerCase() : null;
    } else if (source && typeof source === 'object') {
      if (source.infoHash) {
        return source.infoHash.toLowerCase();
      }
      if (source.magnet && typeof source.magnet === 'string') {
        const magnetMatch = source.magnet.match(/btih:([a-zA-Z0-9]{40})/i);
        return magnetMatch ? magnetMatch[1].toLowerCase() : null;
      }
    }
    return null;
  }

  /**
   * Cria chave de deduplicação - IGUAL AO ORIGINAL
   */
  createDedupeKey(torrentTitle: string, infoHash?: string): string {
    const cleanTitle = this.extractCleanTitleForDedupe(torrentTitle).toLowerCase().replace(/\s+/g, '_');
    return infoHash ? `${infoHash}:${cleanTitle}` : cleanTitle;
  }

  /**
   * Extrai título limpo para deduplicação - SIMPLIFICADO (IGUAL AO ORIGINAL)
   */
  private extractCleanTitleForDedupe(torrentTitle: string): string {
    // Versão simplificada similar ao original
    return torrentTitle
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Limpa todos os caches - IGUAL AO ORIGINAL (mas centralizado)
   */
  clearAllCaches(): void {
    this.imdbTitleCache.clear();
    this.deduplicationCache.clear();
    this.processedTimestamps.clear();
    this.cleanTitleCache.clear();
    this.portugueseCheckCache.clear();
    this.logger.info(' Todos os caches do CacheManager foram limpos');
  }

  /**
   * Estatísticas de cache - IGUAL AO ORIGINAL (mas delegado)
   */
  getCacheStats(): {
    imdbCacheSize: number;
    dedupCacheSize: number;
    processedTimestampsSize: number;
    cleanTitleCacheSize: number;
    portugueseCheckCacheSize: number;
  } {
    const stats = {
      imdbCacheSize: this.imdbTitleCache.size,
      dedupCacheSize: this.deduplicationCache.size,
      processedTimestampsSize: this.processedTimestamps.size,
      cleanTitleCacheSize: this.cleanTitleCache.size,
      portugueseCheckCacheSize: this.portugueseCheckCache.size
    };
    
    this.logger.debug(' Estatísticas de cache', stats);
    
    return stats;
  }

  /**
   * Setup para cache de processamento - NOVO (para TitleFilter refatorado)
   */
  setupProcessedCache(cleanupChance: number = 0.01): void {
    this.logger.debug(' Cache de processamento configurado', {
      cleanupChance,
      ttlIMDB: `${this.IMDB_CACHE_TTL / 60000}min`,
      ttlProcessados: `${this.TITLE_CACHE_TTL / 60000}min`
    });
  }

  /**
   * Verifica e marca como processado - NOVO (para TitleFilter refatorado)
   */
  checkAndMarkProcessed(torrent: any): { alreadyProcessed: boolean; dedupeKey: string } {
    const infoHash = this.extractInfoHash(torrent.magnet || torrent);
    const title = torrent.title || torrent;
    const dedupeKey = this.createDedupeKey(title, infoHash || undefined);
    
    const alreadyProcessed = this.isAlreadyProcessed(dedupeKey);
    
    if (!alreadyProcessed) {
      this.markAsProcessed(dedupeKey);
    }
    
    return { alreadyProcessed, dedupeKey };
  }

  /**
   * Força limpeza de caches - NOVO (para testes)
   */
  forceCleanup(): { removed: number } {
    const initialTotal = this.imdbTitleCache.size + 
                        this.deduplicationCache.size + 
                        this.processedTimestamps.size +
                        this.cleanTitleCache.size +
                        this.portugueseCheckCache.size;
    
    this.cleanupOldCaches();
    
    const finalTotal = this.imdbTitleCache.size + 
                      this.deduplicationCache.size + 
                      this.processedTimestamps.size +
                      this.cleanTitleCache.size +
                      this.portugueseCheckCache.size;
    
    const removed = initialTotal - finalTotal;
    
    this.logger.info(' Limpeza forçada de caches', {
      removidos: removed,
      restantes: finalTotal
    });
    
    return { removed };
  }

  /**
   * Verifica saúde dos caches - NOVO (para monitoramento)
   */
  getCacheHealth(): {
    imdbCacheHealth: 'healthy' | 'warning' | 'critical';
    processedCacheHealth: 'healthy' | 'warning' | 'critical';
    totalEntries: number;
    oldestEntryAge: number;
  } {
    const now = Date.now();
    let oldestAge = 0;
    
    // Encontra a entrada mais antiga
    for (const entry of this.imdbTitleCache.values()) {
      const age = now - entry.timestamp;
      if (age > oldestAge) oldestAge = age;
    }
    
    for (const timestamp of this.processedTimestamps.values()) {
      const age = now - timestamp;
      if (age > oldestAge) oldestAge = age;
    }
    
    // Calcula saúde do cache IMDB
    let imdbCacheHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    const imdbSize = this.imdbTitleCache.size;
    if (imdbSize > 1000) {
      imdbCacheHealth = 'warning';
    }
    if (imdbSize > 5000) {
      imdbCacheHealth = 'critical';
    }
    
    // Calcula saúde do cache de processados
    let processedCacheHealth: 'healthy' | 'warning' | 'critical' = 'healthy';
    const processedSize = this.processedTimestamps.size;
    if (processedSize > 5000) {
      processedCacheHealth = 'warning';
    }
    if (processedSize > 20000) {
      processedCacheHealth = 'critical';
    }
    
    return {
      imdbCacheHealth,
      processedCacheHealth,
      totalEntries: imdbSize + processedSize + 
                   this.cleanTitleCache.size + 
                   this.portugueseCheckCache.size,
      oldestEntryAge: Math.round(oldestAge / 60000) // em minutos
    };
  }

  /**
   * Remove entradas específicas do cache - NOVO (para debugging)
   */
  removeFromCache(cacheType: 'imdb' | 'processed' | 'clean' | 'portuguese', key: string): boolean {
    let removed = false;
    
    switch (cacheType) {
      case 'imdb':
        removed = this.imdbTitleCache.delete(key);
        break;
      case 'processed':
        removed = this.processedTimestamps.delete(key);
        break;
      case 'clean':
        removed = this.cleanTitleCache.delete(key);
        break;
      case 'portuguese':
        removed = this.portugueseCheckCache.delete(key);
        break;
    }
    
    if (removed) {
      this.logger.debug(' Entrada removida manualmente do cache', { cacheType, key });
    }
    
    return removed;
  }

  /**
   * Exporta dados do cache (para debugging/backup) - NOVO
   */
  exportCacheData(): {
    imdbEntries: number;
    processedEntries: number;
    cleanTitleEntries: number;
    portugueseCheckEntries: number;
    sampleImdbIds: string[];
    sampleProcessedKeys: string[];
  } {
    const sampleImdbIds = Array.from(this.imdbTitleCache.keys()).slice(0, 5);
    const sampleProcessedKeys = Array.from(this.processedTimestamps.keys()).slice(0, 5);
    
    return {
      imdbEntries: this.imdbTitleCache.size,
      processedEntries: this.processedTimestamps.size,
      cleanTitleEntries: this.cleanTitleCache.size,
      portugueseCheckEntries: this.portugueseCheckCache.size,
      sampleImdbIds,
      sampleProcessedKeys
    };
  }
}