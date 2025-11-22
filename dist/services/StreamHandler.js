import { RealDebridService } from './RealDebridService.js';
import { TorrentScraperService } from './TorrentScraperService.js';
import { AutoMagnetService } from './AutoMagnetService.js';
import { Logger } from '../utils/logger.js';
import { getImdbIdMovieEntries, getImdbIdSeriesEntries } from '../database/repository.js';
export class StreamHandler {
    constructor() {
        this.logger = new Logger('StreamHandler');
        this.rdService = new RealDebridService();
        this.torrentScraper = new TorrentScraperService();
        this.autoMagnetService = new AutoMagnetService();
    }
    async handleStreamRequest(request) {
        this.logger.info('Processing stream request', {
            type: request.type,
            id: request.id
        });
        try {
            let streams = await this.getStreamsFromDatabase(request);
            if (streams.length === 0) {
                this.logger.info('No streams in database, triggering scraping', {
                    requestId: request.id
                });
                await this.triggerScrapingAndSave(request);
                await this.delay(1500);
                streams = await this.getStreamsFromDatabase(request);
            }
            const enhancedStreams = await this.enhanceWithRealDebrid(streams, request.apiKey);
            const finalStreams = this.prepareFinalStreams(enhancedStreams);
            this.logger.info('Streams served successfully', {
                requestId: request.id,
                totalStreams: finalStreams.length,
                source: streams.length > 0 ? 'database' : 'scraping'
            });
            return { streams: finalStreams };
        }
        catch (error) {
            this.logger.error('Stream request failed', {
                requestId: request.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
            return { streams: [] };
        }
    }
    async triggerScrapingAndSave(request) {
        try {
            const imdbId = this.extractImdbId(request.id);
            if (!imdbId) {
                this.logger.warn('Cannot extract IMDB ID for scraping', { requestId: request.id });
                return;
            }
            const imdbScraper = new (await import('./ImdbScraperService.js')).ImdbScraperService();
            const title = await imdbScraper.getTitleFromImdbId(imdbId);
            if (!title) {
                this.logger.warn('Title not found for IMDB scraping', { imdbId });
                return;
            }
            let torrents = [];
            if (request.type === 'movie') {
                torrents = await this.torrentScraper.searchTorrents(title, 'movie');
            }
            else {
                const seriesInfo = this.parseSeriesId(request.id);
                if (seriesInfo) {
                    torrents = await this.torrentScraper.searchTorrents(title, 'series', seriesInfo.season);
                }
                else {
                    torrents = await this.torrentScraper.searchTorrents(title, 'series');
                }
            }
            if (torrents.length === 0) {
                this.logger.debug('No torrents found during scraping', { imdbId, title });
                return;
            }
            let savedCount = 0;
            for (const torrent of torrents.slice(0, 10)) {
                try {
                    const magnetData = {
                        imdbId: imdbId,
                        title: torrent.title,
                        magnet: torrent.magnet,
                        quality: torrent.quality,
                        seeds: torrent.seeders,
                        category: request.type,
                        language: torrent.language,
                        addedAt: new Date().toISOString()
                    };
                    const result = await this.autoMagnetService.processRealDebridOnClick(magnetData, request.apiKey);
                    if (result.success) {
                        savedCount++;
                    }
                }
                catch (error) {
                    this.logger.debug('Failed to save torrent via AutoMagnet', {
                        title: torrent.title,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    });
                }
            }
            this.logger.info('Scraping and save completed', {
                imdbId,
                torrentsFound: torrents.length,
                torrentsSaved: savedCount
            });
        }
        catch (error) {
            this.logger.error('Scraping and save failed', {
                requestId: request.id,
                error: error instanceof Error ? error.message : 'Unknown error'
            });
        }
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    extractImdbId(id) {
        const match = id.match(/^(tt\d+)/);
        return match ? match[1] : null;
    }
    async getStreamsFromDatabase(request) {
        try {
            let fileEntries = [];
            if (request.type === 'movie') {
                fileEntries = await getImdbIdMovieEntries(request.id);
            }
            else {
                const seriesInfo = this.parseSeriesId(request.id);
                if (seriesInfo) {
                    fileEntries = await getImdbIdSeriesEntries(seriesInfo.imdbId, seriesInfo.season, seriesInfo.episode);
                }
            }
            return fileEntries
                .filter(entry => entry.torrent?.infoHash)
                .map(entry => this.createStreamFromDatabase(entry))
                .filter((stream) => stream !== null);
        }
        catch (error) {
            this.logger.debug('No streams found in database', { requestId: request.id });
            return [];
        }
    }
    createStreamFromDatabase(fileEntry) {
        const { torrent } = fileEntry;
        const quality = this.detectQuality(torrent.title);
        return {
            title: this.formatStreamTitle(torrent),
            name: `Brasil RD [${quality}]`,
            description: torrent.title,
            sources: [`dht:${torrent.infoHash}`],
            infoHash: torrent.infoHash,
            fileIdx: fileEntry.fileIndex,
            behaviorHints: {
                bingeGroup: this.createBingeGroup(fileEntry, torrent)
            }
        };
    }
    async enhanceWithRealDebrid(streams, apiKey) {
        const enhancedStreams = [];
        const infoHashes = streams.map(s => s.infoHash).filter(Boolean);
        const rdTorrents = new Map();
        for (const infoHash of infoHashes) {
            try {
                const existing = await this.rdService.findExistingTorrent(infoHash, apiKey);
                rdTorrents.set(infoHash, existing?.status === 'downloaded');
            }
            catch {
                rdTorrents.set(infoHash, false);
            }
        }
        for (const stream of streams) {
            if (stream.infoHash && rdTorrents.get(stream.infoHash)) {
                enhancedStreams.push({
                    ...stream,
                    name: `[RD] ${stream.name}`
                });
            }
            else {
                enhancedStreams.push(stream);
            }
        }
        return enhancedStreams;
    }
    prepareFinalStreams(streams) {
        return streams
            .filter(stream => this.isValidQuality(stream.name))
            .sort((a, b) => this.compareStreams(a, b))
            .slice(0, 15);
    }
    formatStreamTitle(torrent) {
        return `${torrent.title} | Seeds: ${torrent.seeders || 0} | ${this.formatSize(torrent.size)}`;
    }
    createBingeGroup(fileEntry, torrent) {
        if (fileEntry.imdbSeason && fileEntry.imdbEpisode) {
            return `brasilrd-${fileEntry.imdbId}-s${fileEntry.imdbSeason}`;
        }
        return `brasilrd-${torrent.infoHash.substring(0, 8)}`;
    }
    detectQuality(title) {
        const lowerTitle = title.toLowerCase();
        if (lowerTitle.includes('2160p') || lowerTitle.includes('4k'))
            return '2160p';
        if (lowerTitle.includes('1080p'))
            return '1080p';
        if (lowerTitle.includes('720p'))
            return '720p';
        if (lowerTitle.includes('480p'))
            return '480p';
        return 'HD';
    }
    isValidQuality(streamName) {
        const quality = this.extractQuality(streamName);
        const validQualities = ['2160p', '4k', '1080p', '720p', '480p', 'hd'];
        return validQualities.includes(quality);
    }
    extractQuality(name) {
        const match = name.match(/\[([^\]]+)\]/);
        return match ? match[1].toLowerCase() : 'hd';
    }
    compareStreams(a, b) {
        const qualityOrder = {
            '2160p': 6, '4k': 6,
            '1080p': 5,
            '720p': 4,
            '480p': 3,
            'hd': 2
        };
        const aQuality = this.extractQuality(a.name);
        const bQuality = this.extractQuality(b.name);
        const aScore = qualityOrder[aQuality] || 0;
        const bScore = qualityOrder[bQuality] || 0;
        return bScore - aScore;
    }
    parseSeriesId(seriesId) {
        const match = seriesId.match(/^(tt\d+):(\d+):(\d+)$/);
        if (!match)
            return null;
        const season = parseInt(match[2]);
        const episode = parseInt(match[3]);
        return isNaN(season) || isNaN(episode) ? null : {
            imdbId: match[1],
            season,
            episode
        };
    }
    formatSize(bytes) {
        if (!bytes)
            return 'Unknown';
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
    }
}
