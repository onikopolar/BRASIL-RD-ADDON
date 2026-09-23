"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImdbScraperService = void 0;
const logger_js_1 = require("../utils/logger.js");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const dns_1 = __importDefault(require("dns"));
const https_1 = __importDefault(require("https"));
const tls_1 = __importDefault(require("tls"));
const TmdbHtmlScraper_js_1 = require("./TmdbHtmlScraper.js");
const models_js_1 = require("../database/models.js");
const logger = new logger_js_1.Logger('TMDBScraper');
dns_1.default.setServers(['8.8.8.8', '1.1.1.1']);
class DnsAgent extends https_1.default.Agent {
    createConnection(options, cb) {
        const hostname = options.hostname || options.host || '';
        dns_1.default.resolve4(hostname, (err, addresses) => {
            if (err)
                return cb(err);
            const sock = tls_1.default.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false }, () => cb(null, sock));
            sock.on('error', cb);
        });
        return undefined;
    }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupImdb = (hostname, _opts, cb) => {
    dns_1.default.resolve4(hostname, (err, addresses) => {
        if (err)
            return cb(err);
        cb(null, addresses[0], 4);
    });
};
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
        logger.debug('🔑 TMDB_API_KEY carregada?', { exists: !!this.tmdbApiKey, length: this.tmdbApiKey.length, cwd: process.cwd() });
        if (!this.tmdbApiKey) {
            logger.warn('TMDB_API_KEY não configurada! Metadados em português não estarão disponíveis. Obtenha uma key gratuita em: https://www.themoviedb.org/settings/api');
        }
        ImdbScraperService.startCleanupTimer();
        logger.debug('TMDB Scraper ready');
    }
    static startCleanupTimer() {
        if (ImdbScraperService.cleanupTimer)
            return;
        ImdbScraperService.cleanupTimer = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of ImdbScraperService.globalCache.entries()) {
                if (now - entry.timestamp > ImdbScraperService.prototype.cacheTTL) {
                    ImdbScraperService.globalCache.delete(key);
                }
            }
            if (ImdbScraperService.globalCache.size === 0)
                return;
            logger.debug(`🧹 TMDB cache cleanup: ${ImdbScraperService.globalCache.size} entradas restantes`);
        }, ImdbScraperService.CACHE_CLEANUP_INTERVAL);
        if (ImdbScraperService.cleanupTimer.unref) {
            ImdbScraperService.cleanupTimer.unref();
        }
    }
    static getFromCache(key) {
        const cached = ImdbScraperService.globalCache.get(key);
        if (!cached)
            return undefined;
        const ttl = ImdbScraperService.prototype.cacheTTL;
        if (Date.now() - cached.timestamp > ttl) {
            ImdbScraperService.globalCache.delete(key);
            return undefined;
        }
        return cached;
    }
    static setCache(key, entry) {
        if (ImdbScraperService.globalCache.size >= ImdbScraperService.MAX_CACHE_SIZE) {
            const firstKey = ImdbScraperService.globalCache.keys().next().value;
            if (firstKey)
                ImdbScraperService.globalCache.delete(firstKey);
        }
        ImdbScraperService.globalCache.set(key, entry);
    }
    async getFromDbCache(imdbId, season) {
        try {
            const row = await models_js_1.ImdbTitleCache.findOne({
                where: { imdbId, season },
                attributes: ['titlesPt', 'titlesEn', 'year', 'episodeTitles', 'updatedAt'],
                raw: true,
            });
            if (!row)
                return null;
            const ageMs = Date.now() - new Date(row.updatedAt).getTime();
            if (ageMs > ImdbScraperService.DB_CACHE_TTL_MS)
                return null;
            if (season > 0 && !row.episodeTitles)
                return null;
            if (this.temMojibake(row.episodeTitles) || this.temMojibake(row.titlesPt) || this.temMojibake(row.titlesEn)) {
                logger.debug('DB_CACHE_MOJIBAKE_SKIP', { imdbId, season });
                return null;
            }
            if (this.ehEntradaLegacy(row.titlesPt, row.titlesEn)) {
                logger.debug('DB_CACHE_LEGACY_SKIP', { imdbId, season });
                return null;
            }
            return this.reconstruirImdbTitles(row);
        }
        catch (err) {
            logger.debug('DB_CACHE_READ_FAIL', { imdbId, season, error: err instanceof Error ? err.message : 'Erro' });
            return null;
        }
    }
    ehEntradaLegacy(titlesPt, titlesEn) {
        if (!Array.isArray(titlesPt) || !Array.isArray(titlesEn))
            return false;
        if (titlesPt.length === 0 && titlesEn.length === 0)
            return false;
        if (titlesPt.length !== titlesEn.length)
            return false;
        return titlesPt.every((t, i) => t === titlesEn[i]);
    }
    reconstruirImdbTitles(row) {
        const pt = Array.isArray(row.titlesPt) ? row.titlesPt : [];
        const en = Array.isArray(row.titlesEn) ? row.titlesEn : [];
        const portugueseTitle = pt[0] || null;
        const originalTitle = en[0] || portugueseTitle || '';
        const allTitles = [];
        if (portugueseTitle)
            allTitles.push(portugueseTitle);
        if (originalTitle && originalTitle !== portugueseTitle)
            allTitles.push(originalTitle);
        for (const t of pt)
            if (t && !allTitles.includes(t))
                allTitles.push(t);
        for (const t of en)
            if (t && !allTitles.includes(t))
                allTitles.push(t);
        const hasPortuguese = !!portugueseTitle && portugueseTitle !== originalTitle;
        return {
            originalTitle,
            portugueseTitle: hasPortuguese ? portugueseTitle : null,
            portugueseTitleRaw: hasPortuguese ? portugueseTitle : null,
            allTitles,
            foundInPortuguese: hasPortuguese,
            year: row.year ?? undefined,
            mediaType: undefined,
            portuguesePriority: hasPortuguese,
            episodeTitles: row.episodeTitles || null,
        };
    }
    temMojibake(value) {
        if (!value)
            return false;
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        return /Ã[^\s]/.test(str);
    }
    corrigirMojibake(value) {
        if (!value)
            return value;
        if (Array.isArray(value))
            return value.map(v => this.corrigirMojibake(v));
        if (typeof value === 'object') {
            const out = {};
            for (const k of Object.keys(value))
                out[k] = this.corrigirMojibake(value[k]);
            return out;
        }
        if (typeof value === 'string' && /Ã[^\s]/.test(value)) {
            try {
                return Buffer.from(value, 'latin1').toString('utf8');
            }
            catch {
                return value;
            }
        }
        return value;
    }
    async saveToDbCache(imdbId, season, data) {
        try {
            const origClean = this.corrigirMojibake(data.originalTitle || '');
            const ptClean = data.portugueseTitle ? this.corrigirMojibake(data.portugueseTitle) : null;
            const allClean = (data.allTitles || []).map(t => this.corrigirMojibake(t));
            const titlesPt = ptClean ? [ptClean] : [];
            const titlesEnRaw = [origClean, ...allClean];
            const titlesEn = [];
            for (const t of titlesEnRaw) {
                if (!t)
                    continue;
                if (t === ptClean)
                    continue;
                if (titlesEn.includes(t))
                    continue;
                titlesEn.push(t);
            }
            const episodeTitlesLimpos = this.corrigirMojibake(data.episodeTitles ?? null);
            await models_js_1.ImdbTitleCache.upsert({
                imdbId,
                season,
                titlesPt,
                titlesEn,
                year: data.year ?? null,
                episodeTitles: episodeTitlesLimpos,
                updatedAt: new Date(),
            });
        }
        catch (err) {
            logger.debug('DB_CACHE_WRITE_FAIL', { imdbId, season, error: err instanceof Error ? err.message : 'Erro' });
        }
    }
    async getTitlesFromImdbId(imdbId, season) {
        try {
            const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
            const cached = ImdbScraperService.getFromCache(cacheKey);
            if (cached) {
                logger.debug('TMDB cache hit (mem)', { imdbId, season });
                return cached.data;
            }
            const seasonKey = season ?? 0;
            const fromDb = await this.getFromDbCache(imdbId, seasonKey);
            if (fromDb) {
                logger.debug('TMDB cache hit (db)', { imdbId, season: seasonKey });
                ImdbScraperService.setCache(cacheKey, { data: fromDb, timestamp: Date.now() });
                return fromDb;
            }
            const tmdbInfo = await this.findInTMDB(imdbId);
            if (!tmdbInfo) {
                logger.debug('TMDB API offline, usando fallback HTML', { imdbId });
                const htmlResult = await (0, TmdbHtmlScraper_js_1.getTmdbTitlesViaHtml)(imdbId);
                if (htmlResult) {
                    ImdbScraperService.setCache(cacheKey, { data: htmlResult, timestamp: Date.now() });
                    await this.saveToDbCache(imdbId, seasonKey, htmlResult);
                    return htmlResult;
                }
                logger.debug('TMDB HTML fallback falhou, tentando IMDb HTML', { imdbId });
                const imdbResult = await this.scrapeImdbTitle(imdbId);
                ImdbScraperService.setCache(cacheKey, { data: imdbResult, timestamp: Date.now() });
                await this.saveToDbCache(imdbId, seasonKey, imdbResult);
                return imdbResult;
            }
            const { tmdbId: tmdbIdNum, mediaType } = tmdbInfo;
            const resolved = await this.resolveTitleFromTMDB(tmdbIdNum, mediaType, imdbId, season);
            let finalOriginal = resolved.originalTitle;
            if (finalOriginal && !/^[a-z0-9\s\-\.':,!]+$/i.test(finalOriginal)) {
                finalOriginal = await this.getEnglishTitle(tmdbIdNum, mediaType) || finalOriginal;
            }
            const normalizedOriginal = this.normalizeTitle(finalOriginal);
            const normalizedPortuguese = resolved.portugueseTitle ? this.normalizeTitle(resolved.portugueseTitle) : '';
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
            const englishTitle = await this.getEnglishTitleFromOmdb(imdbId);
            if (englishTitle) {
                const normalizedEn = this.normalizeTitle(englishTitle);
                if (normalizedEn && normalizedEn !== normalizedOriginal && normalizedEn !== normalizedPortuguese) {
                    allTitles.push(normalizedEn);
                }
            }
            const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));
            const result = {
                originalTitle: normalizedOriginal,
                portugueseTitle: hasPortuguese ? normalizedPortuguese : null,
                portugueseTitleRaw: hasPortuguese ? resolved.portugueseTitle : null,
                allTitles: uniqueTitles,
                foundInPortuguese: hasPortuguese,
                year: resolved.year,
                mediaType,
                portuguesePriority,
                episodeTitles: mediaType === 'tv' && season !== undefined && season > 0
                    ? await this.fetchEpisodeTitles(tmdbIdNum, season).catch(() => [])
                    : [],
            };
            ImdbScraperService.setCache(cacheKey, {
                data: result,
                timestamp: Date.now(),
                tmdbId: tmdbIdNum,
                mediaType,
            });
            await this.saveToDbCache(imdbId, seasonKey, result);
            logger.debug('Títulos TMDB obtidos', {
                imdbId,
                tmdbId: tmdbIdNum,
                year: resolved.year,
                mediaType,
                season,
                portugues: hasPortuguese ? 'SIM' : 'NÃO',
                tituloOriginal: normalizedOriginal.substring(0, 50),
            });
            return result;
        }
        catch (error) {
            logger.error('TMDB erro geral', {
                imdbId,
                season,
                error: error instanceof Error ? error.message : 'Erro desconhecido',
            });
            const empty = this.createEmptyResult(imdbId);
            const cacheKey = season ? `${imdbId}:s${season}` : imdbId;
            ImdbScraperService.setCache(cacheKey, { data: empty, timestamp: Date.now() });
            return empty;
        }
    }
    async resolveTitleFromTMDB(tmdbId, mediaType, imdbId, season) {
        if (mediaType === 'movie') {
            const details = await this.fetchDetailsFromTMDB(tmdbId, 'movie');
            if (details) {
                return {
                    originalTitle: details.original_title || details.title || '',
                    portugueseTitle: details.title || null,
                    year: details.release_date ? parseInt(details.release_date.substring(0, 4)) : undefined,
                };
            }
        }
        if (mediaType === 'tv') {
            let year;
            if (season !== undefined && season > 0) {
                try {
                    const seasonData = await this.fetchSeasonFromTMDB(tmdbId, season);
                    if (seasonData?.air_date) {
                        year = parseInt(seasonData.air_date.substring(0, 4));
                    }
                }
                catch (seasonError) {
                    logger.warn('TMDB erro temporada, usando dados da série', { imdbId, season, error: seasonError instanceof Error ? seasonError.message : 'Erro' });
                }
            }
            const seriesDetails = await this.fetchDetailsFromTMDB(tmdbId, 'tv');
            if (seriesDetails) {
                return {
                    originalTitle: seriesDetails.original_name || seriesDetails.name || '',
                    portugueseTitle: seriesDetails.name || null,
                    year: year ?? (seriesDetails.first_air_date ? parseInt(seriesDetails.first_air_date.substring(0, 4)) : undefined),
                };
            }
        }
        return { originalTitle: '', portugueseTitle: null };
    }
    async getEnglishTitle(tmdbId, mediaType) {
        const enDetails = await this.fetchDetailsFromTMDB(tmdbId, mediaType, 'en-US');
        if (!enDetails)
            return null;
        return mediaType === 'tv' ? enDetails.name : enDetails.title;
    }
    async getEnglishTitleFromOmdb(imdbId) {
        try {
            const omdbUrl = `http://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY || 'trilogy'}`;
            const omdbResp = await axios_1.default.get(omdbUrl, { timeout: 5000 });
            if (omdbResp.data?.Response === 'True' && omdbResp.data?.Title) {
                return omdbResp.data.Title;
            }
        }
        catch {
        }
        return '';
    }
    async findInTMDB(imdbId) {
        try {
            const response = await axios_1.default.get(`${this.tmdbBaseUrl}/find/${imdbId}`, {
                params: {
                    api_key: this.tmdbApiKey,
                    external_source: 'imdb_id',
                    language: this.language,
                },
                timeout: 10000,
            });
            if (response.data.movie_results && response.data.movie_results.length > 0) {
                return { tmdbId: response.data.movie_results[0].id, mediaType: 'movie' };
            }
            if (response.data.tv_results && response.data.tv_results.length > 0) {
                return { tmdbId: response.data.tv_results[0].id, mediaType: 'tv' };
            }
            return null;
        }
        catch (error) {
            logger.debug('TMDB find falhou, fallback HTML será usado', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
            return null;
        }
    }
    async fetchDetailsFromTMDB(tmdbId, mediaType, langOverride) {
        try {
            const endpoint = mediaType === 'movie' ? 'movie' : 'tv';
            const response = await axios_1.default.get(`${this.tmdbBaseUrl}/${endpoint}/${tmdbId}`, {
                params: { api_key: this.tmdbApiKey, language: langOverride || this.language },
                timeout: 10000,
            });
            return response.data;
        }
        catch (error) {
            logger.debug('TMDB detalhes falhou', { tmdbId, mediaType, error: error instanceof Error ? error.message : 'Erro' });
            return null;
        }
    }
    async fetchSeasonFromTMDB(tmdbId, season, langOverride) {
        try {
            const response = await axios_1.default.get(`${this.tmdbBaseUrl}/tv/${tmdbId}/season/${season}`, {
                params: { api_key: this.tmdbApiKey, language: langOverride || this.language },
                timeout: 10000,
            });
            return response.data;
        }
        catch (error) {
            logger.debug('TMDB temporada falhou', { tmdbId, season, error: error instanceof Error ? error.message : 'Erro' });
            throw error;
        }
    }
    async fetchEpisodeTitles(tmdbId, season) {
        const result = [];
        try {
            const [ptData, enData] = await Promise.all([
                this.fetchSeasonFromTMDB(tmdbId, season, 'pt-BR').catch(() => null),
                this.fetchSeasonFromTMDB(tmdbId, season, 'en-US').catch(() => null),
            ]);
            const episodes = ptData?.episodes || enData?.episodes || [];
            for (const ep of episodes) {
                const episodeNumber = ep.episode_number;
                if (!episodeNumber)
                    continue;
                const namePt = ptData?.episodes?.find((e) => e.episode_number === episodeNumber)?.name;
                const nameEn = enData?.episodes?.find((e) => e.episode_number === episodeNumber)?.name;
                if (namePt || nameEn) {
                    result.push({ episodeNumber, namePt, nameEn });
                }
            }
        }
        catch (error) {
            logger.warn('TMDB episódios falhou', { tmdbId, season, error: error instanceof Error ? error.message : 'Erro' });
        }
        return result;
    }
    async scrapeImdbTitle(imdbId) {
        try {
            const url = `https://www.imdb.com/title/${imdbId}/`;
            const res = await axios_1.default.get(url, {
                timeout: 10000,
                httpsAgent: dnsAgent,
                lookup: lookupImdb,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
                },
            });
            const $ = cheerio.load(res.data);
            const rawTitle = $('title').text().replace(/\s*-\s*IMDb\s*$/i, '').trim();
            const yearMatch = rawTitle.match(/\((\d{4})\)/);
            const year = yearMatch ? parseInt(yearMatch[1]) : undefined;
            const cleanTitle = rawTitle.replace(/\s*\(\d{4}\)\s*/, '').trim();
            const normalized = this.normalizeTitle(cleanTitle);
            if (!normalized || normalized.length < 2) {
                return this.createEmptyResult(imdbId);
            }
            logger.debug('IMDb HTML fallback OK', { imdbId, title: cleanTitle.substring(0, 50), year });
            return {
                originalTitle: normalized,
                portugueseTitle: null,
                portugueseTitleRaw: null,
                allTitles: [normalized],
                foundInPortuguese: false,
                portuguesePriority: false,
                year,
                mediaType: undefined,
            };
        }
        catch (err) {
            logger.warn('IMDb HTML fallback falhou', { imdbId, error: err.message });
            return this.createEmptyResult(imdbId);
        }
    }
    createEmptyResult(imdbId) {
        logger.debug('Resultado vazio gerado', { imdbId });
        return {
            originalTitle: `Unknown Title (${imdbId})`,
            portugueseTitle: null,
            portugueseTitleRaw: null,
            allTitles: [],
            foundInPortuguese: false,
            portuguesePriority: false,
        };
    }
    normalizeTitle(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async getTitleFromImdbId(imdbId) {
        try {
            const titles = await this.getTitlesFromImdbId(imdbId);
            return titles.portugueseTitle || titles.originalTitle || null;
        }
        catch (error) {
            logger.error('TMDB erro compatibilidade', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
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
            entries: Array.from(ImdbScraperService.globalCache.keys()),
        };
    }
    clearInstanceCache() {
        ImdbScraperService.clearGlobalCache();
    }
    getStats() {
        return {
            cacheSize: ImdbScraperService.globalCache.size,
            cacheTTL: this.cacheTTL,
            version: '2.5.0',
            feature: 'Fallback HTML + cache memória + cache banco (R12) + correção mojibake (R16b) + separação PT/EN no DB (R17)',
        };
    }
}
exports.ImdbScraperService = ImdbScraperService;
ImdbScraperService.globalCache = new Map();
ImdbScraperService.MAX_CACHE_SIZE = 1000;
ImdbScraperService.cleanupTimer = null;
ImdbScraperService.CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000;
ImdbScraperService.DB_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
