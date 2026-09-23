"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentioService = void 0;
const axios_1 = __importDefault(require("axios"));
const logger_js_1 = require("../utils/logger.js");
class TorrentioService {
    constructor() {
        this.logger = new logger_js_1.Logger('TorrentioService');
        this.baseUrl = 'https://torrentio.strem.fun';
    }
    async search(type, imdbId, season, episode) {
        const startTime = Date.now();
        try {
            let path;
            if (type === 'series' && season !== undefined && episode !== undefined) {
                path = `/stream/series/${imdbId}:${season}:${episode}.json`;
            }
            else if (type === 'series' && season !== undefined) {
                path = `/stream/series/${imdbId}:${season}.json`;
            }
            else {
                path = `/stream/${type}/${imdbId}.json`;
            }
            const url = `${this.baseUrl}${path}`;
            this.logger.debug(`🔍 Buscando Torrentio: ${url}`);
            const response = await axios_1.default.get(url, {
                timeout: 12000,
                headers: { 'User-Agent': 'Stremio/4.4' }
            });
            const streams = response.data?.streams || [];
            const elapsed = Date.now() - startTime;
            this.logger.debug(`Torrentio retornou ${streams.length} streams em ${elapsed}ms`);
            const ptStreams = streams.filter(s => this.isPortugueseStream(s));
            this.logger.debug(`${ptStreams.length} streams PT-BR encontrados no Torrentio`);
            const results = ptStreams.map(s => this.convertToResult(s, type));
            return results;
        }
        catch (error) {
            const elapsed = Date.now() - startTime;
            this.logger.warn('Erro ao buscar Torrentio', {
                imdbId,
                erro: error.message,
                tempo: `${elapsed}ms`
            });
            return [];
        }
    }
    isPortugueseStream(stream) {
        const text = `${stream.title} ${stream.name}`.toLowerCase();
        return /dual|dublado|portugues|português|pt-br|ptbr|nacional|🇧🇷|🇵🇹/.test(text);
    }
    convertToResult(stream, type) {
        const title = this.extractCleanTitle(stream.title);
        const infoHash = stream.infoHash;
        const magnet = `magnet:?xt=urn:btih:${infoHash}`;
        const seeders = this.extractSeeders(stream.title);
        const size = this.extractSize(stream.title);
        const quality = this.extractQuality(stream.title);
        const provider = this.extractProvider(stream.title);
        return {
            title,
            magnet,
            infoHash,
            seeders,
            size,
            quality,
            provider,
            language: 'pt-BR',
            type
        };
    }
    extractCleanTitle(rawTitle) {
        let clean = rawTitle
            .replace(/\n.*$/s, '')
            .replace(/[👤💾⚙️🇧🇷🇵🇹🇬🇧🇺🇸]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        clean = clean.replace(/[\s_]*1080p_D$/i, ' 1080p Dual Audio');
        clean = clean.replace(/[\s_]*720p_D$/i, ' 720p Dual Audio');
        clean = clean.replace(/[\s_]*4K_D$/i, ' 4K Dual Audio');
        return clean;
    }
    extractSeeders(title) {
        const match = title.match(/👤\s*(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }
    extractSize(title) {
        const match = title.match(/💾\s*([\d.]+)\s*(GB|MB|TB)/i);
        return match ? `${match[1]} ${match[2].toUpperCase()}` : 'Tamanho não especificado';
    }
    extractQuality(title) {
        const lower = title.toLowerCase();
        if (lower.includes('4k') || lower.includes('2160p'))
            return '4K';
        if (lower.includes('1080p'))
            return '1080p';
        if (lower.includes('720p'))
            return '720p';
        if (lower.includes('480p'))
            return '480p';
        return 'HD';
    }
    extractProvider(title) {
        const match = title.match(/⚙️\s*(\S+)/);
        return match ? match[1] : 'Torrentio';
    }
}
exports.TorrentioService = TorrentioService;
