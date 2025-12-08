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
exports.ComandoScraper = void 0;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const qualityDetector_1 = require("../../lib/qualityDetector");
class ComandoScraper {
    constructor() {
        this.baseUrl = 'https://comando.la';
        this.timeout = 15000;
        this.version = '1.0.0';
        this.monthTranslator = {
            'janeiro': '01',
            'fevereiro': '02',
            'março': '03',
            'abril': '04',
            'maio': '05',
            'junho': '06',
            'julho': '07',
            'agosto': '08',
            'setembro': '09',
            'outubro': '10',
            'novembro': '11',
            'dezembro': '12'
        };
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        console.log(`[INFO] [ComandoScraper] Iniciando v${this.version} - Scraper do Comando Torrents`);
    }
    async search(query, type, targetSeason, targetYear) {
        const startTime = Date.now();
        console.log(`[INFO] [ComandoScraper] Iniciando busca`, {
            query,
            type,
            targetSeason,
            targetYear
        });
        try {
            const searchResults = await this.scrapeSearchPage(query, targetSeason);
            if (searchResults.length === 0) {
                console.log(`[INFO] [ComandoScraper] Nenhum resultado encontrado`);
                return [];
            }
            console.log(`[DEBUG] [ComandoScraper] ${searchResults.length} links encontrados`);
            const allTorrents = [];
            for (const result of searchResults.slice(0, 6)) {
                try {
                    const torrents = await this.scrapeDetailsPage(result.url, result.title);
                    allTorrents.push(...torrents);
                }
                catch (error) {
                    console.log(`[DEBUG] [ComandoScraper] Erro ao processar ${result.url}:`, error instanceof Error ? error.message : 'Erro desconhecido');
                }
            }
            const filteredTorrents = this.filterBySeason(allTorrents, targetSeason);
            const duration = Date.now() - startTime;
            console.log(`[INFO] [ComandoScraper] Busca finalizada`, {
                query,
                resultados: filteredTorrents.length,
                tempo: `${duration}ms`
            });
            return filteredTorrents;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            console.log(`[ERROR] [ComandoScraper] Erro na busca`, {
                query,
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${duration}ms`
            });
            return [];
        }
    }
    async scrapeSearchPage(query, season) {
        let searchQuery = query;
        if (season !== undefined) {
            searchQuery = `${query} temporada ${season}`;
        }
        const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(searchQuery)}`;
        console.log(`[DEBUG] [ComandoScraper] Buscando: ${searchUrl}`);
        const response = await axios_1.default.get(searchUrl, {
            timeout: this.timeout,
            headers: this.getHeaders()
        });
        const $ = cheerio.load(response.data);
        const results = [];
        $('article').each((index, element) => {
            const titleElement = $(element).find('h2.entry-title > a');
            const title = titleElement.text().trim();
            const url = titleElement.attr('href');
            if (title && url) {
                results.push({
                    title: title.replace(' - Download', '').replace('comando.la', '').trim(),
                    url
                });
                console.log(`[DEBUG] [ComandoScraper] Resultado: ${title.substring(0, 60)}...`);
            }
        });
        return results;
    }
    async scrapeDetailsPage(url, originalTitle) {
        console.log(`[DEBUG] [ComandoScraper] Extraindo detalhes: ${url.substring(0, 80)}...`);
        const response = await axios_1.default.get(url, {
            timeout: this.timeout,
            headers: this.getHeaders()
        });
        const $ = cheerio.load(response.data);
        const torrents = [];
        const title = $('article .entry-title').text()
            .replace(' - Download', '')
            .replace('comando.la', '')
            .trim();
        const content = $('article div.entry-content');
        const magnetLinks = [];
        content.find('a[href^="magnet"]').each((index, element) => {
            const magnet = $(element).attr('href');
            if (magnet) {
                magnetLinks.push(magnet);
            }
        });
        const technicalInfo = this.extractTechnicalInfo(content);
        const date = this.extractPublishedDate($);
        for (const magnet of magnetLinks) {
            const quality = this.qualityDetector.extractQualityFromFilename(title);
            const seasonNumber = this.extractSeasonNumber(title);
            const language = this.extractLanguageFromTechnicalInfo(technicalInfo);
            const torrent = {
                title: this.cleanTitle(title),
                magnet: magnet,
                seeders: this.estimateSeeders('Comando', quality),
                leechers: 0,
                size: technicalInfo.size || 'Tamanho não especificado',
                quality: quality || 'HD',
                provider: 'Comando Torrents',
                language: language,
                type: this.determineType(title, technicalInfo),
                relevanceScore: 80,
                sizeInBytes: this.parseSizeToBytes(technicalInfo.size),
                season: seasonNumber || undefined,
                lastUpdated: date,
                confidence: 0.7
            };
            torrents.push(torrent);
        }
        return torrents;
    }
    extractTechnicalInfo(content) {
        const info = {
            size: undefined,
            year: undefined,
            audio: [],
            format: undefined,
            quality: undefined
        };
        content.find('p').each((index, element) => {
            const text = $(element).text().trim();
            const sizeMatch = text.match(/Tamanho:\s*(.+)/i);
            if (sizeMatch)
                info.size = sizeMatch[1].trim();
            const yearMatch = text.match(/Ano.*:\s*(\d{4})/i);
            if (yearMatch)
                info.year = yearMatch[1];
            const audioMatch = text.match(/Áudio:\s*(.+)/i) || text.match(/Idioma:\s*(.+)/i);
            if (audioMatch) {
                const audioParts = audioMatch[1].split(/[|,]/).map(a => a.trim());
                info.audio.push(...audioParts);
            }
            const formatMatch = text.match(/Formato:\s*(.+)/i);
            if (formatMatch)
                info.format = formatMatch[1].trim();
            const qualityMatch = text.match(/Qualidade:\s*(.+)/i);
            if (qualityMatch)
                info.quality = qualityMatch[1].trim();
        });
        return info;
    }
    extractPublishedDate($) {
        const metaDate = $('meta[property="article:published_time"]').attr('content') ||
            $('meta[name="date"]').attr('content');
        if (metaDate) {
            try {
                return new Date(metaDate);
            }
            catch {
            }
        }
        const dateText = $('article div[itemprop="datePublished"]').text().trim();
        if (dateText) {
            const parsedDate = this.parseBrazilianDate(dateText);
            if (parsedDate)
                return parsedDate;
        }
        return new Date();
    }
    parseBrazilianDate(dateText) {
        const match = dateText.match(/(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/);
        if (match) {
            const day = match[1].padStart(2, '0');
            const month = this.monthTranslator[match[2].toLowerCase()];
            const year = match[3];
            if (month) {
                try {
                    return new Date(`${year}-${month}-${day}`);
                }
                catch {
                    return null;
                }
            }
        }
        return null;
    }
    extractLanguageFromTechnicalInfo(info) {
        if (!info.audio || info.audio.length === 0) {
            return 'pt-BR';
        }
        const audioStr = info.audio.join(', ').toLowerCase();
        if (audioStr.includes('português') && audioStr.includes('inglês')) {
            return 'pt-BR,en';
        }
        if (audioStr.includes('português') || audioStr.includes('dublado')) {
            return 'pt-BR';
        }
        if (audioStr.includes('inglês') || audioStr.includes('english')) {
            return 'en';
        }
        return 'pt-BR';
    }
    determineType(title, info) {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('temporada') ||
            titleLower.includes('season') ||
            titleLower.includes('s01') ||
            titleLower.includes('s02') ||
            titleLower.includes(' ep') ||
            titleLower.includes(' episódio')) {
            return 'series';
        }
        if (info.format?.toLowerCase().includes('serie') ||
            info.format?.toLowerCase().includes('season')) {
            return 'series';
        }
        return 'movie';
    }
    filterBySeason(torrents, targetSeason) {
        if (!targetSeason)
            return torrents;
        return torrents.filter(torrent => {
            if (torrent.season === undefined) {
                const seasonFromTitle = this.extractSeasonNumber(torrent.title);
                return seasonFromTitle === targetSeason;
            }
            return torrent.season === targetSeason;
        });
    }
    cleanTitle(title) {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
    }
    extractSeasonNumber(text) {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i,
            /s(\d+)\s*e\d+/i,
            /(\d+)x\d+/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }
    parseSizeToBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Tamanho não especificado' || sizeStr === '–') {
            return 1.5 * 1024 * 1024 * 1024;
        }
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match)
            return 1.5 * 1024 * 1024 * 1024;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G')
            return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M')
            return value * 1024 * 1024;
        return 1.5 * 1024 * 1024 * 1024;
    }
    estimateSeeders(provider, quality) {
        const baseSeeders = {
            'Comando Torrents': 55,
            'BLUDV': 60,
            'TorrentIndexer': 70,
            'Starck Filmes': 50
        };
        const qualityMultiplier = {
            '2160p': 1.5,
            '1080p': 1.3,
            '720p': 1.0,
            'HD': 1.1,
            '480p': 0.8,
            'SD': 0.7
        };
        const base = baseSeeders[provider] || 40;
        const multiplier = qualityMultiplier[quality] || 1.0;
        return Math.round(base * multiplier);
    }
    getHeaders() {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive'
        };
    }
    getStats() {
        return {
            version: this.version,
            baseUrl: this.baseUrl,
            features: [
                'Scraping direto do Comando Torrents',
                'Suporte a datas em formato brasileiro',
                'Extração de magnet links diretos',
                'Filtro por temporada'
            ]
        };
    }
}
exports.ComandoScraper = ComandoScraper;
