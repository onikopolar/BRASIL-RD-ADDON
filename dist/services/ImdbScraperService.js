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
        logger.info('Servico de scraping do IMDB inicializado');
    }
    async getTitleFromImdbId(imdbId) {
        try {
            logger.info(`Buscando titulo no IMDB: ${imdbId}`);
            const portugueseTitle = await this.getPortugueseTitle(imdbId);
            if (portugueseTitle) {
                logger.info(`Titulo em portugues encontrado no IMDB: ${portugueseTitle}`, { imdbId });
                return portugueseTitle;
            }
            const englishTitle = await this.getEnglishTitle(imdbId);
            if (englishTitle) {
                logger.info(`Titulo em ingles encontrado no IMDB: ${englishTitle}`, { imdbId });
                return englishTitle;
            }
            logger.warn(`Titulo nao encontrado no IMDB`, { imdbId });
            return null;
        }
        catch (error) {
            logger.error('Erro ao buscar titulo no IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async getPortugueseTitle(imdbId) {
        try {
            const url = `${this.imdbBaseUrl}/${imdbId}/?language=pt-BR`;
            const html = await this.fetchImdbPage(url);
            const title = this.parseTitleFromHtml(html, imdbId);
            return title && this.isValidPortugueseTitle(title) ? title : null;
        }
        catch (error) {
            logger.warn('Nao foi possivel obter titulo em portugues', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async getEnglishTitle(imdbId) {
        try {
            const url = `${this.imdbBaseUrl}/${imdbId}`;
            const html = await this.fetchImdbPage(url);
            const title = this.parseTitleFromHtml(html, imdbId);
            return title ? title : null;
        }
        catch (error) {
            logger.warn('Nao foi possivel obter titulo em ingles', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    async fetchImdbPage(url) {
        const response = await axios_1.default.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });
        return response.data;
    }
    parseTitleFromHtml(html, imdbId) {
        try {
            const $ = cheerio.load(html);
            const h1Title = $('h1[data-testid="hero__pageTitle"]').text().trim();
            if (h1Title) {
                return this.cleanTitle(h1Title);
            }
            const firstH1 = $('h1').first().text().trim();
            if (firstH1) {
                return this.cleanTitle(firstH1);
            }
            const metaTitle = $('meta[property="og:title"]').attr('content');
            if (metaTitle) {
                return this.cleanTitle(metaTitle);
            }
            const jsonLd = $('script[type="application/ld+json"]').first().html();
            if (jsonLd) {
                try {
                    const data = JSON.parse(jsonLd);
                    if (data.name) {
                        return this.cleanTitle(data.name);
                    }
                }
                catch (e) {
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
            .replace(/- IMDb$/, '')
            .replace(/\(\d{4}\)/, '')
            .replace(/\s*-\s*IMDb\s*$/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    isValidPortugueseTitle(title) {
        const portugueseIndicators = [
            ' o ', ' a ', ' os ', ' as ', ' do ', ' da ', ' dos ', ' das ',
            ' no ', ' na ', ' nos ', ' nas ', ' pelo ', ' pela ', ' pelos ', ' pelas ',
            ' um ', ' uma ', ' uns ', ' umas ', ' é ', ' são ', ' foi ', ' foram '
        ];
        const titleLower = title.toLowerCase();
        const hasPortugueseChars = /[áàâãéèêíïóôõöúüçñ]/i.test(title);
        const hasPortugueseWords = portugueseIndicators.some(word => titleLower.includes(word));
        return hasPortugueseChars || hasPortugueseWords || titleLower.length > 3;
    }
}
exports.ImdbScraperService = ImdbScraperService;
