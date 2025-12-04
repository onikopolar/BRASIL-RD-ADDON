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

  /**
   * Atualiza a URL base do StaticResponseService
   */
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
        return requestConfig;
      },
      (error) => {
        this.logger.error('Request configuration error', { error: error.message });
        return Promise.reject(error);
      }
    );

    client.interceptors.response.use(
      (response: AxiosResponse) => {
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
        // Seleção bem sucedida
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

      // Verificar se o torrent está em estado de download
      const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(torrentInfo.status);
      if (staticResponse && staticResponse === StaticResponse.DOWNLOADING) {
        throw new StreamStatusException(
          staticResponse,
          torrentInfo.status,
          torrentInfo.progress,
          `Torrent está em estado: ${torrentInfo.status}`
        );
      }

      if (torrentInfo.status !== 'downloaded') {
        return null;
      }

      if (!torrentInfo.links || torrentInfo.links.length === 0) {
        return null;
      }

      const selectedFiles = torrentInfo.files?.filter(file => file.selected === 1) || [];
      const fileIndex = selectedFiles.findIndex(file => file.id === fileId);

      if (fileIndex === -1 || fileIndex >= torrentInfo.links.length) {
        return null;
      }

      const rdLink = torrentInfo.links[fileIndex];
      const directLink = await this.unrestrictLink(rdLink, apiKey);

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

  /**
   * Método principal: Agora lança StreamStatusException quando o torrent está downloading
   */
  async getStreamLinkForTorrent(
    torrentId: string, 
    apiKey: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<string | null> {
    this.validateTorrentId(torrentId);

    try {
      this.logger.info('Iniciando seleção de arquivo', { 
        torrentId,
        targetSeason,
        targetEpisode 
      });
      
      const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
      
      // Lançar exceção quando precisa de resposta estática
      const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(torrentInfo.status);
      if (staticResponse) {
        this.logger.info('Lançando StreamStatusException', {
          torrentId,
          rdStatus: torrentInfo.status,
          staticResponse,
          progress: torrentInfo.progress
        });
        
        throw new StreamStatusException(
          staticResponse,
          torrentInfo.status,
          torrentInfo.progress,
          `Torrent está em estado: ${torrentInfo.status}`
        );
      }

      if (torrentInfo.status !== 'downloaded') {
        this.logger.warn('Torrent não está baixado', {
          torrentId,
          status: torrentInfo.status
        });
        return null;
      }

      if (!torrentInfo.links || torrentInfo.links.length === 0) {
        this.logger.warn('Nenhum link disponível', { torrentId });
        return null;
      }

      // Lógica de seleção de arquivos
      const files = torrentInfo.files || [];
      const selectedFiles = files.filter(file => file.selected === 1);
      
      if (selectedFiles.length === 0) {
        this.logger.warn('Nenhum arquivo selecionado', { torrentId });
        return null;
      }

      // Encontrar melhor arquivo
      let bestFileIndex = -1;
      let bestScore = 0;

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileName = file.path.toLowerCase();
        
        // Verificar se é arquivo de vídeo
        const isVideo = this.videoExtensions.some(ext => fileName.endsWith(ext));
        if (!isVideo) continue;
        
        // Calcular score
        let score = file.bytes;
        
        // Bônus para episódio exato
        if (targetSeason !== undefined && targetEpisode !== undefined) {
          const fileSeason = this.extractSeasonFromFileName(file.path);
          const fileEpisode = this.extractEpisodeFromFileName(file.path);
          
          if (fileSeason === targetSeason && fileEpisode === targetEpisode) {
            score += 10000000000;
          }
        }
        
        if (score > bestScore) {
          bestScore = score;
          bestFileIndex = i;
        }
      }

      if (bestFileIndex === -1) {
        bestFileIndex = 0;
      }

      if (bestFileIndex >= torrentInfo.links.length) {
        bestFileIndex = 0;
      }

      // Obter link final
      const selectedLink = torrentInfo.links[bestFileIndex];
      const directLink = await this.unrestrictLink(selectedLink, apiKey);
      
      this.logger.info('Stream link obtido com sucesso', {
        torrentId,
        fileName: selectedFiles[bestFileIndex]?.path || 'Desconhecido'
      });
      
      return directLink;

    } catch (error) {
      // Se já é uma StreamStatusException, relançar
      if (error instanceof StreamStatusException) {
        throw error;
      }
      
      const axiosError = error as AxiosError<RealDebridError>;
      const errorData = axiosError.response?.data;
      const errorCode = errorData?.error_code;
      
      const staticResponse = this.staticResponseService.getResponseForRealDebridStatus('error', errorCode);
      
      if (staticResponse) {
        throw new StreamStatusException(
          staticResponse,
          'error',
          undefined,
          `Erro Real-Debrid: ${this.getErrorMessage(error)}`
        );
      }

      this.logger.error('Falha ao obter stream link', {
        torrentId,
        error: this.getErrorMessage(error)
      });
      return null;
    }
  }

  /**
   * Método para obter stream link com tratamento de status
   */
  async getStreamLinkWithStatus(
    torrentId: string,
    apiKey: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<{
    url: string | null;
    status: 'downloaded' | 'downloading' | 'error' | 'waiting' | 'unknown';
    staticResponse?: StaticResponse;
    progress?: number;
  }> {
    try {
      const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
      
      const staticResponse = this.staticResponseService.getResponseForRealDebridStatus(torrentInfo.status);
      if (staticResponse) {
        return {
          url: null,
          status: this.mapRdStatusToStreamStatus(torrentInfo.status),
          staticResponse,
          progress: torrentInfo.progress
        };
      }

      if (torrentInfo.status === 'downloaded' && torrentInfo.links && torrentInfo.links.length > 0) {
        const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode);
        return {
          url: link,
          status: 'downloaded',
          progress: 100
        };
      }

      return {
        url: null,
        status: this.mapRdStatusToStreamStatus(torrentInfo.status),
        progress: torrentInfo.progress
      };

    } catch (error: any) {
      if (error instanceof StreamStatusException) {
        return {
          url: null,
          status: 'downloading',
          staticResponse: error.staticResponse,
          progress: error.progress
        };
      }
      
      return {
        url: null,
        status: 'error'
      };
    }
  }

  /**
   * Mapeia status do Real-Debrid para status de stream
   */
  private mapRdStatusToStreamStatus(rdStatus: string): 'downloaded' | 'downloading' | 'error' | 'waiting' | 'unknown' {
    const statusMap: Record<string, 'downloaded' | 'downloading' | 'error' | 'waiting' | 'unknown'> = {
      'downloaded': 'downloaded',
      'dead': 'downloaded',
      'downloading': 'downloading',
      'uploading': 'downloading',
      'queued': 'downloading',
      'magnet_conversion': 'downloading',
      'waiting_files_selection': 'waiting',
      'error': 'error',
      'magnet_error': 'error'
    };

    return statusMap[rdStatus] || 'unknown';
  }

  /**
   * Extrai temporada do nome do arquivo
   */
  private extractSeasonFromFileName(fileName: string): number | undefined {
    const lowerName = fileName.toLowerCase();
    
    const patterns = [
      /s(\d+)e\d+/i,           // S03E08
      /season\s*(\d+)\s*episode/i, // Season 3 Episode 8
      /(\d+)x\d+/i             // 3x08
    ];
    
    for (const pattern of patterns) {
      const match = lowerName.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
    
    return undefined;
  }

  /**
   * Extrai episódio do nome do arquivo
   */
  private extractEpisodeFromFileName(fileName: string): number | undefined {
    const lowerName = fileName.toLowerCase();
    
    const patterns = [
      /s\d+e(\d+)/i,                // S03E08
      /season\s*\d+\s*episode\s*(\d+)/i, // Season 3 Episode 8
      /\d+x(\d+)/i,                 // 3x08
      /ep\s*(\d+)/i                 // Ep 08
    ];
    
    for (const pattern of patterns) {
      const match = lowerName.match(pattern);
      if (match && match[1]) {
        return parseInt(match[1], 10);
      }
    }
    
    return undefined;
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