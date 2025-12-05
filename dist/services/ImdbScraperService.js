"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImdbScraperService = void 0;
const logger_1 = require("../utils/logger");
const axios_1 = __importDefault(require("axios"));
const logger = new logger_1.Logger('TMDBScraper');
class ImdbScraperService {
    constructor() {
        this.tmdbBaseUrl = 'https://api.themoviedb.org/3';
        this.language = 'pt-BR';
        this.cacheTTL = 5 * 60 * 1000;
        this.tmdbApiKey = process.env.TMDB_API_KEY || '4bfe2bbccad24f1bb07507953a137ebd';
        if (!this.tmdbApiKey) {
            logger.error('TMDB API KEY não configurada!');
        }
        logger.info('TMDB Scraper v1.1.0 inicializado', {
            feature: 'Cache global compartilhado'
        });
    }
    async getTitlesFromImdbId(imdbId) {
        try {
            const cached = ImdbScraperService.globalCache.get(imdbId);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                logger.debug('Cache TMDB hit', { imdbId });
                return cached.data;
            }
            logger.debug('Cache TMDB miss', { imdbId });
            const tmdbInfo = await this.findInTMDB(imdbId);
            if (!tmdbInfo) {
                return this.createEmptyResult(imdbId);
            }
            const { tmdbId, mediaType } = tmdbInfo;
            const details = await this.fetchDetailsFromTMDB(tmdbId, mediaType);
            if (!details) {
                return this.createEmptyResult(imdbId);
            }
            let originalTitle = '';
            let portugueseTitle = '';
            let year;
            if (mediaType === 'movie') {
                originalTitle = details.original_title || '';
                portugueseTitle = details.title || '';
                if (details.release_date) {
                    year = parseInt(details.release_date.substring(0, 4));
                }
            }
            else if (mediaType === 'tv') {
                originalTitle = details.original_name || '';
                portugueseTitle = details.name || '';
                if (details.first_air_date) {
                    year = parseInt(details.first_air_date.substring(0, 4));
                }
            }
            if (!originalTitle) {
                return this.createEmptyResult(imdbId);
            }
            const normalizedOriginal = this.normalizeTitle(originalTitle);
            const normalizedPortuguese = portugueseTitle ? this.normalizeTitle(portugueseTitle) : '';
            const allTitles = [normalizedOriginal];
            if (normalizedPortuguese && normalizedPortuguese !== normalizedOriginal) {
                allTitles.push(normalizedPortuguese);
            }
            const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));
            const result = {
                originalTitle: normalizedOriginal,
                portugueseTitle: normalizedPortuguese || null,
                allTitles: uniqueTitles,
                foundInPortuguese: !!normalizedPortuguese,
                year,
                mediaType
            };
            ImdbScraperService.globalCache.set(imdbId, {
                data: result,
                timestamp: Date.now(),
                tmdbId,
                mediaType
            });
            logger.debug('Títulos encontrados no TMDB', {
                imdbId,
                tmdbId,
                year,
                mediaType
            });
            return result;
        }
        catch (error) {
            logger.error('Erro TMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return this.createEmptyResult(imdbId);
        }
    }
    async findInTMDB(imdbId) {
        try {
            const response = await axios_1.default.get(`${this.tmdbBaseUrl}/find/${imdbId}`, {
                params: {
                    api_key: this.tmdbApiKey,
                    external_source: 'imdb_id',
                    language: this.language
                },
                timeout: 10000
            });
            if (response.data.movie_results && response.data.movie_results.length > 0) {
                return {
                    tmdbId: response.data.movie_results[0].id,
                    mediaType: 'movie'
                };
            }
            if (response.data.tv_results && response.data.tv_results.length > 0) {
                return {
                    tmdbId: response.data.tv_results[0].id,
                    mediaType: 'tv'
                };
            }
            return null;
        }
        catch (error) {
            logger.error('Erro converter IMDB para TMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async fetchDetailsFromTMDB(tmdbId, mediaType) {
        try {
            const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
            const response = await axios_1.default.get(`${this.tmdbBaseUrl}/${endpoint}/${tmdbId}`, {
                params: {
                    api_key: this.tmdbApiKey,
                    language: this.language
                },
                timeout: 10000
            });
            return response.data;
        }
        catch (error) {
            logger.error('Erro buscar detalhes TMDB', {
                tmdbId,
                mediaType,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    createEmptyResult(imdbId) {
        return {
            originalTitle: `Unknown Title (${imdbId})`,
            portugueseTitle: null,
            allTitles: [],
            foundInPortuguese: false
        };
    }
    normalizeTitle(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async getTitleFromImdbId(imdbId) {
        try {
            const titles = await this.getTitlesFromImdbId(imdbId);
            return titles.portugueseTitle || titles.originalTitle || null;
        }
        catch (error) {
            logger.error('Erro compatibilidade', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    static clearGlobalCache() {
        ImdbScraperService.globalCache.clear();
    }
    static getGlobalCacheStats() {
        return {
            size: ImdbScraperService.globalCache.size,
            entries: Array.from(ImdbScraperService.globalCache.keys())
        };
    }
    clearInstanceCache() {
        ImdbScraperService.clearGlobalCache();
    }
    getStats() {
        return {
            cacheSize: ImdbScraperService.globalCache.size,
            cacheTTL: this.cacheTTL,
            version: '1.1.0'
        };
    }
}
exports.ImdbScraperService = ImdbScraperService;
ImdbScraperService.globalCache = new Map();
