import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { config } from '../config/index.js';
import { Logger } from '../utils/logger.js';
import { TorboxTorrentInfo, TorboxFile } from '../types/index.js';
import { StaticResponseService, StaticResponse } from '../stream/StaticResponseService.js';
import { StreamStatusException } from '../stream/StreamStatusException.js';
import { EpisodeMatcher } from '../titulos/episodeMatcher.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';
import { normalizarTexto, extrairAno } from '../titulos/TechnicalWords.js';

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
      // Deduplica os títulos antes de armazenar
      const uniqueTitles = Array.from(new Set(titles));
      this.titleCache.set(infoHash.toLowerCase(), uniqueTitles);
      this.logger.debug('Títulos registrados para seleção de arquivo (únicos)', {
        infoHash: infoHash.toLowerCase(),
        titles: uniqueTitles,
      });
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

    const dadosMagnet = await analisarMagnet(magnetLink);
    const hash = dadosMagnet?.infoHash?.toLowerCase() || 'unknown';
    const nome = dadosMagnet?.nome || this.titleCache.get(hash)?.[0] || '';

    this.logger.debug('addMagnet: início', { magnetHash: hash, nome });

    try {
      const body = new URLSearchParams();
      body.append('magnet', magnetLink);

      if (nome) {
        body.append('name', nome);
      }

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

      this.logger.debug('addMagnet: resposta recebida', { responseData: response.data, torrentId });

      if (torrentId) {
        if (hash !== 'unknown') {
          TorboxService.queuedTorrentCache.set(hash, String(torrentId));
        }

        this.logger.info('Magnet adicionado ao Torbox', {
          torrentId,
          magnetHash: hash,
          nomeMagnet: nome?.substring(0, 80) || 'N/A',
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
        const cachedId = hash !== 'unknown' ? TorboxService.queuedTorrentCache.get(hash) : undefined;
        if (cachedId) {
          this.logger.info('Magnet já na fila, usando ID cacheado', {
            torrentId: cachedId,
            magnetHash: hash?.substring(0, 16),
          });
          return cachedId;
        }
      }

      this.logger.error('Falha ao adicionar magnet ao Torbox', {
        error: msg || 'Erro',
        magnetHash: hash,
      });
      throw error;
    }
  }

  async airlockTorrent(torrentId: string, apiKey: string, enabled: boolean): Promise<void> {
    const client = this.createHttpClient(apiKey);
    this.logger.debug('airlockTorrent: início', { torrentId, enabled });
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
    this.logger.debug('getTorrentInfo: início', { torrentId });

    try {
      const response = await this.retryableRequest<TorboxListResponse>(
        () => client.get('/torrents/mylist', { params: { id: torrentId } }),
        'getTorrentInfo'
      );

      const data = response.data?.data;
      if (data) {
        if (Array.isArray(data)) {
          if (data.length === 0) throw new Error('Torrent não encontrado no Torbox');
          this.logger.debug('getTorrentInfo: retornou array, primeiro item', { torrent: data[0] });
          return data[0];
        }
        this.logger.debug('getTorrentInfo: retornou objeto', { torrent: data });
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
    this.logger.debug('selectFiles: método não suportado (noop)');
  }

  async unrestrictLink(_link: string, _apiKey: string): Promise<string> {
    throw new Error('Torbox não suporta unrestrictLink. Use getStreamLinkForFile/getStreamLinkForTorrent.');
  }

  buildStreamPermalink(torrentId: string | number, fileId: number, apiKey: string): string {
    const url = `https://api.torbox.app/v1/api/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${torrentId}&file_id=${fileId}&redirect=true`;
    this.logger.debug('buildStreamPermalink', { torrentId, fileId, url });
    return url;
  }

  async getStreamLinkForFile(torrentId: string, fileId: number, apiKey: string): Promise<string | null> {
    this.logger.debug('getStreamLinkForFile: início', { torrentId, fileId });
    try {
      const info = await this.getTorrentInfo(torrentId, apiKey);

      const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (staticResponse) {
        this.logger.debug('getStreamLinkForFile: status não ready', { status: info.download_state, staticResponse });
        throw new StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
      }

      if (!this.isReadyStatus(info.download_state)) {
        this.logger.debug('getStreamLinkForFile: ainda baixando', { status: info.download_state, progress: info.progress });
        throw new StreamStatusException(StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
      }

      const file = (info.files || []).find(f => f.id === fileId);
      if (!file) {
        this.logger.error('getStreamLinkForFile: arquivo não encontrado', { fileId, files: info.files });
        throw new StreamStatusException(StaticResponse.FAILED_UNEXPECTED, info.download_state, undefined, 'Arquivo não encontrado');
      }

      const link = this.buildStreamPermalink(torrentId, fileId, apiKey);
      this.logger.debug('getStreamLinkForFile: link gerado', { link });
      return link;
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
    torrentId: string,
    apiKey: string,
    targetSeason?: number,
    targetEpisode?: number,
    targetQuality?: string,
    cachedInfo?: TorboxTorrentInfo,
    targetTitles?: string[],
    episodeTitles?: Array<{ episodeNumber: number; namePt?: string; nameEn?: string }> | null
  ): Promise<string | null> {

    this.logger.info('getStreamLinkForTorrent: início', {
      torrentId,
      targetSeason,
      targetEpisode,
      targetQuality,
      hasCachedInfo: !!cachedInfo,
      targetTitles: targetTitles || 'não informado',
      episodeTitles: episodeTitles ? episodeTitles.length : 'não informado'
    });

    try {
      const info = cachedInfo || await this.getTorrentInfo(torrentId, apiKey);

      this.logger.debug('getStreamLinkForTorrent: informações do torrent', {
        hash: info.hash,
        name: info.name,
        download_state: info.download_state,
        progress: info.progress,
        fileCount: info.files?.length
      });

      const staticResponse = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (staticResponse) {
        this.logger.debug('getStreamLinkForTorrent: status não ready', { status: info.download_state, staticResponse });
        throw new StreamStatusException(staticResponse, info.download_state, Math.round(info.progress * 100), `Status: ${info.download_state}`);
      }

      if (!this.isReadyStatus(info.download_state)) {
        this.logger.debug('getStreamLinkForTorrent: ainda baixando', { status: info.download_state, progress: info.progress });
        throw new StreamStatusException(StaticResponse.DOWNLOADING, info.download_state, Math.round(info.progress * 100), 'Aguardando download');
      }

      const files = info.files || [];
      const minSize = (targetSeason !== undefined) ? 5 * 1024 * 1024 : 10 * 1024 * 1024;

      this.logger.debug('getStreamLinkForTorrent: filtro de candidatos', {
        totalFiles: files.length,
        minSize,
        targetSeason,
        targetEpisode
      });

      let candidateFiles = files.filter(f =>
        this.videoExtensions.some(ext => f.name.toLowerCase().endsWith(ext)) &&
        f.size >= minSize
      );

      this.logger.debug('getStreamLinkForTorrent: após filtro de extensão/tamanho', {
        candidateCount: candidateFiles.length,
        candidates: candidateFiles.map(f => f.name)
      });

      if (targetSeason !== undefined && targetEpisode !== undefined) {
        const epData = episodeTitles?.find(ep => ep.episodeNumber === targetEpisode);
        this.logger.info(`Episódio alvo: ${targetSeason}x${targetEpisode}${epData ? ` | PT: ${epData.namePt} | EN: ${epData.nameEn}` : ''}`);
        const episodeFiles = candidateFiles.filter(f =>
          this.episodeMatcher.arquivoPertenceAoEpisodioComTitulos(f.name, targetSeason, targetEpisode, episodeTitles)
        );

        this.logger.debug('getStreamLinkForTorrent: após filtro de episódio', {
          episodeCandidateCount: episodeFiles.length,
          episodeCandidates: episodeFiles.map(f => f.name)
        });

        if (episodeFiles.length === 0) {
          throw new StreamStatusException(
            StaticResponse.FAILED_UNEXPECTED,
            info.download_state,
            100,
            `Nenhum arquivo do episódio ${targetSeason}x${targetEpisode} encontrado no torrent`
          );
        }

        candidateFiles = episodeFiles;
      }

      // Garante que targetTitles seja definido e único
      if (!targetTitles || targetTitles.length === 0) {
        const hash = info.hash?.toLowerCase();
        if (hash && this.titleCache.has(hash)) {
          targetTitles = this.titleCache.get(hash)!; // já deduplicado no setTitlesForHash
          this.logger.debug('Títulos recuperados do cache para seleção de arquivo', {
            hash,
            titles: targetTitles,
          });
        }
      } else {
        // Deduplica títulos fornecidos diretamente
        targetTitles = Array.from(new Set(targetTitles));
        this.logger.debug('Títulos alvo fornecidos diretamente (únicos)', { targetTitles });
      }

      let bestFile: TorboxFile | null = null;
      let bestScore = 0;
      const scoresLog: any[] = [];

      this.logger.debug(`Selecionando arquivo (candidatos: ${candidateFiles.length}, episódio: ${targetSeason}x${targetEpisode})`);

      for (const f of candidateFiles) {
        this.logger.debug('── Avaliando candidato ──', { fileName: f.name, size: f.size });

        let score = 0;
        let titleScore = 0;
        let qualityScore = 0;

        if (targetTitles && targetTitles.length > 0) {
          titleScore = this.calculateTitleMatchScore(f.name, targetTitles);
          this.logger.debug('   titleScore calculado:', { titleScore });
          if (titleScore === -1) {
            this.logger.debug('   ❌ Ano divergente, descartando arquivo');
            continue;
          }
          score += titleScore * 50_000_000_000;
          this.logger.debug('   score após titleScore * 50B:', { score });
        } else {
          this.logger.debug('   Nenhum título alvo fornecido, titleScore = 0');
        }

        if (targetQuality) {
          const fileQuality = this.extractQualityFromFilename(f.name);
          this.logger.debug('   Qualidade extraída do arquivo:', { fileQuality });
          if (fileQuality) {
            const normalizedTarget = this.normalizeQuality(targetQuality);
            const normalizedFile = this.normalizeQuality(fileQuality);
            this.logger.debug('   Qualidades normalizadas:', { target: normalizedTarget, file: normalizedFile });

            if (normalizedFile === normalizedTarget) {
              qualityScore = 100_000_000_000;
              this.logger.debug('   ✅ Qualidade exata, qualityScore = 100B');
            } else {
              const qualityRank = ['2160p', '1080p', '720p', '480p'];
              const targetRank = qualityRank.indexOf(normalizedTarget);
              const fileRank = qualityRank.indexOf(normalizedFile);
              this.logger.debug('   Ranks de qualidade:', { targetRank, fileRank });
              if (targetRank !== -1 && fileRank !== -1) {
                const diff = Math.abs(targetRank - fileRank);
                if (fileRank < targetRank) {
                  qualityScore = 80_000_000_000 - diff * 10_000_000_000;
                  this.logger.debug('   Qualidade superior à alvo, qualityScore:', { qualityScore });
                } else {
                  qualityScore = Math.max(0, 30_000_000_000 - diff * 15_000_000_000);
                  this.logger.debug('   Qualidade inferior à alvo, qualityScore:', { qualityScore });
                }
              }
            }
          } else {
            qualityScore = 5_000_000_000;
            this.logger.debug('   Qualidade não identificada, qualityScore = 5B');
          }
          score += qualityScore;
          this.logger.debug('   score após qualityScore:', { score });
        } else {
          this.logger.debug('   Nenhuma qualidade alvo fornecida');
        }

        score += f.size;
        this.logger.debug('   score final (com tamanho):', { finalScore: score, size: f.size });

        scoresLog.push({
          fileName: f.name,
          titleScore,
          qualityScore,
          size: f.size,
          totalScore: score
        });

        if (score > bestScore) {
          this.logger.debug('   🏆 Novo melhor candidato!', { score, previousBest: bestScore });
          bestScore = score;
          bestFile = f;
        }
      }

      this.logger.info('── Resumo da avaliação de candidatos ──', {
        scores: scoresLog,
        bestFile: bestFile?.name,
        bestScore: bestScore
      });

      this.logger.debug('Arquivo escolhido detalhado', {
        name: bestFile?.name,
        score: bestScore,
        segments: bestFile?.name.split(/[\\/]/).filter(Boolean),
      });

      if (!bestFile) {
        this.logger.error('Nenhum arquivo de vídeo encontrado após avaliação');
        throw new StreamStatusException(StaticResponse.FAILED_RAR, info.download_state, 100, 'Nenhum arquivo de vídeo encontrado');
      }

      const link = this.buildStreamPermalink(torrentId, bestFile.id, apiKey);
      this.logger.info('Link de stream gerado', { torrentId, fileId: bestFile.id, link });
      return link;
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao obter stream', { torrentId, error: (error as Error).message });
      return null;
    }
  }

  async getStreamLinkWithStatus(
    torrentId: string, apiKey: string, targetSeason?: number, targetEpisode?: number
  ): Promise<{
    url: string | null; status: string; staticResponse?: StaticResponse; progress?: number;
  }> {
    this.logger.debug('getStreamLinkWithStatus: início', { torrentId, targetSeason, targetEpisode });
    try {
      const info = await this.getTorrentInfo(torrentId, apiKey);
      const sr = this.staticResponseService.getResponseForTorboxStatus(info.download_state);
      if (sr) {
        this.logger.debug('getStreamLinkWithStatus: status não ready', { status: info.download_state, staticResponse: sr });
        return { url: null, status: info.download_state, staticResponse: sr, progress: Math.round(info.progress * 100) };
      }
      if (this.isReadyStatus(info.download_state)) {
        const hash = info.hash?.toLowerCase();
        const targetTitles = hash ? this.titleCache.get(hash) : undefined;
        const link = await this.getStreamLinkForTorrent(torrentId, apiKey, targetSeason, targetEpisode, undefined, undefined, targetTitles);
        this.logger.debug('getStreamLinkWithStatus: link obtido', { link });
        return { url: link, status: 'cached', progress: 100 };
      }
      this.logger.debug('getStreamLinkWithStatus: baixando', { status: info.download_state, progress: info.progress });
      return { url: null, status: info.download_state, progress: Math.round(info.progress * 100) };
    } catch (error) {
      if (error instanceof StreamStatusException) {
        this.logger.debug('getStreamLinkWithStatus: StreamStatusException', { error });
        return { url: null, status: 'downloading', staticResponse: error.staticResponse, progress: error.progress };
      }
      this.logger.error('getStreamLinkWithStatus: erro inesperado', { error: (error as Error).message });
      return { url: null, status: 'error' };
    }
  }

  async getTorrentFiles(torrentId: string, apiKey: string): Promise<TorboxFile[]> {
    this.logger.debug('getTorrentFiles: início', { torrentId });
    return (await this.getTorrentInfo(torrentId, apiKey)).files || [];
  }

  async findExistingTorrent(magnetHash: string, apiKey: string): Promise<TorboxTorrentInfo | null> {
    const client = this.createHttpClient(apiKey);
    this.logger.debug('findExistingTorrent: início', { magnetHash: magnetHash.substring(0, 16) });
    try {
      const response = await this.retryableRequest<TorboxListResponse>(
        () => client.get('/torrents/mylist'),
        'findExistingTorrent'
      );
      const list = response.data?.data || [];
      this.logger.debug('findExistingTorrent: lista recebida', { count: list.length });
      const t = list.find((torrent: TorboxTorrentInfo) =>
        torrent.hash?.toLowerCase() === magnetHash.toLowerCase()
      );
      if (t) this.logger.info('Torrent existente encontrado no Torbox', { id: t.id, status: t.download_state });
      else this.logger.debug('Torrent não encontrado na lista');
      return t || null;
    } catch (error) {
      if (error instanceof StreamStatusException) throw error;
      this.logger.error('Falha ao buscar torrent existente', { magnetHash: magnetHash.substring(0, 16), error: (error as Error).message });
      return null;
    }
  }

  async processTorrent(magnetLink: string, apiKey: string) {
    const hash = await this.extrairMagnetHash(magnetLink);
    this.logger.debug('processTorrent: início', { magnetHash: hash.substring(0, 16) });
    try {
      const cachedId = hash !== 'unknown' ? TorboxService.queuedTorrentCache.get(hash.toLowerCase()) : undefined;
      if (cachedId) {
        this.logger.debug('processTorrent: ID cacheado encontrado', { torrentId: cachedId });
        try {
          const info = await this.getTorrentInfo(cachedId, apiKey);
          const ready = this.isReadyStatus(info.download_state);
          this.logger.info('Usando torrent cacheado', { torrentId: cachedId, status: info.download_state, ready });
          return { added: true, ready, status: info.download_state, torrentId: cachedId, progress: Math.round(info.progress * 100) };
        } catch (err) {
          this.logger.warn('Falha ao obter info do cache, tentando adicionar novamente', { torrentId: cachedId, error: (err as Error).message });
        }
      }

      const existing = await this.findExistingTorrent(hash, apiKey);
      if (existing) {
        const ready = this.isReadyStatus(existing.download_state);
        this.logger.info('Torrent já existente', { torrentId: existing.id, status: existing.download_state, ready });
        return { added: true, ready, status: existing.download_state, torrentId: String(existing.id), progress: Math.round(existing.progress * 100) };
      }

      this.logger.debug('processTorrent: adicionando magnet');
      const id = await this.addMagnet(magnetLink, apiKey);
      try {
        const info = await this.getTorrentInfo(id, apiKey);
        const ready = this.isReadyStatus(info.download_state);
        this.logger.info('Magnet processado e info obtida', { torrentId: id, status: info.download_state, ready });
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
      this.logger.error('processTorrent: erro geral', { magnetHash: hash.substring(0, 16), error: (error as Error).message });
      return { added: false, ready: false, status: 'error' };
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Calculates a similarity score between the file name and a list of target titles.
   * Returns -1 if the file should be discarded (e.g., year mismatch).
   */
  private calculateTitleMatchScore(fileName: string, targetTitles: string[]): number {
    this.logger.debug('── calculateTitleMatchScore ──', { fileName, targetTitles });

    const segments = fileName.split(/[\\/]/).filter(s => s.trim().length > 0);
    const basename = segments.length > 0 ? segments[segments.length - 1] : fileName;

    this.logger.debug('   Segmentos do caminho:', { segments });

    let bestSegment: string | null = null;
    let bestSegmentScore = -1;
    let bestSegmentDetails: any = null;

    // Função local para tokenizar, incluindo números de sequência (1 ou 2 dígitos)
    const tokenize = (texto: string): string[] => {
      const normalized = normalizarTexto(texto);
      return normalized
        .split(' ')
        .filter(w => w.length > 2 || /^\d+$/.test(w)); // mantém palavras com >2 letras ou números
    };

    // Percorre do arquivo até a raiz, com prioridade para profundidade maior
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      this.logger.debug(`   Avaliando segmento [índice ${i}]: "${seg}"`);

      const segNormalized = normalizarTexto(seg);
      const segYears = extrairAno(seg) || [];
      const segTokens = tokenize(seg);
      this.logger.debug(`      Normalizado: "${segNormalized}", anos: [${segYears.join(', ')}], tokens: [${segTokens.join(', ')}]`);

      for (const title of targetTitles) {
        const titleNormalized = normalizarTexto(title);
        const titleYears = extrairAno(title) || [];
        const titleTokens = tokenize(title);

        this.logger.debug(`      Comparando com título alvo: "${title}" (normalizado: "${titleNormalized}", anos: [${titleYears.join(', ')}], tokens: [${titleTokens.join(', ')}])`);

        let wordScore = 0;
        const matchedWords: string[] = [];
        for (const tt of titleTokens) {
          if (segTokens.includes(tt)) {
            wordScore++;
            matchedWords.push(tt);
          }
        }
        this.logger.debug(`         wordScore: ${wordScore} (tokens correspondentes exatos: ${matchedWords.join(', ')})`);

        // Verifica compatibilidade de anos
        let yearBonus = 0;
        if (segYears.length > 0 && titleYears.length > 0) {
          const hasCommonYear = titleYears.some(ty => segYears.includes(ty));
          if (!hasCommonYear) {
            this.logger.debug(`         ❌ Anos divergentes (segmento: [${segYears.join(', ')}], título: [${titleYears.join(', ')}]), ignorando segmento`);
            continue;
          }
          yearBonus = 100;
        }

        // Bônus de profundidade: arquivo (último segmento) recebe bônus alto
        const depthBonus = (i === segments.length - 1) ? 1000 : (i + 1) * 10;
        const total = wordScore * 1000 + depthBonus + yearBonus;

        this.logger.debug(`         depthBonus: ${depthBonus}, yearBonus: ${yearBonus}, score parcial: ${total}`);

        if (total > bestSegmentScore) {
          bestSegmentScore = total;
          bestSegment = seg;
          bestSegmentDetails = {
            segment: seg,
            wordScore,
            depthBonus,
            yearBonus,
            total,
            matchedWords,
            title,
            segYears,
            titleYears,
          };
        }
      }
    }

    // Fallback: usa basename se nenhum segmento adequado foi encontrado
    if (!bestSegment) {
      this.logger.debug('   Nenhum segmento adequado, usando fallback no basename');
      bestSegment = basename;
      const fileTokens = tokenize(bestSegment);
      const fileYears = extrairAno(bestSegment) || [];
      let maxScore = 0;

      for (const title of targetTitles) {
        const titleYears = extrairAno(title) || [];
        // Verifica ano se ambos tiverem
        if (fileYears.length > 0 && titleYears.length > 0) {
          const hasCommonYear = titleYears.some(ty => fileYears.includes(ty));
          if (!hasCommonYear) {
            this.logger.debug(`      Título "${title}" ignorado por ano divergente no fallback`);
            continue;
          }
        }

        const titleTokens = tokenize(title);
        let score = 0;
        for (const tt of titleTokens) {
          if (fileTokens.includes(tt)) score++;
        }
        if (score > maxScore) {
          maxScore = score;
          this.logger.debug(`      Título "${title}" obteve score ${score} no fallback`);
        }
      }

      this.logger.debug('   TitleMatch fallback (basename)', { fileName, basename, maxScore });
      return maxScore;
    }

    this.logger.debug('   TitleMatch path-aware: melhor segmento encontrado', bestSegmentDetails);
    return bestSegmentScore;
  }

  /**
   * Extrai a qualidade do nome do arquivo.
   * Retorna a qualidade normalizada (ex: "2160p", "1080p", "720p", "480p") ou null.
   */
  private extractQualityFromFilename(filename: string): string | null {
    const match = filename.match(/\b(2160p|4k|uhd|1080p|720p|480p)\b/i);
    if (match) {
      const q = match[1].toLowerCase();
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
      this.logger.debug(`retryableRequest: tentativa ${attempt}/${this.maxRetries} para ${operation}`);
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
        this.logger.error(`retryableRequest: falha definitiva na operação ${operation}`, { error: lastError.message });
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