"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImdbScraperService = void 0;
const logger_js_1 = require("../utils/logger.js");
const axios_1 = __importDefault(require("axios"));
const logger = new logger_js_1.Logger('TMDBScraper');
class ImdbScraperService {
    static getInstance() {
        if (!ImdbScraperService.instance) {
            ImdbScraperService.instance = new ImdbScraperService();
        }
        return ImdbScraperService.instance;
    }
    constructor() {
        this.tmdbBaseUrl = 'https://api.themoviedb.org/3';
        this.language = 'pt-BR';
        this.cacheTTL = 5 * 60 * 1000;
        this.tmdbApiKey = process.env.TMDB_API_KEY || '';
        if (!this.tmdbApiKey) {
            logger.warn('TMDB_API_KEY não configurada! Metadados em português não estarão disponíveis. Obtenha uma key gratuita em: https://www.themoviedb.org/settings/api');
        }
        logger.debug('TMDB Scraper ready');
    }
    async getTitlesFromImdbId(imdbId, season) {
        try {
            const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
            const cached = ImdbScraperService.globalCache.get(cacheKey);
            if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                logger.debug('Cache TMDB hit', { imdbId, season });
                return cached.data;
            }
            logger.debug('Cache TMDB miss', { imdbId, season });
            const tmdbInfo = await this.findInTMDB(imdbId);
            if (!tmdbInfo) {
                logger.warn('TMDB: não encontrado', { imdbId });
                return this.createEmptyResult(imdbId);
            }
            const { tmdbId: tmdbIdNum, mediaType } = tmdbInfo;
            let year;
            let originalTitle = '';
            let portugueseTitle = '';
            if (mediaType === 'movie') {
                const details = await this.fetchDetailsFromTMDB(tmdbIdNum, 'movie');
                if (details) {
                    originalTitle = details.original_title || '';
                    portugueseTitle = details.title || '';
                    if (details.release_date) {
                        year = parseInt(details.release_date.substring(0, 4));
                    }
                    logger.debug('TMDB dados filme', {
                        imdbId,
                        original: originalTitle.substring(0, 40),
                        portugues: portugueseTitle.substring(0, 40),
                        year
                    });
                }
            }
            else if (mediaType === 'tv') {
                if (season !== undefined && season > 0) {
                    try {
                        const seasonData = await this.fetchSeasonFromTMDB(tmdbIdNum, season);
                        if (seasonData) {
                            const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
                            if (seriesDetails) {
                                originalTitle = seriesDetails.original_name || '';
                                portugueseTitle = seriesDetails.name || '';
                            }
                            if (seasonData.air_date) {
                                year = parseInt(seasonData.air_date.substring(0, 4));
                                logger.debug('TMDB ano temporada específica', {
                                    imdbId,
                                    season,
                                    year,
                                    airDate: seasonData.air_date
                                });
                            }
                        }
                    }
                    catch (seasonError) {
                        logger.warn('TMDB erro temporada, usando dados série', {
                            imdbId,
                            season,
                            error: seasonError instanceof Error ? seasonError.message : 'Erro desconhecido'
                        });
                        const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
                        if (seriesDetails) {
                            originalTitle = seriesDetails.original_name || '';
                            portugueseTitle = seriesDetails.name || '';
                            if (seriesDetails.first_air_date) {
                                year = parseInt(seriesDetails.first_air_date.substring(0, 4));
                            }
                        }
                    }
                }
                else {
                    const seriesDetails = await this.fetchDetailsFromTMDB(tmdbIdNum, 'tv');
                    if (seriesDetails) {
                        originalTitle = seriesDetails.original_name || '';
                        portugueseTitle = seriesDetails.name || '';
                        if (seriesDetails.first_air_date) {
                            year = parseInt(seriesDetails.first_air_date.substring(0, 4));
                        }
                    }
                }
                logger.debug('TMDB dados série', {
                    imdbId,
                    season,
                    original: originalTitle.substring(0, 40),
                    portugues: portugueseTitle.substring(0, 40),
                    year
                });
            }
            if (!originalTitle) {
                logger.warn('TMDB: sem título', { imdbId });
                return this.createEmptyResult(imdbId);
            }
            const normalizedOriginal = this.normalizeTitle(originalTitle);
            const normalizedPortuguese = portugueseTitle ? this.normalizeTitle(portugueseTitle) : '';
            const hasPortuguese = !!normalizedPortuguese && normalizedPortuguese !== normalizedOriginal;
            const portuguesePriority = hasPortuguese;
            const allTitles = [];
            if (hasPortuguese) {
                allTitles.push(normalizedPortuguese);
                allTitles.push(normalizedOriginal);
            }
            else {
                allTitles.push(normalizedOriginal);
            }
            const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));
            const result = {
                originalTitle: normalizedOriginal,
                portugueseTitle: hasPortuguese ? normalizedPortuguese : null,
                allTitles: uniqueTitles,
                foundInPortuguese: hasPortuguese,
                year,
                mediaType,
                portuguesePriority
            };
            ImdbScraperService.globalCache.set(cacheKey, {
                data: result,
                timestamp: Date.now(),
                tmdbId: tmdbIdNum,
                mediaType
            });
            logger.info('TMDB títulos obtidos', {
                imdbId,
                tmdbId: tmdbIdNum,
                year,
                mediaType,
                season,
                portugues: hasPortuguese ? 'SIM' : 'NÃO',
                tituloPortugues: hasPortuguese ? normalizedPortuguese.substring(0, 50) : 'N/A',
                tituloOriginal: normalizedOriginal.substring(0, 50)
            });
            return result;
        }
        catch (error) {
            logger.error('TMDB erro geral', {
                imdbId,
                season,
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
            logger.error('TMDB erro converter IMDB', {
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
            logger.error('TMDB erro detalhes', {
                tmdbId,
                mediaType,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async fetchSeasonFromTMDB(tmdbId, season) {
        try {
            const response = await axios_1.default.get(`${this.tmdbBaseUrl}/tv/${tmdbId}/season/${season}`, {
                params: {
                    api_key: this.tmdbApiKey,
                    language: this.language
                },
                timeout: 10000
            });
            return response.data;
        }
        catch (error) {
            logger.error('TMDB erro temporada', {
                tmdbId,
                season,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            throw error;
        }
    }
    createEmptyResult(imdbId) {
        logger.debug('TMDB resultado vazio', { imdbId });
        return {
            originalTitle: `Unknown Title (${imdbId})`,
            portugueseTitle: null,
            allTitles: [],
            foundInPortuguese: false,
            portuguesePriority: false
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
            logger.error('TMDB erro compatibilidade', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    static clearGlobalCache() {
        ImdbScraperService.globalCache.clear();
        logger.info('TMDB cache limpo');
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
            version: '2.0.0',
            feature: 'Português primeiro + cache otimizado'
        };
    }
}
exports.ImdbScraperService = ImdbScraperService;
ImdbScraperService.globalCache = new Map();
