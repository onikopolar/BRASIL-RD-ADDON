import { TorboxService } from './RealDebridService.js';
import { Logger } from '../utils/logger.js';
import { torrentCacheService, streamCacheService } from './AdvancedCacheService.js';
import { metricsService } from '../catalogo/MetricsService.js';

export interface CachedTorrent {
  torrentId: string;
  status: string;
  cachedAt: number;
  apiKeyPrefix: string;
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
  private readonly TORRENT_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  private readonly STREAM_LINK_TTL = 24 * 60 * 60 * 1000;
  
  // Lock por magnet hash para evitar chamadas concorrentes
  private readonly processingLocks: Map<string, Promise<any>> = new Map();

  constructor() {
    this.logger = new Logger('RdTorrentCacheService');
    this.logger.debug('RdTorrentCacheService ready');
  }

  // Gera chave para cache de torrent
  private getTorrentCacheKey(magnetHash: string, apiKey: string): string {
    const apiKeyPrefix = apiKey.substring(0, 8);
    return `torrent:${magnetHash}:${apiKeyPrefix}`;
  }

  // Gera chave para cache de stream link
  private getStreamLinkCacheKey(torrentId: string, season?: number, episode?: number): string {
    const seasonStr = season !== undefined ? `s${season}` : 'all';
    const episodeStr = episode !== undefined ? `e${episode}` : 'all';
    return `stream:${torrentId}:${seasonStr}:${episodeStr}`;
  }

  // Gera chave para lock de processamento
  private getLockKey(magnetHash: string, apiKey: string): string {
    return `lock:${magnetHash}:${apiKey}`;
  }

  // Verifica se cache está expirado
  private isCacheExpired(cachedAt: number, ttl: number): boolean {
    return Date.now() - cachedAt > ttl;
  }

