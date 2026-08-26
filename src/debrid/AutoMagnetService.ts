import { getTorrent, createTorrent, upsertTorrent } from '../lib/repository.js';
import { TorboxService } from './RealDebridService.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { Logger } from '../utils/logger.js';
import { TitleFilter, TitleMatchResult } from '../titulos/titleFilter.js';
import { EpisodeMatcher } from '../titulos/episodeMatcher.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { analisarMagnet } from '../magnet/magnetHelper.js';
import { extrairRangeEpisodios, INDICADORES_INTERNACIONAL_TORRENTS } from '../titulos/TechnicalWords.js';
import { LanguageDetector } from '../titulos/LanguageDetector.js';
import { RescrapeService } from '../services/RescrapeService.js';

const logger = new Logger('AutoMagnetService');
const torboxService = new TorboxService();
const imdbScraper = ImdbScraperService.getInstance();
const titleFilter = TitleFilter.getInstance();
const episodeMatcher = EpisodeMatcher.getInstance();
const qualityDetector = QualityDetector.getInstance();

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

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
  private validationCache = new Map<string, { valid: boolean; data: AutoMagnetResult; timestamp: number }>();
  private readonly cacheTTL = 30000;

  private titleValidationCache = new Map<string, { result: TitleMatchResult; timestamp: number }>();
  private readonly titleCacheTTL = 60000;

  private imdbCache = new Map<string, { data: ImdbTitles; timestamp: number }>();
  private readonly imdbCacheTTL = 300000;

  constructor() {}

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
    infoHash?: string,
    provider?: string,
    originalTitle?: string,
    htmlTitle?: string
  ): Promise<AutoMagnetResult> {
    const cacheKey = `${magnetLink}-${imdbId}-${imdbSeason}-${imdbEpisode}`;

    try {
      const cached = this.validationCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
        return cached.data;
      }

      if (!this.validateMagnetLink(magnetLink)) {
        const result: AutoMagnetResult = { success: false, magnetAdded: false, message: 'Link magnet inválido' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const result: AutoMagnetResult = { success: false, magnetAdded: false, message: 'Títulos IMDB não encontrados' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      let titleMatchResult: TitleMatchResult;
      if (originalTitle) {
        titleMatchResult = {
          matches: true,
          similarity: 1,
          matchedTitle: originalTitle,
          torrentMetadata: titleFilter.extrairMetadados(torrentTitle),
          reason: 'Pré-validado pelo CatalogProvider'
        } as TitleMatchResult;
      } else {
        titleMatchResult = await this.validateTitleWithCache(torrentTitle, imdbId, imdbSeason, imdbEpisode !== null ? imdbEpisode : undefined);
        if (!titleMatchResult.matches) {
          const result: AutoMagnetResult = {
            success: false,
            magnetAdded: false,
            message: 'Título não corresponde',
            validation: { titleMatches: false, reason: titleMatchResult.reason || 'Título não corresponde' }
          };
          this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
          return result;
        }
      }

      let torrentSeason = imdbSeason;
      let torrentEpisode = imdbEpisode;

      if (type === 'series') {
        const torrentMetadata = titleFilter.extrairMetadados(torrentTitle);
        const multiplos = episodeMatcher.temMultiplosEpisodios(torrentTitle);
        const ehPack = episodeMatcher.ehPackTemporadaCompleta(torrentTitle);

        if (torrentSeason === undefined && torrentMetadata.season) torrentSeason = torrentMetadata.season;
        if (ehPack) torrentEpisode = null;
        else if (multiplos.temMultiplos) {
          if (torrentEpisode === undefined && imdbEpisode !== undefined && imdbEpisode !== null) torrentEpisode = imdbEpisode;
        } else if (torrentEpisode === undefined && torrentMetadata.episode) torrentEpisode = torrentMetadata.episode;
      }

      const category = type === 'series' ? 'serie' : 'filme';
      const language = this.detectLanguage(torrentTitle);
      
      // Uso do QualityDetector centralizado (remove duplicação)
      const allQualities = qualityDetector.extractAllQualities(torrentTitle);
      const finalQuality = allQualities.length > 0
        ? allQualities[0]
        : (quality || qualityDetector.extractQualityFromFilename(torrentTitle));

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

      const saved = await this.saveToDatabase(magnetData, titleMatchResult, infoHash, provider, htmlTitle);

      if (!saved) {
        const result: AutoMagnetResult = { success: false, magnetAdded: false, message: 'Já existe no banco' };
        this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
        return result;
      }

      const result: AutoMagnetResult = {
        success: true,
        magnetAdded: true,
        magnetData,
        validation: {
          titleMatches: true,
          seasonMatches: torrentSeason !== undefined,
          episodeMatches: torrentEpisode !== undefined && torrentEpisode !== null,
          matchedTitle: magnetData.matchedImdbTitle,
          matchedLanguage: magnetData.matchedLanguage,
          reason: 'Título validado'
        }
      };
      this.validationCache.set(cacheKey, { valid: true, data: result, timestamp: Date.now() });
      return result;
    } catch (error) {
      logger.error('Erro ao adicionar magnet', {
        title: torrentTitle.substring(0, 60),
        imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });
      const result: AutoMagnetResult = { success: false, magnetAdded: false, message: `Erro: ${error instanceof Error ? error.message : 'Erro'}` };
      this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
      return result;
    }
  }

  private async validateTitleWithCache(torrentTitle: string, imdbId: string, season?: number, episode?: number): Promise<TitleMatchResult> {
    const cacheKey = `title_${imdbId}_${torrentTitle.substring(0, 100)}_${season}_${episode}`;
    const cached = this.titleValidationCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.titleCacheTTL) return cached.result;

    const result = await titleFilter.titulosCombinam(torrentTitle, imdbId, season, episode);
    this.titleValidationCache.set(cacheKey, { result, timestamp: Date.now() });
    return result;
  }

  private validateMagnetLink(magnet: string): boolean {
    return magnet.startsWith('magnet:') && magnet.includes('xt=urn:btih:') && magnet.length > 50;
  }

  private detectLanguage(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('dublado') || lower.includes('dublada') || lower.includes('dublagem')) return 'pt-BR';
    if (lower.includes('dual audio') || lower.includes('dual áudio')) return 'pt-BR,en';
    if (LEGENDADO_REGEX.test(lower)) return 'legendado';
    if (lower.includes('nacional')) return 'pt-BR';
    if (/\b(english|eng)\b/i.test(lower)) return 'en';
    if (/\b(español|spanish|espanol)\b/i.test(lower)) return 'es';
    if (/\b(french|francês|frances)\b/i.test(lower)) return 'fr';

    const langResult = LanguageDetector.getInstance().verificarIdioma(title);
    if (langResult.palavrasPt.length > 0) return 'pt-BR';
    if (langResult.palavrasEn.length > 0) return 'en';
    return 'unknown';
  }

  private async saveToDatabase(
    magnetData: MagnetData,
    titleMatchResult: TitleMatchResult,
    infoHash?: string,
    provider?: string,
    htmlTitle?: string
  ): Promise<boolean> {
    try {
      const magnetHash = infoHash || await this.extrairHashDoMagnet(magnetData.magnet);
      if (!magnetHash) throw new Error('Não foi possível extrair infoHash');

      const existingTorrent = await getTorrent(magnetHash);
      if (existingTorrent) {
        await upsertTorrent(magnetHash, {
          seeders: magnetData.seeds || 0,
          lastSeen: new Date()
        });
        return false;
      }

      if (!titleMatchResult.matches) return false;

      const rangeSource = htmlTitle || magnetData.title;
      const episodeRange = extrairRangeEpisodios(rangeSource);
      let imdbEpisodeStart: number | null = null;
      let imdbEpisodeEnd: number | null = null;

      const isFullPack = episodeRange
        ? (episodeRange.episodeStart === 0 && episodeRange.episodeEnd === 0) ||
          /\b(?:temporada completa|complete season|season pack|pack completo)\b/i.test(rangeSource)
        : false;

      if (episodeRange && !isFullPack) {
        imdbEpisodeStart = episodeRange.episodeStart;
        imdbEpisodeEnd = episodeRange.episodeEnd;
      }

      if (magnetData.imdbSeason && magnetData.imdbEpisode !== undefined) {
        if (magnetData.imdbEpisode === null) {
          imdbEpisodeStart = null;
          imdbEpisodeEnd = null;
        } else {
          imdbEpisodeStart = magnetData.imdbEpisode;
          imdbEpisodeEnd = magnetData.imdbEpisode;
        }
      }

      await createTorrent({
        infoHash: magnetHash,
        provider,
        title: magnetData.title,
        size: this.parseSizeToBytes(magnetData.size) || 0,
        type: magnetData.category === 'serie' ? 'series' : 'movie',
        imdbId: magnetData.imdbId || null,
        imdbSeason: magnetData.imdbSeason || null,
        imdbEpisodeStart,
        imdbEpisodeEnd,
        seeders: magnetData.seeds || 0,
        idioma: magnetData.language,
        qualidade: magnetData.quality,
        magnet: magnetData.magnet,
        uploadDate: new Date(),
        lastSeen: new Date(),
        rescrapeAt: RescrapeService.computeRescrapeAt(magnetData.title, magnetData.quality)
      });

      return true;
    } catch (error) {
      logger.error('Erro ao salvar magnet', {
        title: magnetData.title.substring(0, 60),
        error: error instanceof Error ? error.message : 'Erro'
      });
      throw error;
    }
  }

  private parseSizeToBytes(size?: string): number {
    if (!size) return 0;
    const match = size.toLowerCase().trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]b?)?$/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = match[2] ? match[2].toLowerCase().charAt(0) : 'b';
    const multipliers: Record<string, number> = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
    return Math.floor(value * (multipliers[unit] || 1));
  }

  private async extrairHashDoMagnet(magnet: string): Promise<string | null> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : null;
  }

  async processTorboxOnClick(magnetData: MagnetData, apiKey: string): Promise<{ success: boolean; streamLink?: string; status: string; message?: string }> {
    try {
      const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);
      if (existingTorrent.found && existingTorrent.downloaded) {
        const streamLink = await torboxService.getStreamLinkForTorrent(
          existingTorrent.torrentId!,
          apiKey,
          magnetData.imdbSeason,
          magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined
        );
        return { success: true, streamLink: streamLink || undefined, status: 'downloaded' };
      }
      if (existingTorrent.found) {
        return { success: true, status: existingTorrent.status || 'downloading', message: `Download: ${existingTorrent.status}` };
      }

      const torrentId = await torboxService.addMagnet(magnetData.magnet, apiKey);
      try {
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
        return { success: true, status: torrentInfo.download_state, streamLink: streamLink || undefined, message: `Torrent adicionado: ${torrentInfo.download_state}` };
      } catch {
        return { success: true, status: 'downloading', message: 'Torrent na fila do Torbox, aguardando processamento' };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/already queued|already exists|already added/i.test(msg)) {
        const existing = await this.checkExistingTorrent(magnetData.magnet, apiKey);
        if (existing.found && existing.downloaded) {
          const streamLink = await torboxService.getStreamLinkForTorrent(
            existing.torrentId!,
            apiKey,
            magnetData.imdbSeason,
            magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined
          );
          return { success: true, streamLink: streamLink || undefined, status: 'downloaded' };
        }
        return { success: true, status: 'queued', message: 'Torrent já está na fila do Torbox' };
      }

      const existing = await this.checkExistingTorrent(magnetData.magnet, apiKey);
      if (existing.found && existing.downloaded) {
        const streamLink = await torboxService.getStreamLinkForTorrent(
          existing.torrentId!,
          apiKey,
          magnetData.imdbSeason,
          magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined
        );
        return { success: true, streamLink: streamLink || undefined, status: 'downloaded' };
      }
      if (existing.found) return { success: true, status: existing.status || 'downloading', message: `Status: ${existing.status}` };

      return { success: false, status: 'error', message: `Erro Torbox: ${msg.substring(0, 150)}` };
    }
  }

  private async checkExistingTorrent(magnet: string, apiKey: string): Promise<{ found: boolean; torrentId?: string; status?: string; downloaded: boolean }> {
    try {
      const magnetHash = await this.extrairHashDoMagnet(magnet);
      if (!magnetHash) return { found: false, downloaded: false };
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
    } catch {
      return { found: false, downloaded: false };
    }
  }

  clearCache(): void {
    this.validationCache.clear();
    this.titleValidationCache.clear();
    this.imdbCache.clear();
  }

  getStats() {
    return {
      cacheSize: this.validationCache.size,
      titleCacheSize: this.titleValidationCache.size,
      imdbCacheSize: this.imdbCache.size
    };
  }
}

export default AutoMagnetService;