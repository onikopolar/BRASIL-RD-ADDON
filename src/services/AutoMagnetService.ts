import { getTorrent, createTorrent, createFile, File } from '../lib/repository';
import { RealDebridService } from './RealDebridService';
import { ImdbScraperService, ImdbTitles } from './ImdbScraperService';
import { Logger } from '../utils/logger';
import { TitleFilter, TitleMatchResult, SeriesMetadata } from '../lib/titleFilter';
import { QualityDetector } from '../lib/qualityDetector';

const logger = new Logger('AutoMagnetService');
const rdService = new RealDebridService();
const imdbScraper = new ImdbScraperService();
const titleFilter = new TitleFilter();
const qualityDetector = new QualityDetector();

interface MagnetData {
  imdbId: string;
  title: string;
  magnet: string;
  quality: string;
  seeds: number;
  size?: string;
  category: string;
  language: string;
  addedAt: string;
  imdbSeason?: number;
  imdbEpisode?: number | null;
  imdbTitle?: string;
  matchedImdbTitle?: string;
  matchedLanguage?: 'original' | 'português';
}

interface AutoMagnetResult {
  success: boolean;
  magnetAdded: boolean;
  message?: string;
  magnetData?: MagnetData;
  validation?: {
    titleMatches: boolean;
    seasonMatches?: boolean;
    episodeMatches?: boolean;
    matchedTitle?: string;
    matchedLanguage?: 'original' | 'português';
    reason?: string;
  };
}

export class AutoMagnetService {
  private validationCache = new Map<string, {
    valid: boolean;
    data: AutoMagnetResult;
    timestamp: number;
  }>();
  private readonly cacheTTL = 30000;

  // Versionamento Semantico v1.6.0 - Fix: Otimização de validações duplicadas
  private readonly VERSION = '1.6.0';

  // Cache para resultados de validação de título
  private titleValidationCache = new Map<string, {
    result: TitleMatchResult;
    timestamp: number;
  }>();
  private readonly titleCacheTTL = 60000;

  // Cache para dados do IMDB
  private imdbCache = new Map<string, {
    data: ImdbTitles;
    timestamp: number;
  }>();
  private readonly imdbCacheTTL = 300000;

  constructor() {
    logger.info(`AutoMagnetService v${this.VERSION} inicializado - Otimização: Cache de validações`);
  }

