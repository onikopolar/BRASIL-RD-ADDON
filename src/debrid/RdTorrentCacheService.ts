import { TorboxService } from './RealDebridService.js';
import { TorboxTorrentInfo } from '../types/index.js';
import { Logger } from '../utils/logger.js';
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

  // Cache de torrent: magnetHash + apiKey -> informações do torrent no Torbox
  private readonly torrentCache: Map<string, CachedTorrent> = new Map();

  // Cache de stream link: torrentId + season + episode -> stream link
  private readonly streamLinkCache: Map<string, CachedStreamLink> = new Map();

  // TTLs otimizados
  private readonly TORRENT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 horas
  private readonly STREAM_LINK_TTL = 3 * 60 * 60 * 1000;   // 3 horas

  // Limites de tamanho para evitar crescimento descontrolado
  private readonly MAX_TORRENT_CACHE_SIZE = 5000;
  private readonly MAX_STREAM_LINK_CACHE_SIZE = 10000;

  // Lock por magnet hash para evitar chamadas concorrentes
  private readonly processingLocks: Map<string, Promise<any>> = new Map();

  // Timer de limpeza automática
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

  constructor() {
    this.logger = new Logger('RdTorrentCacheService');
    this.startCleanupTimer();
    this.logger.debug('RdTorrentCacheService ready');
  }

  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, this.CLEANUP_INTERVAL_MS);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
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
    return `lock:${magnetHash}:${apiKey.substring(0, 8)}`;
  }

  // Verifica se cache está expirado
  private isCacheExpired(cachedAt: number, ttl: number): boolean {
    return Date.now() - cachedAt > ttl;
  }

  // Atualiza métricas do cache
  private updateCacheMetrics(): void {
    metricsService.setCacheSize(this.torrentCache.size + this.streamLinkCache.size);
  }

  // Obtém torrent ID do cache ou busca no Torbox
  async getTorrentId(
    magnetHash: string,
    apiKey: string,
    torboxService: TorboxService
  ): Promise<{ torrentId: string | null; status: string; fromCache: boolean }> {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const lockKey = this.getLockKey(magnetHash, apiKey);

    const existingLock = this.processingLocks.get(lockKey);
    if (existingLock) {
      this.logger.debug('Lock existente encontrado', { magnetHash, lockKey });
      return existingLock;
    }

    const processPromise = (async () => {
      try {
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

        const existingTorrent = await torboxService.findExistingTorrent(magnetHash, apiKey);

        if (existingTorrent && existingTorrent.id) {
          const tid = String(existingTorrent.id);
          const cachedData: CachedTorrent = {
            torrentId: tid,
            status: existingTorrent.download_state,
            cachedAt: Date.now(),
            apiKeyPrefix: apiKey.substring(0, 8)
          };

          this.setTorrentCache(cacheKey, cachedData);
          this.updateCacheMetrics();

          this.logger.info('Torrent salvo no cache', {
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

        return {
          torrentId: null,
          status: 'not_found',
          fromCache: false
        };
      } finally {
        this.processingLocks.delete(lockKey);
        this.logger.debug('Lock removido', { magnetHash, lockKey });
      }
    })();

    this.processingLocks.set(lockKey, processPromise);
    this.logger.debug('Novo lock criado', { magnetHash, lockKey });

    return processPromise;
  }

  // Obtém stream link do cache ou busca no Torbox
  async getStreamLink(
    torrentId: string,
    apiKey: string,
    season?: number,
    episode?: number,
    torboxService?: TorboxService,
    quality?: string,
    cachedInfo?: TorboxTorrentInfo
  ): Promise<{ streamLink: string | null; fromCache: boolean }> {
    const cacheKey = this.getStreamLinkCacheKey(torrentId, season, episode);

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

    if (!torboxService) {
      return { streamLink: null, fromCache: false };
    }

    const streamLink = await torboxService.getStreamLinkForTorrent(
      torrentId,
      apiKey,
      season,
      episode,
      quality,
      cachedInfo
    );

    if (streamLink) {
      const cachedData: CachedStreamLink = {
        streamLink,
        cachedAt: Date.now()
      };

      this.setStreamLinkCache(cacheKey, cachedData);
      this.updateCacheMetrics();

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

  // Atualiza status de um torrent no cache
  updateTorrentStatus(magnetHash: string, apiKey: string, status: string): void {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const cachedTorrent = this.torrentCache.get(cacheKey);

    if (cachedTorrent) {
      cachedTorrent.status = status;
      cachedTorrent.cachedAt = Date.now();
      this.torrentCache.set(cacheKey, cachedTorrent);
      this.updateCacheMetrics();

      this.logger.debug('Status do torrent atualizado no cache', {
        magnetHash,
        status
      });
    }
  }

  // Remove torrent do cache (quando deletado do Torbox)
  invalidateTorrent(magnetHash: string, apiKey: string): void {
    const cacheKey = this.getTorrentCacheKey(magnetHash, apiKey);
    const torrent = this.torrentCache.get(cacheKey);

    if (torrent) {
      this.torrentCache.delete(cacheKey);

      const streamKeyPrefix = `stream:${torrent.torrentId}:`;
      for (const [key] of this.streamLinkCache) {
        if (key.startsWith(streamKeyPrefix)) {
          this.streamLinkCache.delete(key);
        }
      }

      this.updateCacheMetrics();
      this.logger.info('Torrent invalidado do cache', {
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

    for (const [key, cached] of this.torrentCache) {
      if (this.isCacheExpired(cached.cachedAt, this.TORRENT_CACHE_TTL)) {
        this.torrentCache.delete(key);
        torrentsRemoved++;
      }
    }

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
      this.updateCacheMetrics();
    }
  }

  // Métodos privados para inserção com controle de tamanho
  private setTorrentCache(key: string, data: CachedTorrent): void {
    if (this.torrentCache.size >= this.MAX_TORRENT_CACHE_SIZE) {
      const firstKey = this.torrentCache.keys().next().value;
      if (firstKey) this.torrentCache.delete(firstKey);
    }
    this.torrentCache.set(key, data);
  }

  private setStreamLinkCache(key: string, data: CachedStreamLink): void {
    if (this.streamLinkCache.size >= this.MAX_STREAM_LINK_CACHE_SIZE) {
      const firstKey = this.streamLinkCache.keys().next().value;
      if (firstKey) this.streamLinkCache.delete(firstKey);
    }
    this.streamLinkCache.set(key, data);
  }

  // Estatísticas do cache
  getStats() {
    return {
      version: '2.0.0',
      torrentCacheSize: this.torrentCache.size,
      streamLinkCacheSize: this.streamLinkCache.size,
      activeLocks: this.processingLocks.size,
      ttlConfig: {
        torrentCache: `${this.TORRENT_CACHE_TTL / 3600000} horas`,
        streamLinkCache: `${this.STREAM_LINK_TTL / 3600000} horas`
      },
      features: [
        'Cache local com LRU simples',
        'Lock por magnet hash',
        'Limpeza automática de expirados',
        'Limites de tamanho configuráveis',
        'Métricas integradas'
      ]
    };
  }
}