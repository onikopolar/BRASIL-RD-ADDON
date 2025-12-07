import { RealDebridService } from './RealDebridService';
import { Logger } from '../utils/logger';

export interface CachedTorrent {
  torrentId: string;
  status: string;
  cachedAt: number;
  apiKeyPrefix: string; // Primeiros 8 chars para diferenciar contas
}

export interface CachedStreamLink {
  streamLink: string;
  cachedAt: number;
}

export class RdTorrentCacheService {
  private readonly logger: Logger;
  
  // Camada 1: Hash do magnet -> Informações do torrent no RD (30 dias)
  private readonly torrentCache: Map<string, CachedTorrent> = new Map();
  
  // Camada 2: Torrent ID + Season + Episode -> Stream link (24 horas)
  private readonly streamLinkCache: Map<string, CachedStreamLink> = new Map();
  
  // TTLs otimizados
  private readonly TORRENT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 dias
  private readonly STREAM_LINK_TTL = 24 * 60 * 60 * 1000; // 24 horas
  
  // Lock por magnet hash para evitar chamadas concorrentes
  private readonly processingLocks: Map<string, Promise<any>> = new Map();

  constructor() {
    this.logger = new Logger('RdTorrentCacheService');
    this.logger.info(`RdTorrentCacheService inicializado - Cache inteligente de 2 camadas`);
  }

  /**
   * Gera chave para cache de torrent
   */
  private getTorrentCacheKey(magnetHash: string, apiKey: string): string {
    const apiKeyPrefix = apiKey.substring(0, 8);
    return `torrent:${magnetHash}:${apiKeyPrefix}`;
  }

  /**
   * Gera chave para cache de stream link
   */
  private getStreamLinkCacheKey(torrentId: string, season?: number, episode?: number): string {
    const seasonStr = season !== undefined ? `s${season}` : 'all';
    const episodeStr = episode !== undefined ? `e${episode}` : 'all';
    return `stream:${torrentId}:${seasonStr}:${episodeStr}`;
  }

  /**
   * Gera chave para lock de processamento
   */
  private getLockKey(magnetHash: string, apiKey: string): string {
    return `lock:${magnetHash}:${apiKey}`;
  }

  /**
   * Verifica se cache está expirado
   */
  private isCacheExpired(cachedAt: number, ttl: number): boolean {
    return Date.now() - cachedAt > ttl;
  }

  /**
   * Obtém torrent ID do cache ou busca no RD
   */
  async getTorrentId(
    magnetHash: string, 
    apiKey: string, 
    rdService: RealDebridService
  ): Promise<{ torrentId: string | null; status: string; fromCache: boolean }> {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const lockKey = this.getLockKey(magnetHash, apiKey);

    // Verificar lock existente
    const existingLock = this.processingLocks.get(lockKey);
    if (existingLock) {
      this.logger.debug('Lock existente encontrado', { magnetHash, lockKey });
      return existingLock;
    }

    // Criar nova promise com lock
    const processPromise = (async () => {
      try {
        // Verificar cache primeiro
        const cachedTorrent = this.torrentCache.get(cacheKey);
        if (cachedTorrent && !this.isCacheExpired(cachedTorrent.cachedAt, this.TORRENT_CACHE_TTL)) {
          this.logger.debug('Cache de torrent HIT', { 
            magnetHash, 
            torrentId: cachedTorrent.torrentId,
            status: cachedTorrent.status
          });
          return {
            torrentId: cachedTorrent.torrentId,
            status: cachedTorrent.status,
            fromCache: true
          };
        }

        this.logger.debug('Cache de torrent MISS', { magnetHash });
        
        // Buscar no RD
        const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
        
        if (existingTorrent && existingTorrent.id) {
          // Salvar no cache
          const cachedTorrent: CachedTorrent = {
            torrentId: existingTorrent.id,
            status: existingTorrent.status,
            cachedAt: Date.now(),
            apiKeyPrefix: apiKey.substring(0, 8)
          };
          
          this.torrentCache.set(cacheKey, cachedTorrent);
          
          this.logger.info('Torrent salvo no cache', {
            magnetHash,
            torrentId: existingTorrent.id,
            status: existingTorrent.status
          });
          
          return {
            torrentId: existingTorrent.id,
            status: existingTorrent.status,
            fromCache: false
          };
        }
        
        // Torrent não encontrado no RD
        return {
          torrentId: null,
          status: 'not_found',
          fromCache: false
        };
        
      } finally {
        // Remover lock após processamento
        this.processingLocks.delete(lockKey);
        this.logger.debug('Lock removido', { magnetHash, lockKey });
      }
    })();

    // Armazenar lock
    this.processingLocks.set(lockKey, processPromise);
    this.logger.debug('Novo lock criado', { magnetHash, lockKey });
    
    return processPromise;
  }

