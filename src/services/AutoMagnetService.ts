import { getTorrent, createTorrent, createFile, File } from '../lib/repository';
import { RealDebridService } from './RealDebridService';
import { ImdbScraperService, ImdbTitles } from './ImdbScraperService';
import { Logger } from '../utils/logger';
import { TitleFilter, TitleMatchResult, SeriesMetadata } from '../lib/titleFilter';

const logger = new Logger('AutoMagnetService');
const rdService = new RealDebridService();
const imdbScraper = new ImdbScraperService();
const titleFilter = new TitleFilter();

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
  matchedImdbTitle?: string;     // Qual título do IMDB que deu match
  matchedLanguage?: 'original' | 'portuguese'; // Idioma do título que deu match
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
    matchedLanguage?: 'original' | 'portuguese';
    reason?: string;
  };
}

export class AutoMagnetService {
  constructor() {
    logger.info('AutoMagnetService inicializado - Validação com suporte a múltiplos idiomas');
  }

  /**
   * Adiciona magnet automaticamente baseado em dados do scraping
   * COM VALIDAÇÃO DE TÍTULO + TEMPORADA/EPISÓDIO (MÚLTIPLOS TÍTULOS DO IMDB)
   */
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
    try {
      logger.info('Processando magnet automaticamente', {
        torrentTitle,
        imdbId,
        type,
        imdbSeason,
        imdbEpisode,
        magnetLink: magnetLink.substring(0, 50) + '...'
      });

      // ✅ VALIDAÇÃO 1: Link magnet válido
      if (!this.validateMagnetLink(magnetLink)) {
        return {
          success: false,
          magnetAdded: false,
          message: 'Link magnet inválido'
        };
      }

      // ✅ VALIDAÇÃO 2: Buscar TODOS os títulos do IMDB (original + português)
      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        logger.warn('Não foi possível obter títulos do IMDB', { imdbId });
        return {
          success: false,
          magnetAdded: false,
          message: 'Títulos IMDB não encontrados'
        };
      }

      // ✅ VALIDAÇÃO 3: Título do torrent combina com QUALQUER título do IMDB
      const titleMatchResult = await titleFilter.doTitlesMatch(
        torrentTitle,
        imdbId,
        imdbSeason,
        imdbEpisode
      );

      if (!titleMatchResult.matches) {
        let rejectionReason = titleMatchResult.reason || 'Título do torrent não corresponde aos títulos do IMDB';

        // Adiciona detalhes específicos de série se disponível
        if (type === 'series' && imdbSeason !== undefined) {
          const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
          if (torrentMetadata.hasEpisodeInfo) {
            if (torrentMetadata.season && torrentMetadata.season !== imdbSeason) {
              rejectionReason = `Temporada errada: Torrent S${torrentMetadata.season} vs Solicitado S${imdbSeason}`;
            } else if (imdbEpisode !== undefined && torrentMetadata.episode && torrentMetadata.episode !== imdbEpisode) {
              rejectionReason = `Episódio errado: Torrent E${torrentMetadata.episode} vs Solicitado E${imdbEpisode}`;
            }
          }
        }

        logger.warn('Magnet REJEITADO', {
          imdbId,
          imdbTitles: imdbTitles.allTitles,
          torrentTitle,
          imdbSeason,
          imdbEpisode,
          reason: rejectionReason,
          similarity: titleMatchResult.similarity
        });

        return {
          success: false,
          magnetAdded: false,
          message: 'Título não corresponde ao conteúdo solicitado',
          validation: {
            titleMatches: false,
            reason: rejectionReason
          }
        };
      }

      // ✅ VALIDAÇÃO 4: Para séries, extrair metadata para salvar
      let torrentSeason = imdbSeason;
      let torrentEpisode = imdbEpisode;

      if (type === 'series') {
        const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
        if (torrentMetadata.season && torrentSeason === undefined) {
          torrentSeason = torrentMetadata.season;
        }
        if (torrentMetadata.episode && torrentEpisode === undefined) {
          torrentEpisode = torrentMetadata.episode;
        }
      }

