"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentIndexerService = void 0;
const axios_1 = __importDefault(require("axios"));
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
class TorrentIndexerService {
    constructor() {
        this.baseUrl = 'https://torrent-indexer.darklyn.org';
        this.timeout = 15000;
        this.qualityDetector = new qualityDetector_js_1.QualityDetector();
    }
    async search(query, type, targetSeason) {
        if (!query || query.trim().length === 0) {
            return [];
        }
        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params = {
                q: query.toLowerCase(),
                filter_results: 'true',
                category: category
            };
            if (targetSeason && type === 'series') {
                params.season = targetSeason.toString();
            }
            const response = await axios_1.default.get(`${this.baseUrl}/search`, {
                timeout: this.timeout,
                headers: this.getHeaders(),
                params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) {
                return [];
            }
            const results = data.results.slice(0, 20);
            const mappedResults = results.map((indexerResult) => this.mapTorrentIndexerResult(indexerResult, type)).filter(Boolean);
            return mappedResults;
        }
        catch (error) {
            return [];
        }
    }
    mapTorrentIndexerResult(indexerResult, type) {
        if (!indexerResult.title || !indexerResult.magnet_link) {
            return null;
        }
        const quality = this.qualityDetector.extractQualityFromFilename(indexerResult.title);
        if (!this.qualityDetector.isValidQuality(quality)) {
            return null;
        }
        const seasonNumber = this.extractSeasonNumber(indexerResult.title);
        return {
            title: this.cleanTitle(indexerResult.title),
            magnet: indexerResult.magnet_link,
            seeders: indexerResult.seed_count || this.estimateSeeders('TorrentIndexer', quality),
            leechers: indexerResult.leech_count || 0,
            size: indexerResult.size || 'Size not specified',
            quality: quality,
            provider: 'TorrentIndexer',
            language: this.extractLanguage(indexerResult.title),
            type,
            relevanceScore: 100,
            sizeInBytes: this.calculateSizeInBytes(indexerResult.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(indexerResult.date || Date.now()),
            confidence: 0.5
        };
    }
    extractSeasonNumber(text) {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i
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
    cleanTitle(title) {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .trim();
    }
    extractLanguage(title) {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('dual'))
            return 'pt-BR,en';
        if (titleLower.includes('dublado'))
            return 'pt-BR';
        if (titleLower.includes('legendado'))
            return 'pt';
        return 'pt-BR';
    }
    calculateSizeInBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Size not specified') {
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
            'TorrentIndexer': 70,
            'BLUDV': 80,
            'Starck Filmes': 60,
            'BaixaFilmesTorrent': 50
        };
        const qualityMultiplier = {
            '2160p': 1.5,
            '1080p': 1.3,
            '720p': 1.0,
            'HD': 1.1
        };
        const base = baseSeeders[provider] || 30;
        const multiplier = qualityMultiplier[quality] || 1.0;
        return Math.round(base * multiplier);
    }
    getHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
}
exports.TorrentIndexerService = TorrentIndexerService;
