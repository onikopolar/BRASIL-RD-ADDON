import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { config } from '../config/index.js';
import { Logger } from '../utils/logger.js';
import { TorboxTorrentInfo, TorboxFile } from '../types/index.js';
import { StaticResponseService, StaticResponse } from '../stream/StaticResponseService.js';
import { StreamStatusException } from '../stream/StreamStatusException.js';
import { EpisodeMatcher } from '../titulos/episodeMatcher.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';

interface TorboxError {
  error?: string;
  detail?: string;
}

interface TorboxCreateTorrentResponse {
  data?: {
    torrent_id?: number;
    id?: number;
    hash?: string;
    queued_id?: number;
  };
  torrent_id?: number;
  id?: number;
  hash?: string;
}

interface TorboxListResponse {
  data?: TorboxTorrentInfo[];
  success?: boolean;
}

export class TorboxService {
  private readonly logger: Logger;
  private readonly maxRetries: number = 3;
  private readonly baseDelay: number = 1000;
  private readonly videoExtensions: string[] = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
  ];
  private staticResponseService: StaticResponseService;
  private readonly episodeMatcher = EpisodeMatcher.getInstance();

  constructor(baseUrl?: string) {
    this.logger = new Logger('TorboxService');
    this.staticResponseService = new StaticResponseService(baseUrl);
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
  }

  private createHttpClient(apiKey: string): AxiosInstance {
    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Torbox API Key is required');
    }

    const client = axios.create({
      baseURL: config.torbox.baseUrl,
      timeout: config.torbox.timeout || 30000,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    client.interceptors.response.use(
      response => response,
      (error: AxiosError) => {
        const errorData = error.response?.data as TorboxError;
        const status = error.response?.status;
        const errorMessage = errorData?.detail || errorData?.error || error.message;

        if (status === 503) {
          throw new StreamStatusException(
            StaticResponse.FAILED_DOWNLOAD, 'error', undefined,
            'Torbox indisponível no momento'
          );
        }

        if (status === 401 || status === 403) {
          throw new Error('Torbox authentication failed: Invalid or expired API token');
        }

        throw new Error(`Torbox API Error (${status}): ${errorMessage}`);
      }
    );

    return client;
  }

  // ── Public API (mesma interface do RealDebridService) ─────────────────

  async addMagnet(magnetLink: string, apiKey: string): Promise<string> {
    this.validateMagnetLink(magnetLink);
    const client = this.createHttpClient(apiKey);

    try {
      // Torbox espera form-data, não JSON. Usamos URLSearchParams para compatibilidade.
      const body = new URLSearchParams();
      body.append('magnet', magnetLink);

      const response = await this.retryableRequest<TorboxCreateTorrentResponse>(
        () => client.post('/torrents/createtorrent', body.toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }),
        'addMagnet'
      );

      const torrentId = response.data?.torrent_id
        || response.data?.id
        || response.data?.data?.torrent_id
        || response.data?.data?.id
        || response.data?.data?.queued_id;

      if (torrentId) {
        this.logger.info('Magnet adicionado ao Torbox', {
          torrentId,
          magnetHash: await this.extrairMagnetHash(magnetLink),
          campoEncontrado: response.data?.torrent_id ? 'torrent_id' :
            response.data?.id ? 'id' :
            response.data?.data?.torrent_id ? 'data.torrent_id' :
            response.data?.data?.id ? 'data.id' : 'data.queued_id'
        });
        return String(torrentId);
      }

      throw new Error('Formato de resposta inválido do createtorrent: ' + JSON.stringify(response.data));
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao adicionar magnet ao Torbox', {
        error: error instanceof Error ? error.message : 'Erro',
        magnetHash: await this.extrairMagnetHash(magnetLink)
      });
      throw error;
    }
  }

  async getTorrentInfo(torrentId: string, apiKey: string): Promise<TorboxTorrentInfo> {
    this.validateTorrentId(torrentId);
    const client = this.createHttpClient(apiKey);

    try {
      const response = await this.retryableRequest<TorboxListResponse>(
        () => client.get('/torrents/mylist', { params: { id: torrentId } }),
        'getTorrentInfo'
      );

      const data = response.data?.data;
      if (data) {
        // ?id=ID retorna objeto único; sem parâmetros retorna array
        if (Array.isArray(data)) {
          if (data.length === 0) throw new Error('Torrent não encontrado no Torbox');
          return data[0];
        }
        return data as TorboxTorrentInfo;
      }
      throw new Error('Torrent não encontrado no Torbox');
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao obter info do torrent', { torrentId });
      throw error;
    }
  }

  async selectFiles(_torrentId: string, _apiKey: string, _fileIds: string = 'all'): Promise<void> {
    // Torbox não requer seleção de arquivos — todos os arquivos já estão disponíveis
    // Mantido para compatibilidade com a interface existente
  }

  async unrestrictLink(_link: string, _apiKey: string): Promise<string> {
    // Torbox não usa unrestrict — usa permalink direto
    throw new Error('Torbox não suporta unrestrictLink. Use getStreamLinkForFile/getStreamLinkForTorrent.');
  }

  /**
   * Constrói o permalink de download do Torbox.
   * Não requer chamada à API — a URL redireciona automaticamente para o CDN.
   */
  buildStreamPermalink(torrentId: string | number, fileId: number, apiKey: string): string {
    return `https://api.torbox.app/v1/api/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${fileId}&redirect=true`;
  }

  async getStreamLinkForFile(torrentId: string, fileId: number, apiKey: string): Promise<string | null> {
    try {
      const info = await this.getTorrentInfo(torrentId, apiKey);

      const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (staticResponse) {
        throw new StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
      }

      if (!this.isReadyStatus(info.download_state)) {
        throw new StreamStatusException(StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
      }

      const file = (info.files || []).find(f => f.id === fileId);
      if (!file) {
        throw new StreamStatusException(StaticResponse.FAILED_UNEXPECTED, info.download_state, undefined, 'Arquivo não encontrado');
      }

      return this.buildStreamPermalink(torrentId, fileId, apiKey);
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

      const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (staticResponse) {
        throw new StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
      }

      if (!this.isReadyStatus(info.download_state)) {
        throw new StreamStatusException(StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
      }

      const files = info.files || [];
      let bestFile: TorboxFile | null = null;
      let bestScore = 0;

      for (const f of files) {
        if (!this.videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext))) continue;
        let score = f.size;
        if (targetSeason !== undefined && targetEpisode !== undefined) {
          const { temporada, episodio } = this.extrairTemporadaEpisodio(f.name);
          if (temporada === targetSeason && episodio === targetEpisode) score += 10_000_000_000;
        }
        if (score > bestScore) { bestScore = score; bestFile = f; }
      }

      if (!bestFile) {
        throw new StreamStatusException(StaticResponse.FAILED_RAR, info.download_state, 100, 'Nenhum arquivo de vídeo encontrado');
      }

      return this.buildStreamPermalink(torrentId, bestFile.id, apiKey);
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
      const sr = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (sr) return { url: null, status: info.download_state, staticResponse: sr, progress: Math.round(info.progress * 100) };
      if (this.isReadyStatus(info.download_state)) {
        const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode);
        return { url: link, status: 'cached', progress: 100 };
      }
      return { url: null, status: info.download_state, progress: Math.round(info.progress * 100) };
    } catch (error) {
      if (error instanceof StreamStatusException) {
        return { url: null, status: 'downloading', staticResponse: error.staticResponse, progress: error.progress };
      }
      return { url: null, status: 'error' };
    }
  }

  async getTorrentFiles(torrentId: string, apiKey: string): Promise<TorboxFile[]> {
    return (await this.getTorrentInfo(torrentId, apiKey)).files || [];
  }

  async findExistingTorrent(magnetHash: string, apiKey: string): Promise<TorboxTorrentInfo | null> {
    const client = this.createHttpClient(apiKey);
    try {
      const response = await this.retryableRequest<TorboxListResponse>(
        () => client.get('/torrents/mylist'),
        'findExistingTorrent'
      );
      const list = response.data?.data || [];
      const t = list.find((torrent: TorboxTorrentInfo) =>
        torrent.hash?.toLowerCase() === magnetHash.toLowerCase()
      );
      if (t) this.logger.info('Torrent existente encontrado no Torbox', { id: t.id, status: t.download_state });
      return t || null;
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao buscar torrent existente', { magnetHash });
      return null;
    }
  }

  async processTorrent(magnetLink: string, apiKey: string) {
    const hash = await this.extrairMagnetHash(magnetLink);
    try {
      const existing = await this.findExistingTorrent(hash, apiKey);
      if (existing) {
        const ready = this.isReadyStatus(existing.download_state);
        return { added: true, ready, status: existing.download_state, torrentId: String(existing.id), progress: Math.round(existing.progress * 100) };
      }
      const id = await this.addMagnet(magnetLink, apiKey);
      // Torbox processa automaticamente, não precisa selectFiles
      const info = await this.getTorrentInfo(id, apiKey);
      const ready = this.isReadyStatus(info.download_state);
      return { added: true, ready, status: info.download_state, torrentId: id, progress: Math.round(info.progress * 100) };
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      return { added: false, ready: false, status: 'error' };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Status do Torbox que indicam que o torrent está pronto para stream */
  private isReadyStatus(status: string): boolean {
    const ready = ['completed', 'cached', 'uploading', 'seeding'];
    const s = status?.toLowerCase() || '';
    return ready.includes(s);
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

  private async extrairMagnetHash(link: string): Promise<string> {
    const dados = await analisarMagnet(link);
    return dados ? dados.infoHash : 'unknown';
  }

  private extrairTemporadaEpisodio(nomeArquivo: string): { temporada?: number; episodio?: number } {
    const info = this.episodeMatcher.extractEpisodeInfo(nomeArquivo);
    if (info.season > 0 && info.episode > 0) {
      return { temporada: info.season, episodio: info.episode };
    }
    return {};
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}