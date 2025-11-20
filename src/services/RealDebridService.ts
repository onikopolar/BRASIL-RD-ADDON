import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { config } from '../config/index';
import { Logger } from '../utils/logger';
import { RDTorrentInfo, RDFile } from '../types/index';

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

  constructor() {
    this.logger = new Logger('RealDebridService');
  }

  private createHttpClient(apiKey: string): AxiosInstance {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Real-Debrid API Key is required');
    }

    if (!config.realDebrid.baseUrl) {
      throw new Error('Real-Debrid base URL is required');
    }

    return axios.create({
      baseURL: config.realDebrid.baseUrl,
      timeout: config.realDebrid.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  private setupInterceptors(client: AxiosInstance): void {
    client.interceptors.request.use(
      (requestConfig) => {
        this.logger.debug('Real-Debrid API Request', {
          method: requestConfig.method?.toUpperCase(),
          url: requestConfig.url,
          params: requestConfig.params
        });
        return requestConfig;
      },
      (error) => {
        this.logger.error('Request configuration error', { error: error.message });
        return Promise.reject(error);
      }
    );

    client.interceptors.response.use(
      (response: AxiosResponse) => {
        this.logger.debug('Real-Debrid API Response', {
          url: response.config.url,
          status: response.status,
          data: response.data
        });
        return response;
      },
      (error: AxiosError) => {
        const errorData = error.response?.data as RealDebridError;
        const statusCode = error.response?.status;
        const errorMessage = errorData?.error || error.message;
        
        this.logger.error('Real-Debrid API Error', {
          url: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          status: statusCode,
          errorCode: errorData?.error_code,
          errorMessage: errorMessage
        });

        if (statusCode === 401) {
          throw new Error('Real-Debrid authentication failed: Invalid or expired token');
        } else if (statusCode === 403) {
          throw new Error('Real-Debrid permission denied: Account locked or insufficient privileges');
        } else if (statusCode === 429) {
          throw new Error('Real-Debrid rate limit exceeded: Too many requests');
        } else if (statusCode === 503) {
          throw new Error('Real-Debrid service unavailable: Please try again later');
        } else if (errorData?.error) {
          throw new Error(`Real-Debrid API Error: ${errorData.error}`);
        } else {
          throw new Error(`Real-Debrid network error: ${errorMessage}`);
        }
      }
    );
  }

  async addMagnet(magnetLink: string, apiKey: string): Promise<string> {
    this.validateMagnetLink(magnetLink);
    const client = this.createHttpClient(apiKey);
    this.setupInterceptors(client);

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
        this.logger.info('Magnet link added successfully', {
          torrentId: response.data.id,
          magnetHash: this.extractMagnetHash(magnetLink)
        });
        return response.data.id;
      } else {
        throw new Error('Invalid response format from addMagnet endpoint');
      }
    } catch (error) {
      this.logger.error('Failed to add magnet link', {
        error: this.getErrorMessage(error),
        magnetHash: this.extractMagnetHash(magnetLink)
      });
      throw error;
    }
  }

  async getTorrentInfo(torrentId: string, apiKey: string): Promise<RDTorrentInfo> {
    this.validateTorrentId(torrentId);
    const client = this.createHttpClient(apiKey);
    this.setupInterceptors(client);

    try {
      const response = await this.retryableRequest<RDTorrentInfo>(
        () => client.get(`/torrents/info/${torrentId}`),
        'getTorrentInfo'
      );

      this.logger.debug('Torrent info retrieved successfully', {
        torrentId,
        status: response.data.status,
        progress: response.data.progress,
        filesCount: response.data.files?.length
      });

      return response.data;
    } catch (error) {
      this.logger.error('Failed to get torrent information', {
        torrentId,
        error: this.getErrorMessage(error)
      });
      throw error;
    }
  }

  async selectFiles(torrentId: string, apiKey: string, fileIds: string = 'all'): Promise<void> {
    this.validateTorrentId(torrentId);
    const client = this.createHttpClient(apiKey);
    this.setupInterceptors(client);

    try {
      const response = await this.retryableRequest(
        () => client.post(
          `/torrents/selectFiles/${torrentId}`,
          `files=${fileIds}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        ),
        'selectFiles'
      );

      if (response.status === 204 || response.status === 202) {
        this.logger.info('Files selected successfully', {
          torrentId,
          fileIds,
          action: response.status === 202 ? 'already_selected' : 'selected'
        });
      } else {
        throw new Error(`Unexpected response status: ${response.status}`);
      }
    } catch (error) {
      this.logger.error('Failed to select files', {
        torrentId,
        fileIds,
        error: this.getErrorMessage(error)
      });
      throw error;
    }
  }

  async unrestrictLink(link: string, apiKey: string): Promise<string> {
    if (!link || link.trim().length === 0) {
      throw new Error('Link cannot be empty');
    }

    const client = this.createHttpClient(apiKey);
    this.setupInterceptors(client);

    try {
      const response = await this.retryableRequest<RealDebridUnrestrictResponse>(
        () => client.post(
          '/unrestrict/link',
          `link=${encodeURIComponent(link)}`,
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        ),
        'unrestrictLink'
      );

      if (response.data.download) {
        this.logger.debug('Link unrestricted successfully', {
          originalLink: this.sanitizeLink(link),
          unrestrictedLink: this.sanitizeLink(response.data.download)
        });
        return response.data.download;
      } else {
        throw new Error('No download link returned from unrestrict endpoint');
      }
    } catch (error) {
      this.logger.error('Link unrestrict failed', {
        error: this.getErrorMessage(error),
        link: this.sanitizeLink(link)
      });
      throw error;
    }
  }

  async getStreamLinkForFile(torrentId: string, fileId: number, apiKey: string): Promise<string | null> {
    this.validateTorrentId(torrentId);

    try {
      const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
      
      // LOG DIAGNÓSTICO - Status do torrent
      this.logger.debug('DEBUG - Torrent streaming analysis', {
        torrentId,
        fileId,
        status: torrentInfo.status,
        linksCount: torrentInfo.links?.length || 0,
        filesCount: torrentInfo.files?.length || 0,
        selectedFilesCount: torrentInfo.files?.filter(f => f.selected === 1).length || 0
      });

      if (torrentInfo.status !== 'downloaded') {
        this.logger.debug('Torrent not ready for streaming', {
          torrentId,
          fileId,
          status: torrentInfo.status
        });
        return null;
      }

      if (!torrentInfo.links || torrentInfo.links.length === 0) {
        this.logger.debug('No links available for torrent', { torrentId, fileId });
        return null;
      }

      const selectedFiles = torrentInfo.files?.filter(file => file.selected === 1) || [];
      
      // LOG DIAGNÓSTICO - Análise de arquivos selecionados
      this.logger.debug('DEBUG - Selected files details', {
        torrentId,
        fileId,
        selectedFilesCount: selectedFiles.length,
        selectedFileIds: selectedFiles.map(f => f.id),
        lookingForFileId: fileId
      });

      const fileIndex = selectedFiles.findIndex(file => file.id === fileId);

      if (fileIndex === -1) {
        this.logger.debug('File not found in selected files', {
          torrentId,
          fileId,
          selectedFilesCount: selectedFiles.length,
          selectedFileIds: selectedFiles.map(f => f.id)
        });
        return null;
      }

      if (fileIndex >= torrentInfo.links.length) {
        this.logger.debug('File index exceeds available links', {
          torrentId,
          fileId,
          fileIndex,
          linksCount: torrentInfo.links.length
        });
        return null;
      }

      const rdLink = torrentInfo.links[fileIndex];
      
      // LOG DIAGNÓSTICO - Antes de gerar link direto
      this.logger.debug('DEBUG - Generating direct link', {
        torrentId,
        fileId,
        fileIndex,
        rdLink: this.sanitizeLink(rdLink)
      });

      const directLink = await this.unrestrictLink(rdLink, apiKey);

      this.logger.debug('Stream link obtained for file', {
        torrentId,
        fileId,
        filePath: selectedFiles[fileIndex]?.path,
        directLink: this.sanitizeLink(directLink)
      });

      return directLink;

    } catch (error) {
      this.logger.error('Failed to get stream link for file', {
        torrentId,
        fileId,
        error: this.getErrorMessage(error)
      });
      return null;
    }
  }

  async getStreamLinkForTorrent(torrentId: string, apiKey: string): Promise<string | null> {
    this.validateTorrentId(torrentId);

    try {
      const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
      
      if (torrentInfo.status !== 'downloaded') {
        this.logger.debug('Torrent not ready for streaming', {
          torrentId,
          status: torrentInfo.status
        });
        return null;
      }

      if (!torrentInfo.links || torrentInfo.links.length === 0) {
        this.logger.debug('No links available for torrent', { torrentId });
        return null;
      }

      const mainLink = torrentInfo.links[0];
      const directLink = await this.unrestrictLink(mainLink, apiKey);
      
      this.logger.debug('Stream link obtained for torrent', {
        torrentId,
        directLink: this.sanitizeLink(directLink)
      });

      return directLink;

    } catch (error) {
      this.logger.error('Failed to get stream link for torrent', {
        torrentId,
        error: this.getErrorMessage(error)
      });
      return null;
    }
  }

  async getTorrentFiles(torrentId: string, apiKey: string): Promise<RDFile[]> {
    const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
    return torrentInfo.files || [];
  }

  async findExistingTorrent(magnetHash: string, apiKey: string): Promise<RDTorrentInfo | null> {
    const client = this.createHttpClient(apiKey);
    this.setupInterceptors(client);

    try {
      const response = await this.retryableRequest<RDTorrentInfo[]>(
        () => client.get('/torrents', {
          params: { limit: 5000 }
        }),
        'findExistingTorrent'
      );

      const torrents = response.data;
      const existingTorrent = torrents.find(torrent => 
        torrent.hash?.toLowerCase() === magnetHash.toLowerCase()
      );

      if (existingTorrent) {
        this.logger.info('Existing torrent found', {
          torrentId: existingTorrent.id,
          magnetHash,
          status: existingTorrent.status,
          progress: existingTorrent.progress
        });
        return existingTorrent;
      }

      this.logger.debug('No existing torrent found', {
        magnetHash,
        totalTorrents: torrents.length
      });
      return null;

    } catch (error) {
      this.logger.error('Failed to find existing torrent', {
        magnetHash,
        error: this.getErrorMessage(error)
      });
      return null;
    }
  }

  async processTorrent(magnetLink: string, apiKey: string): Promise<{
    added: boolean;
    ready: boolean;
    status: string;
    torrentId?: string;
    progress?: number;
  }> {
    const magnetHash = this.extractMagnetHash(magnetLink);
    
    try {
      const existingTorrent = await this.findExistingTorrent(magnetHash, apiKey);
      
      if (existingTorrent) {
        return {
          added: true,
          ready: existingTorrent.status === 'downloaded',
          status: existingTorrent.status,
          torrentId: existingTorrent.id,
          progress: existingTorrent.progress
        };
      }

      const torrentId = await this.addMagnet(magnetLink, apiKey);
      await this.selectFiles(torrentId, apiKey, 'all');
      
      const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
      
      return {
        added: true,
        ready: torrentInfo.status === 'downloaded',
        status: torrentInfo.status,
        torrentId: torrentId,
        progress: torrentInfo.progress
      };

    } catch (error) {
      this.logger.error('Failed to process torrent', {
        magnetHash,
        error: this.getErrorMessage(error)
      });
      
      return {
        added: false,
        ready: false,
        status: 'error'
      };
    }
  }

  private async retryableRequest<T>(
    requestFn: () => Promise<AxiosResponse<T>>,
    operation: string
  ): Promise<AxiosResponse<T>> {
    let lastError: Error;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await requestFn();
        return response;
      } catch (error) {
        lastError = error as Error;
        
        if (this.isRetryableError(error as AxiosError) && attempt < this.maxRetries) {
          const delayMs = this.baseDelay * Math.pow(2, attempt - 1);
          
          this.logger.warn(`Retrying request after error`, {
            operation,
            attempt,
            maxAttempts: this.maxRetries,
            delayMs,
            error: this.getErrorMessage(error)
          });
          
          await this.delay(delayMs);
          continue;
        }
        break;
      }
    }

    throw lastError!;
  }

  private isRetryableError(error: AxiosError): boolean {
    const status = error.response?.status;
    const code = error.code;

    if (status && [429, 500, 502, 503, 504].includes(status)) {
      return true;
    }

    if (code && ['ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND'].includes(code)) {
      return true;
    }

    return !error.response;
  }

  private validateMagnetLink(magnetLink: string): void {
    if (!magnetLink) {
      throw new Error('Magnet link is required');
    }

    if (!magnetLink.startsWith('magnet:?')) {
      throw new Error('Invalid magnet link format: must start with "magnet:?"');
    }

    if (!magnetLink.includes('xt=urn:btih:')) {
      throw new Error('Magnet link does not contain valid info hash');
    }
  }

  private validateTorrentId(torrentId: string): void {
    if (!torrentId || torrentId.trim().length === 0) {
      throw new Error('Torrent ID is required');
    }
  }

  private extractMagnetHash(magnetLink: string): string {
    const match = magnetLink.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : 'unknown';
  }

  private sanitizeLink(link: string): string {
    if (link.length <= 50) return link;
    return link.substring(0, 47) + '...';
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}