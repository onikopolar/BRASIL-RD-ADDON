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
        this.logger.info('StreamFormatter v1.6.0 inicializado - Fix URL streams lazy Torrentio RD');
    }
    formatTorrentioStyleTitle(baseTitle, metadata, isDirect = false, seeds, size, language, tracker) {
        let result = baseTitle;
        let line2 = '';
        if (seeds !== undefined && seeds > 0) {
            line2 += `🔗 ${seeds}`;
        }
        else {
            line2 += `🔗 0`;
        }
        if (size) {
            line2 += ` | 💾 ${size}`;
        }
        const formattedLanguage = this.formatLanguage(language || 'PT-BR');
        line2 += ` | 🌐 ${formattedLanguage}`;
        if (tracker) {
            line2 += ` | ⚙️ ${tracker}`;
        }
        if (line2) {
            result += '\n' + line2;
        }
        let line3 = '';
        const metadataItems = [];
        if (metadata) {
            if (metadata.isCompleteSeason) {
                metadataItems.push('📦');
            }
            if (metadata.isPackage) {
                metadataItems.push('🎬');
            }
            if (metadata.hasMultiEpisode) {
                metadataItems.push('👥');
            }
            if (metadata.source && metadata.source !== 'unknown') {
                metadataItems.push(`🎞️`);
            }
            if (metadata.codec && metadata.codec !== 'unknown') {
                metadataItems.push(`🔧`);
            }
        }
        if (isDirect) {
            metadataItems.push('🚀');
        }
        else {
            metadataItems.push('⏳');
        }
        const limitedItems = metadataItems.slice(0, 3);
        line3 = limitedItems.join(' ');
        if (line3) {
            result += '\n' + line3;
        }
        return result;
    }
    formatLanguage(language) {
        if (!language)
            return 'PT-BR';
        const normalizedLang = language.toLowerCase().trim();
        const langMap = {
            'pt-br': 'PT-BR',
            'pt': 'PT-BR',
            'portuguese': 'PT-BR',
            'brazilian': 'PT-BR',
            'dublado': 'PT-BR',
            'en': 'EN',
            'english': 'EN',
            'eng': 'EN',
            'legendado': 'EN',
            'dual': 'Dual',
            'dual audio': 'Dual',
            'dualaudio': 'Dual',
            'pt-br,en': 'Dual',
            'pt-br,en-us': 'Dual',
            'portuguese,english': 'Dual',
            'dublado,legendado': 'Dual',
            'multi': 'Multi',
            'multilanguage': 'Multi',
            'pt-br,en-us,ja-jp': 'Multi',
            'portuguese,english,japanese': 'Multi',
            'es': 'ES',
            'spanish': 'ES',
            'esp': 'ES',
            'fr': 'FR',
            'french': 'FR'
        };
        if (langMap[normalizedLang]) {
            return langMap[normalizedLang];
        }
        for (const [key, value] of Object.entries(langMap)) {
            if (normalizedLang.includes(key)) {
                return value;
            }
        }
        return language.toUpperCase();
    }
    extractTracker(magnet) {
        if (!magnet)
            return 'Magnet';
        if (magnet.includes('thepiratebay'))
            return 'ThePirateBay';
        if (magnet.includes('1337x'))
            return '1337x';
        if (magnet.includes('rarbg'))
            return 'RARBG';
        if (magnet.includes('torrentgalaxy'))
            return 'TorrentGalaxy';
        if (magnet.includes('magnetdl'))
            return 'MagnetDL';
        return 'Torrent';
    }
    createDirectStream(title, name, description, directLink, quality, type, season, episode, behaviorHints, metadata, fileIdx) {
        this.logger.debug('CRIANDO_STREAM_DIRETO', {
            qualidade: quality,
            tipo: type,
            temporada: season,
            episodio: episode
        });
        let finalTitle = title;
        if (type === 'series' && season !== undefined && episode !== undefined) {
            const seasonStr = season.toString().padStart(2, '0');
            const episodeStr = episode.toString().padStart(2, '0');
            const episodeTag = ` S${seasonStr}E${episodeStr}`;
            if (!title.includes('S') && !title.includes('E')) {
                finalTitle = title + episodeTag;
            }
        }
        const seedsMatch = description.match(/(\d+)\s*seeds?/i);
        const sizeMatch = description.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        const languageFromDesc = this.extractLanguageFromDescription(description);
        const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
        const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
        finalTitle = this.formatTorrentioStyleTitle(finalTitle, metadata, true, seeds, size, languageFromDesc, 'RealDebrid');
        const stream = {
            title: finalTitle,
            infoHash: (0, magnetHelper_1.extractHashFromMagnet)(directLink) || undefined,
            fileIdx: fileIdx !== undefined ? fileIdx : 0,
            url: directLink
        };
        if (behaviorHints) {
            stream.behaviorHints = {
                notWebReady: false,
                bingeGroup: `br-${type || 'movie'}-${quality}`,
                filename: this.sanitizeFilename(finalTitle.split('\n')[0]),
                streamQuality: quality,
                ...behaviorHints
            };
        }
        this.logger.debug('STREAM_DIRETO_CRIADO', {
            titulo: finalTitle.substring(0, 80).replace(/\n/g, '\\n'),
            infoHash: stream.infoHash ? 'sim' : 'nao',
            fileIdx: stream.fileIdx,
            tem_url: !!stream.url,
            formato: 'torrentio_style'
        });
        return stream;
    }
    createLazyStream(title, name, description, magnet, apiKey, quality, type, season, episode, behaviorHints, metadata, fileIdx) {
        this.logger.debug('CRIANDO_STREAM_LAZY', {
            qualidade: quality,
            tipo: type,
            temporada: season,
            episodio: episode
        });
        const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(magnet);
        let finalTitle = title;
        if (type === 'series' && season !== undefined && episode !== undefined) {
            const seasonStr = season.toString().padStart(2, '0');
            const episodeStr = episode.toString().padStart(2, '0');
            const episodeTag = ` S${seasonStr}E${episodeStr}`;
            if (!title.includes('S') && !title.includes('E')) {
                finalTitle = title + episodeTag;
            }
        }
        const seedsMatch = description.match(/(\d+)\s*seeds?/i);
        const sizeMatch = description.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        const languageFromDesc = this.extractLanguageFromDescription(description);
        const tracker = this.extractTracker(magnet);
        const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
        const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
        finalTitle = this.formatTorrentioStyleTitle(finalTitle, metadata, false, seeds, size, languageFromDesc, tracker);
        let resolveUrl = '';
        try {
            const filename = this.sanitizeFilename(finalTitle.split('\n')[0] + '.mkv');
            resolveUrl = (0, magnetHelper_1.generateLazyResolveUrl)(magnet, apiKey, filename, fileIdx || 0, type, season, episode);
            this.logger.debug('URL_LAZY_GERADA', {
                formato: 'torrentio_rd',
                url_preview: resolveUrl.substring(0, 100),
                filename: filename,
                fileIdx: fileIdx || 0
            });
        }
        catch (error) {
            this.logger.error('ERRO_GERAR_URL_LAZY', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
        }
        const stream = {
            title: finalTitle,
            infoHash: magnetHash || undefined,
            fileIdx: fileIdx !== undefined ? fileIdx : 0
        };
        if (resolveUrl) {
            stream.url = resolveUrl;
        }
        if (behaviorHints) {
            stream.behaviorHints = {
                notWebReady: false,
                bingeGroup: `br-${type || 'movie'}-${quality}`,
                filename: this.sanitizeFilename(finalTitle.split('\n')[0]),
                streamQuality: quality,
                ...behaviorHints
            };
        }
        if (metadata?.isPackage && stream.behaviorHints) {
            stream.behaviorHints.packageContent = true;
        }
        this.logger.debug('STREAM_LAZY_CRIADO', {
            titulo: finalTitle.substring(0, 80).replace(/\n/g, '\\n'),
            infoHash: stream.infoHash ? 'sim' : 'nao',
            fileIdx: stream.fileIdx,
            tem_url: !!stream.url,
            formato: 'torrentio_style_com_url'
        });
        return stream;
    }
    extractLanguageFromDescription(description) {
        const languagePatterns = [
            /(PT-BR|Dual|EN|Multi|ES|FR)/i,
            /(portuguese|english|spanish|french)/i,
            /(dublado|legendado|subtitled)/i
        ];
        for (const pattern of languagePatterns) {
            const match = description.match(pattern);
            if (match) {
                return match[1];
            }
        }
        return 'PT-BR';
    }
    createMultipleQualityStreams(torrent, request, directLink, type, season, episode, isAvailableOnRD = false, fileIdx) {
        const allQualities = this.extractAllQualities(torrent.title);
        this.logger.debug('PROCESSANDO_MULTIPLAS_QUALIDADES', {
            titulo_torrent: torrent.title.substring(0, 80),
            qualidades_encontradas: allQualities.length,
            tipo: type,
            temporada: season,
            episodio: episode
        });
        if (allQualities.length === 0) {
            const defaultQuality = this.qualityDetector.extractBestQuality(torrent.title);
            if (defaultQuality && defaultQuality !== 'unknown') {
                allQualities.push(defaultQuality);
            }
            else {
                allQualities.push('HD');
            }
        }
        const streams = [];
        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        const episodeTag = type === 'series' && season && episode
            ? `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`
            : '';
        for (const quality of allQualities) {
            const baseTitle = torrent.title;
            const baseDesc = `${baseTitle}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'PT-BR')}`;
            const streamName = `Brasil RD (${quality})`;
            let streamTitle = streamName;
            if (type === 'series' && season !== undefined && episode !== undefined) {
                streamTitle += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            }
            if (isAvailableOnRD && directLink) {
                streams.push(this.createDirectStream(streamTitle, streamName, baseDesc, directLink, quality, type, season, episode, {
                    bingeGroup: `br-${request.id}-${quality}`,
                    filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
                }, metadata, fileIdx));
            }
            else {
                streams.push(this.createLazyStream(streamTitle, streamName, baseDesc, torrent.magnet, request.apiKey, quality, type, season, episode, {
                    bingeGroup: `br-${request.id}-${quality}`,
                    filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
                }, metadata, fileIdx));
            }
            this.logger.debug('QUALIDADE_STREAM_CRIADA', {
                qualidade: quality,
                tipo: type,
                temporada: season,
                episodio: episode,
                tem_link_direto: !!(isAvailableOnRD && directLink),
                formato: 'torrentio'
            });
        }
        this.logger.info('STREAMS_CRIADOS_COM_SUCESSO', {
            total: streams.length,
            qualidades: allQualities,
            torrent: torrent.title.substring(0, 60),
            streams_com_url: streams.filter(s => s.url).length,
            streams_sem_url: streams.filter(s => !s.url).length,
            versao: '1.6.0',
            formato: 'torrentio_com_url'
        });
        return streams;
    }
    extractAllQualities(title) {
        const qualityPatterns = [
            /\b(2160p|4k|uhd)\b/gi,
            /\b(1080p|fullhd|full hd)\b/gi,
            /\b(720p|hd|high definition)\b/gi,
            /\b(480p|sd|standard definition)\b/gi,
            /\b(360p|low)\b/gi,
            /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi
        ];
        const foundQualities = new Set();
        const titleLower = title.toLowerCase();
        for (const pattern of qualityPatterns.slice(0, 5)) {
            const matches = titleLower.match(pattern);
            if (matches) {
                for (const match of matches) {
                    const normalized = this.normalizeQuality(match);
                    if (normalized) {
                        foundQualities.add(normalized);
                    }
                }
            }
        }
        for (const pattern of qualityPatterns.slice(5)) {
            const matches = titleLower.match(pattern);
            if (matches) {
                for (const match of matches) {
                    const qualityMatches = match.match(/\d{3,4}p/gi);
                    if (qualityMatches) {
                        for (const qualityMatch of qualityMatches) {
                            const normalized = this.normalizeQuality(qualityMatch);
                            if (normalized) {
                                foundQualities.add(normalized);
                            }
                        }
                    }
                }
            }
        }
        const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
        let listMatch;
        while ((listMatch = listPattern.exec(titleLower)) !== null) {
            const normalized = this.normalizeQuality(listMatch[1]);
            if (normalized) {
                foundQualities.add(normalized);
            }
        }
        const result = Array.from(foundQualities);
        if (result.length === 0) {
            const defaultQuality = this.qualityDetector.extractBestQuality(title);
            if (defaultQuality && defaultQuality !== 'unknown') {
                result.push(defaultQuality);
            }
        }
        const qualityOrder = ['2160p', '1080p', '720p', 'HD', 'SD'];
        result.sort((a, b) => {
            const indexA = qualityOrder.indexOf(a);
            const indexB = qualityOrder.indexOf(b);
            return indexA - indexB;
        });
        return result;
    }
    normalizeQuality(quality) {
        const qualityLower = quality.toLowerCase();
        if (qualityLower.includes('4k') || qualityLower.includes('2160p') || qualityLower.includes('uhd')) {
            return '2160p';
        }
        else if (qualityLower.includes('1080p') || qualityLower.includes('fullhd') || qualityLower.includes('full hd')) {
            return '1080p';
        }
        else if (qualityLower.includes('720p') || qualityLower.includes('hd') || qualityLower.includes('high definition')) {
            return '720p';
        }
        else if (qualityLower.includes('480p') || qualityLower.includes('sd') || qualityLower.includes('standard definition')) {
            return 'SD';
        }
        else if (qualityLower.includes('360p') || qualityLower.includes('low')) {
            return 'SD';
        }
        else if (qualityLower.includes('hd')) {
            return 'HD';
        }
        if (qualityLower.match(/\d{3,4}p/)) {
            return qualityLower;
        }
        return '';
    }
    createSeriesStream(torrent, request, directLink, season, episode, isAvailableOnRD = false, fileIdx) {
        const qualities = this.extractAllQualities(torrent.title);
        const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
        const baseDesc = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'PT-BR')}`;
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, baseDesc, torrent.magnet, request.apiKey, quality, 'series', season, episode, {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(torrent.title)
        }, undefined, fileIdx);
    }
    createMovieStream(torrent, request, directLink, isAvailableOnRD = false, fileIdx) {
        const qualities = this.extractAllQualities(torrent.title);
        const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
        const baseDesc = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'PT-BR')}`;
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, baseDesc, torrent.magnet, request.apiKey, quality, 'movie', undefined, undefined, {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(torrent.title)
        }, undefined, fileIdx);
    }
    sortStreamsByQuality(streams) {
        const qualityPriority = {
            '2160p': 100,
            '1080p': 80,
            '720p': 60,
            'HD': 40,
            'SD': 20
        };
        return streams.sort((a, b) => {
            const scoreA = this.calculateQualityScore(a.title || '');
            const scoreB = this.calculateQualityScore(b.title || '');
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }
            return (a.title || '').localeCompare(b.title || '');
        });
    }
    calculateQualityScore(name) {
        if (!name)
            return 0;
        const quality = this.qualityDetector.extractBestQuality(name);
        const qualityPriority = {
            '2160p': 100,
            '1080p': 80,
            '720p': 60,
            'HD': 40,
            'SD': 20
        };
        return qualityPriority[quality] || 0;
    }
    sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 255);
    }
    getStats() {
        return {
            versao: '1.6.0',
            feature: 'Fix URL streams lazy Torrentio RD',
            formato: 'title com \n (3 linhas) como Torrentio',
            linha1: 'Titulo + episodio',
            linha2: '🔗 seeds | 💾 tamanho | 🌐 idioma | ⚙️ tracker',
            linha3: '📦 🎬 👥 🎞️ 🔧 🚀 ⏳ (max 3 emojis)',
            emojis_nossos: '🔗 💾 🌐 📦 🎬 👥 🎞️ 🔧 🚀 ⏳',
            compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100% (igual Torrentio)',
            fix: 'URL em streams lazy para resolver via Real-Debrid'
        };
    }
}
exports.StreamFormatter = StreamFormatter;
