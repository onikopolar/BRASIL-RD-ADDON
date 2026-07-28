import { getTorrent, createTorrent, upsertTorrent } from '../lib/repository.js';
import { TorboxService } from './RealDebridService.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { Logger } from '../utils/logger.js';
import { TitleFilter, TitleMatchResult, SeriesMetadata } from '../titulos/titleFilter.js';
import { EpisodeMatcher } from '../titulos/episodeMatcher.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';

const logger = new Logger('AutoMagnetService');
const torboxService = new TorboxService();
const imdbScraper = ImdbScraperService.getInstance();
const titleFilter = TitleFilter.getInstance();
const episodeMatcher = EpisodeMatcher.getInstance();
const qualityDetector = QualityDetector.getInstance();

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

  private readonly VERSION = '1.6.1'; // Melhoria na detecção de packs

  private titleValidationCache = new Map<string, {
    result: TitleMatchResult;
    timestamp: number;
  }>();
  private readonly titleCacheTTL = 60000;

  private imdbCache = new Map<string, {
    data: ImdbTitles;
    timestamp: number;
  }>();
  private readonly imdbCacheTTL = 300000;

  constructor() {
    // Construtor silencioso
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
    imdbEpisode?: number | null,
    infoHash?: string // cacheado do parse-torrent (evita re-parse)
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

      const cached = this.validationCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return cached.data;
      }

      if (!this.validateMagnetLink(magnetLink)) {
        const result = { success: false, magnetAdded: false, message: 'Link magnet inválido' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const result = { success: false, magnetAdded: false, message: 'Títulos IMDB não encontrados' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      const titleMatchResult = await this.validateTitleWithCache(
        torrentTitle,
        imdbId,
        imdbSeason,
        imdbEpisode !== null ? imdbEpisode : undefined
      );

      if (!titleMatchResult.matches) {
        let rejectionReason = titleMatchResult.reason || 'Título não corresponde';

        if (type === 'series' && imdbSeason !== undefined) {
          const torrentMetadata = titleFilter.extrairMetadados(torrentTitle);
          const multiplos = episodeMatcher.temMultiplosEpisodios(torrentTitle);
          const ehPack = episodeMatcher.ehPackTemporadaCompleta(torrentTitle);
          
          if (!ehPack) {
            if (multiplos.temMultiplos && multiplos.episodioInicio && multiplos.episodioFim) {
              if (imdbEpisode !== undefined && imdbEpisode !== null) {
                const episodeInRange = imdbEpisode >= multiplos.episodioInicio && 
                                     imdbEpisode <= multiplos.episodioFim;
                if (!episodeInRange) {
                  rejectionReason = `Episódio ${imdbEpisode} fora do range ${multiplos.episodioInicio}-${multiplos.episodioFim}`;
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
        const torrentMetadata = titleFilter.extrairMetadados(torrentTitle);
        const multiplos = episodeMatcher.temMultiplosEpisodios(torrentTitle);
        const ehPack = episodeMatcher.ehPackTemporadaCompleta(torrentTitle);
        

        if (torrentSeason === undefined && torrentMetadata.season) {
          torrentSeason = torrentMetadata.season;
        }
        
        if (ehPack) {
          torrentEpisode = null;
        } else if (multiplos.temMultiplos) {
          if (torrentEpisode === undefined && imdbEpisode !== undefined && imdbEpisode !== null) {
            torrentEpisode = imdbEpisode;
          }
        } else if (torrentEpisode === undefined && torrentMetadata.episode) {
          torrentEpisode = torrentMetadata.episode;
        }
      }

      // Log suprimido: muito verboso em producao

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

      const saved = await this.saveToDatabaseOptimized(magnetData, imdbTitles, allQualities, titleMatchResult, infoHash);

      if (saved) {
        let validationMessage = 'Título validado';
        if (titleMatchResult.matchedLanguage === 'português') {
          validationMessage += ' (pt)';
        }
        
        if (type === 'series' && torrentSeason) {
          validationMessage += ` | S${torrentSeason}`;
          if (torrentEpisode !== null && torrentEpisode !== undefined) {
            validationMessage += `E${torrentEpisode}`;
          } else if (episodeMatcher.ehPackTemporadaCompleta(torrentTitle)) {
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


  private async validateTitleWithCache(
    torrentTitle: string,
    imdbId: string,
    season?: number,
    episode?: number
  ): Promise<TitleMatchResult> {
    const cacheKey = `title_${imdbId}_${torrentTitle.substring(0, 100)}_${season}_${episode}`;
    const cached = this.titleValidationCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.timestamp) < this.titleCacheTTL) {
      return cached.result;
    }

    const result = await titleFilter.titulosCombinam(torrentTitle, imdbId, season, episode);
    this.titleValidationCache.set(cacheKey, { result: result, timestamp: Date.now() });
    
    return result;
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
    titleMatchResult: TitleMatchResult,
    infoHash?: string // cacheado do parse-torrent
  ): Promise<boolean> {
    try {
      // Usa infoHash cacheado do parse-torrent, evita re-parse
      const magnetHash = infoHash || await this.extrairHashDoMagnet(magnetData.magnet);
      if (!magnetHash) {
        throw new Error('Não foi possível extrair infoHash');
      }

      // Log suprimido: muito verboso em producao

      // Verifica se ja existe no banco
      const existingTorrent = await getTorrent(magnetHash);
      if (existingTorrent) {
        // Atualiza seeders e lastSeen
        await upsertTorrent(magnetHash, {
          seeders: magnetData.seeds || 0,
          lastSeen: new Date()
        });
        return false;
      }

      if (!titleMatchResult.matches) {
        logger.error('Validação falhou antes do salvamento', {
          imdbId: magnetData.imdbId,
          title: magnetData.title.substring(0, 60),
          reason: 'Falhou na validação anterior'
        });
        return false;
      }

      if (!existingTorrent) {
        await createTorrent({
          infoHash: magnetHash,
          provider: 'brasil-rd',
          title: magnetData.title,
          size: this.parseSizeToBytes(magnetData.size) || 0,
          type: magnetData.category === 'serie' ? 'series' : 'movie',
          imdbId: magnetData.imdbId || null,
          imdbSeason: magnetData.imdbSeason || null,
          seeders: magnetData.seeds || 0,
          idioma: magnetData.language,
          qualidade: magnetData.quality,
          uploadDate: new Date(),
          lastSeen: new Date()
        });
      }

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

  private async extrairHashDoMagnet(magnet: string): Promise<string | null> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : null;
  }

  async processTorboxOnClick(
    magnetData: MagnetData,
    apiKey: string
  ): Promise<{ success: boolean; streamLink?: string; status: string; message?: string }> {
    try {
      logger.info('Processando Torbox', {
        title: magnetData.title.substring(0, 60),
        imdbId: magnetData.imdbId
      });

      const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);

      if (existingTorrent.found && existingTorrent.downloaded) {
        logger.info('Torrent já baixado no Torbox', {
          title: magnetData.title.substring(0, 60),
          torrentId: existingTorrent.torrentId
        });

        const streamLink = await torboxService.getStreamLinkForTorrent(
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

      logger.info('Adicionando magnet ao Torbox', {
        title: magnetData.title.substring(0, 60)
      });

      const torrentId = await torboxService.addMagnet(magnetData.magnet, apiKey);
      // Torbox não precisa de selectFiles — processa automaticamente

      const torrentInfo = await torboxService.getTorrentInfo(torrentId, apiKey);

      let streamLink: string | null = null;
      if (torrentInfo.download_state === 'completed' || torrentInfo.download_state === 'cached') {
        streamLink = await torboxService.getStreamLinkForTorrent(
          torrentId,
          apiKey,
          magnetData.imdbSeason,
          magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined
        );
      }

      return {
        success: true,
        status: torrentInfo.download_state,
        streamLink: streamLink || undefined,
        message: `Torrent adicionado: ${torrentInfo.download_state}`
      };

    } catch (error) {
      logger.error('Erro ao processar Torbox', {
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
      const magnetHash = await this.extrairMagnetHash(magnet);

      if (!magnetHash) {
        return { found: false, downloaded: false };
      }

      const existingTorrent = await torboxService.findExistingTorrent(magnetHash, apiKey);

      if (existingTorrent) {
        return {
          found: true,
          torrentId: String(existingTorrent.id),
          status: existingTorrent.download_state,
          downloaded: existingTorrent.download_state === 'completed' || existingTorrent.download_state === 'cached'
        };
      }

      return { found: false, downloaded: false };

    } catch (error) {
      return { found: false, downloaded: false };
    }
  }

  private async extrairMagnetHash(magnet: string): Promise<string> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : '';
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
    ehPack?: boolean;
    reason?: string;
  }> {
    try {
      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      const torrentMetadata = titleFilter.extrairMetadados(torrentTitle);
      const multiplos = episodeMatcher.temMultiplosEpisodios(torrentTitle);
      const ehPack = episodeMatcher.ehPackTemporadaCompleta(torrentTitle);
      
      const matchResult = await titleFilter.titulosCombinam(
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
        if (ehPack) {
          episodeMatch = true;
          reason += ' Pack de temporada completa - compatível com qualquer episódio.';
        } else if (multiplos.temMultiplos && multiplos.episodioInicio && multiplos.episodioFim) {
          episodeMatch = testEpisode >= multiplos.episodioInicio && 
                        testEpisode <= multiplos.episodioFim;
          if (!episodeMatch) {
            reason += ` Episódio fora do range: ${testEpisode} vs ${multiplos.episodioInicio}-${multiplos.episodioFim}.`;
          } else {
            reason += ` Episódio ${testEpisode} dentro do range ${multiplos.episodioInicio}-${multiplos.episodioFim}.`;
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
        if (ehPack) {
          reason += ' (Temporada Completa)';
        } else if (torrentMetadata.episode) {
          reason += `E${torrentMetadata.episode}`;
        }
        if (multiplos.temMultiplos) {
          reason += ` [Range: ${multiplos.episodioInicio}-${multiplos.episodioFim}]`;
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
        ehPack: ehPack,
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

  extrairMetadados(torrentTitle: string): SeriesMetadata {
    return titleFilter.extrairMetadados(torrentTitle);
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
        'Detecção de packs ampliada (temporada sem episódio)'
      ]
    };
  }
}

export default AutoMagnetService;