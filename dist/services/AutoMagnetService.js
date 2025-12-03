"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AutoMagnetService = void 0;
const repository_1 = require("../lib/repository");
const RealDebridService_1 = require("./RealDebridService");
const ImdbScraperService_1 = require("./ImdbScraperService");
const logger_1 = require("../utils/logger");
const titleFilter_1 = require("../lib/titleFilter");
const logger = new logger_1.Logger('AutoMagnetService');
const rdService = new RealDebridService_1.RealDebridService();
const imdbScraper = new ImdbScraperService_1.ImdbScraperService();
const titleFilter = new titleFilter_1.TitleFilter();
class AutoMagnetService {
    constructor() {
        logger.info('AutoMagnetService inicializado - Validação com suporte a múltiplos idiomas');
    }
    async autoAddMagnet(magnetLink, torrentTitle, imdbId, type, seeds = 50, quality, size, imdbSeason, imdbEpisode) {
        try {
            logger.info('Processando magnet automaticamente', {
                torrentTitle,
                imdbId,
                type,
                imdbSeason,
                imdbEpisode,
                magnetLink: magnetLink.substring(0, 50) + '...'
            });
            if (!this.validateMagnetLink(magnetLink)) {
                return {
                    success: false,
                    magnetAdded: false,
                    message: 'Link magnet inválido'
                };
            }
            const imdbTitles = await imdbScraper.getTitlesFromImdbId(imdbId);
            if (!imdbTitles || imdbTitles.allTitles.length === 0) {
                logger.warn('Não foi possível obter títulos do IMDB', { imdbId });
                return {
                    success: false,
                    magnetAdded: false,
                    message: 'Títulos IMDB não encontrados'
                };
            }
            const titleMatchResult = await titleFilter.doTitlesMatch(torrentTitle, imdbId, imdbSeason, imdbEpisode);
            if (!titleMatchResult.matches) {
                let rejectionReason = titleMatchResult.reason || 'Título do torrent não corresponde aos títulos do IMDB';
                if (type === 'series' && imdbSeason !== undefined) {
                    const torrentMetadata = titleFilter.extractSeriesMetadata(torrentTitle);
                    if (torrentMetadata.hasEpisodeInfo) {
                        if (torrentMetadata.season && torrentMetadata.season !== imdbSeason) {
                            rejectionReason = `Temporada errada: Torrent S${torrentMetadata.season} vs Solicitado S${imdbSeason}`;
                        }
                        else if (imdbEpisode !== undefined && torrentMetadata.episode && torrentMetadata.episode !== imdbEpisode) {
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
            const category = type === 'series' ? 'serie' : 'filme';
            const language = this.detectLanguage(torrentTitle);
            const finalQuality = quality || this.extractQualityFromTitle(torrentTitle);
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
            }
            else {
                return {
                    success: false,
                    magnetAdded: false,
                    message: 'Episódio já existe no banco de dados'
                };
            }
        }
        catch (error) {
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
    async getImdbTitle(imdbId) {
        try {
            const titles = await imdbScraper.getTitlesFromImdbId(imdbId);
            if (titles && titles.allTitles.length > 0) {
                const title = titles.portugueseTitle || titles.originalTitle;
                logger.debug('Título obtido do serviço IMDB', { imdbId, title });
                return title;
            }
            const knownTitles = {
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
        }
        catch (error) {
            logger.debug('Erro ao buscar título do IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    extractQualityFromTitle(title) {
        const qualityMatch = title.match(/(4K|2160p|1080p|720p|480p|SD)/i);
        if (qualityMatch) {
            const matchedQuality = qualityMatch[1].toLowerCase();
            return matchedQuality === '2160p' ? '4K' : matchedQuality;
        }
        return '1080p';
    }
    validateMagnetLink(magnet) {
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
                throw new Error('Não foi possível extrair infoHash do magnet');
            }
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
                    logger.debug('Episódio já existe no banco de dados, ignorando', {
                        title: magnetData.title,
                        imdbId: magnetData.imdbId,
                        infoHash: magnetHash.substring(0, 8) + '...',
                        imdbSeason: magnetData.imdbSeason,
                        imdbEpisode: magnetData.imdbEpisode
                    });
                    return false;
                }
            }
            else {
                const existingTorrent = await (0, repository_1.getTorrent)(magnetHash);
                if (existingTorrent) {
                    logger.debug('Magnet já existe no banco de dados, ignorando', {
                        title: magnetData.title,
                        imdbId: magnetData.imdbId,
                        infoHash: magnetHash.substring(0, 8) + '...'
                    });
                    return false;
                }
            }
            if (magnetData.matchedImdbTitle) {
                const finalValidation = await titleFilter.doTitlesMatch(magnetData.title, magnetData.imdbId, magnetData.imdbSeason, magnetData.imdbEpisode);
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
                logger.debug('Torrent salvo no banco', {
                    infoHash: magnetHash.substring(0, 8) + '...',
                    title: magnetData.title
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
        }
        catch (error) {
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
                const streamLink = await rdService.getStreamLinkForTorrent(existingTorrent.torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode);
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
            logger.info('Adicionando torrent ao Real-Debrid', {
                title: magnetData.title,
                imdbSeason: magnetData.imdbSeason,
                imdbEpisode: magnetData.imdbEpisode
            });
            const torrentId = await rdService.addMagnet(magnetData.magnet, apiKey);
            await rdService.selectFiles(torrentId, apiKey, 'all');
            const torrentInfo = await rdService.getTorrentInfo(torrentId, apiKey);
            let streamLink = null;
            if (torrentInfo.status === 'downloaded') {
                streamLink = await rdService.getStreamLinkForTorrent(torrentId, apiKey, magnetData.imdbSeason, magnetData.imdbEpisode);
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
        }
        catch (error) {
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
    async checkExistingTorrent(magnet, apiKey) {
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
        }
        catch (error) {
            logger.debug('Erro ao verificar torrent no Real-Debrid', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
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
                if (torrentMetadata.season)
                    reason += ` S${torrentMetadata.season}`;
                if (torrentMetadata.episode)
                    reason += `E${torrentMetadata.episode}`;
                reason += ` (similaridade: ${(matchResult.similarity * 100).toFixed(1)}%)`;
            }
            else {
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
        }
        catch (error) {
            return {
                valid: false,
                torrentTitle,
                reason: `Erro no teste: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
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
            logger.error('Erro ao obter títulos do IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
}
exports.AutoMagnetService = AutoMagnetService;
exports.default = AutoMagnetService;
