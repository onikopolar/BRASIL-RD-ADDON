"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleFilter = void 0;
const logger_js_1 = require("../utils/logger.js");
const ImdbScraperService_js_1 = require("../services/ImdbScraperService.js");
const index_js_1 = require("./title-filter/index.js");
class TitleFilter {
    static getInstance() {
        if (!TitleFilter.instance) {
            TitleFilter.instance = new TitleFilter();
        }
        return TitleFilter.instance;
    }
    constructor() {
        this.IMDB_CACHE_TTL = 30 * 60 * 1000;
        this.DEDUP_CACHE_TTL = 10 * 60 * 1000;
        this.TITLE_CACHE_TTL = 5 * 60 * 1000;
        this.VERSION = '2.6.1';
        this.logger = new logger_js_1.Logger('TitleFilter');
        this.imdbScraper = ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.titleCleaner = index_js_1.TitleCleaner.getInstance();
        this.languageDetector = index_js_1.LanguageDetector.getInstance();
        this.similarityCalculator = index_js_1.SimilarityCalculator.getInstance();
        this.metadataExtractor = index_js_1.MetadataExtractor.getInstance();
        this.cacheManager = index_js_1.CacheManager.getInstance();
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
            if (source.infoHash)
                return source.infoHash.toLowerCase();
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
        if (this.cacheManager.isAlreadyProcessed(dedupeKey))
            return true;
        this.cacheManager.markAsProcessed(dedupeKey);
        return false;
    }
    deduplicateTorrents(torrents) {
        if (torrents.length <= 1)
            return torrents;
        const seen = new Set();
        const unique = [];
        for (const torrent of torrents) {
            const infoHash = this.extractInfoHash(torrent.magnet || torrent);
            const title = torrent.title || 'unknown';
            const key = infoHash || this.extractCleanTitle(title).toLowerCase();
            if (seen.has(key))
                continue;
            seen.add(key);
            unique.push(torrent);
        }
        return unique;
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
        return yearMatch ? parseInt(yearMatch[0]) : undefined;
    }
    hasMultipleEpisodes(torrentTitle) {
        const lower = torrentTitle.toLowerCase();
        const rangeMatch = lower.match(/e(\d{1,10})-(\d{1,10})(?:-(\d{1,10}))?(?:-(\d{1,10}))?/);
        if (rangeMatch) {
            const start = parseInt(rangeMatch[1]);
            let end = start;
            for (let i = 2; i <= 4; i++)
                if (rangeMatch[i])
                    end = parseInt(rangeMatch[i]);
            return { hasMultiple: true, startEpisode: start, endEpisode: end };
        }
        const concatMatch = lower.match(/e(\d{1,10})e(\d{1,10})(?:e(\d{1,10}))?(?:e(\d{1,10}))?/);
        if (concatMatch) {
            const start = parseInt(concatMatch[1]);
            let end = start;
            for (let i = 2; i <= 4; i++)
                if (concatMatch[i])
                    end = parseInt(concatMatch[i]);
            return { hasMultiple: true, startEpisode: start, endEpisode: end };
        }
        return { hasMultiple: false };
    }
    hasSeasonIndicator(title) {
        const lower = title.toLowerCase();
        const patterns = [
            /\bs\d{1,3}\b/,
            /\bseason\s*\d{1,3}\b/,
            /\bt\d{1,3}\b/,
            /\btemporada\s*\d{1,3}\b/,
            /\b\d{1,2}ª?\s*temporada\b/
        ];
        return patterns.some(p => p.test(lower));
    }
    hasEpisodeIndicator(title) {
        const lower = title.toLowerCase();
        return /s\d+e\d+/i.test(lower) || /episode\s+\d+/i.test(lower) || /\be\d{1,3}\b/i.test(lower);
    }
    isCompleteSeasonPack(torrentTitle) {
        const hasSeason = this.hasSeasonIndicator(torrentTitle);
        const hasEpisode = this.hasEpisodeIndicator(torrentTitle);
        return hasSeason && !hasEpisode;
    }
    isEpisodeCompatible(torrentTitle, torrentEpisode, targetEpisode, targetSeason) {
        if (this.isCompleteSeasonPack(torrentTitle)) {
            return { compatible: true, reason: 'Pack de temporada (sem episódio específico)' };
        }
        const multiple = this.hasMultipleEpisodes(torrentTitle);
        if (multiple.hasMultiple && multiple.startEpisode && multiple.endEpisode) {
            if (targetEpisode >= multiple.startEpisode && targetEpisode <= multiple.endEpisode) {
                return { compatible: true, reason: `Episódio ${targetEpisode} no range ${multiple.startEpisode}-${multiple.endEpisode}` };
            }
            return { compatible: false, reason: `Episódio ${targetEpisode} fora do range ${multiple.startEpisode}-${multiple.endEpisode}` };
        }
        if (torrentEpisode === undefined) {
            if (this.hasSeasonIndicator(torrentTitle) && !this.hasEpisodeIndicator(torrentTitle)) {
                return { compatible: true, reason: 'Provável pack de temporada (sem episódio)' };
            }
            return { compatible: false, reason: 'Episódio não especificado' };
        }
        if (torrentEpisode === targetEpisode) {
            return { compatible: true, reason: `Episódio específico ${targetEpisode} corresponde` };
        }
        return { compatible: false, reason: `Episódio diferente: Torrent E${torrentEpisode} vs E${targetEpisode}` };
    }
    async getImdbTitlesWithCache(imdbId, season) {
        const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
        const cached = this.cacheManager.getImdbTitlesFromCache(cacheKey);
        if (cached)
            return cached.titles;
        try {
            const titles = await this.imdbScraper.getTitlesFromImdbId(imdbId, season);
            if (titles.allTitles.length > 0) {
                this.cacheManager.saveImdbTitlesToCache(cacheKey, titles);
                return titles;
            }
        }
        catch (error) {
            this.logger.error('Erro TMDB', { imdbId, season, error: error instanceof Error ? error.message : 'Erro' });
        }
        return null;
    }
    async smartTitleContainsCheck(torrentTitle, imdbId, torrentMetadata, season) {
        const torrentYear = torrentMetadata?.year || this.extractTorrentYear(torrentTitle);
        return this.similarityCalculator.smartTitleContainsCheck(torrentTitle, imdbId, { year: torrentYear, season });
    }
    async doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode) {
        try {
            if (!this.isPortugueseContent(torrentTitle)) {
                return { matches: false, similarity: 0, torrentMetadata: this.extractSeriesMetadata(torrentTitle), reason: 'Conteúdo não está em português' };
            }
            const imdbTitles = await this.getImdbTitlesWithCache(imdbId, targetSeason);
            if (!imdbTitles || imdbTitles.allTitles.length === 0) {
                return { matches: false, similarity: 0, torrentMetadata: this.extractSeriesMetadata(torrentTitle), reason: `Nenhum título encontrado no TMDB para ${imdbId}` };
            }
            const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
            const torrentYear = this.extractTorrentYear(torrentTitle);
            if (imdbTitles.mediaType === 'movie' && this.hasSeasonIndicator(torrentTitle)) {
                return {
                    matches: false, similarity: 0, torrentMetadata,
                    reason: 'Torrent é série, mas TMDB diz que é filme'
                };
            }
            if (targetSeason !== undefined) {
                if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
                    return { matches: false, similarity: 0, torrentMetadata, reason: `Temporada diferente: S${torrentMetadata.season} vs S${targetSeason}` };
                }
                if (targetEpisode !== undefined) {
                    const compat = this.isEpisodeCompatible(torrentTitle, torrentMetadata.episode, targetEpisode, targetSeason);
                    if (!compat.compatible) {
                        this.logger.warn('Episódio incompatível', { torrentTitle: torrentTitle.substring(0, 60), targetEpisode, motivo: compat.reason });
                        return { matches: false, similarity: 0, torrentMetadata, reason: compat.reason };
                    }
                }
            }
            const smartMatch = await this.smartTitleContainsCheck(torrentTitle, imdbId, { year: torrentYear }, targetSeason);
            return {
                matches: smartMatch.matches,
                matchedTitle: imdbTitles.portugueseTitle || imdbTitles.originalTitle,
                matchedLanguage: imdbTitles.portugueseTitle ? 'português' : 'original',
                similarity: smartMatch.similarity,
                torrentMetadata,
                reason: smartMatch.reason
            };
        }
        catch (error) {
            this.logger.error('Erro comparação', { torrentTitle: torrentTitle.substring(0, 60), imdbId, error: error instanceof Error ? error.message : 'Erro' });
            return { matches: false, similarity: 0, torrentMetadata: this.extractSeriesMetadata(torrentTitle), reason: `Erro: ${error instanceof Error ? error.message : 'Erro'}` };
        }
    }
    doTitlesMatchSync(torrentTitle, imdbTitle, targetSeason, targetEpisode) {
        if (!this.isPortugueseContent(torrentTitle))
            return false;
        const smartMatch = this.similarityCalculator.smartTitleContainsCheckSync(torrentTitle, imdbTitle);
        const confusion = this.similarityCalculator.detectConfusingSeries(torrentTitle, imdbTitle);
        const threshold = confusion.isConfusing ? Math.max(0.4, confusion.minSimilarity) : 0.4;
        if (smartMatch.matches && smartMatch.similarity >= threshold) {
            if (targetSeason !== undefined) {
                const meta = this.extractSeriesMetadata(torrentTitle);
                if (meta.season && meta.season !== targetSeason)
                    return false;
                if (targetEpisode !== undefined) {
                    const compat = this.isEpisodeCompatible(torrentTitle, meta.episode, targetEpisode, targetSeason);
                    if (!compat.compatible)
                        return false;
                }
            }
            return true;
        }
        return false;
    }
    async applyTitleFilter(torrents, imdbId, requestId, targetSeason, targetEpisode) {
        const uniqueTorrents = this.deduplicateTorrents(torrents);
        const portugueseTorrents = uniqueTorrents.filter(t => {
            if (this.isAlreadyProcessed(t))
                return false;
            return this.isPortugueseContent(t.title);
        });
        if (portugueseTorrents.length === 0)
            return [];
        const imdbTitles = await this.getImdbTitlesWithCache(imdbId, targetSeason);
        if (!imdbTitles)
            return [];
        const included = [];
        for (const torrent of portugueseTorrents) {
            const meta = this.extractSeriesMetadata(torrent.title);
            if (targetSeason !== undefined) {
                if (meta.season && meta.season !== targetSeason)
                    continue;
                if (targetEpisode !== undefined) {
                    const compat = this.isEpisodeCompatible(torrent.title, meta.episode, targetEpisode, targetSeason);
                    if (!compat.compatible) {
                        this.logger.warn('Episódio incompatível', { torrentTitle: torrent.title.substring(0, 60), targetEpisode, motivo: compat.reason });
                        continue;
                    }
                }
            }
            const match = await this.smartTitleContainsCheck(torrent.title, imdbId, { year: this.extractTorrentYear(torrent.title) }, targetSeason);
            if (match.matches)
                included.push(torrent);
        }
        return included;
    }
    applyTitleFilterSync(torrents, imdbTitle, requestId, targetSeason, targetEpisode) {
        const uniqueTorrents = this.deduplicateTorrents(torrents);
        const included = [];
        for (const torrent of uniqueTorrents) {
            if (!this.isPortugueseContent(torrent.title))
                continue;
            if (this.doTitlesMatchSync(torrent.title, imdbTitle, targetSeason, targetEpisode)) {
                included.push(torrent);
            }
        }
        return included;
    }
    async testTitleMatch(torrentTitle, imdbId, targetSeason, targetEpisode) {
        return this.doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode);
    }
    testTitleMatchSync(torrentTitle, imdbTitle, targetSeason, targetEpisode) {
        const isPortuguese = this.isPortugueseContent(torrentTitle);
        const normTorrent = this.normalizeForComparison(torrentTitle);
        const normImdb = this.normalizeForComparison(imdbTitle);
        const metadata = this.extractSeriesMetadata(torrentTitle);
        const contains = normTorrent.includes(normImdb);
        const contained = normImdb.includes(normTorrent);
        const similarity = this.similarityCalculator.calculateWordSimilarity(normTorrent, normImdb);
        const confusion = this.similarityCalculator.detectConfusingSeries(torrentTitle, imdbTitle);
        const threshold = confusion.isConfusing ? Math.max(0.4, confusion.minSimilarity) : 0.4;
        let matches = isPortuguese && (contains || contained || similarity >= threshold);
        let episodeCompat;
        if (targetSeason !== undefined) {
            if (metadata.season && metadata.season !== targetSeason)
                matches = false;
            if (targetEpisode !== undefined) {
                episodeCompat = this.isEpisodeCompatible(torrentTitle, metadata.episode, targetEpisode, targetSeason);
                if (!episodeCompat.compatible)
                    matches = false;
            }
        }
        return { matches, normalizedTorrent: normTorrent, normalizedImdb: normImdb, contains, contained, similarity, metadata, isPortuguese, episodeCompatibility: episodeCompat };
    }
    clearAllCaches() {
        this.cacheManager.clearAllCaches();
    }
    getCacheStats() {
        return this.cacheManager.getCacheStats();
    }
    addConfusingSeries(original, derivative, minSimilarity = 0.8) {
        this.similarityCalculator.addConfusingSeries(original, derivative, minSimilarity);
    }
    listConfusingSeries() {
        return this.similarityCalculator.listConfusingSeries();
    }
    getSimilarityCalculatorStats() {
        return this.similarityCalculator.getStats();
    }
    getVersionInfo() {
        const simStats = this.similarityCalculator.getStats();
        return {
            titleFilterVersion: this.VERSION,
            similarityCalculatorVersion: simStats.versão,
            thresholdMovies: simStats.limiarFilmes,
            thresholdSeries: simStats.limiarSéries,
            melhorias: simStats.melhorias
        };
    }
}
exports.TitleFilter = TitleFilter;
