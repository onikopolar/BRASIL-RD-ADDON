"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CatalogProvider = void 0;
const qualityDetector_1 = require("../lib/qualityDetector");
const streamFormatter_1 = require("../lib/streamFormatter");
const magnetHelper_1 = require("../lib/magnetHelper");
const logger_1 = require("../utils/logger");
const RealDebridService_1 = require("../services/RealDebridService");
class CatalogProvider {
    constructor(magnetService) {
        this.magnetService = magnetService;
        this.logger = new logger_1.Logger('CatalogProvider');
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        this.streamFormatter = new streamFormatter_1.StreamFormatter();
        this.rdService = new RealDebridService_1.RealDebridService();
        this.logger.info('CatalogProvider inicializado com verificação Real-Debrid');
    }
    async getStreamsFromCatalog(request) {
        this.logger.debug('=== CATALOG PROVIDER CHAMADO ===', {
            requestId: request.id,
            type: request.type,
            imdbId: request.imdbId || request.id,
            apiKeyPresent: !!request.apiKey
        });
        const curatedMagnets = this.magnetService.searchMagnets(request);
        this.logger.debug('Resultado da busca no catálogo:', {
            magnetsFound: curatedMagnets.length,
            imdbId: request.imdbId || request.id,
            magnetTitles: curatedMagnets.map(m => m.title.substring(0, 50))
        });
        if (curatedMagnets.length === 0) {
            this.logger.debug('Nenhum magnet encontrado no catálogo para', {
                requestId: request.id,
                type: request.type
            });
            return [];
        }
        const qualityGroups = this.groupMagnetsByQuality(curatedMagnets);
        const bestMagnets = this.selectBestFromEachQualityGroup(qualityGroups);
        const streams = [];
        const streamPromises = bestMagnets.map(async (magnet) => {
            try {
                return await this.processMagnetWithRDCache(magnet, request);
            }
            catch (error) {
                this.logger.error('Erro ao processar magnet com RD cache', {
                    title: magnet.title,
                    error: error instanceof Error ? error.message : 'Unknown error'
                });
                return null;
            }
        });
        const streamResults = await Promise.all(streamPromises);
        for (const stream of streamResults) {
            if (stream) {
                streams.push(stream);
            }
        }
        const sortedStreams = this.streamFormatter.sortStreamsByQuality(streams);
        this.logger.info('Streams gerados do catálogo:', {
            requestId: request.id,
            totalStreams: sortedStreams.length,
            availableDirectLinks: sortedStreams.filter(s => s.sources && s.sources[0] && !s.sources[0].startsWith('dht:')).length,
            magnetLinks: sortedStreams.filter(s => s.sources && s.sources[0] && s.sources[0].startsWith('dht:')).length,
            qualities: sortedStreams.map(s => this.qualityDetector.extractQualityFromStreamName(s.name))
        });
        return sortedStreams;
    }
    async processMagnetWithRDCache(magnet, request) {
        try {
            const magnetHash = (0, magnetHelper_1.extractHashFromMagnet)(magnet.magnet);
            if (!magnetHash) {
                this.logger.warn('Magnet sem hash válido', { title: magnet.title });
                return null;
            }
            const quality = this.qualityDetector.extractQualityFromFilename(magnet.title);
            const cleanTitle = this.extractCleanMovieTitle(magnet.title);
            const season = magnet.season;
            const episode = magnet.episode;
            const isSeries = request.type === 'series';
            let name = `Brasil RD (${quality})`;
            let description = `${cleanTitle}\n${magnet.seeds || 0} seeds | ${magnet.size || 'Tamanho não especificado'} | ${this.formatLanguage(magnet.language)}`;
            if (isSeries && season !== undefined && episode !== undefined) {
                const seasonStr = season.toString().padStart(2, '0');
                const episodeStr = episode.toString().padStart(2, '0');
                name += ` S${seasonStr}E${episodeStr}`;
                description += ` | S${seasonStr}E${episodeStr}`;
            }
            const apiKey = request.apiKey;
            if (apiKey) {
                try {
                    this.logger.debug('Verificando se magnet já está no RD:', {
                        hash: magnetHash,
                        season,
                        episode,
                        isSeries
                    });
                    const existingTorrent = await this.rdService.findExistingTorrent(magnetHash, apiKey);
                    if (existingTorrent) {
                        const torrentInfo = await this.rdService.getTorrentInfo(existingTorrent.id, apiKey);
                        this.logger.debug('Torrent encontrado no RD:', {
                            id: existingTorrent.id,
                            status: torrentInfo.status,
                            progress: torrentInfo.progress
                        });
                        if (torrentInfo.status === 'downloaded' || torrentInfo.status === 'ready') {
                            const streamLink = await this.rdService.getStreamLinkForTorrent(existingTorrent.id, apiKey, season, episode);
                            if (streamLink) {
                                this.logger.info('✅ Conteúdo já disponível no Real-Debrid - Retornando link direto', {
                                    title: cleanTitle,
                                    quality,
                                    season,
                                    episode,
                                    streamLinkLength: streamLink.length
                                });
                                return this.streamFormatter.createDirectStream(name, name, description, streamLink, quality, isSeries ? 'series' : 'movie', season, episode, {
                                    bingeGroup: `brasil-rd-${isSeries ? 'series' : 'movie'}-${quality}`,
                                    filename: this.sanitizeFilename(name)
                                });
                            }
                        }
                        else if (torrentInfo.status === 'downloading' || torrentInfo.status === 'queued') {
                            name += ' ⏳';
                            description += ` | Processando no RD (${torrentInfo.progress || 0}%)...`;
                        }
                    }
                }
                catch (rdError) {
                    this.logger.warn('Erro ao verificar RD, usando método lazy', {
                        error: rdError instanceof Error ? rdError.message : 'Unknown RD error',
                        title: cleanTitle
                    });
                }
            }
            return this.streamFormatter.createLazyStream(name, name, description, magnet.magnet, apiKey || '', quality, isSeries ? 'series' : 'movie', season, episode, {
                bingeGroup: `brasil-rd-${isSeries ? 'series' : 'movie'}-${quality}`,
                filename: this.sanitizeFilename(name)
            });
        }
        catch (error) {
            this.logger.error('Erro ao processar magnet com RD cache', {
                title: magnet.title,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return null;
        }
    }
    groupMagnetsByQuality(magnets) {
        const groups = new Map();
        const allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
        for (const quality of allowedQualities) {
            groups.set(quality, []);
        }
        for (const magnet of magnets) {
            const quality = this.qualityDetector.extractQualityFromFilename(magnet.title);
            if (allowedQualities.has(quality)) {
                groups.get(quality).push(magnet);
            }
            else {
                groups.get('HD').push(magnet);
            }
        }
        return groups;
    }
    selectBestFromEachQualityGroup(qualityGroups) {
        const bestMagnets = [];
        const qualityOrder = ['2160p', '1080p', '720p', 'HD'];
        for (const quality of qualityOrder) {
            const group = qualityGroups.get(quality);
            if (group && group.length > 0) {
                const bestInQuality = group.sort((a, b) => {
                    if (b.seeds !== a.seeds) {
                        return b.seeds - a.seeds;
                    }
                    return b.title.length - a.title.length;
                })[0];
                bestMagnets.push(bestInQuality);
            }
        }
        return bestMagnets;
    }
    extractCleanMovieTitle(fullTitle) {
        return fullTitle
            .replace(/(1080p|720p|4K|2160p|HD|WEB-DL|WEBRip|BluRay|H264|H265|x264|x265|AC3|DTS|DUAL|Dublado|Legendado)/gi, '')
            .replace(/[.\-_]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\([^)]*\)/g, '')
            .replace(/\[[^\]]*\]/g, '')
            .trim() || fullTitle;
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
    sanitizeFilename(filename) {
        return filename
            .replace(/[<>:"/\\|?*]/g, '_')
            .substring(0, 255);
    }
}
exports.CatalogProvider = CatalogProvider;