  /**
   * Obtém stream link do cache ou busca no RD
   */
  async getStreamLink(
    torrentId: string,
    apiKey: string,
    season?: number,
    episode?: number,
    rdService?: RealDebridService
  ): Promise<{ streamLink: string | null; fromCache: boolean }> {
    const cacheKey = this.getStreamLinkCacheKey(torrentId, season, episode);
    
    // Verificar cache primeiro
    const cachedStream = this.streamLinkCache.get(cacheKey);
    if (cachedStream && !this.isCacheExpired(cachedStream.cachedAt, this.STREAM_LINK_TTL)) {
      this.logger.debug('Cache de stream link HIT', { 
        torrentId, 
        season, 
        episode,
        streamLink: cachedStream.streamLink.substring(0, 50) + '...'
      });
      return {
        streamLink: cachedStream.streamLink,
        fromCache: true
      };
    }
    
    this.logger.debug('Cache de stream link MISS', { torrentId, season, episode });
    
    // Se não tem rdService ou stream não está no cache, retorna null
    if (!rdService) {
      return { streamLink: null, fromCache: false };
    }
    
    // Buscar no RD
    const streamLink = await rdService.getStreamLinkForTorrent(torrentId, apiKey, season, episode);
    
    if (streamLink) {
      // Salvar no cache
      const cachedStream: CachedStreamLink = {
        streamLink,
        cachedAt: Date.now()
      };
      
      this.streamLinkCache.set(cacheKey, cachedStream);
      
      this.logger.info('Stream link salvo no cache', {
        torrentId,
        season,
        episode,
        streamLink: streamLink.substring(0, 50) + '...'
      });
    }
    
    return {
      streamLink,
      fromCache: false
    };
  }

  /**
   * Atualiza status de um torrent no cache
   */
  updateTorrentStatus(magnetHash: string, apiKey: string, status: string): void {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const cachedTorrent = this.torrentCache.get(cacheKey);
    
    if (cachedTorrent) {
      cachedTorrent.status = status;
      cachedTorrent.cachedAt = Date.now();
      this.torrentCache.set(cacheKey, cachedTorrent);
      
      this.logger.debug('Status do torrent atualizado no cache', {
        magnetHash,
        status
      });
    }
  }

  /**
   * Remove torrent do cache (quando deletado do RD)
   */
  invalidateTorrent(magnetHash: string, apiKey: string): void {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const torrent = this.torrentCache.get(cacheKey);
    
    if (torrent) {
      // Remover torrent e todos seus stream links
      this.torrentCache.delete(cacheKey);
      
      // Remover todos os stream links deste torrent
      const streamKeyPrefix = `stream:${torrent.torrentId}:`;
      for (const [key] of this.streamLinkCache) {
        if (key.startsWith(streamKeyPrefix)) {
          this.streamLinkCache.delete(key);
        }
      }
      
      this.logger.info('Torrent invalidado do cache', {
        magnetHash,
        torrentId: torrent.torrentId
      });
    }
  }

  /**
   * Limpa cache expirado
   */
  cleanupExpiredCache(): void {
    const now = Date.now();
    let torrentsRemoved = 0;
    let streamsRemoved = 0;
    
    // Limpar torrents expirados
    for (const [key, cached] of this.torrentCache) {
      if (this.isCacheExpired(cached.cachedAt, this.TORRENT_CACHE_TTL)) {
        this.torrentCache.delete(key);
        torrentsRemoved++;
      }
    }
    
    // Limpar stream links expirados
    for (const [key, cached] of this.streamLinkCache) {
      if (this.isCacheExpired(cached.cachedAt, this.STREAM_LINK_TTL)) {
        this.streamLinkCache.delete(key);
        streamsRemoved++;
      }
    }
    
    if (torrentsRemoved > 0 || streamsRemoved > 0) {
      this.logger.debug('Cache expirado limpo', {
        torrentsRemoved,
        streamsRemoved
      });
    }
  }

  /**
   * Estatísticas do cache
   */
  getStats() {
    return {
      version: '1.0.0',
      torrentCacheSize: this.torrentCache.size,
      streamLinkCacheSize: this.streamLinkCache.size,
      activeLocks: this.processingLocks.size,
      ttlConfig: {
        torrentCache: '30 dias',
        streamLinkCache: '24 horas'
      },
      features: [
        'Cache inteligente de 2 camadas',
        'Lock por magnet hash para evitar duplicatas',
        'Cache compartilhado por hash (diferentes usuários)',
        'Invalidacao automatica ao deletar torrent',
        'Limpeza automatica de cache expirado'
      ]
    };
  }
}