  // Obtém torrent ID do cache ou busca no RD com cache avançado
  async getTorrentId(
    magnetHash: string, 
    apiKey: string, 
    torboxService: TorboxService
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
        // Tenta obter do cache avançado primeiro (stale-while-revalidate)
        const advancedCacheKey = `torrent:${magnetHash}:${apiKey.substring(0, 8)}`;
        const cachedFromAdvanced = await torrentCacheService.get<CachedTorrent>(advancedCacheKey);
        
        if (cachedFromAdvanced) {
          // Verifica se ainda é válido
          if (!this.isCacheExpired(cachedFromAdvanced.cachedAt, this.TORRENT_CACHE_TTL)) {
            this.logger.debug('Cache avançado de torrent HIT', { 
              magnetHash, 
              torrentId: cachedFromAdvanced.torrentId,
              status: cachedFromAdvanced.status
            });
            return {
              torrentId: cachedFromAdvanced.torrentId,
              status: cachedFromAdvanced.status,
              fromCache: true
            };
          }
        }

        // Cache antigo (backward compatibility)
        const cachedTorrent = this.torrentCache.get(cacheKey);
        if (cachedTorrent && !this.isCacheExpired(cachedTorrent.cachedAt, this.TORRENT_CACHE_TTL)) {
          this.logger.debug('Cache de torrent HIT', { 
            magnetHash, 
            torrentId: cachedTorrent.torrentId,
            status: cachedTorrent.status
          });
          
          // Atualiza cache avançado em background
          this.updateAdvancedCacheInBackground(advancedCacheKey, cachedTorrent);
          
          return {
            torrentId: cachedTorrent.torrentId,
            status: cachedTorrent.status,
            fromCache: true
          };
        }

        this.logger.debug('Cache de torrent MISS', { magnetHash });
        
        // Buscar no RD
        const existingTorrent = await torboxService.findExistingTorrent(magnetHash, apiKey);
        
        if (existingTorrent && existingTorrent.id) {
          const tid = String(existingTorrent.id);
          // Salvar no cache avançado
          const cachedTorrent: CachedTorrent = {
            torrentId: tid,
            status: existingTorrent.download_state,
            cachedAt: Date.now(),
            apiKeyPrefix: apiKey.substring(0, 8)
          };

          // Salva em ambos os caches
          await torrentCacheService.set(advancedCacheKey, cachedTorrent, {
            ttl: this.TORRENT_CACHE_TTL,
            staleWhileRevalidate: 60 * 60 * 1000 // 1 hora para revalidação
          });

          this.torrentCache.set(cacheKey, cachedTorrent);

          // Atualiza métricas
          metricsService.setCacheSize(this.torrentCache.size);

          this.logger.info('Torrent salvo no cache avançado', {
            magnetHash,
            torrentId: tid,
            status: existingTorrent.download_state
          });

          return {
            torrentId: tid,
            status: existingTorrent.download_state,
            fromCache: false
          };
        }

        // Torrent não encontrado no Torbox
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

  // Obtém stream link do cache ou busca no RD com cache avançado
  async getStreamLink(
    torrentId: string,
    apiKey: string,
    season?: number,
    episode?: number,
    torboxService?: TorboxService
  ): Promise<{ streamLink: string | null; fromCache: boolean }> {
    const cacheKey = this.getStreamLinkCacheKey(torrentId, season, episode);
    const advancedCacheKey = `stream:${torrentId}:${season || 'all'}:${episode || 'all'}`;
    
    // Tenta obter do cache avançado primeiro
    const cachedFromAdvanced = await streamCacheService.get<CachedStreamLink>(advancedCacheKey);
    
    if (cachedFromAdvanced) {
      // Verifica se ainda é válido
      if (!this.isCacheExpired(cachedFromAdvanced.cachedAt, this.STREAM_LINK_TTL)) {
        this.logger.debug('Cache avançado de stream link HIT', { 
          torrentId, 
          season, 
          episode,
          streamLink: cachedFromAdvanced.streamLink.substring(0, 50) + '...'
        });
        return {
          streamLink: cachedFromAdvanced.streamLink,
          fromCache: true
        };
      }
    }
    
    // Cache antigo (backward compatibility)
    const cachedStream = this.streamLinkCache.get(cacheKey);
    if (cachedStream && !this.isCacheExpired(cachedStream.cachedAt, this.STREAM_LINK_TTL)) {
      this.logger.debug('Cache de stream link HIT', { 
        torrentId, 
        season, 
        episode,
        streamLink: cachedStream.streamLink.substring(0, 50) + '...'
      });
      
      // Atualiza cache avançado em background
      this.updateAdvancedCacheInBackground(advancedCacheKey, cachedStream);
      
      return {
        streamLink: cachedStream.streamLink,
        fromCache: true
      };
    }
    
    this.logger.debug('Cache de stream link MISS', { torrentId, season, episode });
    
    // Se não tem rdService ou stream não está no cache, retorna null
    if (!torboxService) {
      return { streamLink: null, fromCache: false };
    }
    
    // Buscar no RD
    const streamLink = await torboxService.getStreamLinkForTorrent(torrentId, apiKey, season, episode);
    
    if (streamLink) {
      // Salvar no cache avançado
      const cachedStream: CachedStreamLink = {
        streamLink,
        cachedAt: Date.now()
      };
      
      // Salva em ambos os caches
      await streamCacheService.set(advancedCacheKey, cachedStream, {
        ttl: this.STREAM_LINK_TTL,
        staleWhileRevalidate: 30 * 60 * 1000 // 30 minutos para revalidação
      });
      
      this.streamLinkCache.set(cacheKey, cachedStream);
      
      // Atualiza métricas
      metricsService.setCacheSize(this.streamLinkCache.size);
      
      this.logger.info('Stream link salvo no cache avançado', {
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

  // Atualiza cache avançado em background (stale-while-revalidate)
  private async updateAdvancedCacheInBackground(key: string, data: any): Promise<void> {
    // Executa em background sem bloquear
    setImmediate(async () => {
      try {
        if (key.startsWith('torrent:')) {
          await torrentCacheService.set(key, data, {
            ttl: this.TORRENT_CACHE_TTL,
            staleWhileRevalidate: 60 * 60 * 1000
          });
        } else if (key.startsWith('stream:')) {
          await streamCacheService.set(key, data, {
            ttl: this.STREAM_LINK_TTL,
            staleWhileRevalidate: 30 * 60 * 1000
          });
        }
        this.logger.debug('Cache avançado atualizado em background', { key });
      } catch (error) {
        this.logger.debug('Erro ao atualizar cache avançado em background', { 
          key, 
          error: error instanceof Error ? error.message : 'Erro desconhecido' 
        });
      }
    });
  }

  // Atualiza status de um torrent no cache
  updateTorrentStatus(magnetHash: string, apiKey: string, status: string): void {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const advancedCacheKey = `torrent:${magnetHash}:${apiKey.substring(0, 8)}`;
    const cachedTorrent = this.torrentCache.get(cacheKey);
    
    if (cachedTorrent) {
      cachedTorrent.status = status;
      cachedTorrent.cachedAt = Date.now();
      this.torrentCache.set(cacheKey, cachedTorrent);
      
      // Atualiza cache avançado também
      this.updateAdvancedCacheInBackground(advancedCacheKey, cachedTorrent);
      
      this.logger.debug('Status do torrent atualizado no cache', {
        magnetHash,
        status
      });
    }
  }

  // Remove torrent do cache (quando deletado do RD)
  invalidateTorrent(magnetHash: string, apiKey: string): void {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const advancedCacheKey = `torrent:${magnetHash}:${apiKey.substring(0, 8)}`;
    const torrent = this.torrentCache.get(cacheKey);
    
    if (torrent) {
      // Remover do cache avançado
      torrentCacheService.delete(advancedCacheKey);
      
      // Remover torrent e todos seus stream links
      this.torrentCache.delete(cacheKey);
      
      // Remover todos os stream links deste torrent
      const streamKeyPrefix = `stream:${torrent.torrentId}:`;
      for (const [key] of this.streamLinkCache) {
        if (key.startsWith(streamKeyPrefix)) {
          this.streamLinkCache.delete(key);
          streamCacheService.delete(`stream:${torrent.torrentId}:${key.split(':').slice(2).join(':')}`);
        }
      }
      
      this.logger.info('Torrent invalidado do cache avançado', {
        magnetHash,
        torrentId: torrent.torrentId
      });
    }
  }

  // Limpa cache expirado
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
      metricsService.setCacheSize(this.torrentCache.size + this.streamLinkCache.size);
    }
  }

  // Estatísticas do cache
  getStats() {
    return {
      version: '1.1.0',
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
        'Limpeza automatica de cache expirado',
        'Cache avançado com stale-while-revalidate',
        'LRU automático para gerenciamento de memória',
        'Métricas integradas com Prometheus'
      ]
    };
  }
}