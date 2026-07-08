import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { config } from '../config/index';
import { Logger } from '../utils/logger';
import { RDTorrentInfo, RDFile } from '../types/index';
import { StaticResponseService, StaticResponse } from './StaticResponseService';
import { StreamStatusException } from './StreamStatusException';

interface RealDebridError {
  error?: string;
  error_code?: number;
}

interface RealDebridTorrentAddResponse {
  id: string;
  uri: string;
}

interface RealDebridUnrestrictResponse {
  download: string;
  stream?: string[];
}

export class RealDebridService {
  private readonly logger: Logger;
  private readonly maxRetries: number = 3;
  private readonly baseDelay: number = 1000;
  private readonly videoExtensions: string[] = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
  ];
  private staticResponseService: StaticResponseService;

  constructor(baseUrl?: string) {
    this.logger = new Logger('RealDebridService');
    this.staticResponseService = new StaticResponseService(baseUrl);
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
  }

  private createHttpClient(apiKey: string): AxiosInstance {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Real-Debrid API Key is required');
    }

    if (!config.realDebrid.baseUrl) {
      throw new Error('Real-Debrid base URL is required');
    }

    const client = axios.create({
      baseURL: config.realDebrid.baseUrl,
      timeout: config.realDebrid.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    // Interceptor de resposta para transformar erros HTTP em StreamStatusException quando aplicável
    client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        const errorData = error.response?.data as RealDebridError;
        const status = error.response?.status;
        const errorMessage = errorData?.error || error.message;
        const errorCode = errorData?.error_code;

        // Mapeia erros conhecidos para StreamStatusException (vídeo informativo)
        if (status === 451 && errorMessage?.includes('infringing_file')) {
          throw new StreamStatusException(
            StaticResponse.FAILED_INFRINGEMENT,
            'error',
            undefined,
            'Conteúdo bloqueado por direitos autorais (RD)'
          );
        }

        if (status === 503) {
          throw new StreamStatusException(
            StaticResponse.FAILED_DOWNLOAD,
            'error',
            undefined,
            'Real-Debrid indisponível no momento'
          );
        }

        if (status === 401) {
          throw new Error('Real-Debrid authentication failed: Invalid or expired token');
        }

        if (status === 403) {
          throw new Error('Real-Debrid permission denied');
        }

        if (errorCode === 35) {
          throw new StreamStatusException(
            StaticResponse.FAILED_INFRINGEMENT,
            'error',
            undefined,
            'Arquivo bloqueado (infringing_file)'
          );
        }

        // Erro genérico
        throw new Error(`Real-Debrid API Error: ${errorMessage}`);
      }
    );

    return client;
  }

  async addMagnet(magnetLink: string, apiKey: string): Promise<string> {
    this.validateMagnetLink(magnetLink);
    const client = this.createHttpClient(apiKey);

    try {
      const response = await this.retryableRequest<RealDebridTorrentAddResponse>(
        () => client.post(
          '/torrents/addMagnet',
          `magnet=${encodeURIComponent(magnetLink)}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        ),
        'addMagnet'
      );

      if (response.status === 201 && response.data.id) {
        this.logger.info('Magnet adicionado', {
          torrentId: response.data.id,
          magnetHash: this.extractMagnetHash(magnetLink)
        });
        return response.data.id;
      } else {
        throw new Error('Formato de resposta inválido do addMagnet');
      }
    } catch (error) {
      // StreamStatusException já é tratada nas camadas superiores
      if (error instanceof StreamStatusException) {
        throw error;
      }
      this.logger.error('Falha ao adicionar magnet', {
        error: error instanceof Error ? error.message : 'Erro',
        magnetHash: this.extractMagnetHash(magnetLink)
      });
      throw error;
    }
  }

  async getTorrentInfo(torrentId: string, apiKey: string): Promise<RDTorrentInfo> {
    this.validateTorrentId(torrentId);
    const client = this.createHttpClient(apiKey);

    try {
      const response = await this.retryableRequest<RDTorrentInfo>(
        () => client.get(`/torrents/info/${torrentId}`),
        'getTorrentInfo'
      );
      return response.data;
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao obter info do torrent', { torrentId });
      throw error;
    }
  }

  async selectFiles(torrentId: string, apiKey: string, fileIds: string = 'all'): Promise<void> {
    this.validateTorrentId(torrentId);
    const client = this.createHttpClient(apiKey);

    try {
      await this.retryableRequest(
        () => client.post(
          `/torrents/selectFiles/${torrentId}`,
          `files=${fileIds}`,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        ),
        'selectFiles'
      );
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao selecionar arquivos', { torrentId });
      throw error;
    }
  }

  async unrestrictLink(link: string, apiKey: string): Promise<string> {
    if (!link || link.trim().length === 0) {
      throw new Error('Link não pode ser vazio');
    }

    const client = this.createHttpClient(apiKey);

    try {
      const response = await this.retryableRequest<RealDebridUnrestrictResponse>(
        () => client.post(
          '/unrestrict/link',
          `link=${encodeURIComponent(link)}`,
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        ),
        'unrestrictLink'
      );

      if (response.data.download) {
        return response.data.download;
      } else {
        throw new Error('Nenhum link de download retornado');
      }
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao unrestrict link', { link: link.substring(0, 40) });
      throw error;
    }
  }

  async getStreamLinkForFile(torrentId: string, fileId: number, apiKey: string): Promise<string | null> {
    try {
      const info = await this.getTorrentInfo(torrentId, apiKey);
      if (info.status !== 'downloaded' || !info.links?.length) return null;

      const selected = info.files?.filter(f => f.selected === 1) || [];
      const idx = selected.findIndex(f => f.id === fileId);
      if (idx === -1 || idx >= info.links.length) return null;

      return await this.unrestrictLink(info.links[idx], apiKey);
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao obter stream para arquivo', { torrentId, fileId });
      return null;
    }
  }

  async getStreamLinkForTorrent(
    torrentId: string, apiKey: string, targetSeason?: number, targetEpisode?: number
  ): Promise<string | null> {
    this.validateTorrentId(torrentId);

    try {
      const info = await this.getTorrentInfo(torrentId, apiKey);

      const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(info.status);
      if (staticResponse) {
        throw new StreamStatusException(staticResponse, info.status, info.progress, `Status: ${info.status}`);
      }

      if (info.status !== 'downloaded' || !info.links?.length) {
        throw new StreamStatusException(StaticResponse.DOWNLOADING, info.status, info.progress, 'Aguardando download');
      }

      const files = info.files || [];
      const selected = files.filter(f => f.selected === 1);
      let bestIdx = 0;
      let bestScore = 0;

      for (let i = 0; i < selected.length; i++) {
        const f = selected[i];
        if (!this.videoExtensions.some(ext => f.path.toLowerCase().endsWith(ext))) continue;
        let score = f.bytes;
        if (targetSeason !== undefined && targetEpisode !== undefined) {
          const fs = this.extractSeasonFromFileName(f.path);
          const fe = this.extractEpisodeFromFileName(f.path);
          if (fs === targetSeason && fe === targetEpisode) score += 10_000_000_000;
        }
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }

      const link = info.links[Math.min(bestIdx, info.links.length - 1)];
      return await this.unrestrictLink(link, apiKey);
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao obter stream', { torrentId });
      return null;
    }
  }

  async getStreamLinkWithStatus(
    torrentId: string, apiKey: string, targetSeason?: number, targetEpisode?: number
  ): Promise<{
    url: string | null; status: string; staticResponse?: StaticResponse; progress?: number;
  }> {
    try {
      const info = await this.getTorrentInfo(torrentId, apiKey);
      const sr = this.staticResponseService.getResponseForRealDebridStatus(info.status);
      if (sr) return { url: null, status: info.status, staticResponse: sr, progress: info.progress };
      if (info.status === 'downloaded' && info.links?.length) {
        const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode);
        return { url: link, status: 'downloaded', progress: 100 };
      }
      return { url: null, status: info.status, progress: info.progress };
    } catch (error) {
      if (error instanceof StreamStatusException) {
        return { url: null, status: 'downloading', staticResponse: error.staticResponse, progress: error.progress };
      }
      return { url: null, status: 'error' };
    }
  }

  async getTorrentFiles(torrentId: string, apiKey: string): Promise<RDFile[]> {
    return (await this.getTorrentInfo(torrentId, apiKey)).files || [];
  }

  async findExistingTorrent(magnetHash: string, apiKey: string): Promise<RDTorrentInfo | null> {
    const client = this.createHttpClient(apiKey);
    try {
      const resp = await this.retryableRequest<RDTorrentInfo[]>(
        () => client.get('/torrents', { params: { limit: 5000 } }),
        'findExistingTorrent'
      );
      const t = resp.data.find(torrent => torrent.hash?.toLowerCase() === magnetHash.toLowerCase());
      if (t) this.logger.info('Torrent existente encontrado', { id: t.id, status: t.status });
      return t || null;
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao buscar torrent existente', { magnetHash });
      return null;
    }
  }

  async processTorrent(magnetLink: string, apiKey: string) {
    const hash = this.extractMagnetHash(magnetLink);
    try {
      const existing = await this.findExistingTorrent(hash, apiKey);
      if (existing) return { added: true, ready: existing.status === 'downloaded', status: existing.status, torrentId: existing.id, progress: existing.progress };
      const id = await this.addMagnet(magnetLink, apiKey);
      await this.selectFiles(id, apiKey);
      const info = await this.getTorrentInfo(id, apiKey);
      return { added: true, ready: info.status === 'downloaded', status: info.status, torrentId: id, progress: info.progress };
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      return { added: false, ready: false, status: 'error' };
    }
  }

  private async retryableRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>, operation: string
  ): Promise<AxiosResponse<T>> {
    let lastError: Error;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;
        if (error instanceof StreamStatusException) throw error;
        if (this.isRetryableError(error as AxiosError) && attempt < this.maxRetries) {
          const delay = this.baseDelay * Math.pow(2, attempt - 1);
          this.logger.warn(`Tentativa ${attempt}/${this.maxRetries} falhou, retry em ${delay}ms`);
          await this.delay(delay);
          continue;
        }
        break;
      }
    }
    throw lastError!;
  }

  private isRetryableError(error: AxiosError): boolean {
    const status = error.response?.status;
    return status ? [429, 500, 502, 503, 504].includes(status) : !error.response;
  }

  private validateMagnetLink(link: string): void {
    if (!link?.startsWith('magnet:?') || !link.includes('xt=urn:btih:')) {
      throw new Error('Magnet link inválido');
    }
  }

  private validateTorrentId(id: string): void {
    if (!id?.trim()) throw new Error('Torrent ID obrigatório');
  }

  private extractMagnetHash(link: string): string {
    return link.match(/btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase() || 'unknown';
  }

  private extractSeasonFromFileName(name: string): number | undefined {
    const m = name.match(/s(\d+)e\d+/i) || name.match(/season\s*(\d+)/i) || name.match(/(\d+)x\d+/i);
    return m ? parseInt(m[1], 10) : undefined;
  }

  private extractEpisodeFromFileName(name: string): number | undefined {
    const m = name.match(/s\d+e(\d+)/i) || name.match(/episode\s*(\d+)/i) || name.match(/\d+x(\d+)/i) || name.match(/ep\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : undefined;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}