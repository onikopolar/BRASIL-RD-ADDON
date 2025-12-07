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
        this.logger.info('StreamFormatter v1.3.3 - URLs únicas por qualidade');
    }
    createDirectStream(title, name, description, directLink, quality, type, season, episode, behaviorHints, metadata) {
        this.logger.debug('DIRECT', { qualidade: quality, tipo: type, temporada: season, episodio: episode });
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
        const finalDescription = this.format3x3Description(description, metadata, true, type, season, episode);
        return {
            title: finalTitle,
            name: finalName,
            description: finalDescription,
            sources: [directLink],
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-direct-${type || 'movie'}-${quality}`,
                filename: this.sanitizeFilename(finalTitle),
                streamQuality: quality,
                ...behaviorHints
            },
            status: 'ready',
            url: directLink
        };
    }
    createLazyStream(title, name, description, magnet, apiKey, quality, type, season, episode, behaviorHints, metadata) {
        this.logger.debug('LAZY', { qualidade: quality, tipo: type, temporada: season, episodio: episode });
        const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(magnet);
        const sources = magnetHash ? [`dht:${magnetHash}`] : [];
        const resolveUrl = this.generateLazyResolveUrl(magnet, apiKey, quality, type, season, episode);
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
        const finalDescription = this.format3x3Description(description, metadata, false, type, season, episode);
        const stream = {
            title: finalTitle,
            name: finalName,
            description: finalDescription,
            sources: sources,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-lazy-${type || 'movie'}-${quality}`,
                filename: this.sanitizeFilename(finalTitle),
                streamQuality: quality,
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
    format3x3Description(baseDescription, metadata, isDirect = false, type, season, episode) {
        const lines = baseDescription.split('\n');
        const contentTitle = lines[0] || 'Sem título';
        const seedsMatch = baseDescription.match(/(\d+)\s*seeds?/i);
        const sizeMatch = baseDescription.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
        const languageFromDesc = this.extractLanguageFromDescription(baseDescription);
        const formattedLanguage = this.formatLanguage(languageFromDesc);
        const seeds = seedsMatch ? seedsMatch[1] : '0';
        const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : 'N/A';
        let result = contentTitle;
        let topLine = '';
        topLine += `🔗 ${seeds}`;
        topLine += ` | 💾 ${size}`;
        topLine += ` | 🌐 ${formattedLanguage}`;
        if (type === 'series' && season !== undefined && episode !== undefined) {
            const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            topLine += ` | 📺 ${episodeTag}`;
        }
        result += '\n' + topLine;
        let bottomLine = '';
        const metadataItems = [];
        if (metadata) {
            if (metadata.isCompleteSeason) {
                metadataItems.push('📦 Completa');
            }
            if (metadata.isPackage) {
                metadataItems.push('🎬 Pacote');
            }
            if (metadata.hasMultiEpisode) {
                metadataItems.push('👥 Múltiplos');
            }
            if (metadata.source && metadata.source !== 'unknown') {
                metadataItems.push(`🎞️ ${metadata.source}`);
            }
            if (metadata.codec && metadata.codec !== 'unknown') {
                metadataItems.push(`🔧 ${metadata.codec}`);
            }
        }
        if (isDirect) {
            metadataItems.push('🚀 Instantâneo');
        }
        else {
            metadataItems.push('⏳ Processando');
        }
        const limitedItems = metadataItems.slice(0, 3);
        bottomLine = limitedItems.join(' | ');
        if (bottomLine) {
            result += '\n' + bottomLine;
        }
        return result;
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
    createMultipleQualityStreams(torrent, request, directLink, type, season, episode, isAvailableOnRD = false) {
        const allQualities = this.extractAllQualities(torrent.title);
        this.logger.debug('MULTI_QUALITY_STREAMS', {
            torrentTitle: torrent.title.substring(0, 80),
            qualidadesEncontradas: allQualities.length,
            qualidades: allQualities,
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
            const baseDesc = `${baseTitle}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`;
            const streamName = `Brasil RD (${quality})`;
            let streamTitle = streamName;
            if (type === 'series' && season !== undefined && episode !== undefined) {
                streamTitle += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
            }
            if (isAvailableOnRD && directLink) {
                streams.push(this.createDirectStream(streamTitle, streamName, baseDesc, directLink, quality, type, season, episode, {
                    bingeGroup: `br-${request.id}-${quality}`,
                    filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
                }, metadata));
            }
            else {
                streams.push(this.createLazyStream(streamTitle, streamName, baseDesc, torrent.magnet, request.apiKey, quality, type, season, episode, {
                    bingeGroup: `br-${request.id}-${quality}`,
                    filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
                }, metadata));
            }
            this.logger.debug('QUALITY_STREAM_CRIADO', {
                qualidade: quality,
                tipo: type,
                temporada: season,
                episodio: episode,
                temLinkDireto: !!(isAvailableOnRD && directLink),
                versao: '1.3.3'
            });
        }
        this.logger.info('STREAMS_CRIADOS', {
            total: streams.length,
            qualidades: allQualities,
            torrent: torrent.title.substring(0, 60),
            versao: '1.3.3'
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
    createSeriesStream(torrent, request, directLink, season, episode, isAvailableOnRD = false) {
        const qualities = this.extractAllQualities(torrent.title);
        const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`, torrent.magnet, request.apiKey, quality, 'series', season, episode, {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(torrent.title)
        });
    }
    createMovieStream(torrent, request, directLink, isAvailableOnRD = false) {
        const qualities = this.extractAllQualities(torrent.title);
        const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
        return this.createLazyStream(`Brasil RD (${quality})`, `Brasil RD (${quality})`, `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`, torrent.magnet, request.apiKey, quality, 'movie', undefined, undefined, {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(torrent.title)
        });
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
            '2160p': 100,
            '1080p': 80,
            '720p': 60,
            'HD': 40,
            'SD': 20
        };
        return qualityPriority[quality] || 0;
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
    generateLazyResolveUrl(magnet, apiKey, quality, type, season, episode) {
        const encodedMagnet = Buffer.from(magnet).toString('base64');
        const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
        const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
        let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}&quality=${encodeURIComponent(quality)}`;
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
    buildResolveUrl(magnet, apiKey, quality, type, season, episode) {
        return this.generateLazyResolveUrl(magnet, apiKey, quality, type, season, episode);
    }
    getStats() {
        return {
            versão: '1.3.3',
            feature: 'Streams separados por qualidade',
            fix: 'URLs únicas por qualidade (resolve deduplicação)',
            formato: [
                'Linha 1: Título COMPLETO do torrent',
                'Linha 2: 🔗 seeds | 💾 tamanho | 🌐 idioma | 📺 episódio',
                'Linha 3: 📦🎬👥🎞️🔧🚀⏳ (max 3)'
            ],
            ordenação: '2160p(100) > 1080p(80) > 720p(60) > HD(40) > SD(20)',
            melhorias: [
                'Cria stream SEPARADO para cada qualidade encontrada',
                'Detecta padrões como 720p/1080p, 720p e 1080p, 720p ou 1080p',
                'Usuário escolhe qualidade desejada',
                'BehaviorHint streamQuality marca qualidade de cada stream',
                'URL de resolve INCLUI qualidade (evita deduplicação)',
                'Mesma magnet, diferentes URLs por qualidade'
            ]
        };
    }
}
exports.StreamFormatter = StreamFormatter;
