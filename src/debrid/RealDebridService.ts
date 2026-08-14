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
  private static instance: TorboxService | null = null;

  private readonly logger: Logger;
  private readonly maxRetries: number = 3;
  private readonly baseDelay: number = 1000;
  /** Cache infoHash -> torrentId for queued torrents not yet in mylist */
  private static queuedTorrentCache = new Map<string, string>();
  private readonly videoExtensions: string[] = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
  ];
  private staticResponseService: StaticResponseService;
  private readonly episodeMatcher = EpisodeMatcher.getInstance();

  /** Cache of target titles for each infoHash (e.g., ["Kung Fu Hustle", "Kung-Fusao"]) */
  private titleCache = new Map<string, string[]>();

  // Singleton global – garante que a mesma instância seja usada em todo o addon
  public static getInstance(baseUrl?: string): TorboxService {
    if (!TorboxService.instance) {
      TorboxService.instance = new TorboxService(baseUrl);
    } else if (baseUrl) {
      TorboxService.instance.staticResponseService.setBaseUrl(baseUrl);
    }
    return TorboxService.instance;
  }

  constructor(baseUrl?: string) {
    this.logger = new Logger('TorboxService');
    this.staticResponseService = new StaticResponseService(baseUrl);
  }

  public setStaticResponseBaseUrl(baseUrl: string): void {
    this.staticResponseService.setBaseUrl(baseUrl);
  }

  /** Registers titles (PT and EN) that will be used to choose the correct file inside the torrent */
  public setTitlesForHash(infoHash: string, titles: string[]): void {
    if (infoHash && titles.length > 0) {
      this.titleCache.set(infoHash.toLowerCase(), titles);
      console.log(`[DEBUG-TORBOX] setTitlesForHash: ${infoHash.toLowerCase()} -> ${JSON.stringify(titles)}`);
    }
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
        const hash = await this.extrairMagnetHash(magnetLink);
        if (hash) TorboxService.queuedTorrentCache.set(hash.toLowerCase(), String(torrentId));
        this.logger.info('Magnet adicionado ao Torbox', {
          torrentId,
          magnetHash: hash,
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
      const msg = error instanceof Error ? error.message : '';
      if (/already queued/i.test(msg)) {
        const hash = await this.extrairMagnetHash(magnetLink);
        const cachedId = hash ? TorboxService.queuedTorrentCache.get(hash.toLowerCase()) : undefined;
        if (cachedId) {
          this.logger.info('Magnet já na fila, usando ID cacheado', { torrentId: cachedId, magnetHash: hash?.substring(0, 16) });
          return cachedId;
        }
      }
      this.logger.error('Falha ao adicionar magnet ao Torbox', {
        error: msg || 'Erro',
        magnetHash: await this.extrairMagnetHash(magnetLink)
      });
      throw error;
    }
  }

  async airlockTorrent(torrentId: string, apiKey: string, enabled: boolean): Promise<void> {
    const client = this.createHttpClient(apiKey);
    try {
      await this.retryableRequest(
        () => client.put('/torrents/edittorrent', {
          torrent_id: parseInt(torrentId),
          airlocked: enabled
        }),
        'airlockTorrent'
      );
      this.logger.info(`AirLock ${enabled ? 'ATIVADO' : 'DESATIVADO'}`, { torrentId });
    } catch (error) {
      this.logger.warn('Falha ao configurar AirLock', {
        torrentId,
        error: (error as Error).message
      });
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
        if (Array.isArray(data)) {
          if (data.length === 0) throw new Error('Torrent não encontrado no Torbox');
          return data[0];
        }
        return data as TorboxTorrentInfo;
      }
      throw new Error('Torrent não encontrado no Torbox');
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao obter info do torrent', { torrentId, message: (error as Error).message });
      throw error;
    }
  }

  async selectFiles(_torrentId: string, _apiKey: string, _fileIds: string = 'all'): Promise<void> {
  }

  async unrestrictLink(_link: string, _apiKey: string): Promise<string> {
    throw new Error('Torbox não suporta unrestrictLink. Use getStreamLinkForFile/getStreamLinkForTorrent.');
  }

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

  /**
   * Obtém o link de stream para um arquivo dentro do torrent.
   * Agora exige correspondência exata de episódio quando informado.
   * Prioriza a qualidade (targetQuality) na seleção do arquivo.
   */
  async getStreamLinkForTorrent(
    torrentId: string, apiKey: string, targetSeason?: number, targetEpisode?: number, targetQuality?: string,
    cachedInfo?: TorboxTorrentInfo, targetTitles?: string[]
  ): Promise<string | null> {
    this.validateTorrentId(torrentId);

    try {
      const info = cachedInfo || await this.getTorrentInfo(torrentId, apiKey);

      const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (staticResponse) {
        throw new StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
      }

      if (!this.isReadyStatus(info.download_state)) {
        throw new StreamStatusException(StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
      }

      const files = info.files || [];
      const minSize = (targetSeason !== undefined) ? 5 * 1024 * 1024 : 10 * 1024 * 1024;

      // Filtra apenas arquivos de vídeo com tamanho mínimo
      let candidateFiles = files.filter(f =>
        this.videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) &&
        f.size >= minSize
      );

      // Se episódio alvo foi informado, filtra estritamente pelos arquivos que pertencem a ele
      if (targetSeason !== undefined && targetEpisode !== undefined) {
        const episodeFiles = candidateFiles.filter(f =>
          this.episodeMatcher.arquivoPertenceAoEpisodio(f.name, targetSeason, targetEpisode)
        );

        if (episodeFiles.length === 0) {
          // Nenhum arquivo corresponde ao episódio solicitado – o torrent não serve
          throw new StreamStatusException(
            StaticResponse.FAILED_UNEXPECTED,
            info.download_state,
            100,
            `Nenhum arquivo do episódio ${targetSeason}x${targetEpisode} encontrado no torrent`
          );
        }

        candidateFiles = episodeFiles; // Trabalha apenas com os que batem
      }

      // Recupera títulos do cache interno se não foram passados
      if (!targetTitles || targetTitles.length === 0) {
        const hash = info.hash?.toLowerCase();
        if (hash && this.titleCache.has(hash)) {
          targetTitles = this.titleCache.get(hash);
          console.log(`[DEBUG-TORBOX] getStreamLinkForTorrent: títulos recuperados do cache para ${hash}: ${JSON.stringify(targetTitles)}`);
        } else {
          console.log(`[DEBUG-TORBOX] getStreamLinkForTorrent: cache vazio ou hash não encontrado para ${hash}`);
        }
      }

      let bestFile: TorboxFile | null = null;
      let bestScore = 0;

      console.log(`[DEBUG-TORBOX] 📁 Iniciando seleção entre ${candidateFiles.length} vídeos (episódio ${targetSeason}x${targetEpisode})...`);

      for (const f of candidateFiles) {
        let score = 0;
        let titleScore = 0;
        let qualityScore = 0;

        // 1. Correspondência de título (peso moderado)
        if (targetTitles && targetTitles.length > 0) {
          titleScore = this.calculateTitleMatchScore(f.name, targetTitles);
          score += titleScore * 50_000_000_000;
        }

        // 2. QUALIDADE (prioridade máxima)
        if (targetQuality) {
          const fileQuality = this.extractQualityFromFilename(f.name);
          if (fileQuality) {
            const normalizedTarget = this.normalizeQuality(targetQuality);
            const normalizedFile = this.normalizeQuality(fileQuality);

            if (normalizedFile === normalizedTarget) {
              qualityScore = 100_000_000_000;
            } else {
              const qualityRank = ['2160p', '1080p', '720p', '480p'];
              const targetRank = qualityRank.indexOf(normalizedTarget);
              const fileRank = qualityRank.indexOf(normalizedFile);
              if (targetRank !== -1 && fileRank !== -1) {
                const diff = Math.abs(targetRank - fileRank);
                if (fileRank < targetRank) {
                  // Qualidade superior (ex: 2160p quando pediu 1080p)
                  qualityScore = 80_000_000_000 - diff * 10_000_000_000;
                } else {
                  // Qualidade inferior
                  qualityScore = Math.max(0, 30_000_000_000 - diff * 15_000_000_000);
                }
              }
            }
          } else {
            qualityScore = 5_000_000_000;
          }
          score += qualityScore;
        }

        // 3. Tamanho (desempate)
        score += f.size;

        console.log(`[DEBUG-TORBOX]   - ${f.name}`);
        console.log(`[DEBUG-TORBOX]     titleScore=${titleScore}, qualityScore=${qualityScore}, size=${f.size}, TOTAL=${score}`);

        if (score > bestScore) {
          bestScore = score;
          bestFile = f;
          console.log(`[DEBUG-TORBOX]     -> NOVO MELHOR (score=${score})`);
        }
      }

      console.log(`[DEBUG-TORBOX] 🏆 Escolhido: ${bestFile?.name} (score final: ${bestScore})`);

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
        const hash = info.hash?.toLowerCase();
        const targetTitles = hash ? this.titleCache.get(hash) : undefined;
        const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode, undefined, undefined, targetTitles);
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
      this.logger.error('Falha ao buscar torrent existente', { magnetHash: magnetHash.substring(0, 16) });
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
      try {
        const info = await this.getTorrentInfo(id, apiKey);
        const ready = this.isReadyStatus(info.download_state);
        return { added: true, ready, status: info.download_state, torrentId: id, progress: Math.round(info.progress * 100) };
      } catch (infoErr) {
        this.logger.warn('getTorrentInfo falhou, torrent provavelmente em fila', {
          torrentId: id,
          error: infoErr instanceof Error ? infoErr.message : 'Erro',
        });
        return { added: true, ready: false, status: 'downloading', torrentId: id, progress: 0 };
      }
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      return { added: false, ready: false, status: 'error' };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Calculates a similarity score between the file name and a list of target titles */
  private calculateTitleMatchScore(fileName: string, targetTitles: string[]): number {
    const normalize = (s: string) => s.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const fileWords = normalize(fileName).split(' ');
    let maxScore = 0;

    console.log(`[DEBUG-TORBOX] calculateTitleMatchScore para arquivo "${fileName}"`);
    for (const title of targetTitles) {
      const normalizedTitle = normalize(title);
      const titleWords = normalizedTitle.split(' ').filter(w => w.length > 2);
      let score = 0;
      for (const tw of titleWords) {
        if (fileWords.some(fw => fw.includes(tw))) {
          score++;
          console.log(`[DEBUG-TORBOX]   palavra "${tw}" encontrada no arquivo`);
        }
      }
      console.log(`[DEBUG-TORBOX]   score contra título "${title}" -> ${score}`);
      if (score > maxScore) maxScore = score;
    }
    console.log(`[DEBUG-TORBOX]   maxScore final: ${maxScore}`);
    return maxScore;
  }

  /**
   * Extrai a qualidade do nome do arquivo.
   * Retorna a qualidade normalizada (ex: "2160p", "1080p", "720p", "480p") ou null.
   */
  private extractQualityFromFilename(filename: string): string | null {
    const match = filename.match(/\b(2160p|4k|uhd|1080p|720p|480p)\b/i);
    if (match) {
      const q = match[1].toLowerCase();
      // Normaliza 4k/uhd para 2160p
      if (q === '4k' || q === 'uhd') return '2160p';
      return q;
    }
    return null;
  }

  /**
   * Normaliza a qualidade para comparação (ex: "2160p", "1080p", "720p", "480p")
   */
  private normalizeQuality(quality: string): string {
    const q = quality.toLowerCase().replace(/\s/g, '');
    if (q === '4k' || q === 'uhd') return '2160p';
    if (q === 'fullhd' || q === '1080p') return '1080p';
    if (q === 'hd' || q === '720p') return '720p';
    if (q === 'sd' || q === '480p') return '480p';
    return q;
  }

  private isReadyStatus(status: string): boolean {
    const ready = ['completed', 'cached', 'uploading', 'seeding'];
    const s = status?.toLowerCase() || '';
    return ready.some(r => s.includes(r));
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
        const axiosErr = error as AxiosError;
        if (this.isRetryableError(axiosErr) && attempt < this.maxRetries) {
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

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}