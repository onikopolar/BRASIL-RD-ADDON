"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleFilter = void 0;
const logger_1 = require("../utils/logger");
const ImdbScraperService_1 = require("../services/ImdbScraperService");
const title_filter_1 = require("./title-filter");
class TitleFilter {
    constructor() {
        this.IMDB_CACHE_TTL = 30 * 60 * 1000;
        this.DEDUP_CACHE_TTL = 10 * 60 * 1000;
        this.TITLE_CACHE_TTL = 5 * 60 * 1000;
        this.VERSION = '2.6.0';
        this.logger = new logger_1.Logger('TitleFilter');
        this.logger.info(`TitleFilter v${this.VERSION} iniciado - Corrige detecção de temporadas completas`);
        this.logger.info(`SimilarityCalculator v23.3.2 integrado - Detecção inteligente de packs`);
        this.imdbScraper = new ImdbScraperService_1.ImdbScraperService();
        this.titleCleaner = new title_filter_1.TitleCleaner();
        this.languageDetector = new title_filter_1.LanguageDetector();
        this.similarityCalculator = new title_filter_1.SimilarityCalculator(undefined, true);
        this.metadataExtractor = new title_filter_1.MetadataExtractor();
        this.cacheManager = new title_filter_1.CacheManager();
    }
    cleanupOldCaches() {
        this.cacheManager.cleanupOldCaches(this.IMDB_CACHE_TTL, this.DEDUP_CACHE_TTL, this.TITLE_CACHE_TTL);
    }
    extractInfoHash(source) {
        if (typeof source === 'string') {
            const magnetMatch = source.match(/btih:([a-zA-Z0-9]{40})/i);
            return magnetMatch ? magnetMatch[1].toLowerCase() : null;
        }
        else if (source && typeof source === 'object') {
            if (source.infoHash) {
                return source.infoHash.toLowerCase();
            }
            if (source.magnet && typeof source.magnet === 'string') {
                const magnetMatch = source.magnet.match(/btih:([a-zA-Z0-9]{40})/i);
                return magnetMatch ? magnetMatch[1].toLowerCase() : null;
            }
        }
        return null;
    }
    createDedupeKey(torrentTitle, infoHash) {
        const cleanTitle = this.extractCleanTitle(torrentTitle).toLowerCase().replace(/\s+/g, '_');
        return infoHash ? `${infoHash}:${cleanTitle}` : cleanTitle;
    }
    isAlreadyProcessed(torrent) {
        const infoHash = this.extractInfoHash(torrent.magnet || torrent);
        const title = torrent.title || torrent;
        const dedupeKey = this.createDedupeKey(title, infoHash || undefined);
        if (Math.random() < 0.01) {
            this.cleanupOldCaches();
        }
        if (this.cacheManager.isAlreadyProcessed(dedupeKey)) {
            return true;
        }
        this.cacheManager.markAsProcessed(dedupeKey);
        return false;
    }
    deduplicateTorrents(torrents) {
        if (torrents.length <= 1)
            return torrents;
        const seen = new Set();
        const uniqueTorrents = [];
        let duplicatesRemoved = 0;
        for (const torrent of torrents) {
            const infoHash = this.extractInfoHash(torrent.magnet || torrent);
            const title = torrent.title || 'unknown';
            let key;
            if (infoHash) {
                key = infoHash;
            }
            else {
                const cleanTitle = this.extractCleanTitle(title).toLowerCase();
                key = cleanTitle;
            }
            if (seen.has(key)) {
                duplicatesRemoved++;
                continue;
            }
            seen.add(key);
            uniqueTorrents.push(torrent);
        }
        if (duplicatesRemoved > 0) {
            this.logger.info(`Deduplicação: ${duplicatesRemoved} removidos`);
        }
        return uniqueTorrents;
    }
    isPortugueseContent(torrentTitle) {
        return this.languageDetector.isPortugueseContent(torrentTitle);
    }
    normalizeForComparison(title) {
        return this.titleCleaner.normalizeForComparison(title);
    }
    extractCleanTitle(fullTitle) {
        return this.titleCleaner.extractCleanTitle(fullTitle);
    }
    extractSeriesMetadata(torrentTitle) {
        return this.metadataExtractor.extractSeriesMetadata(torrentTitle);
    }
    extractTorrentYear(torrentTitle) {
        const yearMatch = torrentTitle.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            return parseInt(yearMatch[0]);
        }
        return undefined;
    }
    hasMultipleEpisodes(torrentTitle) {
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
            this.logger.debug('Detectado múltiplos episódios', {
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
    isCompleteSeasonPack(torrentTitle) {
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
        if (hasCompletePattern && !hasSpecificEpisode) {
            this.logger.debug('Pack de temporada completa detectado', {
                title: torrentTitle.substring(0, 60),
                pattern: completeSeasonPatterns.find(p => p.test(lowerTitle))?.toString()
            });
            return true;
        }
        return false;
    }
    isEpisodeCompatible(torrentTitle, torrentEpisode, targetEpisode, targetSeason) {
        if (this.isCompleteSeasonPack(torrentTitle)) {
            return {
                compatible: true,
                reason: 'Pack de temporada completa - compatível com qualquer episódio'
            };
        }
        const multipleEpisodes = this.hasMultipleEpisodes(torrentTitle);
        if (multipleEpisodes.hasMultiple && multipleEpisodes.startEpisode && multipleEpisodes.endEpisode) {
            const isInRange = targetEpisode >= multipleEpisodes.startEpisode && targetEpisode <= multipleEpisodes.endEpisode;
            if (isInRange) {
                return {
                    compatible: true,
                    reason: `Episódio ${targetEpisode} dentro do range ${multipleEpisodes.startEpisode}-${multipleEpisodes.endEpisode}`
                };
            }
            return {
                compatible: false,
                reason: `Episódio ${targetEpisode} fora do range ${multipleEpisodes.startEpisode}-${multipleEpisodes.endEpisode}`
            };
        }
        if (torrentEpisode === undefined) {
            const lowerTitle = torrentTitle.toLowerCase();
            const seemsLikePack = lowerTitle.includes('pack') ||
                lowerTitle.includes('complete') ||
                lowerTitle.includes('temporada') ||
                lowerTitle.includes('season');
            if (seemsLikePack) {
                return {
                    compatible: true,
                    reason: 'Possível pack detectado - compatível'
                };
            }
            return {
                compatible: false,
                reason: 'Episódio não especificado e não parece ser pack'
            };
        }
        if (torrentEpisode === targetEpisode) {
            return {
                compatible: true,
                reason: `Episódio específico ${targetEpisode} corresponde`
            };
        }
        return {
            compatible: false,
            reason: `Episódio diferente: Torrent E${torrentEpisode} vs E${targetEpisode}`
        };
    }
    async getImdbTitlesWithCache(imdbId, season) {
        const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
        const cachedEntry = this.cacheManager.getImdbTitlesFromCache(cacheKey);
        if (cachedEntry) {
            this.logger.debug('Cache IMDB hit', { imdbId, season });
            return cachedEntry.titles;
        }
        try {
            this.logger.debug('Cache IMDB miss', { imdbId, season });
            const titles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
            if (titles.allTitles.length > 0) {
                this.cacheManager.saveImdbTitlesToCache(cacheKey, titles);
                this.logger.debug('TMDB dados carregados', {
                    imdbId,
                    season,
                    year: titles.year,
                    tipo: titles.mediaType,
                    português: titles.foundInPortuguese
                });
                return titles;
            }
            else {
                this.logger.warn('TMDB: sem títulos', { imdbId, season });
            }
        }
        catch (error) {
            this.logger.error('Erro TMDB', {
                imdbId,
                season,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
        return null;
    }
    async smartTitleContainsCheck(torrentTitle, imdbId, torrentMetadata, season) {
        const torrentYear = torrentMetadata?.year || this.extractTorrentYear(torrentTitle);
        return await this.similarityCalculator.smartTitleContainsCheck(torrentTitle, imdbId, { year: torrentYear, season });
    }
    async doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode) {
        try {
            const isPortuguese = this.isPortugueseContent(torrentTitle);
            if (!isPortuguese) {
                this.logger.warn('Rejeitado: não português', {
                    title: torrentTitle.substring(0, 60)
                });
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: this.extractSeriesMetadata(torrentTitle),
                    reason: 'Conteúdo não está em português'
                };
            }
            const imdbTitles = await this.getImdbTitlesWithCache(imdbId, targetSeason);
            if (!imdbTitles || imdbTitles.allTitles.length === 0) {
                this.logger.warn('TMDB: sem dados', {
                    imdbId,
                    season: targetSeason,
                    title: torrentTitle.substring(0, 60)
                });
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: this.extractSeriesMetadata(torrentTitle),
                    reason: `Nenhum título encontrado no TMDB para ${imdbId}`
                };
            }
            if (imdbTitles.year) {
                this.logger.debug('TMDB ano', {
                    imdbId,
                    season: targetSeason,
                    year: imdbTitles.year,
                    tipo: imdbTitles.mediaType
                });
            }
            const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
            const torrentYear = this.extractTorrentYear(torrentTitle);
            if (targetSeason !== undefined) {
                if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
                    this.logger.warn('Temporada diferente', {
                        torrentSeason: torrentMetadata.season,
                        targetSeason
                    });
                    return {
                        matches: false,
                        similarity: 0,
                        torrentMetadata,
                        reason: `Temporada diferente: Torrent S${torrentMetadata.season} vs S${targetSeason}`
                    };
                }
                if (targetEpisode !== undefined) {
                    const episodeCompatibility = this.isEpisodeCompatible(torrentTitle, torrentMetadata.episode, targetEpisode, targetSeason);
                    if (!episodeCompatibility.compatible) {
                        this.logger.warn('Episódio incompatível', {
                            torrentTitle: torrentTitle.substring(0, 60),
                            targetEpisode,
                            motivo: episodeCompatibility.reason
                        });
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata,
                            reason: episodeCompatibility.reason
                        };
                    }
                    this.logger.debug('Episódio compatível', {
                        torrentTitle: torrentTitle.substring(0, 60),
                        targetEpisode,
                        motivo: episodeCompatibility.reason
                    });
                }
            }
            const smartMatch = await this.smartTitleContainsCheck(torrentTitle, imdbId, { year: torrentYear }, targetSeason);
            const result = {
                matches: smartMatch.matches,
                matchedTitle: imdbTitles.portugueseTitle || imdbTitles.originalTitle,
                matchedLanguage: imdbTitles.portugueseTitle ? 'português' : 'original',
                similarity: smartMatch.similarity,
                torrentMetadata,
                reason: smartMatch.reason
            };
            this.logger.debug('Resultado', {
                matches: result.matches,
                similaridade: result.similarity,
                motivo: result.reason
            });
            return result;
        }
        catch (error) {
            this.logger.error('Erro comparação', {
                torrentTitle: torrentTitle.substring(0, 60),
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return {
                matches: false,
                similarity: 0,
                torrentMetadata: this.extractSeriesMetadata(torrentTitle),
                reason: `Erro: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
            };
        }
    }
    doTitlesMatchSync(torrentTitle, imdbTitle, targetSeason, targetEpisode) {
        if (!this.isPortugueseContent(torrentTitle)) {
            return false;
        }
        const smartMatch = this.similarityCalculator.smartTitleContainsCheckSync(torrentTitle, imdbTitle);
        const baseThreshold = 0.4;
        const confusionCheck = this.similarityCalculator.detectConfusingSeries(torrentTitle, imdbTitle);
        const adjustedThreshold = confusionCheck.isConfusing ?
            Math.max(baseThreshold, confusionCheck.minSimilarity) :
            baseThreshold;
        if (smartMatch.matches && smartMatch.similarity >= adjustedThreshold) {
            if (targetSeason !== undefined) {
                const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
                if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
                    return false;
                }
                if (targetEpisode !== undefined) {
                    const episodeCompatibility = this.isEpisodeCompatible(torrentTitle, torrentMetadata.episode, targetEpisode, targetSeason);
                    if (!episodeCompatibility.compatible) {
                        return false;
                    }
                }
            }
            return true;
        }
        return false;
    }
    async applyTitleFilter(torrents, imdbId, requestId, targetSeason, targetEpisode) {
        const startTime = Date.now();
        this.logger.info('Filtro iniciado', {
            requestId,
            imdbId,
            season: targetSeason,
            episode: targetEpisode,
            total: torrents.length
        });
        const uniqueTorrents = this.deduplicateTorrents(torrents);
        const results = {
            included: [],
            excluded: [],
            reasons: [],
            duplicatesRemoved: torrents.length - uniqueTorrents.length
        };
        const portugueseTorrents = uniqueTorrents.filter(torrent => {
            if (this.isAlreadyProcessed(torrent)) {
                results.excluded.push(torrent);
                return false;
            }
            const isPortuguese = this.isPortugueseContent(torrent.title);
            if (!isPortuguese) {
                results.excluded.push(torrent);
            }
            return isPortuguese;
        });
        if (portugueseTorrents.length === 0) {
            this.logger.warn('Sem portugueses', {
                requestId,
                imdbId,
                total: uniqueTorrents.length
            });
            return [];
        }
        let imdbTitles;
        try {
            imdbTitles = await this.getImdbTitlesWithCache(imdbId, targetSeason);
            if (!imdbTitles) {
                this.logger.error('TMDB falhou', { imdbId, season: targetSeason });
                return [];
            }
            this.logger.debug('TMDB dados', {
                imdbId,
                season: targetSeason,
                year: imdbTitles.year,
                tipo: imdbTitles.mediaType
            });
        }
        catch (error) {
            this.logger.error('Erro TMDB', {
                requestId,
                imdbId,
                season: targetSeason,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
        for (const torrent of portugueseTorrents) {
            const torrentMetadata = this.extractSeriesMetadata(torrent.title);
            if (targetSeason !== undefined) {
                if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
                    results.excluded.push(torrent);
                    continue;
                }
                if (targetEpisode !== undefined) {
                    const episodeCompatibility = this.isEpisodeCompatible(torrent.title, torrentMetadata.episode, targetEpisode, targetSeason);
                    if (!episodeCompatibility.compatible) {
                        results.excluded.push(torrent);
                        results.reasons.push(`Episódio: ${episodeCompatibility.reason}`);
                        continue;
                    }
                }
            }
            const match = await this.smartTitleContainsCheck(torrent.title, imdbId, { year: this.extractTorrentYear(torrent.title) }, targetSeason);
            if (match.matches) {
                results.included.push(torrent);
            }
            else {
                results.excluded.push(torrent);
            }
        }
        const processingTime = Date.now() - startTime;
        this.logger.info('Filtro finalizado', {
            requestId,
            imdbId,
            season: targetSeason,
            episódio: targetEpisode,
            anoUsado: imdbTitles.year || '?',
            totalOriginal: torrents.length,
            duplicatas: results.duplicatesRemoved,
            portugueses: portugueseTorrents.length,
            incluídos: results.included.length,
            excluídos: results.excluded.length,
            tempo: `${processingTime}ms`
        });
        return results.included;
    }
    applyTitleFilterSync(torrents, imdbTitle, requestId, targetSeason, targetEpisode) {
        const startTime = Date.now();
        this.logger.info('Filtro sync iniciado', {
            requestId,
            total: torrents.length
        });
        const uniqueTorrents = this.deduplicateTorrents(torrents);
        const results = {
            included: [],
            excluded: [],
            duplicatesRemoved: torrents.length - uniqueTorrents.length
        };
        for (const torrent of uniqueTorrents) {
            if (!this.isPortugueseContent(torrent.title)) {
                results.excluded.push(torrent);
                continue;
            }
            const matches = this.doTitlesMatchSync(torrent.title, imdbTitle, targetSeason, targetEpisode);
            if (matches) {
                results.included.push(torrent);
            }
            else {
                results.excluded.push(torrent);
            }
        }
        const processingTime = Date.now() - startTime;
        this.logger.info('Filtro sync finalizado', {
            requestId,
            totalOriginal: torrents.length,
            duplicatas: results.duplicatesRemoved,
            incluídos: results.included.length,
            tempo: `${processingTime}ms`
        });
        return results.included;
    }
    async testTitleMatch(torrentTitle, imdbId, targetSeason, targetEpisode) {
        this.logger.info('Teste título', {
            torrentTitle,
            imdbId,
            season: targetSeason,
            episode: targetEpisode
        });
        return await this.doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode);
    }
    testTitleMatchSync(torrentTitle, imdbTitle, targetSeason, targetEpisode) {
        const isPortuguese = this.isPortugueseContent(torrentTitle);
        const normTorrent = this.normalizeForComparison(torrentTitle);
        const normImdb = this.normalizeForComparison(imdbTitle);
        const metadata = this.extractSeriesMetadata(torrentTitle);
        const contains = normTorrent.includes(normImdb);
        const contained = normImdb.includes(normTorrent);
        const similarity = this.similarityCalculator.calculateWordSimilarity(normTorrent, normImdb);
        const confusionCheck = this.similarityCalculator.detectConfusingSeries(torrentTitle, imdbTitle);
        const baseThreshold = 0.4;
        const adjustedThreshold = confusionCheck.isConfusing ?
            Math.max(baseThreshold, confusionCheck.minSimilarity) :
            baseThreshold;
        let matches = isPortuguese && (contains || contained || similarity >= adjustedThreshold);
        let episodeCompatibility;
        if (targetSeason !== undefined) {
            if (metadata.season && metadata.season !== targetSeason) {
                matches = false;
            }
            if (targetEpisode !== undefined) {
                episodeCompatibility = this.isEpisodeCompatible(torrentTitle, metadata.episode, targetEpisode, targetSeason);
                if (!episodeCompatibility.compatible) {
                    matches = false;
                }
            }
        }
        return {
            matches,
            normalizedTorrent: normTorrent,
            normalizedImdb: normImdb,
            contains,
            contained,
            similarity,
            metadata,
            isPortuguese,
            episodeCompatibility
        };
    }
    clearAllCaches() {
        this.cacheManager.clearAllCaches();
        this.logger.info('Caches limpos');
    }
    getCacheStats() {
        return this.cacheManager.getCacheStats();
    }
    addConfusingSeries(original, derivative, minSimilarity = 0.8) {
        this.similarityCalculator.addConfusingSeries(original, derivative, minSimilarity);
        this.logger.info('Série confusa adicionada', {
            original,
            derivative,
            minSimilarity
        });
    }
    listConfusingSeries() {
        return this.similarityCalculator.listConfusingSeries();
    }
    getSimilarityCalculatorStats() {
        return this.similarityCalculator.getStats();
    }
    getVersionInfo() {
        const similarityStats = this.similarityCalculator.getStats();
        return {
            titleFilterVersion: this.VERSION,
            similarityCalculatorVersion: similarityStats.versão,
            similarityCalculatorFeature: similarityStats.feature,
            similarityCalculatorDescrição: similarityStats.descrição,
            thresholdMovies: similarityStats.limiarFilmes,
            thresholdSeries: similarityStats.limiarSéries
        };
    }
}
exports.TitleFilter = TitleFilter;
