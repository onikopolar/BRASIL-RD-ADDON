"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TMDBService = void 0;
const logger_1 = require("../../utils/logger");
const axios_1 = __importDefault(require("axios"));
class TMDBService {
    constructor(apiKey) {
        this.baseURL = 'https://api.themoviedb.org/3';
        this.language = 'pt-BR';
        this.logger = new logger_1.Logger('TMDBService');
        this.apiKey = apiKey;
        this.logger.info('✅ TMDBService inicializado - Modo Multi-Query');
    }
    async validatePortugueseTitle(torrentTitle) {
        this.logger.debug('🔍 VALIDAÇÃO TMDB (Multi-Query)', {
            torrentTitle: torrentTitle.substring(0, 80)
        });
        const queries = this.generateQueriesFromTorrentTitle(torrentTitle);
        this.logger.debug('📝 Queries geradas:', { queries });
        for (const query of queries) {
            const tmdbResult = await this.searchWithQuery(query);
            if (tmdbResult) {
                const matchResult = this.compareWithTMDBResult(torrentTitle, tmdbResult, query);
                if (matchResult.matches) {
                    this.logger.debug('✅ Match encontrado com query:', { query });
                    return matchResult;
                }
            }
        }
        return {
            matches: false,
            confidence: 0,
            portugueseTitle: '',
            englishTitle: '',
            tmdbId: 0,
            type: 'movie',
            reason: 'Nenhum match encontrado com nenhuma query'
        };
    }
    generateQueriesFromTorrentTitle(torrentTitle) {
        let cleaned = torrentTitle
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const technicalTerms = [
            'dublado', 'legendado', 'dual audio', 'dual áudio',
            '1080p', '720p', '2160p', '4k', 'hd', 'fullhd', 'full hd',
            'bluray', 'webdl', 'hdtv', 'dvdrip', 'web-dl', 'web dl',
            'torrent', 'hdr', 'sdr', 'ddp5', 'dd5', 'dd5.1', 'x264', 'x265', 'h.265', 'h.264',
            'mkv', 'mp4', 'avi', 'magnet', 'hash'
        ];
        technicalTerms.forEach(term => {
            const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\s*\\b${escapedTerm}\\b\\s*`, 'gi');
            cleaned = cleaned.replace(regex, ' ');
        });
        cleaned = cleaned.replace(/\s+/g, ' ').trim();
        const words = cleaned.split(' ').filter(w => w.length > 0);
        if (words.length === 0) {
            return [cleaned];
        }
        const queries = [];
        queries.push(words.join(' '));
        const keywords = words.filter(w => {
            if (/^\d+$/.test(w)) {
                const num = parseInt(w);
                return num >= 1900 && num <= 2100;
            }
            return true;
        });
        for (let i = 0; i < keywords.length; i++) {
            for (let j = i + 1; j < Math.min(i + 4, keywords.length); j++) {
                const combination = keywords.slice(i, j + 1).join(' ');
                if (combination.length >= 3) {
                    queries.push(combination);
                }
            }
        }
        const sortedByLength = [...keywords].sort((a, b) => b.length - a.length);
        if (sortedByLength.length >= 2) {
            queries.push(sortedByLength.slice(0, 2).join(' '));
        }
        const articles = ['o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na'];
        const withoutArticles = keywords.filter(w => !articles.includes(w));
        if (withoutArticles.length > 0 && withoutArticles.length !== keywords.length) {
            queries.push(withoutArticles.join(' '));
        }
        const uniqueQueries = [...new Set(queries.filter(q => q.length >= 2))];
        return uniqueQueries.sort((a, b) => {
            const scoreA = this.getQueryScore(a);
            const scoreB = this.getQueryScore(b);
            return scoreB - scoreA;
        });
    }
    getQueryScore(query) {
        const words = query.split(' ');
        let score = words.length * 10;
        words.forEach(word => {
            if (/^\d{4}$/.test(word)) {
                const year = parseInt(word);
                if (year >= 1900 && year <= 2100) {
                    score += 20;
                }
            }
            if (word.length >= 5) {
                score += 5;
            }
        });
        return score;
    }
    async searchWithQuery(query) {
        if (query.length < 2) {
            return null;
        }
        try {
            const response = await axios_1.default.get(`${this.baseURL}/search/multi`, {
                params: {
                    api_key: this.apiKey,
                    query: query,
                    language: this.language,
                    include_adult: false,
                    page: 1
                },
                timeout: 5000
            });
            if (response.data.results.length === 0) {
                return null;
            }
            return this.extractTMDBResult(response.data.results[0]);
        }
        catch (error) {
            this.logger.debug('⚠️ Erro na query:', { query, error: error instanceof Error ? error.message : 'Erro desconhecido' });
            return null;
        }
    }
    extractTMDBResult(result) {
        let portugueseTitle = '';
        let englishTitle = '';
        let type = 'movie';
        const tmdbId = result.id;
        let year;
        if (result.media_type === 'movie') {
            portugueseTitle = result.title || '';
            englishTitle = result.original_title || '';
            type = 'movie';
            if (result.release_date) {
                year = parseInt(result.release_date.substring(0, 4));
            }
        }
        else if (result.media_type === 'tv') {
            portugueseTitle = result.name || '';
            englishTitle = result.original_name || '';
            type = 'tv';
            if (result.first_air_date) {
                year = parseInt(result.first_air_date.substring(0, 4));
            }
        }
        else {
            return null;
        }
        if (!year && result.release_date) {
            year = parseInt(result.release_date.substring(0, 4));
        }
        if (!year && result.first_air_date) {
            year = parseInt(result.first_air_date.substring(0, 4));
        }
        portugueseTitle = this.normalizeTitle(portugueseTitle);
        englishTitle = this.normalizeTitle(englishTitle);
        return {
            portugueseTitle,
            englishTitle,
            tmdbId,
            type,
            year
        };
    }
    compareWithTMDBResult(torrentTitle, tmdbResult, queryUsed) {
        const torrentYear = this.extractYearFromTitle(torrentTitle);
        const torrentClean = this.normalizeTitle(torrentTitle);
        const tmdbClean = tmdbResult.portugueseTitle;
        this.logger.debug('🔍 Comparação:', {
            torrent: torrentClean,
            tmdb: tmdbClean,
            queryUsed,
            torrentYear,
            tmdbYear: tmdbResult.year
        });
        const tmdbContainsQuery = tmdbClean.includes(this.normalizeTitle(queryUsed));
        if (!tmdbContainsQuery) {
            return {
                matches: false,
                confidence: 0.3,
                portugueseTitle: tmdbResult.portugueseTitle,
                englishTitle: tmdbResult.englishTitle,
                tmdbId: tmdbResult.tmdbId,
                type: tmdbResult.type,
                year: tmdbResult.year,
                reason: `TMDB não contém a query usada: "${queryUsed}"`
            };
        }
        const similarity = this.calculateSimilarity(torrentClean, tmdbClean);
        const yearOk = !torrentYear || !tmdbResult.year || Math.abs(torrentYear - tmdbResult.year) <= 2;
        const confidence = similarity * (yearOk ? 1.0 : 0.7);
        const matches = similarity >= 0.6;
        return {
            matches,
            confidence,
            portugueseTitle: tmdbResult.portugueseTitle,
            englishTitle: tmdbResult.englishTitle,
            tmdbId: tmdbResult.tmdbId,
            type: tmdbResult.type,
            year: tmdbResult.year,
            reason: matches ?
                `Match com query "${queryUsed}" (similaridade: ${(similarity * 100).toFixed(1)}%)` :
                `Similaridade insuficiente: ${(similarity * 100).toFixed(1)}%`
        };
    }
    calculateSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        const set1 = new Set(words1);
        const commonWords = words2.filter(w => set1.has(w)).length;
        const wordSimilarity = commonWords / Math.max(words1.length, words2.length);
        const sequenceSimilarity = this.calculateSequenceSimilarity(str1, str2);
        return (wordSimilarity * 0.6 + sequenceSimilarity * 0.4);
    }
    calculateSequenceSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        let maxCommonLength = 0;
        for (let i = 0; i < words1.length; i++) {
            for (let j = 0; j < words2.length; j++) {
                let common = 0;
                let k = 0;
                while (i + k < words1.length && j + k < words2.length &&
                    words1[i + k] === words2[j + k]) {
                    common++;
                    k++;
                }
                if (common > maxCommonLength) {
                    maxCommonLength = common;
                }
            }
        }
        return maxCommonLength / Math.max(words1.length, words2.length);
    }
    extractYearFromTitle(title) {
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            return parseInt(yearMatch[0]);
        }
        return null;
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
    getStats() {
        return {
            service: 'TMDB API - Modo Multi-Query',
            language: this.language,
            strategy: 'Transforma torrent em múltiplas queries e testa cada uma'
        };
    }
}
exports.TMDBService = TMDBService;
