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
  imdbEpisode?: number;
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

  // Versionamento Semantico v1.4.0 - Detecta todas qualidades do torrent
  private readonly VERSION = '1.4.0';

  constructor() {
    logger.info(`AutoMagnetService v${this.VERSION} inicializado - Detecta todas qualidades do torrent`);
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
    imdbEpisode?: number
  ): Promise<AutoMagnetResult> {
    const cacheKey = `${magnetLink}-${imdbId}-${imdbSeason}-${imdbEpisode}`;
    
    try {
      logger.info('Processando magnet', {
        title: torrentTitle.substring(0, 60),
        imdbId,
        type,
        imdbSeason,
        imdbEpisode
      });

      const cached = this.validationCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        logger.debug('Cache hit', { cacheKey });
        return cached.data;
      }

      if (!this.validateMagnetLink(magnetLink)) {
        const result = { success: false, magnetAdded: false, message: 'Link magnet invalido' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const result = { success: false, magnetAdded: false, message: 'Titulos IMDB nao encontrados' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      const titleMatchResult = await titleFilter.doTitlesMatch(
        torrentTitle,
        imdbId,
        imdbSeason,
        imdbEpisode
      );

      if (!titleMatchResult.matches) {
        let rejectionReason = titleMatchResult.reason || 'Titulo nao corresponde';

        if (type === 'series' && imdbSeason !== undefined) {
          const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
          const hasMultipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
          
          if (hasMultipleEpisodes.hasMultiple && hasMultipleEpisodes.startEpisode && hasMultipleEpisodes.endEpisode) {
            if (imdbEpisode !== undefined) {
              const episodeInRange = imdbEpisode >= hasMultipleEpisodes.startEpisode && 
                                   imdbEpisode <= hasMultipleEpisodes.endEpisode;
              if (!episodeInRange) {
                rejectionReason = `Episodio ${imdbEpisode} fora do range ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}`;
              } else {
                rejectionReason = titleMatchResult.reason || 'Outro motivo de rejeicao';
              }
            }
          } else if (torrentMetadata.hasEpisodeInfo) {
            if (torrentMetadata.season && torrentMetadata.season !== imdbSeason) {
              rejectionReason = `Temporada errada: S${torrentMetadata.season} vs S${imdbSeason}`;
            } else if (imdbEpisode !== undefined && torrentMetadata.episode && torrentMetadata.episode !== imdbEpisode) {
              rejectionReason = `Episodio errado: E${torrentMetadata.episode} vs E${imdbEpisode}`;
            }
          }
        }

        const result = {
          success: false,
          magnetAdded: false,
          message: 'Titulo nao corresponde',
          validation: { titleMatches: false, reason: rejectionReason }
        };
        
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      let torrentSeason = imdbSeason;
      let torrentEpisode = imdbEpisode;

      if (type === 'series') {
        const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
        const hasMultipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
        
        logger.debug('Season/Episode debug', {
          torrentTitle: torrentTitle.substring(0, 60),
          passedSeason: imdbSeason,
          passedEpisode: imdbEpisode,
          extractedSeason: torrentMetadata.season,
          extractedEpisode: torrentMetadata.episode,
          hasMultipleEpisodes: hasMultipleEpisodes.hasMultiple,
          episodeRange: hasMultipleEpisodes.hasMultiple ? 
            `${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}` : 'nao'
        });

        if (torrentSeason === undefined && torrentMetadata.season) {
          torrentSeason = torrentMetadata.season;
        }
        
        if (hasMultipleEpisodes.hasMultiple) {
          if (torrentEpisode === undefined && imdbEpisode !== undefined) {
            torrentEpisode = imdbEpisode;
          }
        } else if (torrentEpisode === undefined && torrentMetadata.episode) {
          torrentEpisode = torrentMetadata.episode;
        }
      }

      logger.debug('Valores finais', {
        finalSeason: torrentSeason,
        finalEpisode: torrentEpisode,
        willSaveEpisode: torrentEpisode !== undefined
      });

      const category = type === 'series' ? 'serie' : 'filme';
      const language = this.detectLanguage(torrentTitle);
      
      // VERSÃO 1.4.0: Extrai TODAS qualidades do torrent (720p e 1080p)
      const allQualities = this.extractAllQualitiesFromTitle(torrentTitle);
      const finalQuality = allQualities.length > 0 ? allQualities[0] : (quality || qualityDetector.extractQualityFromFilename(torrentTitle));

      const magnetData: MagnetData = {
        imdbId,
        title: torrentTitle,
        magnet: magnetLink,
        quality: finalQuality,
        seeds,
        size,
        category,
        language,
        addedAt: new Date().toISOString(),
        imdbSeason: torrentSeason,
        imdbEpisode: torrentEpisode,
        imdbTitle: imdbTitles.originalTitle,
        matchedImdbTitle: titleMatchResult.matchedTitle,
        matchedLanguage: titleMatchResult.matchedLanguage
      };

      // VERSÃO 1.4.0: Salva registro no banco indicando qualidades disponiveis
      const saved = await this.saveToDatabase(magnetData, imdbTitles, allQualities);

      if (saved) {
        let validationMessage = 'Titulo validado';
        if (titleMatchResult.matchedLanguage === 'português') {
          validationMessage += ' (pt)';
        }
        
        if (type === 'series' && torrentSeason) {
          validationMessage += ` | S${torrentSeason}`;
          if (torrentEpisode) {
            validationMessage += `E${torrentEpisode}`;
          }
        }
        
        // VERSÃO 1.4.0: Adiciona informacao das qualidades
        if (allQualities.length > 1) {
          validationMessage += ` | Qualidades: ${allQualities.join(', ')}`;
        }

        const result = {
          success: true,
          magnetAdded: true,
          magnetData,
          validation: {
            titleMatches: true,
            seasonMatches: torrentSeason !== undefined,
            episodeMatches: torrentEpisode !== undefined,
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
          episode: magnetData.imdbEpisode,
          versao: this.VERSION
        });

        return result;
      } else {
        const result = { success: false, magnetAdded: false, message: 'Ja existe no banco' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

    } catch (error) {
      logger.error('Erro ao adicionar magnet', {
        title: torrentTitle.substring(0, 60),
        imdbId,
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

  // VERSÃO 1.4.0: Novo metodo para extrair todas qualidades do titulo
  private extractAllQualitiesFromTitle(title: string): string[] {
    const qualityPatterns = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi,
      // Padroes com multiplas qualidades
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,  // 720p/1080p
      /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi, // 720p e 1080p
      /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi  // 720p ou 1080p
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
      
      logger.debug('Detectado multiplos episodios', {
        title: torrentTitle.substring(0, 60),
        startEpisode,
        endEpisode
      });
      
      return { hasMultiple: true, startEpisode, endEpisode };
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
      
      return { hasMultiple: true, startEpisode, endEpisode };
    }
    
    return { hasMultiple: false };
  }

  private validateMagnetLink(magnet: string): boolean {
    const isValid = magnet.startsWith('magnet:') &&
                   magnet.includes('xt=urn:btih:') &&
                   magnet.length > 50;

    if (!isValid) {
      logger.warn('Link magnet invalido', {
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

  // VERSÃO 1.4.0: Adiciona parametro para todas qualidades
  private async saveToDatabase(
    magnetData: MagnetData, 
    imdbTitles: ImdbTitles, 
    allQualities: string[] = []
  ): Promise<boolean> {
    try {
      const magnetHash = this.extractHashFromMagnet(magnetData.magnet);
      if (!magnetHash) {
        throw new Error('Nao foi extrair infoHash');
      }

      logger.debug('Salvando no banco', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId,
        season: magnetData.imdbSeason,
        episode: magnetData.imdbEpisode,
        category: magnetData.category,
        qualidadesEncontradas: allQualities.length > 1 ? allQualities.join(', ') : 'unica'
      });

      if (magnetData.category === 'serie' && magnetData.imdbSeason !== undefined) {
        const existingEpisode = await File.findOne({
          where: {
            infoHash: magnetHash,
            imdbId: magnetData.imdbId,
            imdbSeason: magnetData.imdbSeason,
            imdbEpisode: magnetData.imdbEpisode
          }
        });

        if (existingEpisode) {
          logger.debug('Episodio ja existe', {
            title: magnetData.title.substring(0, 60),
            imdbId: magnetData.imdbId,
            imdbSeason: magnetData.imdbSeason,
            imdbEpisode: magnetData.imdbEpisode
          });
          return false;
        }
      } else {
        const existingTorrent = await getTorrent(magnetHash);
        if (existingTorrent) {
          logger.debug('Magnet ja existe', {
            title: magnetData.title.substring(0, 60),
            imdbId: magnetData.imdbId
          });
          return false;
        }
      }

      if (magnetData.matchedImdbTitle) {
        const finalValidation = await titleFilter.doTitlesMatch(
          magnetData.title,
          magnetData.imdbId,
          magnetData.imdbSeason,
          magnetData.imdbEpisode
        );

        if (!finalValidation.matches) {
          logger.error('Validacao final falhou', {
            imdbId: magnetData.imdbId,
            title: magnetData.title.substring(0, 60),
            reason: 'Falhou na validacao final'
          });
          return false;
        }
      }

      const existingTorrent = await getTorrent(magnetHash);
      if (!existingTorrent) {
        // VERSÃO 1.4.0: Adiciona campo para indicar qualidades disponiveis
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
          // Novo campo: armazena qualidades detectadas como JSON string
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
        // Novo campo: registra qualidades disponiveis
        qualityMetadata: allQualities.length > 1 ? JSON.stringify({ allQualities: allQualities }) : null,
        createdAt: new Date(),
        updatedAt: new Date()
      });

      logger.info('Magnet salvo no DB', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId,
        qualidadeSalva: magnetData.quality,
        todasQualidades: allQualities,
        season: magnetData.imdbSeason,
        episode: magnetData.imdbEpisode,
        versao: this.VERSION
      });

      return true;

    } catch (error) {
      logger.error('Erro ao salvar magnet', {
        error: error instanceof Error ? error.message : 'Erro',
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId
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
      logger.info('Processando RD', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId
      });

      const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);

      if (existingTorrent.found && existingTorrent.downloaded) {
        logger.info('Torrent ja baixado no RD', {
          title: magnetData.title.substring(0, 60),
          torrentId: existingTorrent.torrentId
        });

        const streamLink = await rdService.getStreamLinkForTorrent(
          existingTorrent.torrentId!,
          apiKey,
          magnetData.imdbSeason,
          magnetData.imdbEpisode
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

      logger.info('Adicionando ao RD', {
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
          magnetData.imdbEpisode
        );
      }

      return {
        success: true,
        status: torrentInfo.status,
        streamLink: streamLink || undefined,
        message: `Torrent adicionado: ${torrentInfo.status}`
      };

    } catch (error) {
      logger.error('Erro no RD', {
        title: magnetData.title.substring(0, 60),
        error: error instanceof Error ? error.message : 'Erro'
      });

      return {
        success: false,
        status: 'error',
        message: `Erro RD: ${error instanceof Error ? error.message : 'Erro'}`
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
    testEpisode?: number
  ): Promise<{
    valid: boolean;
    torrentTitle: string;
    imdbTitles?: ImdbTitles;
    matchResult?: TitleMatchResult;
    torrentMetadata?: SeriesMetadata;
    seasonMatch?: boolean;
    episodeMatch?: boolean;
    reason?: string;
  }> {
    try {
      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
      const hasMultipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
      
      const matchResult = await titleFilter.doTitlesMatch(
        torrentTitle,
        imdbId,
        testSeason,
        testEpisode
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

      if (testEpisode !== undefined) {
        if (hasMultipleEpisodes.hasMultiple && hasMultipleEpisodes.startEpisode && hasMultipleEpisodes.endEpisode) {
          episodeMatch = testEpisode >= hasMultipleEpisodes.startEpisode && 
                        testEpisode <= hasMultipleEpisodes.endEpisode;
          if (!episodeMatch) {
            reason += ` Episodio fora do range: ${testEpisode} vs ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}.`;
          }
        } else if (torrentMetadata.episode) {
          episodeMatch = torrentMetadata.episode === testEpisode;
          if (!episodeMatch) {
            reason += ` Episodio: Torrent E${torrentMetadata.episode} vs Teste E${testEpisode}.`;
          }
        }
      }

      const valid = matchResult.matches && seasonMatch && episodeMatch;

      if (valid) {
        reason = `Valido: "${torrentTitle}" -> "${matchResult.matchedTitle}"`;
        if (matchResult.matchedLanguage === 'português') {
          reason += ' (pt)';
        }
        if (torrentMetadata.season) reason += ` S${torrentMetadata.season}`;
        if (torrentMetadata.episode) reason += `E${torrentMetadata.episode}`;
        if (hasMultipleEpisodes.hasMultiple) {
          reason += ` [Range: ${hasMultipleEpisodes.startEpisode}-${hasMultipleEpisodes.endEpisode}]`;
        }
        reason += ` (${(matchResult.similarity * 100).toFixed(1)}%)`;
      } else {
        reason = `Invalido: "${torrentTitle}"`;
        if (imdbTitles.allTitles.length > 0) {
          reason += ` != IMDB: ${imdbTitles.allTitles.join(' / ')}`;
        }
        if (matchResult.reason) {
          reason += ` ${matchResult.reason}`;
        }
      }

      return {
        valid,
        torrentTitle,
        imdbTitles,
        matchResult,
        torrentMetadata,
        seasonMatch,
        episodeMatch,
        reason
      };

    } catch (error) {
      return {
        valid: false,
        torrentTitle,
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
      logger.error('Erro titulos IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return null;
    }
  }

  clearCache(): void {
    this.validationCache.clear();
  }

  getStats() {
    return {
      cacheSize: this.validationCache.size,
      cacheTTL: this.cacheTTL,
      version: this.VERSION,
      features: [
        'Detecta todas qualidades do torrent (720p e 1080p)',
        'Armazena qualidades no campo metadata do banco',
        'Registra qualidades disponiveis no qualityMetadata',
        'Compativel com StreamFormatter v1.3.3'
      ]
    };
  }
}

export default AutoMagnetService;