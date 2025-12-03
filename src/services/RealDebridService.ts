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
  private readonly videoExtensions: string[] = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
  ];

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
   * ✅ MÉTODO CORRIGIDO: Agora aceita season/episode para seleção específica
   * Se season/episode forem fornecidos, tenta encontrar o episódio exato
   * Caso contrário, usa a lógica inteligente padrão
   */
  async getStreamLinkForTorrent(
    torrentId: string, 
    apiKey: string,
    targetSeason?: number,    // ✅ NOVO: Temporada desejada (opcional)
    targetEpisode?: number    // ✅ NOVO: Episódio desejado (opcional)
  ): Promise<string | null> {
    this.validateTorrentId(torrentId);

    try {
      // 🔍 DEBUG 1: Obter informações do torrent
      this.logger.info('🔍 [DEBUG CRÍTICO] Iniciando seleção de arquivo', { 
        torrentId,
        targetSeason,
        targetEpisode 
      });
      
      const torrentInfo = await this.getTorrentInfo(torrentId, apiKey);
      
      if (torrentInfo.status !== 'downloaded') {
        this.logger.warn('❌ [DEBUG CRÍTICO] Torrent não está baixado', {
          torrentId,
          status: torrentInfo.status
        });
        return null;
      }

      if (!torrentInfo.links || torrentInfo.links.length === 0) {
        this.logger.warn('❌ [DEBUG CRÍTICO] Nenhum link disponível', { torrentId });
        return null;
      }

      // 🔍 DEBUG 2: Listar todos os arquivos
      const files = torrentInfo.files || [];
      const selectedFiles = files.filter(file => file.selected === 1);
      
      this.logger.info('📊 [DEBUG CRÍTICO] Arquivos no torrent', {
        torrentId,
        totalFiles: files.length,
        selectedFiles: selectedFiles.length
      });

      if (selectedFiles.length === 0) {
        this.logger.warn('❌ [DEBUG CRÍTICO] Nenhum arquivo selecionado', { torrentId });
        return null;
      }

      // 🔍 DEBUG 3: FILTRO INTELIGENTE - Lógica melhorada
      let bestFileIndex = -1;
      let bestScore = 0;
      const candidateFiles: Array<{index: number, path: string, bytes: number, reason: string}> = [];

      // Palavras-chave de propaganda PURA (arquivos que são APENAS propaganda)
      const purePromoKeywords = [
        '1xbet', 'betano', 'blaze', 'estrela bet', 'betway', 'pixbet',
        'promo', 'propaganda', 'publicidade', 'advertisement', 'sample'
      ];

      // Palavras-chave que podem estar em nomes legítimos (mas verificar contexto)
      const toleratedKeywords = [
        'bludv.tv', 'torrentdosfilmes', 'www.', '.tv', 'acesso'
      ];

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileName = file.path.toLowerCase();
        const fileNameUpper = file.path.toUpperCase();
        
        // REGRA 1: Ignorar arquivos MUITO pequenos (< 100MB não é episódio)
        if (file.bytes < 100 * 1024 * 1024) {
          candidateFiles.push({
            index: i,
            path: file.path,
            bytes: file.bytes,
            reason: `REJEITADO: Muito pequeno (${(file.bytes / (1024*1024)).toFixed(1)}MB)`
          });
          continue;
        }
        
        // REGRA 2: Verificar se é arquivo de vídeo
        const isVideo = this.videoExtensions.some(ext => fileName.endsWith(ext));
        if (!isVideo) {
          candidateFiles.push({
            index: i,
            path: file.path,
            bytes: file.bytes,
            reason: 'REJEITADO: Não é arquivo de vídeo'
          });
          continue;
        }
        
        // REGRA 3: Verificar se é propaganda PURA
        let isPurePromo = false;
        for (const keyword of purePromoKeywords) {
          if (fileName.includes(keyword) && !this.hasEpisodeIndicators(fileName)) {
            isPurePromo = true;
            candidateFiles.push({
              index: i,
              path: file.path,
              bytes: file.bytes,
              reason: `REJEITADO: Propaganda pura (${keyword})`
            });
            break;
          }
        }
        if (isPurePromo) continue;
        
        // REGRA 4: Verificar se parece ser um episódio/série
        const hasEpisodeIndicators = this.hasEpisodeIndicators(fileName);
        if (!hasEpisodeIndicators) {
          candidateFiles.push({
            index: i,
            path: file.path,
            bytes: file.bytes,
            reason: 'REJEITADO: Sem indicadores de episódio'
          });
          continue;
        }
        
        // ✅ ARQUIVO VÁLIDO - Calcular SCORE
        let score = file.bytes; // Base: tamanho (maior = melhor)
        
        // ✅ BÔNUS GIGANTE se for o episódio EXATO solicitado
        if (targetSeason !== undefined && targetEpisode !== undefined) {
          const fileSeason = this.extractSeasonFromFileName(file.path);
          const fileEpisode = this.extractEpisodeFromFileName(file.path);
          
          if (fileSeason === targetSeason && fileEpisode === targetEpisode) {
            // PRIORIDADE MÁXIMA para o episódio exato solicitado!
            score += 10000000000; // +10GB "virtuais"
            candidateFiles.push({
              index: i,
              path: file.path,
              bytes: file.bytes,
              reason: `🎯 EPISÓDIO EXATO! S${targetSeason}E${targetEpisode} - Score=${(score/1000000000).toFixed(2)}GB`
            });
            
            // Seleciona imediatamente e pula o resto da análise
            bestFileIndex = i;
            bestScore = score;
            break; // Para o loop, encontramos o episódio exato!
          }
        }
        
        // Bônus por qualidade
        if (fileName.includes('1080p') || fileName.includes('4k') || fileName.includes('2160p')) {
          score += 200000000; // +200MB "virtuais"
        } else if (fileName.includes('720p')) {
          score += 100000000; // +100MB "virtuais"
        }
        
        // Bônus por áudio dublado/dual
        if (fileName.includes('dual') || fileName.includes('dublado') || fileName.includes('dub')) {
          score += 150000000; // +150MB "virtuais"
        }
        
        // Bônus por ser MKV (geralmente melhor qualidade)
        if (fileName.endsWith('.mkv')) {
          score += 50000000; // +50MB "virtuais"
        }
        
        // Penalidade por ter domínio no nome (mas ainda aceita)
        for (const keyword of toleratedKeywords) {
          if (fileName.includes(keyword)) {
            score -= 10000000; // -10MB "virtuais"
            break;
          }
        }
        
        candidateFiles.push({
          index: i,
          path: file.path,
          bytes: file.bytes,
          reason: `CANDIDATO: Score=${(score/1000000000).toFixed(2)}GB`
        });

        if (score > bestScore) {
          bestScore = score;
          bestFileIndex = i;
        }
      }

      // 🔍 DEBUG 4: Mostrar análise dos arquivos
      this.logger.info('📋 [DEBUG CRÍTICO] Análise dos arquivos', {
        torrentId,
        bestFileIndex,
        bestFileScore: bestScore,
        bestFileName: bestFileIndex >= 0 ? selectedFiles[bestFileIndex]?.path : 'Nenhum',
        targetSeason,
        targetEpisode,
        totalCandidates: candidateFiles.filter(c => c.reason.includes('CANDIDATO')).length,
        candidateFiles: candidateFiles
      });

      if (bestFileIndex === -1) {
        this.logger.warn('⚠️ [DEBUG CRÍTICO] Nenhum arquivo de vídeo válido encontrado. Usando primeiro arquivo como fallback.');
        bestFileIndex = 0;
      }

      // Verificar se o índice está dentro dos limites
      if (bestFileIndex >= torrentInfo.links.length) {
        this.logger.warn('⚠️ [DEBUG CRÍTICO] Índice fora do range. Corrigindo para primeiro link.');
        bestFileIndex = 0;
      }

      // 🔍 DEBUG 5: Obter link final
      const selectedLink = torrentInfo.links[bestFileIndex];
      const selectedFile = selectedFiles[bestFileIndex];
      
      this.logger.info('🎯 [DEBUG CRÍTICO] Arquivo selecionado para streaming', {
        torrentId,
        fileIndex: bestFileIndex,
        fileName: selectedFile?.path || 'Desconhecido',
        fileSizeMB: selectedFile ? Math.round(selectedFile.bytes / (1024*1024)) : 0,
        fileSizeGB: selectedFile ? (selectedFile.bytes / (1024*1024*1024)).toFixed(2) : '0',
        score: bestScore,
        linkIndex: bestFileIndex,
        totalLinks: torrentInfo.links.length,
        targetSeason,
        targetEpisode,
        isExactMatch: (targetSeason !== undefined && targetEpisode !== undefined) ? 
          `S${targetSeason}E${targetEpisode}` : 'Não especificado'
      });

      const directLink = await this.unrestrictLink(selectedLink, apiKey);
      
      this.logger.info('✅ [DEBUG CRÍTICO] Stream link obtido com sucesso', {
        torrentId,
        directLink: this.sanitizeLink(directLink),
        fileName: selectedFile?.path || 'Desconhecido',
        fileType: this.getFileType(selectedFile?.path || ''),
        estimatedQuality: this.estimateQuality(selectedFile?.path || ''),
        targetSeason: targetSeason !== undefined ? `S${targetSeason}` : 'Não especificado',
        targetEpisode: targetEpisode !== undefined ? `E${targetEpisode}` : 'Não especificado',
        isExactMatch: this.isExactMatch(selectedFile?.path || '', targetSeason, targetEpisode)
      });
      
      return directLink;

    } catch (error) {
      this.logger.error('❌ [DEBUG CRÍTICO] Falha ao obter stream link', {
        torrentId,
        targetSeason,
        targetEpisode,
        error: this.getErrorMessage(error)
      });
      return null;
    }
  }

  /**
   * Extrai temporada do nome do arquivo
   */
  private extractSeasonFromFileName(fileName: string): number | undefined {
    const lowerName = fileName.toLowerCase();
    
    // Padrão S03E08
    const sPattern = /s(\d+)e\d+/i;
    const sMatch = lowerName.match(sPattern);
    if (sMatch && sMatch[1]) {
      return parseInt(sMatch[1], 10);
    }
    
    // Padrão Season 3 Episode 8
    const seasonPattern = /season\s*(\d+)\s*episode/i;
    const seasonMatch = lowerName.match(seasonPattern);
    if (seasonMatch && seasonMatch[1]) {
      return parseInt(seasonMatch[1], 10);
    }
    
    // Padrão 3x08
    const xPattern = /(\d+)x\d+/i;
    const xMatch = lowerName.match(xPattern);
    if (xMatch && xMatch[1]) {
      return parseInt(xMatch[1], 10);
    }
    
    return undefined;
  }

  /**
   * Extrai episódio do nome do arquivo
   */
  private extractEpisodeFromFileName(fileName: string): number | undefined {
    const lowerName = fileName.toLowerCase();
    
    // Padrão S03E08
    const ePattern = /s\d+e(\d+)/i;
    const eMatch = lowerName.match(ePattern);
    if (eMatch && eMatch[1]) {
      return parseInt(eMatch[1], 10);
    }
    
    // Padrão Season 3 Episode 8
    const episodePattern = /season\s*\d+\s*episode\s*(\d+)/i;
    const episodeMatch = lowerName.match(episodePattern);
    if (episodeMatch && episodeMatch[1]) {
      return parseInt(episodeMatch[1], 10);
    }
    
    // Padrão 3x08
    const xPattern = /\d+x(\d+)/i;
    const xMatch = lowerName.match(xPattern);
    if (xMatch && xMatch[1]) {
      return parseInt(xMatch[1], 10);
    }
    
    // Padrão Ep 08
    const epPattern = /ep\s*(\d+)/i;
    const epMatch = lowerName.match(epPattern);
    if (epMatch && epMatch[1]) {
      return parseInt(epMatch[1], 10);
    }
    
    return undefined;
  }

  /**
   * Verifica se é uma correspondência exata
   */
  private isExactMatch(fileName: string, targetSeason?: number, targetEpisode?: number): string {
    if (targetSeason === undefined || targetEpisode === undefined) {
      return 'Não aplicável';
    }
    
    const fileSeason = this.extractSeasonFromFileName(fileName);
    const fileEpisode = this.extractEpisodeFromFileName(fileName);
    
    if (fileSeason === targetSeason && fileEpisode === targetEpisode) {
      return `✅ EXATO! S${targetSeason}E${targetEpisode}`;
    } else if (fileSeason === targetSeason) {
      return `⚠️ Temporada correta (S${targetSeason}), mas episódio ${fileEpisode || '?'} vs ${targetEpisode}`;
    } else if (fileEpisode === targetEpisode) {
      return `⚠️ Episódio correto (E${targetEpisode}), mas temporada ${fileSeason || '?'} vs ${targetSeason}`;
    } else {
      return `❌ Diferente: S${fileSeason || '?'}E${fileEpisode || '?'} vs S${targetSeason}E${targetEpisode}`;
    }
  }

  /**
   * Verifica se o nome do arquivo contém indicadores de episódio
   */
  private hasEpisodeIndicators(fileName: string): boolean {
    const lowerName = fileName.toLowerCase();
    
    // Padrões de episódio de série
    const episodePatterns = [
      /s\d+e\d+/i,           // S03E08
      /season\s*\d+\s*episode\s*\d+/i, // Season 3 Episode 8
      /episode\s*\d+/i,      // Episode 8
      /\d+x\d+/i,            // 3x08
      /ep\s*\d+/i,           // Ep 08
      /part\s*\d+/i,         // Part 1
      /pt\.\s*\d+/i,         // Pt.1
      /\s+\d+\s+of\s+\d+/i,  // 1 of 10
    ];
    
    // Verificar padrões
    for (const pattern of episodePatterns) {
      if (pattern.test(lowerName)) {
        return true;
      }
    }
    
    // Verificar nomes comuns de filmes/séries
    const commonIndicators = [
      'stranger things',
      'game of thrones',
      'breaking bad',
      'the walking dead',
      'friends',
      'the office',
      'completa',
      'temporada',
      'complete',
      'season'
    ];
    
    for (const indicator of commonIndicators) {
      if (lowerName.includes(indicator)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Estima a qualidade baseada no nome do arquivo
   */
  private estimateQuality(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    
    if (lowerName.includes('4k') || lowerName.includes('2160p') || lowerName.includes('uhd')) {
      return '4K';
    } else if (lowerName.includes('1080p') || lowerName.includes('fhd')) {
      return '1080p';
    } else if (lowerName.includes('720p') || lowerName.includes('hd')) {
      return '720p';
    } else if (lowerName.includes('480p') || lowerName.includes('sd')) {
      return '480p';
    }
    
    return 'Desconhecida';
  }

  /**
   * Obtém tipo de arquivo baseado na extensão
   */
  private getFileType(fileName: string): string {
    const lowerName = fileName.toLowerCase();
    
    if (lowerName.endsWith('.mkv')) return 'MKV';
    if (lowerName.endsWith('.mp4')) return 'MP4';
    if (lowerName.endsWith('.avi')) return 'AVI';
    if (lowerName.endsWith('.mov')) return 'MOV';
    if (lowerName.endsWith('.webm')) return 'WebM';
    
    return 'Outro';
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