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
const logger_1 = require("../utils/logger");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const logger = new logger_1.Logger('ImdbScraper');
class ImdbScraperService {
    constructor() {
        this.imdbBaseUrl = 'https://www.imdb.com/title';
        this.titleCache = new Map();
        logger.info('Servico de scraping do IMDB inicializado - Suporte a multiplos idiomas');
    }
    async getTitlesFromImdbId(imdbId) {
        try {
            if (this.titleCache.has(imdbId)) {
                logger.debug('Usando titulos em cache', { imdbId });
                return this.titleCache.get(imdbId);
            }
            logger.info(`Buscando titulos no IMDB: ${imdbId}`);
            const [originalResult, portugueseResult] = await Promise.allSettled([
                this.fetchAndParseTitle(imdbId, false),
                this.fetchAndParseTitle(imdbId, true)
            ]);
            let originalTitle = '';
            if (originalResult.status === 'fulfilled' && originalResult.value) {
                originalTitle = originalResult.value;
            }
            else {
                logger.warn('Falha ao buscar titulo original', {
                    imdbId,
                    error: originalResult.status === 'rejected' ? originalResult.reason : 'Desconhecido'
                });
            }
            let portugueseTitle = null;
            let foundInPortuguese = false;
            if (portugueseResult.status === 'fulfilled' && portugueseResult.value) {
                portugueseTitle = portugueseResult.value;
                foundInPortuguese = this.isValidPortugueseTitle(portugueseTitle);
                if (!foundInPortuguese) {
                    logger.debug('Titulo em portugues nao considerado valido', {
                        imdbId,
                        title: portugueseTitle
                    });
                    portugueseTitle = null;
                }
            }
            if (!originalTitle) {
                logger.warn('Tentando fallback para titulo original', { imdbId });
                originalTitle = await this.getEnglishTitleFallback(imdbId);
            }
            if (!originalTitle) {
                throw new Error(`Nao foi possivel obter titulo para ${imdbId}`);
            }
            const allTitles = [originalTitle];
            if (portugueseTitle && portugueseTitle !== originalTitle) {
                allTitles.push(portugueseTitle);
            }
            const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));
            const result = {
                originalTitle,
                portugueseTitle,
                allTitles: uniqueTitles,
                foundInPortuguese
            };
            this.titleCache.set(imdbId, result);
            logger.info(`Titulos encontrados no IMDB`, {
                imdbId,
                originalTitle,
                portugueseTitle,
                foundInPortuguese,
                totalTitles: uniqueTitles.length,
                titlesList: uniqueTitles
            });
            return result;
        }
        catch (error) {
            logger.error('Erro critico ao buscar titulos no IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            try {
                const fallbackTitle = await this.getTitleFromImdbIdFallback(imdbId);
                return {
                    originalTitle: fallbackTitle || `Unknown Title (${imdbId})`,
                    portugueseTitle: null,
                    allTitles: fallbackTitle ? [fallbackTitle] : [],
                    foundInPortuguese: false
                };
            }
            catch {
                return {
                    originalTitle: `Unknown Title (${imdbId})`,
                    portugueseTitle: null,
                    allTitles: [],
                    foundInPortuguese: false
                };
            }
        }
    }
    async getTitleFromImdbId(imdbId) {
        try {
            const titles = await this.getTitlesFromImdbId(imdbId);
            return titles.portugueseTitle || titles.originalTitle || null;
        }
        catch (error) {
            logger.error('Erro no metodo de compatibilidade', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async fetchAndParseTitle(imdbId, inPortuguese) {
        try {
            const url = inPortuguese
                ? `${this.imdbBaseUrl}/${imdbId}/?language=pt-BR`
                : `${this.imdbBaseUrl}/${imdbId}`;
            const html = await this.fetchImdbPage(url, inPortuguese);
            const title = this.parseTitleFromHtml(html, imdbId);
            if (!title) {
                return null;
            }
            const cleanedTitle = this.cleanTitle(title);
            if (inPortuguese && !this.isValidPortugueseTitle(cleanedTitle)) {
                return null;
            }
            return cleanedTitle;
        }
        catch (error) {
            logger.debug(`Falha ao buscar titulo ${inPortuguese ? 'em portugues' : 'original'}`, {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async fetchImdbPage(url, isPortuguese) {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache'
        };
        if (isPortuguese) {
            headers['Accept-Language'] = 'pt-BR,pt;q=0.9,en;q=0.8';
            headers['Cookie'] = 'lc-main=pt_BR';
        }
        else {
            headers['Accept-Language'] = 'en-US,en;q=0.9';
        }
        const response = await axios_1.default.get(url, {
            timeout: 10000,
            headers,
            validateStatus: (status) => status === 200
        });
        return response.data;
    }
    parseTitleFromHtml(html, imdbId) {
        try {
            const $ = cheerio.load(html);
            const h1Title = $('h1[data-testid="hero__pageTitle"]').text().trim();
            if (h1Title) {
                return h1Title;
            }
            const firstH1 = $('h1').first().text().trim();
            if (firstH1) {
                return firstH1;
            }
            const metaTitle = $('meta[property="og:title"]').attr('content');
            if (metaTitle) {
                return metaTitle.replace(/\s*-\s*IMDb\s*$/i, '').trim();
            }
            const pageTitle = $('title').text().trim();
            if (pageTitle) {
                return pageTitle.replace(/\s*-\s*IMDb\s*$/i, '').trim();
            }
            const jsonLdScript = $('script[type="application/ld+json"]').first().html();
            if (jsonLdScript) {
                try {
                    const data = JSON.parse(jsonLdScript);
                    if (data.name) {
                        return data.name.toString().trim();
                    }
                }
                catch (e) {
                }
            }
            if (this.containsPortugueseMarkers(html)) {
                const altTitleSection = $('.titlereference-overview, [data-testid="akas"]').first();
                if (altTitleSection.length) {
                    const altTitles = altTitleSection.text();
                    const lines = altTitles.split('\n').map(line => line.trim()).filter(line => line);
                    for (const line of lines) {
                        if (line.toLowerCase().includes('brazil') ||
                            line.toLowerCase().includes('portuguese') ||
                            this.containsPortugueseMarkers(line)) {
                            const title = line.replace(/\(.*?\)/g, '').trim();
                            if (title)
                                return title;
                        }
                    }
                }
            }
            return null;
        }
        catch (error) {
            logger.error('Erro ao parsear HTML do IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    cleanTitle(title) {
        return title
            .replace(/\s*[-–]\s*IMDb\s*$/i, '')
            .replace(/\(\s*\d{4}\s*\)$/, '')
            .replace(/\s*[|•]\s*.*$/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    isValidPortugueseTitle(title) {
        if (!title || title.length < 2)
            return false;
        const titleLower = title.toLowerCase();
        const hasPortugueseAccents = /[áàâãéèêíïóôõöúüçñ]/i.test(title);
        const portugueseIndicators = [
            /\b(de|do|da|dos|das)\b/i,
            /\b(no|na|nos|nas)\b/i,
            /\b(um|uma|uns|umas)\b/i,
            /\b(o|a|os|as)\s+[a-z]/i,
            /\b(e|mas|porque|que)\b/i,
            /\b(temporada|epis[oó]dio|s[ée]rie|filme)\b/i,
            /\b(dublado|legendado|nacional|brasil)\b/i
        ];
        const hasPortugueseWords = portugueseIndicators.some(pattern => pattern.test(titleLower));
        const englishIndicators = [
            /\b(the|of|and|in|on|at|to|for)\b/i,
            /\b(season|episode|series|movie)\b/i,
            /\b(web|dl|bluray|dvd|hd)\b/i
        ];
        const hasEnglishWords = englishIndicators.some(pattern => pattern.test(titleLower));
        return (hasPortugueseAccents || hasPortugueseWords) && !hasEnglishWords;
    }
    containsPortugueseMarkers(text) {
        const lowerText = text.toLowerCase();
        return lowerText.includes('brasil') ||
            lowerText.includes('portuguese') ||
            lowerText.includes('português') ||
            /[áàâãéèêíïóôõöúüçñ]/i.test(text);
    }
    async getEnglishTitleFallback(imdbId) {
        try {
            const url = `${this.imdbBaseUrl}/${imdbId}`;
            const html = await this.fetchImdbPage(url, false);
            const title = this.parseTitleFromHtml(html, imdbId);
            return title ? this.cleanTitle(title) : '';
        }
        catch {
            return '';
        }
    }
    async getTitleFromImdbIdFallback(imdbId) {
        try {
            const portugueseTitle = await this.fetchAndParseTitle(imdbId, true);
            if (portugueseTitle)
                return portugueseTitle;
            const englishTitle = await this.fetchAndParseTitle(imdbId, false);
            return englishTitle;
        }
        catch {
            return null;
        }
    }
    clearCache() {
        this.titleCache.clear();
        logger.debug('Cache do IMDB limpo');
    }
}
exports.ImdbScraperService = ImdbScraperService;
