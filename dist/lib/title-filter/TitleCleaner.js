"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleCleaner = void 0;
const logger_1 = require("../../utils/logger");
class TitleCleaner {
    constructor() {
        this.cleanTitleCache = new Map();
        this.TITLE_CACHE_TTL = 5 * 60 * 1000;
        this.logger = new logger_1.Logger('TitleCleaner');
        this.logger.info('✅ TitleCleaner inicializado - Versão exata do original');
    }
    cleanupOldCaches() {
        const now = Date.now();
        for (const [key, entry] of this.cleanTitleCache.entries()) {
            if (now - entry.timestamp > this.TITLE_CACHE_TTL) {
                this.cleanTitleCache.delete(key);
            }
        }
    }
    extractCleanTitle(fullTitle) {
        const cacheKey = `clean:${fullTitle}`;
        if (Math.random() < 0.01) {
            this.cleanupOldCaches();
        }
        const cachedEntry = this.cleanTitleCache.get(cacheKey);
        if (cachedEntry) {
            this.logger.debug('📦 Clean title em cache', {
                original: fullTitle.substring(0, 60),
                cleaned: cachedEntry.cleaned.substring(0, 60)
            });
            return cachedEntry.cleaned;
        }
        this.logger.debug('🧹 Extraindo título limpo', { original: fullTitle });
        let cleaned = fullTitle
            .replace(/&#8211;/g, '-')
            .replace(/&#\d+;/g, ' ')
            .replace(/[\[\]{}()]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const technicalTerms = [
            '2160p', '1080p', '720p', '480p', '360p', 'SD', 'HD', 'FHD', 'UHD', '4K', 'HDR',
            'WEB-DL', 'WEBRip', 'WEB-DLRip', 'WEB', 'DL', 'Rip', 'BluRay', 'Blu-ray', 'BRRip', 'BDRip',
            'HDTV', 'PDTV', 'DSR', 'SATRip', 'DVDRip', 'DVD', 'BD', 'BR',
            'x264', 'x265', 'H264', 'H265', 'AVC', 'HEVC', 'XviD', 'DivX',
            'AC3', 'DTS', 'AAC', 'MP3', 'FLAC', 'DD5.1', 'Dolby Digital', 'Dolby',
            'REPACK', 'PROPER', 'READNFO', 'NFO', 'RARBG', 'YTS', 'ETTV', 'EZTV', 'KILLERS', 'GGEZ'
        ];
        technicalTerms.forEach(term => {
            const regex = new RegExp(`\\b${term}\\b`, 'gi');
            cleaned = cleaned.replace(regex, ' ');
        });
        const torrentWords = [
            'torrent', 'download', 'baixar', 'baixe'
        ];
        torrentWords.forEach(word => {
            const regex = new RegExp(`\\b${word}\\b`, 'gi');
            cleaned = cleaned.replace(regex, ' ');
        });
        cleaned = cleaned.replace(/\s*\(\s*\d{4}\s*\)/g, ' ');
        cleaned = cleaned.replace(/\b(\d{1,2})(ª|º|a|o)\b/gi, '$1$2');
        const seasonPatterns = [
            /\d+\s*ª?\s*temporada/gi,
            /season\s*\d+/gi,
            /s\d+/gi,
            /\d+\s*epis[oó]dios?/gi,
            /\d+\s*x\s*\d+/gi,
            /s\d+\s*e\d+/gi
        ];
        const hasSeasonInfo = seasonPatterns.some(pattern => pattern.test(cleaned));
        cleaned = cleaned
            .replace(/[._-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const originalWords = fullTitle.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const cleanedWords = cleaned.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (cleanedWords.length < originalWords.length * 0.3 && cleanedWords.length > 0) {
            this.logger.debug('⚠️ Limpeza muito agressiva, usando fallback', {
                original: fullTitle.substring(0, 80),
                cleaned: cleaned.substring(0, 80),
                originalWords: originalWords.length,
                cleanedWords: cleanedWords.length
            });
            const fallback = fullTitle
                .replace(/&#8211;/g, '-')
                .replace(/&#\d+;/g, ' ')
                .replace(/[\[\]{}()]/g, ' ')
                .replace(/\b(2160p|1080p|720p|480p|SD|HD|4K|WEB-DL|WEBRip|BluRay|x264|x265)\b/gi, ' ')
                .replace(/\b(torrent|download|baixar)\b/gi, ' ')
                .replace(/\s+/g, ' ')
                .trim();
            this.cleanTitleCache.set(cacheKey, {
                cleaned: fallback,
                timestamp: Date.now()
            });
            this.logger.debug('✅ Título limpo extraído (fallback)', {
                original: fullTitle.substring(0, 80),
                cleaned: fallback.substring(0, 80),
                hasSeasonInfo: hasSeasonInfo
            });
            return fallback;
        }
        this.logger.debug('✅ Título limpo extraído', {
            original: fullTitle.substring(0, 80),
            cleaned: cleaned.substring(0, 80),
            hasSeasonInfo: hasSeasonInfo
        });
        this.cleanTitleCache.set(cacheKey, {
            cleaned: cleaned,
            timestamp: Date.now()
        });
        return cleaned;
    }
    normalizeForComparison(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    isNumberedSequence(torrentTitle, imdbTitle) {
        const cleanTitle = this.extractCleanTitle(torrentTitle).toLowerCase();
        const cleanImdb = this.extractCleanTitle(imdbTitle).toLowerCase();
        if (cleanTitle === cleanImdb) {
            return false;
        }
        const imdbWords = cleanImdb.split(' ');
        const titleWords = cleanTitle.split(' ');
        if (titleWords.length > imdbWords.length) {
            let matchesStart = true;
            for (let i = 0; i < imdbWords.length; i++) {
                if (titleWords[i] !== imdbWords[i]) {
                    matchesStart = false;
                    break;
                }
            }
            if (matchesStart) {
                const nextWord = titleWords[imdbWords.length];
                const isSequence = /^\d+$/.test(nextWord);
                if (isSequence) {
                    this.logger.debug('⚠️ Detectada sequência numerada', {
                        title: torrentTitle,
                        imdbTitle: imdbTitle,
                        nextWord: nextWord
                    });
                }
                return isSequence;
            }
        }
        return false;
    }
    cleanForDeduplication(title) {
        const cleanTitle = this.extractCleanTitle(title);
        return cleanTitle
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s+/g, '_');
    }
    clearCache() {
        this.cleanTitleCache.clear();
        this.logger.info('🗑️ Cache do TitleCleaner limpo');
    }
    getCacheStats() {
        return { cacheSize: this.cleanTitleCache.size };
    }
}
exports.TitleCleaner = TitleCleaner;
