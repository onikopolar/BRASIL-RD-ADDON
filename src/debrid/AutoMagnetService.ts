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
import { RescrapeService } from '../services/scraper/RescrapeService.js';
import { CacheService } from '../debrid/CacheService.js';

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
  private validationCache = new CacheService();
  private titleValidationCache = new CacheService();

  private readonly cacheTTL = 30000;
  private readonly titleCacheTTL = 60000;

  constructor() { }

  //Valida o título reaproveitando o TitleFilter, com cache pra não repetir trabalho
  private async validateTitleWithCache(
    torrentTitle: string,
    imdbId: string,
    season?: number,
    episode?: number,
    tituloParaIdioma?: string
  ): Promise<TitleMatchResult> {
    const cacheKey = `title_${imdbId}_${torrentTitle.substring(0, 100)}_${season}_${episode}_${tituloParaIdioma || ''}`;
    const cached = this.titleValidationCache.get<TitleMatchResult>(cacheKey);
    if (cached) return cached;

    const result = await titleFilter.titulosCombinam(
      torrentTitle,
      imdbId,
      season,
      episode,
      tituloParaIdioma
    );
    this.titleValidationCache.set(cacheKey, result, this.titleCacheTTL);
    return result;
  }

  private validateMagnetLink(magnet: string): boolean {
    return magnet.startsWith('magnet:') && magnet.includes('xt=urn:btih:') && magnet.length > 50;
  }

  //Detecta o idioma pelo texto do título antes de cair no LanguageDetector
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

  //Escolhe a fonte primária de range: htmlTitle > dn= do magnet > title. Pega o primeiro que dá range útil.
  private escolherRangeSource(htmlTitle: string | undefined, dn: string | null, title: string): string | undefined {
    const fontes = [htmlTitle, dn, title];
    for (const fonte of fontes) {
      if (!fonte) continue;
      const r = extrairRangeEpisodios(fonte);
      if (r && (r.seasonStart > 0 || r.episodeStart > 0)) return fonte;
    }
    return htmlTitle || dn || title;
  }

  //Ponto único: recebe o contexto completo e devolve o range que vale. htmlTitle > dn= > title.
  private calcularRangeDoContexto(
    htmlTitle: string | undefined,
    dn: string | null,
    title: string
  ): { range: ReturnType<typeof extrairRangeEpisodios>; fonte: string | null } {
    const source = this.escolherRangeSource(htmlTitle, dn, title);
    if (!source) return { range: null, fonte: null };
    return { range: extrairRangeEpisodios(source), fonte: source };
  }

  //Decide seeds finais: valor novo > 0 vence; senão preserva o que já tá no banco.
  private resolverSeedsFinais(
    seedsNovos: number | undefined,
    seedsExistentes: number | null | undefined,
    contexto: string
  ): number {
    const novo = seedsNovos || 0;
    if (novo > 0) return novo;

    const preservado = seedsExistentes ?? 0;
    if (preservado > 0) {
      logger.debug('SEEDS_PRESERVADOS', { contexto, valor: preservado });
    }
    return preservado;
  }

  //Grava o torrent no banco. Só isso — a decisão de S/E vem pronta do autoAddMagnet.
  private async saveToDatabase(
    magnetData: MagnetData,
    titleMatchResult: TitleMatchResult,
    infoHash?: string,
    provider?: string
  ): Promise<boolean> {
    try {
      const parsedMagnet = await analisarMagnet(magnetData.magnet);
      const magnetHash = infoHash || parsedMagnet?.infoHash || null;
      if (!magnetHash) throw new Error('Não foi possível extrair infoHash');

      const dnMagnet = parsedMagnet?.nome || magnetData.title;

      const existingTorrent: any = await getTorrent(magnetHash);
      if (existingTorrent) {
        //Scraper manda seeds=0 quando não sabe — não sobrescreve o valor real que já tá no banco.
        const seedsFinais = this.resolverSeedsFinais(magnetData.seeds, existingTorrent.seeders, 'saveToDatabase');
        await upsertTorrent(magnetHash, {
          seeders: seedsFinais,
          lastSeen: new Date()
        });
        return false;
      }

      if (!titleMatchResult.matches) return false;

      // Decision passada pronta pelo autoAddMagnet — não recalcula aqui.
      let imdbSeason: number | null = null;
      let imdbSeasonEnd: number | null = null;
      let imdbEpisodeStart: number | null = null;
      let imdbEpisodeEnd: number | null = null;

      if (magnetData.category === 'serie') {
        if (magnetData.imdbSeason !== undefined && magnetData.imdbSeason !== null) {
          imdbSeason = magnetData.imdbSeason;
          imdbSeasonEnd = magnetData.imdbSeason;
        }
        if (magnetData.imdbEpisode !== undefined && magnetData.imdbEpisode !== null) {
          imdbEpisodeStart = magnetData.imdbEpisode;
          imdbEpisodeEnd = magnetData.imdbEpisode;
        }
      }

      logger.info('Salvando torrent no banco', {
        infoHash: magnetHash,
        imdbId: magnetData.imdbId,
        imdbSeason,
        imdbSeasonEnd,
        imdbEpisodeStart,
        imdbEpisodeEnd,
        isCompleteSeason: titleMatchResult.torrentMetadata.isCompleteSeason,
      });

      await createTorrent({
        infoHash: magnetHash,
        provider,
        title: magnetData.title,
        size: this.parseSizeToBytes(magnetData.size) || 0,
        type: magnetData.category === 'serie' ? 'series' : 'movie',
        imdbId: magnetData.imdbId || null,
        imdbSeason,
        imdbSeasonEnd,
        imdbEpisodeStart,
        imdbEpisodeEnd,
        seeders: magnetData.seeds || 0,
        idioma: magnetData.language,
        qualidade: magnetData.quality,
        magnet: magnetData.magnet,
        uploadDate: new Date(),
        lastSeen: new Date(),
        rescrapeAt: RescrapeService.computeRescrapeAt(dnMagnet, magnetData.quality)
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

  //Ponto de entrada: valida o título e, se passar, grava no banco
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
      const cached = this.validationCache.get<AutoMagnetResult>(cacheKey);
      if (cached) return cached;

      if (!this.validateMagnetLink(magnetLink)) {
        const result: AutoMagnetResult = { success: false, magnetAdded: false, message: 'Link magnet inválido' };
        this.validationCache.set(cacheKey, result, this.cacheTTL);
        return result;
      }

      // Parse único — usado pra hash, dn= e range.
      const parsedMagnet = await analisarMagnet(magnetLink).catch(() => null);
      const hashRapido = infoHash || parsedMagnet?.infoHash || null;

      // Short-circuit por hash — se já tá no banco, só atualiza seeders e sai.
      if (hashRapido) {
        const existente: any = await getTorrent(hashRapido);
        if (existente) {
          //Scraper manda seeds=0 quando não sabe — não sobrescreve o valor real que já tá no banco.
          const seedsFinais = this.resolverSeedsFinais(seeds, existente.seeders, 'short-circuit');
          await upsertTorrent(hashRapido, { seeders: seedsFinais, lastSeen: new Date() });
          const result: AutoMagnetResult = { success: true, magnetAdded: false, message: 'Já existe no banco' };
          this.validationCache.set(cacheKey, result, this.cacheTTL);
          return result;
        }
      }

      const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
      if (!imdbTitles || imdbTitles.allTitles.length === 0) {
        const result: AutoMagnetResult = { success: false, magnetAdded: false, message: 'Títulos IMDB não encontrados' };
        this.validationCache.set(cacheKey, result, this.cacheTTL);
        return result;
      }

      // Para séries priorizamos o título completo (tem temporada e episódio).
      // Para filmes, o título original costuma ser mais limpo.
      const titleForValidation = type === 'series'
        ? (torrentTitle?.trim() || originalTitle?.trim() || '')
        : (originalTitle?.trim() || torrentTitle?.trim() || '');

      const titleForLanguage = type === 'series'
        ? (originalTitle?.trim() || undefined)
        : (torrentTitle?.trim() || undefined);

      const titleMatchResult = await this.validateTitleWithCache(
        titleForValidation,
        imdbId,
        imdbSeason,
        imdbEpisode !== null ? imdbEpisode : undefined,
        titleForLanguage
      );

      if (!titleMatchResult.matches) {
        const result: AutoMagnetResult = {
          success: false,
          magnetAdded: false,
          message: 'Título não corresponde',
          validation: { titleMatches: false, reason: titleMatchResult.reason || 'Título não corresponde' }
        };
        this.validationCache.set(cacheKey, result, this.cacheTTL);
        return result;
      }

      const effectiveTitle = titleForValidation;
      const category = type === 'series' ? 'serie' : 'filme';

      // ── Decisão única de S/E ──────────────────────────────────────
      // Ordem: range do contexto (htmlTitle > dn= > title) vence tudo.
      // Se não tem range útil, cai no que o request mandou, depois em fallbacks.
      let finalSeason: number | undefined = imdbSeason;
      let finalEpisode: number | null | undefined = imdbEpisode;
      let fonteDecisao = 'request';

      if (type === 'series') {
        const { range: rangeDoContexto, fonte: rangeFonte } = this.calcularRangeDoContexto(
          htmlTitle, parsedMagnet?.nome ?? null, effectiveTitle
        );
        const metadata = titleFilter.extrairMetadados(effectiveTitle);
        const multiplos = episodeMatcher.temMultiplosEpisodios(effectiveTitle);
        const ehPack = episodeMatcher.ehPackTemporadaCompleta(effectiveTitle);

        // Season: range explícito > request > metadata
        if (finalSeason === undefined && rangeDoContexto?.seasonStart) {
          finalSeason = rangeDoContexto.seasonStart;
          fonteDecisao = 'range_contexto';
        }
        if (finalSeason === undefined && metadata.season) {
          finalSeason = metadata.season;
          fonteDecisao = 'metadata';
        }

        // Episode: range explícito > request (número) > request (null=pack) > fallbacks
        if (rangeDoContexto && rangeDoContexto.episodeStart > 0) {
          finalEpisode = rangeDoContexto.episodeStart;
          fonteDecisao = 'range_contexto';
        } else if (imdbEpisode === null) {
          finalEpisode = null;
          fonteDecisao = 'request_null';
        } else if (finalEpisode === undefined) {
          if (multiplos.temMultiplos) {
            fonteDecisao = 'multi_ep_sem_alvo';
          } else if (metadata.episode) {
            finalEpisode = metadata.episode;
            fonteDecisao = 'metadata';
          } else if (ehPack) {
            finalEpisode = null;
            fonteDecisao = 'ehpack';
          }
        }

        //Log objetivo da decisão — rastreia de onde veio cada S/E
        logger.debug('AUTO_MAGNET_DECISAO', {
          title: effectiveTitle.substring(0, 50),
          htmlTitle: htmlTitle?.substring(0, 40) || '-',
          dn: parsedMagnet?.nome?.substring(0, 40) || '-',
          rangeFonte: rangeFonte?.substring(0, 40) || '-',
          reqS: imdbSeason ?? '-',
          reqE: imdbEpisode === null ? 'null' : (imdbEpisode ?? '-'),
          finalS: finalSeason ?? '-',
          finalE: finalEpisode === null ? 'null' : (finalEpisode ?? '-'),
          fonte: fonteDecisao,
        });
      }

      const language = this.detectLanguage(effectiveTitle);

      const allQualities = qualityDetector.extractAllQualities(effectiveTitle);
      const finalQuality = allQualities.length > 0
        ? allQualities[0]
        : (quality || qualityDetector.extractQualityFromFilename(effectiveTitle));

      const magnetData: MagnetData = {
        imdbId,
        title: effectiveTitle,
        magnet: magnetLink,
        quality: finalQuality,
        seeds,
        size,
        category,
        language,
        addedAt: new Date().toISOString(),
        imdbSeason: finalSeason,
        imdbEpisode: finalEpisode,
        imdbTitle: imdbTitles.originalTitle,
        matchedImdbTitle: titleMatchResult.matchedTitle,
        matchedLanguage: titleMatchResult.matchedLanguage
      };

      const saved = await this.saveToDatabase(magnetData, titleMatchResult, hashRapido || undefined, provider);

      if (!saved) {
        const result: AutoMagnetResult = { success: false, magnetAdded: false, message: 'Já existe no banco' };
        this.validationCache.set(cacheKey, result, this.cacheTTL);
        return result;
      }

      const result: AutoMagnetResult = {
        success: true,
        magnetAdded: true,
        magnetData,
        validation: {
          titleMatches: true,
          seasonMatches: finalSeason !== undefined,
          episodeMatches: finalEpisode !== undefined && finalEpisode !== null,
          matchedTitle: magnetData.matchedImdbTitle,
          matchedLanguage: magnetData.matchedLanguage,
          reason: 'Título validado'
        }
      };
      this.validationCache.set(cacheKey, result, this.cacheTTL);
      return result;
    } catch (error) {
      logger.error('Erro ao adicionar magnet', {
        title: torrentTitle.substring(0, 60),
        imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });
      const result: AutoMagnetResult = { success: false, magnetAdded: false, message: `Erro: ${error instanceof Error ? error.message : 'Erro'}` };
      this.validationCache.set(cacheKey, result, this.cacheTTL);
      return result;
    }
  }

  //Resolve no Torbox sob demanda, criando o torrent na conta do usuário se ainda não existir
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
  }

  getStats() {
    return {
      cacheSize: this.validationCache.getStats().size,
      titleCacheSize: this.titleValidationCache.getStats().size,
    };
  }
}

export default AutoMagnetService;