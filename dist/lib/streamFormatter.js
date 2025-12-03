"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamFormatter = void 0;
const magnetHelper_1 = require("../lib/magnetHelper");
const logger_1 = require("../utils/logger");
class StreamFormatter {
    constructor() {
        this.logger = new logger_1.Logger('StreamFormatter');
    }
    createDirectStream(title, name, description, directLink, quality, type, season, episode, behaviorHints) {
        this.logger.debug('Criando stream DIRETO', {
            title,
            quality,
            type,
            season,
            episode,
            directLinkLength: directLink.length
        });
        let finalName = name;
        let finalTitle = title;
        if (type === 'series' && season !== undefined && episode !== undefined) {
            const seasonStr = season.toString().padStart(2, '0');
            const episodeStr = episode.toString().padStart(2, '0');
            const episodeTag = ` S${seasonStr}E${episodeStr}`;
            if (!name.includes('S') && !name.includes('E')) {
                finalName = name + episodeTag;
            }
            if (!title.includes('S') && !title.includes('E')) {
                finalTitle = title + episodeTag;
            }
        }
        return {
            title: finalTitle,
            name: finalName,
            description: description + ' | ✅ INSTANTÂNEO',
            sources: [directLink],
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-direct-${type || 'movie'}-${quality}`,
                filename: this.sanitizeFilename(finalTitle),
                ...behaviorHints
            },
            status: 'ready',
            url: directLink
        };
    }
    createLazyStream(title, name, description, magnet, apiKey, quality, type, season, episode, behaviorHints) {
        this.logger.debug('Criando stream LAZY', {
            title,
            quality,
            type,
            season,
            episode,
            hasApiKey: !!apiKey
        });
        const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(magnet);
        const sources = magnetHash ? [`dht:${magnetHash}`] : [];
        const resolveUrl = this.generateLazyResolveUrl(magnet, apiKey, type, season, episode);
        let finalName = name;
        let finalTitle = title;
        if (type === 'series' && season !== undefined && episode !== undefined) {
            const seasonStr = season.toString().padStart(2, '0');
            const episodeStr = episode.toString().padStart(2, '0');
            const episodeTag = ` S${seasonStr}E${episodeStr}`;
            if (!name.includes('S') && !name.includes('E')) {
                finalName = name + episodeTag;
            }
            if (!title.includes('S') && !title.includes('E')) {
                finalTitle = title + episodeTag;
            }
        }
        let finalDescription = description;
        if (type === 'series') {
            finalDescription += ' | ⏳ Aguardando processamento...';
        }
        return {
            title: finalTitle,
            name: finalName,
            description: finalDescription,
            sources: sources,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-lazy-${type || 'movie'}-${quality}`,
                filename: this.sanitizeFilename(finalTitle),
                ...behaviorHints
            },
            magnet: magnet,
            status: 'pending',
            infoHash: magnetHash || undefined,
            url: resolveUrl
        };
    }
    createSeriesStream(torrent, request, directLink, season, episode, isAvailableOnRD = false) {
        const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
        const quality = this.extractQualityFromFilename(torrent.title);
        if (isAvailableOnRD && directLink) {
            return this.createDirectStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`, directLink, quality, 'series', season, episode, {
                bingeGroup: `br-${request.id}-${season}`,
                filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
            });
        }
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`, torrent.magnet, request.apiKey, quality, 'series', season, episode, {
            bingeGroup: `br-${request.id}-${season}`,
            filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
        });
    }
    sortStreamsByQuality(streams) {
        const qualityPriority = {
            '2160p': 5,
            '1080p': 4,
            '720p': 3,
            'HD': 2,
            'SD': 1
        };
        return streams.sort((a, b) => {
            const isDirectA = this.isDirectStream(a);
            const isDirectB = this.isDirectStream(b);
            if (isDirectA !== isDirectB) {
                return isDirectA ? -1 : 1;
            }
            const scoreA = this.calculateQualityScore(a.name || '');
            const scoreB = this.calculateQualityScore(b.name || '');
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }
            return (a.name || '').localeCompare(b.name || '');
        });
    }
    isDirectStream(stream) {
        return !!(stream.sources &&
            stream.sources.length > 0 &&
            stream.sources[0] &&
            !stream.sources[0].startsWith('dht:') &&
            stream.sources[0].startsWith('http'));
    }
    calculateQualityScore(name) {
        if (!name)
            return 0;
        const quality = this.extractQualityFromStreamName(name);
        const qualityPriority = {
            '2160p': 5,
            '1080p': 4,
            '720p': 3,
            'HD': 2,
            'SD': 1
        };
        return qualityPriority[quality] || 0;
    }
    extractQualityFromStreamName(name) {
        const patterns = [
            { pattern: /\b2160p\b/i, quality: '2160p' },
            { pattern: /\b4k\b/i, quality: '2160p' },
            { pattern: /\b1080p\b/i, quality: '1080p' },
            { pattern: /\b720p\b/i, quality: '720p' },
            { pattern: /\bhd\b/i, quality: 'HD' },
            { pattern: /\bsd\b/i, quality: 'SD' }
        ];
        const cleanName = name.toLowerCase();
        for (const { pattern, quality } of patterns) {
            if (pattern.test(cleanName)) {
                return quality;
            }
        }
        return 'HD';
    }
    extractQualityFromFilename(filename) {
        return this.extractQualityFromStreamName(filename);
    }
    extractCleanMovieTitle(fullTitle) {
        const cleanTitle = fullTitle
            .replace(/(1080p|720p|4K|2160p|HD|WEB-DL|WEBRip|BluRay|H264|H265|x264|x265|AC3|DTS|DUAL|Dublado|Legendado|REMUX|UHD)/gi, '')
            .replace(/[.\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\([^)]*\)/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .trim();
        return cleanTitle || fullTitle;
    }
    formatLanguage(language) {
        if (!language)
            return 'PT-BR';
        const langMap = {
            'pt-BR': 'PT-BR',
            'pt-BR,en': 'Dual audio PT-BR / EN',
            'en': 'EN',
            'dual': 'Dual audio',
            'multi': 'Multi language',
            'pt': 'Português',
            'pt-BR,en-US': 'Dual PT-BR/EN',
            'pt-BR,en-US,ja-JP': 'Multi PT-BR/EN/JP'
        };
        return langMap[language] || language;
    }
    generateLazyResolveUrl(magnet, apiKey, type, season, episode) {
        const encodedMagnet = Buffer.from(magnet).toString('base64');
        const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
        const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
        let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}`;
        if (type === 'series') {
            if (season !== undefined) {
                url += `&season=${season}`;
            }
            if (episode !== undefined) {
                url += `&episode=${episode}`;
            }
            url += `&type=series`;
        }
        else if (type === 'movie') {
            url += `&type=movie`;
        }
        return url;
    }
    sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 255);
    }
    buildResolveUrl(magnet, apiKey, type, season, episode) {
        return this.generateLazyResolveUrl(magnet, apiKey, type, season, episode);
    }
}
exports.StreamFormatter = StreamFormatter;