      // ✅ Tudo validado - prosseguir com salvamento
      const category = type === 'series' ? 'serie' : 'filme';
      const language = this.detectLanguage(torrentTitle);
      const finalQuality = quality || this.extractQualityFromTitle(torrentTitle);

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
        imdbTitle: imdbTitles.originalTitle, // Mantém compatibilidade
        matchedImdbTitle: titleMatchResult.matchedTitle,
        matchedLanguage: titleMatchResult.matchedLanguage
      };

      // Salvar no banco de dados
      const saved = await this.saveToDatabase(magnetData, imdbTitles);

      if (saved) {
        let validationMessage = '✅ Título validado com IMDB';
        if (titleMatchResult.matchedLanguage === 'portuguese') {
          validationMessage += ' (via título em português)';
        }
        
        if (type === 'series' && torrentSeason) {
          validationMessage += ` | S${torrentSeason}`;
          if (torrentEpisode) {
            validationMessage += `E${torrentEpisode}`;
          }
        }

        logger.info('Magnet adicionado automaticamente ao catálogo', {
          title: magnetData.title,
          imdbId: magnetData.imdbId,
          quality: magnetData.quality,
          seeds: magnetData.seeds,
          imdbSeason: magnetData.imdbSeason,
          imdbEpisode: magnetData.imdbEpisode,
          matchedTitle: magnetData.matchedImdbTitle,
          matchedLanguage: magnetData.matchedLanguage,
          validation: validationMessage
        });

        return {
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
      } else {
        return {
          success: false,
          magnetAdded: false,
          message: 'Episódio já existe no banco de dados'
        };
      }

    } catch (error) {
      logger.error('Erro ao adicionar magnet automaticamente', {
        torrentTitle,
        imdbId,
        imdbSeason,
        imdbEpisode,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      return {
        success: false,
        magnetAdded: false,
        message: `Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  /**
   * Busca títulos do IMDB pelo ID (compatibilidade)
   */
  private async getImdbTitle(imdbId: string): Promise<string | null> {
    try {
      // Usa novo método mas retorna apenas um título para compatibilidade
      const titles = await imdbScraper.getTitlesFromImdbId(imdbId);
      if (titles && titles.allTitles.length > 0) {
        // Prefere título em português, fallback para original
        const title = titles.portugueseTitle || titles.originalTitle;
        logger.debug('Título obtido do serviço IMDB', { imdbId, title });
        return title;
      }

      // Fallback para títulos conhecidos (mantido para compatibilidade)
      const knownTitles: Record<string, string> = {
        'tt1979388': 'O Bom Dinossauro',
        'tt15789038': 'Elementos',
        'tt7979580': 'A Família Mitchell e a Revolta das Máquinas',
        'tt0317219': 'Carros',
        'tt0126029': 'Shrek',
        'tt0114709': 'Toy Story',
        'tt2294629': 'Frozen'
      };

      if (knownTitles[imdbId]) {
        logger.debug('Usando título conhecido', { imdbId, title: knownTitles[imdbId] });
        return knownTitles[imdbId];
      }

      return null;

    } catch (error) {
      logger.debug('Erro ao buscar título do IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  /**
   * Extrai qualidade do título
   */
  private extractQualityFromTitle(title: string): string {
    const qualityMatch = title.match(/(4K|2160p|1080p|720p|480p|SD)/i);
    if (qualityMatch) {
      const matchedQuality = qualityMatch[1].toLowerCase();
      return matchedQuality === '2160p' ? '4K' : matchedQuality;
    }
    return '1080p';
  }

  /**
   * Valida link magnet
   */
  private validateMagnetLink(magnet: string): boolean {
    const isValid = magnet.startsWith('magnet:') &&
                   magnet.includes('xt=urn:btih:') &&
                   magnet.length > 50;

    if (!isValid) {
      logger.warn('Link magnet inválido fornecido', {
        magnetLength: magnet.length,
        hasMagnetPrefix: magnet.startsWith('magnet:'),
        hasBtih: magnet.includes('xt=urn:btih:')
      });
    }

    return isValid;
  }

  /**
   * Detecta idioma automaticamente baseado no título
   */
  private detectLanguage(title: string): string {
    const lowerTitle = title.toLowerCase();

    if (lowerTitle.includes('dual')) return 'pt-BR,en';
    if (lowerTitle.includes('dublado')) return 'pt-BR';
    if (lowerTitle.includes('legendado')) return 'pt';
    if (lowerTitle.includes('english') || lowerTitle.includes('eng')) return 'en';
    if (lowerTitle.includes('español') || lowerTitle.includes('spanish')) return 'es';

    return 'pt-BR';
  }

  /**
   * Salva magnet no banco de dados (ATUALIZADO - usa múltiplos títulos do IMDB)
   */
  private async saveToDatabase(magnetData: MagnetData, imdbTitles: ImdbTitles): Promise<boolean> {
    try {
      // Extrai infoHash do magnet link
      const magnetHash = this.extractHashFromMagnet(magnetData.magnet);
      if (!magnetHash) {
        throw new Error('Não foi possível extrair infoHash do magnet');
      }

      // ✅ CORREÇÃO: Para séries, verifica se o EPISÓDIO específico já existe
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
          logger.debug('Episódio já existe no banco de dados, ignorando', {
            title: magnetData.title,
            imdbId: magnetData.imdbId,
            infoHash: magnetHash.substring(0, 8) + '...',
            imdbSeason: magnetData.imdbSeason,
            imdbEpisode: magnetData.imdbEpisode
          });
          return false;
        }
      } else {
        // Para filmes, verifica se o torrent já existe
        const existingTorrent = await getTorrent(magnetHash);
        if (existingTorrent) {
          logger.debug('Magnet já existe no banco de dados, ignorando', {
            title: magnetData.title,
            imdbId: magnetData.imdbId,
            infoHash: magnetHash.substring(0, 8) + '...'
          });
          return false;
        }
      }

      // Validação final antes de salvar (usando título que deu match)
      if (magnetData.matchedImdbTitle) {
        const finalValidation = await titleFilter.doTitlesMatch(
          magnetData.title,
          magnetData.imdbId,
          magnetData.imdbSeason,
          magnetData.imdbEpisode
        );

        if (!finalValidation.matches) {
          logger.error('VALIDAÇÃO FINAL FALHOU - Não salvando magnet', {
            imdbId: magnetData.imdbId,
            matchedTitle: magnetData.matchedImdbTitle,
            torrentTitle: magnetData.title,
            imdbSeason: magnetData.imdbSeason,
            imdbEpisode: magnetData.imdbEpisode,
            reason: 'Título/temporada/episódio falhou na validação final'
          });
          return false;
        }
      }

      // ✅ CORREÇÃO: Salva o torrent apenas se não existir (para evitar duplicatas)
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
          createdAt: new Date(),
          updatedAt: new Date()
        });
        logger.debug('Torrent salvo no banco', {
          infoHash: magnetHash.substring(0, 8) + '...',
          title: magnetData.title
        });
      }

      // ✅ CORREÇÃO: Sempre salva o episódio/file (mesmo que torrent já exista)
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
        createdAt: new Date(),
        updatedAt: new Date()
      });

      logger.info('Magnet adicionado ao banco de dados automaticamente', {
        title: magnetData.title,
        imdbId: magnetData.imdbId,
        imdbOriginalTitle: imdbTitles.originalTitle,
        imdbPortugueseTitle: imdbTitles.portugueseTitle,
        matchedTitle: magnetData.matchedImdbTitle,
        matchedLanguage: magnetData.matchedLanguage,
        quality: magnetData.quality,
        language: magnetData.language,
        category: magnetData.category,
        imdbSeason: magnetData.imdbSeason,
        imdbEpisode: magnetData.imdbEpisode,
        infoHash: magnetHash.substring(0, 8) + '...',
        seeds: magnetData.seeds
      });

      return true;

    } catch (error) {
      logger.error('Erro ao salvar magnet no banco de dados', {
        error: error instanceof Error ? error.message : 'Erro desconhecido',
        title: magnetData.title,
        imdbId: magnetData.imdbId,
        imdbSeason: magnetData.imdbSeason,
        imdbEpisode: magnetData.imdbEpisode
      });
      throw error;
    }
  }

  /**
   * Converte string de tamanho para bytes
   */
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

  /**
   * Extrai hash de um link magnet
   */
  private extractHashFromMagnet(magnet: string): string | null {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Processa torrent no Real-Debrid (quando usuário clica para assistir)
   */
  async processRealDebridOnClick(
    magnetData: MagnetData,
    apiKey: string
  ): Promise<{ success: boolean; streamLink?: string; status: string; message?: string }> {
    try {
      logger.info('Processando Real-Debrid no click', {
        title: magnetData.title,
        imdbId: magnetData.imdbId,
        imdbSeason: magnetData.imdbSeason,
        imdbEpisode: magnetData.imdbEpisode,
        matchedTitle: magnetData.matchedImdbTitle,
        matchedLanguage: magnetData.matchedLanguage
      });

      const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);

      if (existingTorrent.found && existingTorrent.downloaded) {
        logger.info('Torrent já baixado no Real-Debrid', {
          title: magnetData.title,
          torrentId: existingTorrent.torrentId,
          imdbSeason: magnetData.imdbSeason,
          imdbEpisode: magnetData.imdbEpisode
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
        logger.info('Torrent encontrado mas ainda não baixado', {
          title: magnetData.title,
          torrentId: existingTorrent.torrentId,
          status: existingTorrent.status,
          imdbSeason: magnetData.imdbSeason,
          imdbEpisode: magnetData.imdbEpisode
        });

        return {
          success: true,
          status: 'downloading',
          message: `Download em progresso: ${existingTorrent.status}`
        };
      }

      // Adicionar ao Real-Debrid
      logger.info('Adicionando torrent ao Real-Debrid', {
        title: magnetData.title,
        imdbSeason: magnetData.imdbSeason,
        imdbEpisode: magnetData.imdbEpisode
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
        logger.info('Torrent já baixado - streamLink obtido', {
          torrentId,
          streamLink: streamLink ? streamLink.substring(0, 100) + '...' : 'none',
          requestedSeason: magnetData.imdbSeason,
          requestedEpisode: magnetData.imdbEpisode
        });
      }

      return {
        success: true,
        status: torrentInfo.status,
        streamLink: streamLink || undefined,
        message: `Torrent adicionado: ${torrentInfo.status}`
      };

    } catch (error) {
      logger.error('Erro ao processar Real-Debrid', {
        title: magnetData.title,
        imdbSeason: magnetData.imdbSeason,
        imdbEpisode: magnetData.imdbEpisode,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      return {
        success: false,
        status: 'error',
        message: `Erro no Real-Debrid: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  /**
   * Verifica se torrent já existe no Real-Debrid
   */
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
        logger.debug('Torrent encontrado no Real-Debrid', {
          torrentId: existingTorrent.id,
          status: existingTorrent.status,
          downloaded: existingTorrent.status === 'downloaded'
        });

        return {
          found: true,
          torrentId: existingTorrent.id,
          status: existingTorrent.status,
          downloaded: existingTorrent.status === 'downloaded'
        };
      }

      return { found: false, downloaded: false };

    } catch (error) {
      logger.debug('Erro ao verificar torrent no Real-Debrid', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return { found: false, downloaded: false };
    }
  }

  /**
   * Extrai hash de um link magnet (para Real-Debrid)
   */
  private extractMagnetHash(magnet: string): string {
    const match = magnet.match(/btih:([^&]+)/i);
    return match ? match[1] : '';
  }

  /**
   * Método para debug/teste de validação (ATUALIZADO)
   */
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
      // Obtém todos os títulos do IMDB
      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
      
      // Testa match usando novo sistema
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
          reason += ` Temporada errada: Torrent S${torrentMetadata.season} vs Teste S${testSeason}.`;
        }
      }

      if (testEpisode !== undefined && torrentMetadata.episode) {
        episodeMatch = torrentMetadata.episode === testEpisode;
        if (!episodeMatch) {
          reason += ` Episódio errado: Torrent E${torrentMetadata.episode} vs Teste E${testEpisode}.`;
        }
      }

      const valid = matchResult.matches && seasonMatch && episodeMatch;

      if (valid) {
        reason = `✅ Título válido: "${torrentTitle}" → "${matchResult.matchedTitle}"`;
        if (matchResult.matchedLanguage === 'portuguese') {
          reason += ' (via título em português)';
        }
        if (torrentMetadata.season) reason += ` S${torrentMetadata.season}`;
        if (torrentMetadata.episode) reason += `E${torrentMetadata.episode}`;
        reason += ` (similaridade: ${(matchResult.similarity * 100).toFixed(1)}%)`;
      } else {
        reason = `❌ Título inválido: "${torrentTitle}"`;
        if (imdbTitles.allTitles.length > 0) {
          reason += ` ≠ IMDB: ${imdbTitles.allTitles.join(' / ')}`;
        }
        reason += `.${reason}`;
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
        reason: `Erro no teste: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
      };
    }
  }

  /**
   * Método auxiliar para extrair metadados de série
   */
  extractSeriesMetadata(torrentTitle: string): SeriesMetadata {
    return titleFilter.extractSeriesMetadata(torrentTitle);
  }

  /**
   * Obtém títulos completos do IMDB (novo método)
   */
  async getImdbTitles(imdbId: string): Promise<ImdbTitles | null> {
    try {
      return await imdbScraper.getTitlesFromImdbId(imdbId);
    } catch (error) {
      logger.error('Erro ao obter títulos do IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }
}

export default AutoMagnetService;