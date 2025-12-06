"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StreamFormatter = void 0;
const magnetHelper_1 = require("../lib/magnetHelper");
const qualityDetector_1 = require("../lib/qualityDetector");
const logger_1 = require("../utils/logger");
const MetadataExtractor_1 = require("../lib/title-filter/MetadataExtractor");
class StreamFormatter {
    constructor() {
        this.logger = new logger_1.Logger('StreamFormatter');
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        this.metadataExtractor = new MetadataExtractor_1.MetadataExtractor();
        this.logger.info('StreamFormatter v1.0.6 inicializado');
    }
    createDirectStream(title, name, description, directLink, quality, type, season, episode, behaviorHints, metadata) {
        this.logger.debug('Criando stream DIRETO', {
            title,
            quality,
            type,
            season,
            episode,
            hasMetadata: !!metadata
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
        let finalDescription = description;
        if (metadata) {
            if (metadata.isCompleteSeason) {
                finalDescription += ' | ✅ Temporada Completa';
            }
            if (metadata.hasMultiEpisode) {
                finalDescription += ' | 📺 Múltiplos Episódios';
            }
            if (metadata.language && metadata.language !== 'unknown') {
                finalDescription += ` | 🌐 ${metadata.language}`;
            }
        }
        finalDescription += ' | INSTANTÂNEO';
        return {
            title: finalTitle,
            name: finalName,
            description: finalDescription,
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
    createLazyStream(title, name, description, magnet, apiKey, quality, type, season, episode, behaviorHints, metadata) {
        this.logger.debug('Criando stream LAZY', {
            title,
            quality,
            type,
            season,
            episode,
            hasApiKey: !!apiKey,
            hasMetadata: !!metadata
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
        if (metadata) {
            if (metadata.isCompleteSeason) {
                finalDescription += ' | Temporada Completa';
            }
            if (metadata.isPackage) {
                finalDescription += ' | 📦 Pacote';
            }
            if (metadata.hasMultiEpisode) {
                finalDescription += ' | 📺 Múltiplos Episódios';
            }
            if (metadata.language && metadata.language !== 'unknown') {
                finalDescription += ` | 🌐 ${metadata.language}`;
            }
            if (metadata.source && metadata.source !== 'unknown') {
                finalDescription += ` | 🎞️ ${metadata.source}`;
            }
        }
        if (type === 'series') {
            finalDescription += ' | ⏳ Aguardando processamento...';
        }
        const stream = {
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
        if (metadata?.isPackage && stream.behaviorHints) {
            stream.behaviorHints.packageContent = true;
        }
        return stream;
    }
    createMultipleQualityStreams(torrent, request, directLink, type, season, episode, isAvailableOnRD = false) {
        const episodeTag = type === 'series' && season && episode
            ? `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`
            : '';
        const allQualities = this.extractAllQualities(torrent.title);
        this.logger.debug('Criando múltiplos streams por qualidade', {
            torrentTitle: torrent.title,
            allQualities,
            type,
            episodeTag,
            hasMultipleQualities: allQualities.length > 1
        });
        if (allQualities.length <= 1) {
            const quality = allQualities[0] || this.qualityDetector.extractBestQuality(torrent.title);
            if (type === 'series') {
                return [this.createSeriesStream(torrent, request, directLink, season, episode, isAvailableOnRD)];
            }
            else {
                return [this.createMovieStream(torrent, request, directLink, isAvailableOnRD)];
            }
        }
        const streams = [];
        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        this.logger.debug('Metadados para múltiplas qualidades', {
            title: torrent.title.substring(0, 60),
            quality: metadata.quality,
            isPackage: metadata.isPackage,
            hasMultiEpisode: metadata.hasMultiEpisode
        });
        for (const quality of allQualities) {
            const baseTitle = this.extractCleanMovieTitle(torrent.title);
            const qualitySuffix = ` (${quality})`;
            let description = `${baseTitle}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)}`;
            if (episodeTag) {
                description += ` | ${episodeTag}`;
            }
            if (isAvailableOnRD && directLink) {
                streams.push(this.createDirectStream(`Brasil RD${qualitySuffix}`, `Brasil RD${qualitySuffix}`, description, directLink, quality, type, season, episode, {
                    bingeGroup: `br-${request.id}-${quality}`,
                    filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
                }, metadata));
            }
            else {
                streams.push(this.createLazyStream(`Brasil RD${qualitySuffix}`, `Brasil RD${qualitySuffix}`, description, torrent.magnet, request.apiKey, quality, type, season, episode, {
                    bingeGroup: `br-${request.id}-${quality}`,
                    filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
                }, metadata));
            }
        }
        this.logger.info(`Criados ${streams.length} streams para múltiplas qualidades`, {
            torrentTitle: torrent.title,
            qualities: allQualities,
            type
        });
        return streams;
    }
    extractAllQualities(title) {
        const qualityPatterns = [
            /\b(2160p|4k|uhd)\b/gi,
            /\b(1080p|fullhd|full hd)\b/gi,
            /\b(720p|hd|high definition)\b/gi,
            /\b(480p|sd|standard definition)\b/gi,
            /\b(360p|low)\b/gi
        ];
        const foundQualities = [];
        const titleLower = title.toLowerCase();
        for (const pattern of qualityPatterns) {
            const matches = titleLower.match(pattern);
            if (matches) {
                for (const match of matches) {
                    let normalizedQuality = match;
                    if (match.includes('4k') || match.includes('2160p') || match.includes('uhd')) {
                        normalizedQuality = '2160p';
                    }
                    else if (match.includes('1080p') || match.includes('fullhd') || match.includes('full hd')) {
                        normalizedQuality = '1080p';
                    }
                    else if (match.includes('720p') || match.includes('hd') || match.includes('high definition')) {
                        normalizedQuality = '720p';
                    }
                    else if (match.includes('480p') || match.includes('sd') || match.includes('standard definition')) {
                        normalizedQuality = 'SD';
                    }
                    else if (match.includes('360p') || match.includes('low')) {
                        normalizedQuality = 'SD';
                    }
                    if (!foundQualities.includes(normalizedQuality)) {
                        foundQualities.push(normalizedQuality);
                    }
                }
            }
        }
        if (foundQualities.length === 0) {
            const defaultQuality = this.qualityDetector.extractBestQuality(title);
            if (defaultQuality && defaultQuality !== 'unknown') {
                foundQualities.push(defaultQuality);
            }
        }
        const qualityOrder = ['2160p', '1080p', '720p', 'HD', 'SD'];
        foundQualities.sort((a, b) => {
            const indexA = qualityOrder.indexOf(a);
            const indexB = qualityOrder.indexOf(b);
            return indexA - indexB;
        });
        this.logger.debug('Qualidades extraídas do título', {
            title: title.substring(0, 60),
            foundQualities,
            total: foundQualities.length
        });
        return foundQualities;
    }
    createSeriesStream(torrent, request, directLink, season, episode, isAvailableOnRD = false) {
        const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
        const quality = this.qualityDetector.extractBestQuality(torrent.title);
        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        this.logger.debug('Metadados para série', {
            title: torrent.title.substring(0, 60),
            season: metadata.season,
            isCompleteSeason: metadata.isCompleteSeason,
            isPackage: metadata.isPackage
        });
        if (isAvailableOnRD && directLink) {
            return this.createDirectStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`, directLink, quality, 'series', season, episode, {
                bingeGroup: `br-${request.id}-${season}`,
                filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
            }, metadata);
        }
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`, torrent.magnet, request.apiKey, quality, 'series', season, episode, {
            bingeGroup: `br-${request.id}-${season}`,
            filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
        }, metadata);
    }
    createMovieStream(torrent, request, directLink, isAvailableOnRD = false) {
        const quality = this.qualityDetector.extractBestQuality(torrent.title);
        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        this.logger.debug('Metadados para filme', {
            title: torrent.title.substring(0, 60),
            quality: metadata.quality,
            year: metadata.year,
            mediaType: metadata.mediaType
        });
        if (isAvailableOnRD && directLink) {
            return this.createDirectStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)}`, directLink, quality, 'movie', undefined, undefined, {
                bingeGroup: `br-${request.id}`,
                filename: this.sanitizeFilename(torrent.title)
            }, metadata);
        }
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)}`, torrent.magnet, request.apiKey, quality, 'movie', undefined, undefined, {
            bingeGroup: `br-${request.id}`,
            filename: this.sanitizeFilename(torrent.title)
        }, metadata);
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
        const quality = this.qualityDetector.extractBestQuality(name);
        const qualityPriority = {
            '2160p': 5,
            '1080p': 4,
            '720p': 3,
            'HD': 2,
            'SD': 1
        };
        return qualityPriority[quality] || 0;
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
    getStats() {
        return {
            version: '1.0.6',
            feature: 'Integração completa com MetadataExtractor',
            method: 'Metadados enriquecidos em todos os streams'
        };
    }
}
exports.StreamFormatter = StreamFormatter;
