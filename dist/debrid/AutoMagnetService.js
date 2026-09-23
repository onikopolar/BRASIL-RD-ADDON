"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoMagnetService = void 0;
const repository_js_1 = require("../lib/repository.js");
const RealDebridService_js_1 = require("./RealDebridService.js");
const ImdbScraperService_js_1 = require("../catalogo/ImdbScraperService.js");
const logger_js_1 = require("../utils/logger.js");
const titleFilter_js_1 = require("../titulos/titleFilter.js");
const episodeMatcher_js_1 = require("../titulos/episodeMatcher.js");
const qualityDetector_js_1 = require("../lib/qualityDetector.js");
const magnetHelper_js_1 = require("../magnet/magnetHelper.js");
const TechnicalWords_js_1 = require("../titulos/TechnicalWords.js");
const LanguageDetector_js_1 = require("../titulos/LanguageDetector.js");
const RescrapeService_js_1 = require("../services/scraper/RescrapeService.js");
const CacheService_js_1 = require("../debrid/CacheService.js");
const logger = new logger_js_1.Logger('AutoMagnetService');
const torboxService = new RealDebridService_js_1.TorboxService();
const imdbScraper = ImdbScraperService_js_1.ImdbScraperService.getInstance();
const titleFilter = titleFilter_js_1.TitleFilter.getInstance();
const episodeMatcher = episodeMatcher_js_1.EpisodeMatcher.getInstance();
const qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
const LEGENDADO_REGEX = new RegExp('\\b(' + TechnicalWords_js_1.INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b', 'i');
class AutoMagnetService {
    constructor() {
        this.validationCache = new CacheService_js_1.CacheService();
        this.titleValidationCache = new CacheService_js_1.CacheService();
        this.cacheTTL = 30000;
        this.titleCacheTTL = 60000;
    }
    async validateTitleWithCache(torrentTitle, imdbId, season, episode, tituloParaIdioma) {
        const cacheKey = `title_${imdbId}_${torrentTitle.substring(0, 100)}_${season}_${episode}_${tituloParaIdioma || ''}`;
        const cached = this.titleValidationCache.get(cacheKey);
        if (cached)
            return cached;
        const result = await titleFilter.titulosCombinam(torrentTitle, imdbId, season, episode, tituloParaIdioma);
        this.titleValidationCache.set(cacheKey, result, this.titleCacheTTL);
        return result;
    }
    validateMagnetLink(magnet) {
        return magnet.startsWith('magnet:') && magnet.includes('xt=urn:btih:') && magnet.length > 50;
    }
    detectLanguage(title) {
        const lower = title.toLowerCase();
        if (lower.includes('dublado') || lower.includes('dublada') || lower.includes('dublagem'))
            return 'pt-BR';
        if (lower.includes('dual audio') || lower.includes('dual áudio'))
            return 'pt-BR,en';
        if (LEGENDADO_REGEX.test(lower))
            return 'legendado';
        if (lower.includes('nacional'))
            return 'pt-BR';
        if (/\b(english|eng)\b/i.test(lower))
            return 'en';
        if (/\b(español|spanish|espanol)\b/i.test(lower))
            return 'es';
        if (/\b(french|francês|frances)\b/i.test(lower))
            return 'fr';
        const langResult = LanguageDetector_js_1.LanguageDetector.getInstance().verificarIdioma(title);
        if (langResult.palavrasPt.length > 0)
            return 'pt-BR';
        if (langResult.palavrasEn.length > 0)
            return 'en';
        return 'unknown';
    }
    parseSizeToBytes(size) {
        if (!size)
            return 0;
        const match = size.toLowerCase().trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]b?)?$/i);
        if (!match)
            return 0;
        const value = parseFloat(match[1]);
        const unit = match[2] ? match[2].toLowerCase().charAt(0) : 'b';
        const multipliers = { b: 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3, t: 1024 ** 4 };
        return Math.floor(value * (multipliers[unit] || 1));
    }
    async extrairHashDoMagnet(magnet) {
        const dados = await (0, magnetHelper_js_1.analisarMagnet)(magnet);
        return dados ? dados.infoHash : null;
    }
    escolherRangeSource(htmlTitle, dn, title) {
        const fontes = [htmlTitle, dn, title];
        for (const fonte of fontes) {
            if (!fonte)
                continue;
            const r = (0, TechnicalWords_js_1.extrairRangeEpisodios)(fonte);
            if (r && (r.seasonStart > 0 || r.episodeStart > 0))
                return fonte;
        }
        return htmlTitle || dn || title;
    }
    calcularRangeDoContexto(htmlTitle, dn, title) {
        const source = this.escolherRangeSource(htmlTitle, dn, title);
        if (!source)
            return { range: null, fonte: null };
        return { range: (0, TechnicalWords_js_1.extrairRangeEpisodios)(source), fonte: source };
    }
    resolverSeedsFinais(seedsNovos, seedsExistentes, contexto) {
        const novo = seedsNovos || 0;
        if (novo > 0)
            return novo;
        const preservado = seedsExistentes ?? 0;
        if (preservado > 0) {
            logger.debug('SEEDS_PRESERVADOS', { contexto, valor: preservado });
        }
        return preservado;
    }
    async saveToDatabase(magnetData, titleMatchResult, infoHash, provider) {
        try {
            const parsedMagnet = await (0, magnetHelper_js_1.analisarMagnet)(magnetData.magnet);
            const magnetHash = infoHash || parsedMagnet?.infoHash || null;
            if (!magnetHash)
                throw new Error('Não foi possível extrair infoHash');
            const dnMagnet = parsedMagnet?.nome || magnetData.title;
            const existingTorrent = await (0, repository_js_1.getTorrent)(magnetHash);
            if (existingTorrent) {
                const seedsFinais = this.resolverSeedsFinais(magnetData.seeds, existingTorrent.seeders, 'saveToDatabase');
                await (0, repository_js_1.upsertTorrent)(magnetHash, {
                    seeders: seedsFinais,
                    lastSeen: new Date()
                });
                return false;
            }
            if (!titleMatchResult.matches)
                return false;
            let imdbSeason = null;
            let imdbSeasonEnd = null;
            let imdbEpisodeStart = null;
            let imdbEpisodeEnd = null;
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
            await (0, repository_js_1.createTorrent)({
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
                rescrapeAt: RescrapeService_js_1.RescrapeService.computeRescrapeAt(dnMagnet, magnetData.quality)
            });
            return true;
        }
        catch (error) {
            logger.error('Erro ao salvar magnet', {
                title: magnetData.title.substring(0, 60),
                error: error instanceof Error ? error.message : 'Erro'
            });
            throw error;
        }
    }
    async autoAddMagnet(magnetLink, torrentTitle, imdbId, type, seeds = 50, quality, size, imdbSeason, imdbEpisode, infoHash, provider, originalTitle, htmlTitle) {
        const cacheKey = `${magnetLink}-${imdbId}-${imdbSeason}-${imdbEpisode}`;
        try {
            const cached = this.validationCache.get(cacheKey);
            if (cached)
                return cached;
            if (!this.validateMagnetLink(magnetLink)) {
                const result = { success: false, magnetAdded: false, message: 'Link magnet inválido' };
                this.validationCache.set(cacheKey, result, this.cacheTTL);
                return result;
            }
            const parsedMagnet = await (0, magnetHelper_js_1.analisarMagnet)(magnetLink).catch(() => null);
            const hashRapido = infoHash || parsedMagnet?.infoHash || null;
            if (hashRapido) {
                const existente = await (0, repository_js_1.getTorrent)(hashRapido);
                if (existente) {
                    const seedsFinais = this.resolverSeedsFinais(seeds, existente.seeders, 'short-circuit');
                    await (0, repository_js_1.upsertTorrent)(hashRapido, { seeders: seedsFinais, lastSeen: new Date() });
                    const result = { success: true, magnetAdded: false, message: 'Já existe no banco' };
                    this.validationCache.set(cacheKey, result, this.cacheTTL);
                    return result;
                }
            }
            const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
            if (!imdbTitles || imdbTitles.allTitles.length === 0) {
                const result = { success: false, magnetAdded: false, message: 'Títulos IMDB não encontrados' };
                this.validationCache.set(cacheKey, result, this.cacheTTL);
                return result;
            }
            const titleForValidation = type === 'series'
                ? (torrentTitle?.trim() || originalTitle?.trim() || '')
                : (originalTitle?.trim() || torrentTitle?.trim() || '');
            const titleForLanguage = type === 'series'
                ? (originalTitle?.trim() || undefined)
                : (torrentTitle?.trim() || undefined);
            const titleMatchResult = await this.validateTitleWithCache(titleForValidation, imdbId, imdbSeason, imdbEpisode !== null ? imdbEpisode : undefined, titleForLanguage);
            if (!titleMatchResult.matches) {
                const result = {
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
            let finalSeason = imdbSeason;
            let finalEpisode = imdbEpisode;
            let fonteDecisao = 'request';
            if (type === 'series') {
                const { range: rangeDoContexto, fonte: rangeFonte } = this.calcularRangeDoContexto(htmlTitle, parsedMagnet?.nome ?? null, effectiveTitle);
                const metadata = titleFilter.extrairMetadados(effectiveTitle);
                const multiplos = episodeMatcher.temMultiplosEpisodios(effectiveTitle);
                const ehPack = episodeMatcher.ehPackTemporadaCompleta(effectiveTitle);
                if (finalSeason === undefined && rangeDoContexto?.seasonStart) {
                    finalSeason = rangeDoContexto.seasonStart;
                    fonteDecisao = 'range_contexto';
                }
                if (finalSeason === undefined && metadata.season) {
                    finalSeason = metadata.season;
                    fonteDecisao = 'metadata';
                }
                if (rangeDoContexto && rangeDoContexto.episodeStart > 0) {
                    finalEpisode = rangeDoContexto.episodeStart;
                    fonteDecisao = 'range_contexto';
                }
                else if (imdbEpisode === null) {
                    finalEpisode = null;
                    fonteDecisao = 'request_null';
                }
                else if (finalEpisode === undefined) {
                    if (multiplos.temMultiplos) {
                        fonteDecisao = 'multi_ep_sem_alvo';
                    }
                    else if (metadata.episode) {
                        finalEpisode = metadata.episode;
                        fonteDecisao = 'metadata';
                    }
                    else if (ehPack) {
                        finalEpisode = null;
                        fonteDecisao = 'ehpack';
                    }
                }
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
            const magnetData = {
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
                const result = { success: false, magnetAdded: false, message: 'Já existe no banco' };
                this.validationCache.set(cacheKey, result, this.cacheTTL);
                return result;
            }
            const result = {
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
        }
        catch (error) {
            logger.error('Erro ao adicionar magnet', {
                title: torrentTitle.substring(0, 60),
                imdbId,
                error: error instanceof Error ? error.message : 'Erro'
            });
            const result = { success: false, magnetAdded: false, message: `Erro: ${error instanceof Error ? error.message : 'Erro'}` };
            this.validationCache.set(cacheKey, result, this.cacheTTL);
            return result;
        }
    }
    async processTorboxOnClick(magnetData, apiKey) {
        try {
            const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);
            if (existingTorrent.found && existingTorrent.downloaded) {
                const streamLink = await torboxService.getStreamLinkForTorrent(existingTorrent.torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined);
                return { success: true, streamLink: streamLink || undefined, status: 'downloaded' };
            }
            if (existingTorrent.found) {
                return { success: true, status: existingTorrent.status || 'downloading', message: `Download: ${existingTorrent.status}` };
            }
            const torrentId = await torboxService.addMagnet(magnetData.magnet, apiKey);
            try {
                const torrentInfo = await torboxService.getTorrentInfo(torrentId, apiKey);
                let streamLink = null;
                if (torrentInfo.download_state === 'completed' || torrentInfo.download_state === 'cached') {
                    streamLink = await torboxService.getStreamLinkForTorrent(torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined);
                }
                return { success: true, status: torrentInfo.download_state, streamLink: streamLink || undefined, message: `Torrent adicionado: ${torrentInfo.download_state}` };
            }
            catch {
                return { success: true, status: 'downloading', message: 'Torrent na fila do Torbox, aguardando processamento' };
            }
        }
        catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (/already queued|already exists|already added/i.test(msg)) {
                const existing = await this.checkExistingTorrent(magnetData.magnet, apiKey);
                if (existing.found && existing.downloaded) {
                    const streamLink = await torboxService.getStreamLinkForTorrent(existing.torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined);
                    return { success: true, streamLink: streamLink || undefined, status: 'downloaded' };
                }
                return { success: true, status: 'queued', message: 'Torrent já está na fila do Torbox' };
            }
            const existing = await this.checkExistingTorrent(magnetData.magnet, apiKey);
            if (existing.found && existing.downloaded) {
                const streamLink = await torboxService.getStreamLinkForTorrent(existing.torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode !== null ? magnetData.imdbEpisode : undefined);
                return { success: true, streamLink: streamLink || undefined, status: 'downloaded' };
            }
            if (existing.found)
                return { success: true, status: existing.status || 'downloading', message: `Status: ${existing.status}` };
            return { success: false, status: 'error', message: `Erro Torbox: ${msg.substring(0, 150)}` };
        }
    }
    async checkExistingTorrent(magnet, apiKey) {
        try {
            const magnetHash = await this.extrairHashDoMagnet(magnet);
            if (!magnetHash)
                return { found: false, downloaded: false };
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
        }
        catch {
            return { found: false, downloaded: false };
        }
    }
    clearCache() {
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
exports.AutoMagnetService = AutoMagnetService;
exports.default = AutoMagnetService;