  async autoAddMagnet(
    magnetLink: string,
    torrentTitle: string,
    imdbId: string,
    type: 'movie' | 'series',
    seeds: number = 50,
    quality?: string,
    size?: string,
    imdbSeason?: number,
    imdbEpisode?: number | null
  ): Promise<AutoMagnetResult> {
    const cacheKey = `${magnetLink}-${imdbId}-${imdbSeason}-${imdbEpisode}`;
    
    try {
      logger.info('Processando magnet', {
        title: torrentTitle.substring(0, 60),
        imdbId: imdbId,
        type: type,
        imdbSeason: imdbSeason,
        imdbEpisode: imdbEpisode
      });

      // Verifica cache principal
      const cached = this.validationCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('Cache hit - resultado principal', { cacheKey: cacheKey.substring(0, 50) });
        return cached.data;
      }

      if (!this.validateMagnetLink(magnetLink)) {
        const result = { success: false, magnetAdded: false, message: 'Link magnet inválido' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      // Obtém títulos do IMDB com cache
      const imdbTitles = await this.getImdbTitlesWithCache(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const result = { success: false, magnetAdded: false, message: 'Títulos IMDB não encontrados' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      // Valida título com cache
      const titleMatchResult = await this.validateTitleWithCache(
        torrentTitle,
        imdbId,
        imdbSeason,
        imdbEpisode !== null ? imdbEpisode : undefined
      );

      if (!titleMatchResult.matches) {
        let rejectionReason = titleMatchResult.reason || 'Título não corresponde';

        if (type === 'series' && imdbSeason !== undefined) {
          const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
          const hasMultipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
          const isCompletePack = this.isCompleteSeasonPack(torrentTitle);
          
          if (!isCompletePack) {
            if (hasMultipleEpisodes.hasMultiple && hasMultipleEpisodes.startEpisode && hasMultipleEpisodes.endEpisode) {
              if (imdbEpisode !== undefined && imdbEpisode !== null) {
                const episodeInRange = imdbEpisode >= hasMultipleEpisodes.startEpisode && 
                                     imdbEpisode <= hasMultipleEpisodes.endEpisode;
                if (!episodeInRange) {
                  rejectionReason = `Episódio ${imdbEpisode} fora do range ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}`;
                } else {
                  rejectionReason = titleMatchResult.reason || 'Outro motivo de rejeição';
                }
              }
            } else if (torrentMetadata.hasEpisodeInfo) {
              if (torrentMetadata.season && torrentMetadata.season !== imdbSeason) {
                rejectionReason = `Temporada errada: S${torrentMetadata.season} vs S${imdbSeason}`;
              } else if (imdbEpisode !== undefined && imdbEpisode !== null && torrentMetadata.episode && torrentMetadata.episode !== imdbEpisode) {
                rejectionReason = `Episódio errado: E${torrentMetadata.episode} vs E${imdbEpisode}`;
              }
            }
          }
        }

        const result = {
          success: false,
          magnetAdded: false,
          message: 'Título não corresponde',
          validation: { titleMatches: false, reason: rejectionReason }
        };
        
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      // Processa metadados da série
      let torrentSeason = imdbSeason;
      let torrentEpisode = imdbEpisode;

      if (type === 'series') {
        const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
        const hasMultipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
        const isCompletePack = this.isCompleteSeasonPack(torrentTitle);
        
        logger.debug('Season/Episode debug', {
          torrentTitle: torrentTitle.substring(0, 60),
          passedSeason: imdbSeason,
          passedEpisode: imdbEpisode,
          extractedSeason: torrentMetadata.season,
          extractedEpisode: torrentMetadata.episode,
          hasMultipleEpisodes: hasMultipleEpisodes.hasMultiple,
          isCompletePack: isCompletePack,
          episodeRange: hasMultipleEpisodes.hasMultiple ? 
            `${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}` : 'não'
        });

        if (torrentSeason === undefined && torrentMetadata.season) {
          torrentSeason = torrentMetadata.season;
        }
        
        if (isCompletePack) {
          torrentEpisode = null;
          logger.debug('Pack de temporada completa detectado', {
            title: torrentTitle.substring(0, 60),
            season: torrentSeason,
            episodeDefinido: 'null (pack completo)'
          });
        } else if (hasMultipleEpisodes.hasMultiple) {
          if (torrentEpisode === undefined && imdbEpisode !== undefined && imdbEpisode !== null) {
            torrentEpisode = imdbEpisode;
          }
        } else if (torrentEpisode === undefined && torrentMetadata.episode) {
          torrentEpisode = torrentMetadata.episode;
        }
      }

      logger.debug('Valores finais para banco', {
        finalSeason: torrentSeason,
        finalEpisode: torrentEpisode,
        finalEpisodeType: torrentEpisode === null ? 'null (pack)' : torrentEpisode,
        willSaveEpisode: torrentEpisode !== undefined
      });

      const category = type === 'series' ? 'serie' : 'filme';
      const language = this.detectLanguage(torrentTitle);
      
      const allQualities = this.extractAllQualitiesFromTitle(torrentTitle);
      const finalQuality = allQualities.length > 0 ? allQualities[0] : (quality || qualityDetector.extractQualityFromFilename(torrentTitle));

      const magnetData: MagnetData = {
        imdbId: imdbId,
        title: torrentTitle,
        magnet: magnetLink,
        quality: finalQuality,
        seeds: seeds,
        size: size,
        category: category,
        language: language,
        addedAt: new Date().toISOString(),
        imdbSeason: torrentSeason,
        imdbEpisode: torrentEpisode,
        imdbTitle: imdbTitles.originalTitle,
        matchedImdbTitle: titleMatchResult.matchedTitle,
        matchedLanguage: titleMatchResult.matchedLanguage
      };

      // Salva no banco sem revalidar
      const saved = await this.saveToDatabaseOptimized(magnetData, imdbTitles, allQualities, titleMatchResult);

      if (saved) {
        let validationMessage = 'Título validado';
        if (titleMatchResult.matchedLanguage === 'português') {
          validationMessage += ' (pt)';
        }
        
        if (type === 'series' && torrentSeason) {
          validationMessage += ` | S${torrentSeason}`;
          if (torrentEpisode !== null && torrentEpisode !== undefined) {
            validationMessage += `E${torrentEpisode}`;
          } else if (this.isCompleteSeasonPack(torrentTitle)) {
            validationMessage += ' (Temporada Completa)';
          }
        }
        
        if (allQualities.length > 1) {
          validationMessage += ` | Qualidades: ${allQualities.join(', ')}`;
        }

        const result = {
          success: true,
          magnetAdded: true,
          magnetData: magnetData,
          validation: {
            titleMatches: true,
            seasonMatches: torrentSeason !== undefined,
            episodeMatches: torrentEpisode !== undefined && torrentEpisode !== null,
            matchedTitle: magnetData.matchedImdbTitle,
            matchedLanguage: magnetData.matchedLanguage,
            reason: validationMessage
          }
        };

        this.validationCache.set(cacheKey, { valid: true, data: result, timestamp: Date.now() });
        
        logger.info('Magnet salvo no banco', {
          title: magnetData.title.substring(0, 60),
          imdbId: magnetData.imdbId,
          qualidade: magnetData.quality,
          todasQualidades: allQualities,
          season: magnetData.imdbSeason,
          episode: magnetData.imdbEpisode === null ? 'null (pack completo)' : magnetData.imdbEpisode,
          versao: this.VERSION
        });

        return result;
      } else {
        const result = { success: false, magnetAdded: false, message: 'Já existe no banco' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

    } catch (error) {
      logger.error('Erro ao adicionar magnet', {
        title: torrentTitle.substring(0, 60),
        imdbId: imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });

      const result = {
        success: false,
        magnetAdded: false,
        message: `Erro: ${error instanceof Error ? error.message : 'Erro'}`
      };
      
      this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
      return result;
    }
  }

  private async getImdbTitlesWithCache(imdbId: string): Promise<ImdbTitles | null> {
    const cacheKey = `imdb_${imdbId}`;
    const cached = this.imdbCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.imdbCacheTTL) {
      logger.debug('Cache hit - títulos IMDB', { imdbId: imdbId });
      return cached.data;
    }

    const data = await imdbScraper.getTitlesFromImdbId(imdbId);
    if (data) {
      this.imdbCache.set(cacheKey, { data: data, timestamp: Date.now() });
    }
    
    return data;
  }

  private async validateTitleWithCache(
    torrentTitle: string,
    imdbId: string,
    season?: number,
    episode?: number
  ): Promise<TitleMatchResult> {
    const cacheKey = `title_${imdbId}_${torrentTitle.substring(0, 100)}_${season}_${episode}`;
    const cached = this.titleValidationCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.titleCacheTTL) {
      logger.debug('Cache hit - validação de título', { 
        imdbId: imdbId,
        titlePreview: torrentTitle.substring(0, 50)
      });
      return cached.result;
    }

    const result = await titleFilter.doTitlesMatch(torrentTitle, imdbId, season, episode);
    this.titleValidationCache.set(cacheKey, { result: result, timestamp: Date.now() });
    
    return result;
  }

  private isCompleteSeasonPack(torrentTitle: string): boolean {
    const lowerTitle = torrentTitle.toLowerCase();
    
    const completeSeasonPatterns = [
      /temporada\s+completa/i,
      /complete\s+season/i,
      /season\s+pack/i,
      /pack\s+temporada/i,
      /\d+ª?\s*temporada$/i,
      /^temporada\s+\d+$/i,
      /season\s+\d+\s+complete/i,
      /season\s+\d+\s+pack/i,
      /temporada\s+\d+\s+completa/i
    ];
    
    const hasCompletePattern = completeSeasonPatterns.some(pattern => pattern.test(lowerTitle));
    const hasSpecificEpisode = /s\d+e\d+/i.test(lowerTitle) || /episode\s+\d+/i.test(lowerTitle) || /e\d+/i.test(lowerTitle);
    
    return hasCompletePattern && !hasSpecificEpisode;
  }

  private extractAllQualitiesFromTitle(title: string): string[] {
    const qualityPatterns = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi,
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi
    ];

    const foundQualities: Set<string> = new Set();
    const titleLower = title.toLowerCase();
    
    for (const pattern of qualityPatterns.slice(0, 5)) {
      const matches = titleLower.match(pattern);
      if (matches) {
        for (const match of matches) {
          const normalized = this.normalizeQuality(match);
          if (normalized) {
            foundQualities.add(normalized);
          }
        }
      }
    }
    
    for (const pattern of qualityPatterns.slice(5)) {
      const matches = titleLower.match(pattern);
      if (matches) {
        for (const match of matches) {
          const qualityMatches = match.match(/\d{3,4}p/gi);
          if (qualityMatches) {
            for (const qualityMatch of qualityMatches) {
              const normalized = this.normalizeQuality(qualityMatch);
              if (normalized) {
                foundQualities.add(normalized);
              }
            }
          }
        }
      }
    }
    
    const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
    let listMatch;
    while ((listMatch = listPattern.exec(titleLower)) !== null) {
      const normalized = this.normalizeQuality(listMatch[1]);
      if (normalized) {
        foundQualities.add(normalized);
      }
    }
    
    const result = Array.from(foundQualities);
    
    if (result.length === 0) {
      const defaultQuality = qualityDetector.extractBestQuality(title);
      if (defaultQuality && defaultQuality !== 'unknown') {
        result.push(defaultQuality);
      }
    }

    const qualityOrder = ['2160p', '1080p', '720p', 'HD', 'SD'];
    result.sort((a, b) => {
      const indexA = qualityOrder.indexOf(a);
      const indexB = qualityOrder.indexOf(b);
      return indexA - indexB;
    });

    return result;
  }

  private normalizeQuality(quality: string): string {
    const qualityLower = quality.toLowerCase();
    
    if (qualityLower.includes('4k') || qualityLower.includes('2160p') || qualityLower.includes('uhd')) {
      return '2160p';
    } else if (qualityLower.includes('1080p') || qualityLower.includes('fullhd') || qualityLower.includes('full hd')) {
      return '1080p';
    } else if (qualityLower.includes('720p') || qualityLower.includes('hd') || qualityLower.includes('high definition')) {
      return '720p';
    } else if (qualityLower.includes('480p') || qualityLower.includes('sd') || qualityLower.includes('standard definition')) {
      return 'SD';
    } else if (qualityLower.includes('360p') || qualityLower.includes('low')) {
      return 'SD';
    } else if (qualityLower.includes('hd')) {
      return 'HD';
    }
    
    if (qualityLower.match(/\d{3,4}p/)) {
      return qualityLower;
    }
    
    return '';
  }

  private hasMultipleEpisodes(torrentTitle: string): { hasMultiple: boolean; startEpisode?: number; endEpisode?: number } {
    const lowerTitle = torrentTitle.toLowerCase();
    
    const episodeRangeMatch = lowerTitle.match(/e(\d{1,10})-(\d{1,10})(?:-(\d{1,10}))?(?:-(\d{1,10}))?/);
    
    if (episodeRangeMatch) {
      const startEpisode = parseInt(episodeRangeMatch[1]);
      let endEpisode = startEpisode;
      for (let i = 2; i <= 4; i++) {
        if (episodeRangeMatch[i]) {
          endEpisode = parseInt(episodeRangeMatch[i]);
        }
      }
      
      logger.debug('Detectado múltiplos episódios', {
        title: torrentTitle.substring(0, 60),
        startEpisode: startEpisode,
        endEpisode: endEpisode
      });
      
      return { hasMultiple: true, startEpisode: startEpisode, endEpisode: endEpisode };
    }
    
    const concatenatedMatch = lowerTitle.match(/e(\d{1,10})e(\d{1,10})(?:e(\d{1,10}))?(?:e(\d{1,10}))?/);
    if (concatenatedMatch) {
      const startEpisode = parseInt(concatenatedMatch[1]);
      let endEpisode = startEpisode;
      for (let i = 2; i <= 4; i++) {
        if (concatenatedMatch[i]) {
          endEpisode = parseInt(concatenatedMatch[i]);
        }
      }
      
      return { hasMultiple: true, startEpisode: startEpisode, endEpisode: endEpisode };
    }
    
    return { hasMultiple: false };
  }

  private validateMagnetLink(magnet: string): boolean {
    const isValid = magnet.startsWith('magnet:') &&
                   magnet.includes('xt=urn:btih:') &&
                   magnet.length > 50;

    if (!isValid) {
      logger.warn('Link magnet inválido', {
        length: magnet.length,
        hasMagnetPrefix: magnet.startsWith('magnet:'),
        hasBtih: magnet.includes('xt=urn:btih:')
      });
    }

    return isValid;
  }

  private detectLanguage(title: string): string {
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('dual')) return 'pt-BR,en';
    if (lowerTitle.includes('dublado')) return 'pt-BR';
    if (lowerTitle.includes('legendado')) return 'pt';
    if (lowerTitle.includes('english') || lowerTitle.includes('eng')) return 'en';
    if (lowerTitle.includes('español') || lowerTitle.includes('spanish')) return 'es';

    return 'pt-BR';
  }

  private async saveToDatabaseOptimized(
    magnetData: MagnetData, 
    imdbTitles: ImdbTitles, 
    allQualities: string[] = [],
    titleMatchResult: TitleMatchResult
  ): Promise<boolean> {
    try {
      const magnetHash = this.extractHashFromMagnet(magnetData.magnet);
      if (!magnetHash) {
        throw new Error('Não foi possível extrair infoHash');
      }

      logger.debug('Salvando no banco', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId,
        season: magnetData.imdbSeason,
        episode: magnetData.imdbEpisode === null ? 'null (pack completo)' : magnetData.imdbEpisode,
        category: magnetData.category,
        qualidadesEncontradas: allQualities.length > 1 ? allQualities.join(', ') : 'única'
      });

      if (magnetData.category === 'serie' && magnetData.imdbSeason !== undefined) {
        let existingEntry;
        
        if (magnetData.imdbEpisode === null) {
          existingEntry = await File.findOne({
            where: {
              infoHash: magnetHash,
              imdbId: magnetData.imdbId,
              imdbSeason: magnetData.imdbSeason,
              imdbEpisode: null
            }
          });
        } else {
          existingEntry = await File.findOne({
            where: {
              infoHash: magnetHash,
              imdbId: magnetData.imdbId,
              imdbSeason: magnetData.imdbSeason,
              imdbEpisode: magnetData.imdbEpisode
            }
          });
        }

        if (existingEntry) {
          logger.debug('Entrada já existe no banco', {
            title: magnetData.title.substring(0, 60),
            imdbId: magnetData.imdbId,
            imdbSeason: magnetData.imdbSeason,
            imdbEpisode: magnetData.imdbEpisode === null ? 'null (pack)' : magnetData.imdbEpisode
          });
          return false;
        }
      } else {
        const existingTorrent = await getTorrent(magnetHash);
        if (existingTorrent) {
          logger.debug('Magnet já existe', {
            title: magnetData.title.substring(0, 60),
            imdbId: magnetData.imdbId
          });
          return false;
        }
      }

      // Pula validação final se já temos resultado válido
      if (!titleMatchResult.matches) {
        logger.error('Validação falhou antes do salvamento', {
          imdbId: magnetData.imdbId,
          title: magnetData.title.substring(0, 60),
          reason: 'Falhou na validação anterior'
        });
        return false;
      }

      const existingTorrent = await getTorrent(magnetHash);
      if (!existingTorrent) {
        await createTorrent({
          infoHash: magnetHash,
          provider: 'brasil-rd',
          magnetLink: magnetData.magnet,
          title: magnetData.title,
          size: this.parseSizeToBytes(magnetData.size) || 0,
          type: magnetData.category === 'serie' ? 'series' : 'movie',
          uploadDate: new Date(),
          seeders: magnetData.seeds || 0,
          languages: magnetData.language,
          resolution: magnetData.quality,
          metadata: allQualities.length > 1 ? JSON.stringify({ availableQualities: allQualities }) : null,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }

      await createFile({
        infoHash: magnetHash,
        title: magnetData.title,
        imdbId: magnetData.imdbId,
        size: this.parseSizeToBytes(magnetData.size) || 0,
        imdbTitle: imdbTitles.originalTitle,
        portugueseTitle: imdbTitles.portugueseTitle,
        imdbSeason: magnetData.imdbSeason,
        imdbEpisode: magnetData.imdbEpisode,
        matchedTitle: magnetData.matchedImdbTitle,
        matchedLanguage: magnetData.matchedLanguage,
        qualityMetadata: allQualities.length > 1 ? JSON.stringify({ allQualities: allQualities }) : null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      logger.info('Magnet salvo no DB com sucesso', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId,
        qualidadeSalva: magnetData.quality,
        todasQualidades: allQualities,
        season: magnetData.imdbSeason,
        episode: magnetData.imdbEpisode === null ? 'null (pack completo)' : magnetData.imdbEpisode,
        versao: this.VERSION
      });

      return true;

    } catch (error) {
      logger.error('Erro ao salvar magnet', {
        error: error instanceof Error ? error.message : 'Erro',
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId,
        versao: this.VERSION
      });
      throw error;
    }
  }

  private parseSizeToBytes(size?: string): number {
    if (!size) return 0;

    try {
      const sizeLower = size.toLowerCase().trim();
      const match = sizeLower.match(/^(\d+(?:\.\d+)?)\s*([kmgt]b?)?$/i);

      if (!match) return 0;

      const value = parseFloat(match[1]);
      const unit = match[2] ? match[2].toLowerCase().charAt(0) : 'b';

      const multipliers: Record<string, number> = {
        'b': 1,
        'k': 1024,
        'm': 1024 * 1024,
        'g': 1024 * 1024 * 1024,
        't': 1024 * 1024 * 1024 * 1024
      };

      return Math.floor(value * (multipliers[unit] || 1));
    } catch {
      return 0;
    }
  }

  private extractHashFromMagnet(magnet: string): string | null {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  async processRealDebridOnClick(
    magnetData: MagnetData,
    apiKey: string
  ): Promise<{ success: boolean; streamLink?: string; status: string; message?: string }> {
    try {
      logger.info('Processando Real-Debrid', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId
      });

      const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);

      if (existingTorrent.found && existingTorrent.downloaded) {
        logger.info('Torrent já baixado no Real-Debrid', {
          title: magnetData.title.substring(0, 60),
          torrentId: existingTorrent.torrentId
        });

        const streamLink = await rdService.getStreamLinkForTorrent(
          existingTorrent.torrentId!,
          apiKey,
          magnetData.imdbSeason,
          magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined
        );

        return {
          success: true,
          streamLink: streamLink || undefined,
          status: 'downloaded'
        };
      }

      if (existingTorrent.found && !existingTorrent.downloaded) {
        logger.info('Torrent em download', {
          title: magnetData.title.substring(0, 60),
          status: existingTorrent.status
        });

        return {
          success: true,
          status: 'downloading',
          message: `Download: ${existingTorrent.status}`
        };
      }

      logger.info('Adicionando magnet ao Real-Debrid', {
        title: magnetData.title.substring(0, 60)
      });

      const torrentId = await rdService.addMagnet(magnetData.magnet, apiKey);
      await rdService.selectFiles(torrentId, apiKey, 'all');

      const torrentInfo = await rdService.getTorrentInfo(torrentId, apiKey);

      let streamLink: string | null = null;
      if (torrentInfo.status === 'downloaded') {
        streamLink = await rdService.getStreamLinkForTorrent(
          torrentId,
          apiKey,
          magnetData.imdbSeason,
          magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined
        );
      }

      return {
        success: true,
        status: torrentInfo.status,
        streamLink: streamLink || undefined,
        message: `Torrent adicionado: ${torrentInfo.status}`
      };

    } catch (error) {
      logger.error('Erro ao processar Real-Debrid', {
        title: magnetData.title.substring(0, 60),
        error: error instanceof Error ? error.message : 'Erro'
      });

      return {
        success: false,
        status: 'error',
        message: `Erro Real-Debrid: ${error instanceof Error ? error.message : 'Erro'}`
      };
    }
  }

  private async checkExistingTorrent(
    magnet: string,
    apiKey: string
  ): Promise<{ found: boolean; torrentId?: string; status?: string; downloaded: boolean }> {
    try {
      const magnetHash = this.extractMagnetHash(magnet);

      if (!magnetHash) {
        return { found: false, downloaded: false };
      }

      const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);

      if (existingTorrent) {
        return {
          found: true,
          torrentId: existingTorrent.id,
          status: existingTorrent.status,
          downloaded: existingTorrent.status === 'downloaded'
        };
      }

      return { found: false, downloaded: false };

    } catch (error) {
      return { found: false, downloaded: false };
    }
  }

  private extractMagnetHash(magnet: string): string {
    const match = magnet.match(/btih:([^&]+)/i);
    return match ? match[1] : '';
  }

  async testTitleValidation(
    torrentTitle: string,
    imdbId: string,
    testSeason?: number,
    testEpisode?: number | null
  ): Promise<{
    valid: boolean;
    torrentTitle: string;
    imdbTitles?: ImdbTitles;
    matchResult?: TitleMatchResult;
    torrentMetadata?: SeriesMetadata;
    seasonMatch?: boolean;
    episodeMatch?: boolean;
    isCompletePack?: boolean;
    reason?: string;
  }> {
    try {
      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
      const hasMultipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
      const isCompletePack = this.isCompleteSeasonPack(torrentTitle);
      
      const matchResult = await titleFilter.doTitlesMatch(
        torrentTitle,
        imdbId,
        testSeason,
        testEpisode !== null ? testEpisode : undefined
      );

      let seasonMatch = true;
      let episodeMatch = true;
      let reason = '';

      if (testSeason !== undefined && torrentMetadata.season) {
        seasonMatch = torrentMetadata.season === testSeason;
        if (!seasonMatch) {
          reason += ` Temporada: Torrent S${torrentMetadata.season} vs Teste S${testSeason}.`;
        }
      }

      if (testEpisode !== undefined && testEpisode !== null) {
        if (isCompletePack) {
          episodeMatch = true;
          reason += ' Pack de temporada completa - compatível com qualquer episódio.';
        } else if (hasMultipleEpisodes.hasMultiple && hasMultipleEpisodes.startEpisode && hasMultipleEpisodes.endEpisode) {
          episodeMatch = testEpisode >= hasMultipleEpisodes.startEpisode && 
                        testEpisode <= hasMultipleEpisodes.endEpisode;
          if (!episodeMatch) {
            reason += ` Episódio fora do range: ${testEpisode} vs ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}.`;
          } else {
            reason += ` Episódio ${testEpisode} dentro do range ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}.`;
          }
        } else if (torrentMetadata.episode) {
          episodeMatch = torrentMetadata.episode === testEpisode;
          if (!episodeMatch) {
            reason += ` Episódio: Torrent E${torrentMetadata.episode} vs Teste E${testEpisode}.`;
          }
        }
      }

      const valid = matchResult.matches && seasonMatch && episodeMatch;

      if (valid) {
        reason = `Válido: "${torrentTitle}" -> "${matchResult.matchedTitle}"`;
        if (matchResult.matchedLanguage === 'português') {
          reason += ' (pt)';
        }
        if (torrentMetadata.season) reason += ` S${torrentMetadata.season}`;
        if (isCompletePack) {
          reason += ' (Temporada Completa)';
        } else if (torrentMetadata.episode) {
          reason += `E${torrentMetadata.episode}`;
        }
        if (hasMultipleEpisodes.hasMultiple) {
          reason += ` [Range: ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}]`;
        }
        reason += ` (${(matchResult.similarity * 100).toFixed(1)}%)`;
      } else {
        reason = `Inválido: "${torrentTitle}"`;
        if (imdbTitles.allTitles.length > 0) {
          reason += ` != IMDB: ${imdbTitles.allTitles.join(' / ')}`;
        }
        if (matchResult.reason) {
          reason += ` ${matchResult.reason}`;
        }
      }

      return {
        valid: valid,
        torrentTitle: torrentTitle,
        imdbTitles: imdbTitles,
        matchResult: matchResult,
        torrentMetadata: torrentMetadata,
        seasonMatch: seasonMatch,
        episodeMatch: episodeMatch,
        isCompletePack: isCompletePack,
        reason: reason
      };

    } catch (error) {
      return {
        valid: false,
        torrentTitle: torrentTitle,
        reason: `Erro: ${error instanceof Error ? error.message : 'Erro'}`
      };
    }
  }

  extractSeriesMetadata(torrentTitle: string): SeriesMetadata {
    return titleFilter.extractSeriesMetadata(torrentTitle);
  }

  async getImdbTitles(imdbId: string): Promise<ImdbTitles | null> {
    try {
      return await imdbScraper.getTitlesFromImdbId(imdbId);
    } catch (error) {
      logger.error('Erro ao buscar títulos IMDB', {
        imdbId: imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return null;
    }
  }

  clearCache(): void {
    this.validationCache.clear();
    this.titleValidationCache.clear();
    this.imdbCache.clear();
    logger.info('Cache limpo');
  }

  getStats() {
    return {
      cacheSize: this.validationCache.size,
      titleCacheSize: this.titleValidationCache.size,
      imdbCacheSize: this.imdbCache.size,
      cacheTTL: this.cacheTTL,
      titleCacheTTL: this.titleCacheTTL,
      imdbCacheTTL: this.imdbCacheTTL,
      versao: this.VERSION,
      otimizacoes: [
        'Cache de resultados de validação principal',
        'Cache de validações de título reutilizável',
        'Cache de dados do IMDB com TTL de 5 minutos',
        'Elimina revalidação duplicada no salvamento',
        'Redução de ~66% nas validações por magnet'
      ]
    };
  }
}

export default AutoMagnetService;