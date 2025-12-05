"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoMagnetService = void 0;
const repository_1 = require("../lib/repository");
const RealDebridService_1 = require("./RealDebridService");
const ImdbScraperService_1 = require("./ImdbScraperService");
const logger_1 = require("../utils/logger");
const titleFilter_1 = require("../lib/titleFilter");
const qualityDetector_1 = require("../lib/qualityDetector");
const logger = new logger_1.Logger('AutoMagnetService');
const rdService = new RealDebridService_1.RealDebridService();
const imdbScraper = new ImdbScraperService_1.ImdbScraperService();
const titleFilter = new titleFilter_1.TitleFilter();
const qualityDetector = new qualityDetector_1.QualityDetector();
class AutoMagnetService {
    constructor() {
        this.validationCache = new Map();
        this.cacheTTL = 30000;
        logger.info('v1.2.0 inicializado', { feature: 'Fix season/episode' });
    }
    async autoAddMagnet(magnetLink, torrentTitle, imdbId, type, seeds = 50, quality, size, imdbSeason, imdbEpisode) {
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
            const titleMatchResult = await titleFilter.doTitlesMatch(torrentTitle, imdbId, imdbSeason, imdbEpisode);
            if (!titleMatchResult.matches) {
                let rejectionReason = titleMatchResult.reason || 'Título não corresponde';
                if (type === 'series' && imdbSeason !== undefined) {
                    const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
                    if (torrentMetadata.hasEpisodeInfo) {
                        if (torrentMetadata.season && torrentMetadata.season !== imdbSeason) {
                            rejectionReason = `Temporada errada: S${torrentMetadata.season} vs S${imdbSeason}`;
                        }
                        else if (imdbEpisode !== undefined && torrentMetadata.episode && torrentMetadata.episode !== imdbEpisode) {
                            rejectionReason = `Episódio errado: E${torrentMetadata.episode} vs E${imdbEpisode}`;
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
            let torrentSeason = imdbSeason;
            let torrentEpisode = imdbEpisode;
            if (type === 'series') {
                const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
                logger.debug('Season/Episode debug', {
                    torrentTitle: torrentTitle.substring(0, 60),
                    passedSeason: imdbSeason,
                    passedEpisode: imdbEpisode,
                    extractedSeason: torrentMetadata.season,
                    extractedEpisode: torrentMetadata.episode,
                    hasEpisodeInfo: torrentMetadata.hasEpisodeInfo
                });
                if (torrentSeason === undefined && torrentMetadata.season) {
                    torrentSeason = torrentMetadata.season;
                }
                if (torrentEpisode === undefined && torrentMetadata.episode) {
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
            const finalQuality = quality || qualityDetector.extractQualityFromFilename(torrentTitle);
            const magnetData = {
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
            const saved = await this.saveToDatabase(magnetData, imdbTitles);
            if (saved) {
                let validationMessage = 'Título validado';
                if (titleMatchResult.matchedLanguage === 'português') {
                    validationMessage += ' (pt)';
                }
                if (type === 'series' && torrentSeason) {
                    validationMessage += ` | S${torrentSeason}`;
                    if (torrentEpisode) {
                        validationMessage += `E${torrentEpisode}`;
                    }
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
                    quality: magnetData.quality,
                    season: magnetData.imdbSeason,
                    episode: magnetData.imdbEpisode
                });
                return result;
            }
            else {
                const result = { success: false, magnetAdded: false, message: 'Já existe no banco' };
                this.validationCache.set(cacheKey, { valid: false, data: result, timestamp: Date.now() });
                return result;
            }
        }
        catch (error) {
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
    validateMagnetLink(magnet) {
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
    detectLanguage(title) {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('dual'))
            return 'pt-BR,en';
        if (lowerTitle.includes('dublado'))
            return 'pt-BR';
        if (lowerTitle.includes('legendado'))
            return 'pt';
        if (lowerTitle.includes('english') || lowerTitle.includes('eng'))
            return 'en';
        if (lowerTitle.includes('español') || lowerTitle.includes('spanish'))
            return 'es';
        return 'pt-BR';
    }
    async saveToDatabase(magnetData, imdbTitles) {
        try {
            const magnetHash = this.extractHashFromMagnet(magnetData.magnet);
            if (!magnetHash) {
                throw new Error('Não foi extrair infoHash');
            }
            logger.debug('Salvando no banco', {
                title: magnetData.title.substring(0, 60),
                imdbId: magnetData.imdbId,
                season: magnetData.imdbSeason,
                episode: magnetData.imdbEpisode,
                category: magnetData.category
            });
            if (magnetData.category === 'serie' && magnetData.imdbSeason !== undefined) {
                const existingEpisode = await repository_1.File.findOne({
                    where: {
                        infoHash: magnetHash,
                        imdbId: magnetData.imdbId,
                        imdbSeason: magnetData.imdbSeason,
                        imdbEpisode: magnetData.imdbEpisode
                    }
                });
                if (existingEpisode) {
                    logger.debug('Episódio já existe', {
                        title: magnetData.title.substring(0, 60),
                        imdbId: magnetData.imdbId,
                        imdbSeason: magnetData.imdbSeason,
                        imdbEpisode: magnetData.imdbEpisode
                    });
                    return false;
                }
            }
            else {
                const existingTorrent = await (0, repository_1.getTorrent)(magnetHash);
                if (existingTorrent) {
                    logger.debug('Magnet já existe', {
                        title: magnetData.title.substring(0, 60),
                        imdbId: magnetData.imdbId
                    });
                    return false;
                }
            }
            if (magnetData.matchedImdbTitle) {
                const finalValidation = await titleFilter.doTitlesMatch(magnetData.title, magnetData.imdbId, magnetData.imdbSeason, magnetData.imdbEpisode);
                if (!finalValidation.matches) {
                    logger.error('Validação final falhou', {
                        imdbId: magnetData.imdbId,
                        title: magnetData.title.substring(0, 60),
                        reason: 'Falhou na validação final'
                    });
                    return false;
                }
            }
            const existingTorrent = await (0, repository_1.getTorrent)(magnetHash);
            if (!existingTorrent) {
                await (0, repository_1.createTorrent)({
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
            }
            await (0, repository_1.createFile)({
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
            logger.info('Magnet salvo no DB', {
                title: magnetData.title.substring(0, 60),
                imdbId: magnetData.imdbId,
                quality: magnetData.quality,
                season: magnetData.imdbSeason,
                episode: magnetData.imdbEpisode
            });
            return true;
        }
        catch (error) {
            logger.error('Erro ao salvar magnet', {
                error: error instanceof Error ? error.message : 'Erro',
                title: magnetData.title.substring(0, 60),
                imdbId: magnetData.imdbId
            });
            throw error;
        }
    }
    parseSizeToBytes(size) {
        if (!size)
            return 0;
        try {
            const sizeLower = size.toLowerCase().trim();
            const match = sizeLower.match(/^(\d+(?:\.\d+)?)\s*([kmgt]b?)?$/i);
            if (!match)
                return 0;
            const value = parseFloat(match[1]);
            const unit = match[2] ? match[2].toLowerCase().charAt(0) : 'b';
            const multipliers = {
                'b': 1,
                'k': 1024,
                'm': 1024 * 1024,
                'g': 1024 * 1024 * 1024,
                't': 1024 * 1024 * 1024 * 1024
            };
            return Math.floor(value * (multipliers[unit] || 1));
        }
        catch {
            return 0;
        }
    }
    extractHashFromMagnet(magnet) {
        const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
        return match ? match[1].toLowerCase() : null;
    }
    async processRealDebridOnClick(magnetData, apiKey) {
        try {
            logger.info('Processando RD', {
                title: magnetData.title.substring(0, 60),
                imdbId: magnetData.imdbId
            });
            const existingTorrent = await this.checkExistingTorrent(magnetData.magnet, apiKey);
            if (existingTorrent.found && existingTorrent.downloaded) {
                logger.info('Torrent já baixado no RD', {
                    title: magnetData.title.substring(0, 60),
                    torrentId: existingTorrent.torrentId
                });
                const streamLink = await rdService.getStreamLinkForTorrent(existingTorrent.torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode);
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
            let streamLink = null;
            if (torrentInfo.status === 'downloaded') {
                streamLink = await rdService.getStreamLinkForTorrent(torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode);
            }
            return {
                success: true,
                status: torrentInfo.status,
                streamLink: streamLink || undefined,
                message: `Torrent adicionado: ${torrentInfo.status}`
            };
        }
        catch (error) {
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
    async checkExistingTorrent(magnet, apiKey) {
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
        }
        catch (error) {
            return { found: false, downloaded: false };
        }
    }
    extractMagnetHash(magnet) {
        const match = magnet.match(/btih:([^&]+)/i);
        return match ? match[1] : '';
    }
    async testTitleValidation(torrentTitle, imdbId, testSeason, testEpisode) {
        try {
            const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
            const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
            const matchResult = await titleFilter.doTitlesMatch(torrentTitle, imdbId, testSeason, testEpisode);
            let seasonMatch = true;
            let episodeMatch = true;
            let reason = '';
            if (testSeason !== undefined && torrentMetadata.season) {
                seasonMatch = torrentMetadata.season === testSeason;
                if (!seasonMatch) {
                    reason += ` Temporada: Torrent S${torrentMetadata.season} vs Teste S${testSeason}.`;
                }
            }
            if (testEpisode !== undefined && torrentMetadata.episode) {
                episodeMatch = torrentMetadata.episode === testEpisode;
                if (!episodeMatch) {
                    reason += ` Episódio: Torrent E${torrentMetadata.episode} vs Teste E${testEpisode}.`;
                }
            }
            const valid = matchResult.matches && seasonMatch && episodeMatch;
            if (valid) {
                reason = `✅ Válido: "${torrentTitle}" → "${matchResult.matchedTitle}"`;
                if (matchResult.matchedLanguage === 'português') {
                    reason += ' (pt)';
                }
                if (torrentMetadata.season)
                    reason += ` S${torrentMetadata.season}`;
                if (torrentMetadata.episode)
                    reason += `E${torrentMetadata.episode}`;
                reason += ` (${(matchResult.similarity * 100).toFixed(1)}%)`;
            }
            else {
                reason = `❌ Inválido: "${torrentTitle}"`;
                if (imdbTitles.allTitles.length > 0) {
                    reason += ` ≠ IMDB: ${imdbTitles.allTitles.join(' / ')}`;
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
        }
        catch (error) {
            return {
                valid: false,
                torrentTitle,
                reason: `Erro: ${error instanceof Error ? error.message : 'Erro'}`
            };
        }
    }
    extractSeriesMetadata(torrentTitle) {
        return titleFilter.extractSeriesMetadata(torrentTitle);
    }
    async getImdbTitles(imdbId) {
        try {
            return await imdbScraper.getTitlesFromImdbId(imdbId);
        }
        catch (error) {
            logger.error('Erro títulos IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro'
            });
            return null;
        }
    }
    clearCache() {
        this.validationCache.clear();
    }
    getStats() {
        return {
            cacheSize: this.validationCache.size,
            cacheTTL: this.cacheTTL,
            version: '1.2.0'
        };
    }
}
exports.AutoMagnetService = AutoMagnetService;
exports.default = AutoMagnetService;
