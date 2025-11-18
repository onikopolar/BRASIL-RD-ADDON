import { RealDebridService } from './RealDebridService';
import { CuratedMagnetService } from './CuratedMagnetService';
import { CacheService } from './CacheService';
import { TorrentScraperService } from './TorrentScraperService';
import { ImdbScraperService } from './ImdbScraperService';
import { Logger } from '../utils/logger';
import { Stream, StreamRequest, CuratedMagnet, RDFile, RDTorrentInfo } from '../types/index';

interface EpisodeInfo {
  season: number;
  episode: number;
  rawMatch: string;
}

interface RequestEpisodeInfo {
  season: number;
  episode: number;
  isValid: boolean;
}

interface CachedTorrent {
  torrentId: string;
  files: RDFile[];
  torrentInfo: RDTorrentInfo;
  timestamp: number;
  magnetHash: string;
}

interface SeasonCacheEntry {
  torrentId: string;
  files: RDFile[];
  addedAt: number;
  magnetHash: string;
}

interface ScrapedTorrent {
  title: string;
  magnet: string;
  seeders: number;
  leechers: number;
  size: string;
  quality: string;
  provider: string;
  language: string;
  type: 'movie' | 'series';
}

interface StreamProcessingConfig {
  maxConcurrentTorrents: number;
  delayBetweenTorrents: number;
  allowPendingStreams: boolean;
  maxPendingStreams: number;
  cacheTTL: {
    downloaded: number;
    downloading: number;
    error: number;
  };
}

export class StreamHandler {
  private readonly rdService: RealDebridService;
  private readonly magnetService: CuratedMagnetService;
  private readonly cacheService: CacheService;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly logger: Logger;

  private readonly processingConfig: StreamProcessingConfig = {
    maxConcurrentTorrents: 2,
    delayBetweenTorrents: 1000,
    allowPendingStreams: false, // DESATIVADO para mobile
    maxPendingStreams: 8,
    cacheTTL: {
      downloaded: 86400000,
      downloading: 300000,
      error: 120000
    }
  };

  private readonly qualityPriority: Record<string, number> = {
    '4K': 5,
    '2160p': 5,
    '1080p': 4,
    '720p': 3,
    '480p': 2,
    'SD': 1
  };

  private readonly videoExtensions = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
    '.mpg', '.mpeg', '.3gp', '.ts', '.mts', '.m2ts', '.vob'
  ];

  private readonly episodePatterns: RegExp[] = [
    /(\d+)x(\d+)/i,
    /s(\d+)e(\d+)/i,
    /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
    /ep[\s\._-]?(\d+)/i,
    /(\d+)(?:\s*-\s*|\s*)(\d+)/,
    /^(\d+)$/
  ];

  private readonly promotionalKeywords = [
    'promo', '1xbet', 'bet', 'propaganda', 'publicidade', 'advertisement',
    'sample', 'trailer', 'teaser', 'preview', 'torrentdosfilmes'
  ];

  private readonly torrentCache = new Map<string, CachedTorrent>();
  private readonly seasonCache = new Map<string, SeasonCacheEntry>();
  private readonly torrentCacheTTL = 60 * 60 * 1000;
  private readonly downloadTimeout = 30 * 60 * 1000;
  private readonly downloadPollInterval = 5000;

  constructor() {
    this.rdService = new RealDebridService();
    this.magnetService = new CuratedMagnetService();
    this.cacheService = new CacheService();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = new ImdbScraperService();
    this.logger = new Logger('StreamHandler');
    
    this.logger.info('StreamHandler initialized', {
      processingConfig: this.processingConfig
    });
  }

  async handleStreamRequest(request: StreamRequest): Promise<{ streams: Stream[] }> {
    const requestId = request.id;
    const cacheKey = this.generateCacheKey(request);
    
    if (!request.apiKey) {
      this.logger.warn('Stream request sem API key', { requestId });
      return { streams: [] };
    }
    
    try {
      const cachedStreams = this.cacheService.get<Stream[]>(cacheKey);
      if (cachedStreams && cachedStreams.length > 0) {
        const allDownloaded = cachedStreams.every(stream => stream.status === 'downloaded');
        if (allDownloaded) {
          this.logger.debug('Returning cached downloaded streams', { 
            requestId, 
            cacheKey,
            streamCount: cachedStreams.length,
            qualities: cachedStreams.map(s => this.extractQualityFromName(s.name || 'unknown'))
          });
          return { streams: cachedStreams };
        } else {
          this.logger.debug('Invalidating cache with non-downloaded streams', {
            requestId,
            cacheKey,
            statuses: cachedStreams.map(s => s.status)
          });
          this.cacheService.delete(cacheKey);
        }
      }

      let streams = await this.processStreamRequest(request);
      
      // CORREÇÃO MOBILE: Filtrar apenas streams com URL válida
      streams = streams.filter(stream => 
        stream.url && stream.url.trim() !== '' && stream.url.startsWith('http')
      );
      
      // CORREÇÃO MOBILE: Remover notWebReady de todos os streams
      streams.forEach(stream => {
        if (stream.behaviorHints) {
          stream.behaviorHints.notWebReady = false;
        }
      });
      
      if (streams.length > 0) {
        const cacheTTL = this.calculateDynamicCacheTTL(streams);
        this.cacheService.set(cacheKey, streams, cacheTTL);
        this.logger.info('Cached new mobile-compatible streams', { 
          requestId, 
          cacheKey, 
          streamCount: streams.length,
          cacheTTL: `${cacheTTL / 60000}min`,
          qualities: streams.map(s => this.extractQualityFromName(s.name || 'unknown')),
          statuses: streams.map(s => s.status)
        });
      }

      return { streams };

    } catch (error) {
      this.logger.error('Stream request processing failed', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { streams: [] };
    }
  }

  private calculateDynamicCacheTTL(streams: Stream[]): number {
    if (streams.length === 0) {
      return this.processingConfig.cacheTTL.error;
    }

    if (streams.every(stream => stream.status === 'downloaded')) {
      return this.processingConfig.cacheTTL.downloaded;
    }

    if (streams.some(stream => stream.status === 'downloading')) {
      return this.processingConfig.cacheTTL.downloading;
    }

    return this.processingConfig.cacheTTL.error;
  }

  private async processStreamRequest(request: StreamRequest): Promise<Stream[]> {
    if (request.type === 'series') {
      return await this.processSeriesRequest(request);
    } else {
      return await this.processMovieRequest(request);
    }
  }

  private async processSeriesRequest(request: StreamRequest): Promise<Stream[]> {
    const curatedMagnets = this.magnetService.searchMagnets(request);
    
    if (curatedMagnets.length > 0) {
      this.logger.debug('Processing curated magnets for series', { 
        requestId: request.id, 
        magnetCount: curatedMagnets.length 
      });
      return await this.processCuratedMagnets(curatedMagnets, request);
    }
    
    return await this.processSeriesScraping(request);
  }

  private async processMovieRequest(request: StreamRequest): Promise<Stream[]> {
    const curatedMagnets = this.magnetService.searchMagnets(request);
    
    if (curatedMagnets.length > 0) {
      this.logger.debug('Processing curated magnets for movie', { 
        requestId: request.id, 
        magnetCount: curatedMagnets.length 
      });
      return await this.processCuratedMagnets(curatedMagnets, request);
    }
    
    return await this.processMovieScraping(request);
  }

  private async processSeriesScraping(request: StreamRequest): Promise<Stream[]> {
    const requestEpisode = this.extractEpisodeFromRequest(request.id);
    const season = requestEpisode.isValid ? requestEpisode.season : undefined;
    
    try {
      const title = await this.fetchTitleFromImdb(request);
      if (!title) {
        this.logger.debug('No title found from IMDB for series scraping', { requestId: request.id });
        return [];
      }

      const imdbId = this.extractImdbIdFromRequest(request);
      if (!imdbId) {
        this.logger.debug('No IMDB ID found, falling back to regular scraping', { requestId: request.id });
        return await this.fallbackToRegularScraping(title, request);
      }

      if (requestEpisode.isValid) {
        this.logger.debug('Processing specific episode from season', { 
          requestId: request.id,
          season: requestEpisode.season,
          episode: requestEpisode.episode
        });
        
        const seasonStream = await this.processEpisodeFromSeason(
          imdbId, 
          requestEpisode.season, 
          requestEpisode.episode, 
          title, 
          request.id,
          request.apiKey!
        );
        
        if (seasonStream) {
          return [seasonStream];
        }
      }

      this.logger.debug('Falling back to regular scraping for series', { requestId: request.id });
      return await this.fallbackToRegularScraping(title, request);

    } catch (error) {
      this.logger.error('Series scraping processing error', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  private async processMovieScraping(request: StreamRequest): Promise<Stream[]> {
    try {
      const title = await this.fetchTitleFromImdb(request);
      if (!title) {
        this.logger.debug('No title found from IMDB for movie scraping', { requestId: request.id });
        return [];
      }

      return await this.fallbackToRegularScraping(title, request);

    } catch (error) {
      this.logger.error('Movie scraping processing error', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }

  private async fallbackToRegularScraping(title: string, request: StreamRequest): Promise<Stream[]> {
    const type = request.type === "series" ? "series" : "movie";
    const requestEpisode = this.extractEpisodeFromRequest(request.id);
    
    let searchQuery = title;
    if (type === 'series' && requestEpisode.isValid) {
      searchQuery = `${title} Temporada ${requestEpisode.season}`;
    }
    
    this.logger.debug('Performing regular scraping', {
      requestId: request.id,
      searchQuery,
      type,
      season: requestEpisode.isValid ? requestEpisode.season : 'N/A'
    });

    const torrentResults = await this.torrentScraper.searchTorrents(
      searchQuery, 
      type,
      requestEpisode.isValid ? requestEpisode.season : undefined
    );

    if (torrentResults.length === 0) {
      this.logger.debug('No torrent results found from scraping', { requestId: request.id });
      return [];
    }

    const filteredResults = torrentResults.filter(torrent => {
      if (type === 'series' && requestEpisode.isValid) {
        const torrentSeason = this.extractSeasonFromTitle(torrent.title);
        const matchesSeason = torrentSeason === requestEpisode.season;
        
        if (!matchesSeason) {
          this.logger.debug('Filtered torrent due to season mismatch', {
            torrentTitle: torrent.title,
            expectedSeason: requestEpisode.season,
            foundSeason: torrentSeason
          });
        }
        
        return matchesSeason;
      }
      return true;
    });

    const resultsToProcess = filteredResults.length > 0 ? filteredResults : torrentResults;
    
    this.logger.info('Processing scraped torrents with rate limiting', {
      requestId: request.id,
      totalResults: torrentResults.length,
      filteredResults: filteredResults.length,
      processingCount: resultsToProcess.length,
      qualities: resultsToProcess.map(t => t.quality),
      maxConcurrent: this.processingConfig.maxConcurrentTorrents
    });

    const streams = await this.processTorrentsWithRateLimit(resultsToProcess, request);
    
    this.logger.info('Completed torrent processing', {
      requestId: request.id,
      totalStreams: streams.length,
      qualities: streams.map(s => this.extractQualityFromName(s.name || 'unknown')),
      statuses: streams.map(s => s.status)
    });

    return this.sortStreamsByQuality(streams);
  }

  private async processTorrentsWithRateLimit(
    torrents: ScrapedTorrent[], 
    request: StreamRequest
  ): Promise<Stream[]> {
    const allStreams: Stream[] = [];
    
    for (let i = 0; i < torrents.length; i += this.processingConfig.maxConcurrentTorrents) {
      const batch = torrents.slice(i, i + this.processingConfig.maxConcurrentTorrents);
      
      this.logger.debug('Processing torrent batch', {
        requestId: request.id,
        batchIndex: Math.floor(i / this.processingConfig.maxConcurrentTorrents) + 1,
        totalBatches: Math.ceil(torrents.length / this.processingConfig.maxConcurrentTorrents),
        batchSize: batch.length,
        torrentsInBatch: batch.map(t => ({ title: t.title, quality: t.quality }))
      });

      const batchPromises = batch.map(async (torrent) => {
        try {
          const streamResult = await this.processScrapedTorrent(torrent, request);
          if (streamResult) {
            this.logger.debug('Successfully processed torrent in batch', {
              requestId: request.id,
              torrentTitle: torrent.title,
              streamCount: Array.isArray(streamResult) ? streamResult.length : 1
            });
            return streamResult;
          }
        } catch (error) {
          this.logger.error('Torrent processing failed in batch', {
            requestId: request.id,
            title: torrent.title,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        return null;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result) => {
        if (result.status === 'fulfilled' && result.value !== null) {
          const streams = Array.isArray(result.value) ? result.value : [result.value];
          allStreams.push(...streams);
        }
      });

      if (i + this.processingConfig.maxConcurrentTorrents < torrents.length) {
        await this.delay(this.processingConfig.delayBetweenTorrents);
      }
    }

    return allStreams;
  }

  private extractSeasonFromTitle(title: string): number | null {
    const patterns = [
      /temporada\s*(\d+)/i,
      /(\d+)\s*temporada/i,
      /season\s*(\d+)/i,
      /s(\d+)/i,
      /(\d+)\s*ª?\s*temp/i
    ];

    for (const pattern of patterns) {
      const match = title.match(pattern);
      if (match) {
        const season = parseInt(match[1]);
        if (!isNaN(season) && season > 0) {
          return season;
        }
      }
    }

    return null;
  }

  private extractImdbIdFromRequest(request: StreamRequest): string | null {
    if (request.imdbId) {
      return request.imdbId;
    }

    const imdbMatch = request.id.match(/^(tt\d+)/);
    return imdbMatch ? imdbMatch[1] : null;
  }

  private getSeasonCacheKey(imdbId: string, season: number): string {
    return `season:${imdbId}:${season}`;
  }

  private async getOrAddSeasonTorrent(imdbId: string, season: number, title: string, apiKey: string): Promise<{ torrentId: string; files: RDFile[] } | null> {
    const cacheKey = this.getSeasonCacheKey(imdbId, season);
    const cached = this.seasonCache.get(cacheKey);
    
    if (cached && (Date.now() - cached.addedAt) < this.torrentCacheTTL) {
      this.logger.debug('Returning cached season torrent', { imdbId, season, cacheKey });
      return { torrentId: cached.torrentId, files: cached.files };
    }

    this.logger.debug('Fetching new season torrent', { imdbId, season, title });

    const searchQuery = `${title} Temporada ${season}`;
    const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', season);
    
    if (torrentResults.length === 0) {
      this.logger.debug('No torrent results found for season', { imdbId, season, searchQuery });
      return null;
    }

    const bestTorrent = torrentResults[0];
    const magnetHash = this.extractHashFromMagnet(bestTorrent.magnet);
    
    if (!magnetHash) {
      this.logger.debug('Invalid magnet hash for season torrent', { imdbId, season });
      return null;
    }

    const processResult = await this.rdService.processTorrent(bestTorrent.magnet, apiKey);
      
    if (!processResult.added || !processResult.torrentId) {
      this.logger.debug('Failed to process season torrent', { imdbId, season });
      return null;
    }

    const torrentId = processResult.torrentId;
    const torrentInfo = await this.rdService.getTorrentInfo(torrentId, apiKey);

    if (processResult.ready) {
      const videoFiles = this.filterAndSortVideoFiles(torrentInfo.files || []);
      if (videoFiles.length === 0) {
        this.logger.debug('No video files found in season torrent', { imdbId, season, torrentId });
        return null;
      }

      const seasonData: SeasonCacheEntry = {
        torrentId,
        files: videoFiles,
        addedAt: Date.now(),
        magnetHash
      };
      
      this.seasonCache.set(cacheKey, seasonData);
      this.logger.debug('Cached season torrent data', { imdbId, season, cacheKey, fileCount: videoFiles.length });

      return { torrentId, files: seasonData.files };
    }

    this.logger.debug('Season torrent not ready for streaming', { 
      imdbId, 
      season, 
      torrentId, 
      status: processResult.status 
    });
    return null;
  }

  private async processEpisodeFromSeason(
    imdbId: string, 
    season: number, 
    episode: number, 
    title: string,
    requestId: string,
    apiKey: string
  ): Promise<Stream | null> {
    
    const seasonData = await this.getOrAddSeasonTorrent(imdbId, season, title, apiKey);
    if (!seasonData) {
      return null;
    }

    const { torrentId, files } = seasonData;
    const videoFiles = this.filterAndSortVideoFiles(files);
    
    const targetFile = this.findEpisodeFile(videoFiles, season, episode);
    if (!targetFile) {
      this.logger.debug('Target episode file not found in season', { 
        requestId, 
        season, 
        episode, 
        availableFiles: videoFiles.map(f => f.path) 
      });
      return null;
    }

    try {
      const streamLink = await this.rdService.getStreamLinkForFile(torrentId, targetFile.id, apiKey);
      if (!streamLink) {
        this.logger.debug('No stream link available for episode file', { requestId, torrentId, fileId: targetFile.id });
        return null;
      }

      const stream: Stream = {
        title: `${title} S${season}E${episode}`,
        url: streamLink,
        name: `Brasil RD - S${season}E${episode}`,
        description: `Conteudo via temporada completa - S${season}E${episode}`,
        behaviorHints: {
          notWebReady: false, // CORREÇÃO MOBILE
          bingeGroup: `br-season-${imdbId}-${season}`,
          filename: this.sanitizeFilename(`${title} S${season}E${episode}`)
        },
        torrentId: torrentId,
        status: 'downloaded'
      };

      this.logger.debug('Successfully created stream from season episode', { 
        requestId, 
        season, 
        episode,
        torrentId 
      });

      return stream;

    } catch (error) {
      this.logger.error('Season episode processing error', {
        requestId,
        imdbId,
        season,
        episode,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private async processCuratedMagnets(magnets: CuratedMagnet[], request: StreamRequest): Promise<Stream[]> {
    const streams: Stream[] = [];

    for (const magnet of magnets) {
      const stream = await this.processMagnetSafely(magnet, request);
      if (stream) {
        streams.push(stream);
        this.logger.debug('Successfully processed curated magnet', { 
          requestId: request.id, 
          magnetTitle: magnet.title 
        });
        break;
      }
    }

    return this.sortStreamsByQuality(streams);
  }

  private async processScrapedTorrent(torrent: ScrapedTorrent, request: StreamRequest): Promise<Stream | Stream[] | null> {
    const requestId = request.id;

    try {
      const processResult = await this.rdService.processTorrent(torrent.magnet, request.apiKey!);
      
      if (!processResult.added || !processResult.torrentId) {
        this.logger.debug('Failed to process scraped torrent', { requestId, title: torrent.title });
        return null;
      }

      const torrentId = processResult.torrentId;
      const torrentInfo = await this.rdService.getTorrentInfo(torrentId, request.apiKey!);

      const videoFiles = this.filterAndSortVideoFiles(torrentInfo.files || []);
      if (videoFiles.length === 0) {
        this.logger.debug('No video files in scraped torrent', { requestId, torrentId });
        return null;
      }

      const cleanVideoFiles = this.filterPromotionalFiles(videoFiles);
      if (cleanVideoFiles.length === 0) {
        this.logger.warn('No valid video files found after promotional filter', {
          requestId,
          originalFiles: videoFiles.length
        });
        return null;
      }

      if (request.type === 'series') {
        return await this.processSeriesTorrent(torrent, request, torrentId, cleanVideoFiles, torrentInfo);
      } else {
        return await this.processMovieTorrent(torrent, request, torrentId, cleanVideoFiles, torrentInfo);
      }

    } catch (error) {
      this.logger.error('Scraped torrent processing failed', {
        requestId,
        title: torrent.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private async processSeriesTorrent(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    torrentId: string,
    cleanVideoFiles: RDFile[],
    torrentInfo: RDTorrentInfo
  ): Promise<Stream[] | null> {
    const requestEpisode = this.extractEpisodeFromRequest(request.id);
    const streams: Stream[] = [];

    if (requestEpisode.isValid) {
      const episodeFiles = this.findEpisodeFilesByQuality(cleanVideoFiles, requestEpisode.season, requestEpisode.episode);
      const validStreams: Stream[] = [];
      const processedFiles: Set<number> = new Set();
      
      if (episodeFiles.length === 0) {
        this.logger.debug('No files found for specific episode', {
          requestId: request.id,
          season: requestEpisode.season,
          episode: requestEpisode.episode,
          availableFiles: cleanVideoFiles.map(f => f.path)
        });
        return null;
      }

      this.logger.info('Found multiple episode files', {
        requestId: request.id,
        season: requestEpisode.season,
        episode: requestEpisode.episode,
        totalFiles: episodeFiles.length,
        files: episodeFiles.map(f => ({
          path: f.path,
          quality: this.extractQualityFromFilename(f.path),
          size: f.bytes
        }))
      });

      for (const file of episodeFiles) {
        if (processedFiles.has(file.id)) {
          continue;
        }
        processedFiles.add(file.id);

        try {
          const streamLink = await this.rdService.getStreamLinkForFile(torrentId, file.id, request.apiKey!);
          const quality = this.extractQualityFromFilename(file.path);
          
          if (streamLink) {
            const stream = this.createSeriesStream(
              torrent, 
              request, 
              torrentId, 
              streamLink, 
              file.path, 
              requestEpisode.season, 
              requestEpisode.episode,
              quality,
              'downloaded'
            );
            
            validStreams.push(stream);
            
            this.logger.debug('Created mobile-compatible stream for episode file', {
              requestId: request.id,
              fileId: file.id,
              quality,
              hasUrl: !!stream.url
            });
          }
          
        } catch (error) {
          this.logger.debug('Failed to process episode file', {
            requestId: request.id,
            fileId: file.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      this.logger.info('Created mobile-compatible streams for series episode', {
        requestId: request.id,
        season: requestEpisode.season,
        episode: requestEpisode.episode,
        streamCount: validStreams.length,
        qualities: validStreams.map(s => this.extractQualityFromName(s.name || 'unknown'))
      });

      return validStreams.length > 0 ? validStreams : null;

    } else {
      const mainFile = this.identifyMainFile(cleanVideoFiles);
      if (!mainFile) {
        this.logger.debug('No main file found for series torrent', { 
          requestId: request.id, 
          availableFiles: cleanVideoFiles.map(f => f.path) 
        });
        return null;
      }

      try {
        const streamLink = await this.rdService.getStreamLinkForFile(torrentId, mainFile.id, request.apiKey!);
        if (streamLink) {
          const stream = this.createSeriesStream(
            torrent, request, torrentId, streamLink, mainFile.path, 1, 1, torrent.quality, 'downloaded'
          );
          streams.push(stream);
        }
      } catch (error) {
        this.logger.debug('Failed to get stream link for main file', {
          requestId: request.id,
          fileId: mainFile.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
      }
    }

    return streams.length > 0 ? streams : null;
  }

  private async processMovieTorrent(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    torrentId: string,
    cleanVideoFiles: RDFile[],
    torrentInfo: RDTorrentInfo
  ): Promise<Stream | null> {
    const mainFile = this.identifyMainFile(cleanVideoFiles);
    if (!mainFile) {
      return null;
    }

    try {
      const streamLink = await this.rdService.getStreamLinkForFile(torrentId, mainFile.id, request.apiKey!);
      
      if (streamLink) {
        const stream: Stream = {
          title: `${torrent.title} [${torrent.provider}]`,
          url: streamLink,
          name: `Brasil RD - ${torrent.quality}`,
          description: `Conteudo via scraping - ${torrent.language}`,
          behaviorHints: {
            notWebReady: false, // CORREÇÃO MOBILE
            bingeGroup: `br-scraped-${request.id}`,
            filename: this.sanitizeFilename(torrent.title)
          },
          torrentId: torrentId,
          status: 'downloaded'
        };
        return stream;
      }
      
      return null;

    } catch (error) {
      this.logger.debug('Failed to get stream link for movie file', {
        requestId: request.id,
        fileId: mainFile.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private createSeriesStream(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    torrentId: string,
    streamLink: string,
    filePath: string,
    season: number,
    episode: number,
    quality: string,
    status: string
  ): Stream {
    const detectedQuality = quality !== 'unknown' ? quality : torrent.quality;
    const episodeTag = `S${season}E${episode}`;

    return {
      title: `${torrent.title} [${torrent.provider}] ${episodeTag}`,
      url: streamLink,
      name: `Brasil RD - ${detectedQuality} - ${episodeTag}`,
      description: `Conteudo via scraping - ${torrent.language} - ${episodeTag}`,
      behaviorHints: {
        notWebReady: false, // CORREÇÃO MOBILE
        bingeGroup: `br-scraped-${request.id}-${season}`,
        filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
      },
      torrentId: torrentId,
      status: status
    };
  }

  private findEpisodeFilesByQuality(files: RDFile[], targetSeason: number, targetEpisode: number): RDFile[] {
    const episodeFiles: RDFile[] = [];
    
    for (const file of files) {
      const episodeInfo = this.extractEpisodeInfo(file.path);
      if (episodeInfo.season === targetSeason && episodeInfo.episode === targetEpisode) {
        episodeFiles.push(file);
      }
    }

    return episodeFiles.sort((a, b) => {
      const qualityA = this.extractQualityFromFilename(a.path);
      const qualityB = this.extractQualityFromFilename(b.path);
      const qualityScoreA = this.qualityPriority[qualityA] || 0;
      const qualityScoreB = this.qualityPriority[qualityB] || 0;
      
      return qualityScoreB - qualityScoreA;
    });
  }

  private extractQualityFromFilename(filename: string): string {
    const qualityPatterns = [
      /2160p|4k/i,
      /1080p/i,
      /720p/i,
      /480p/i
    ];
    
    for (const pattern of qualityPatterns) {
      if (pattern.test(filename)) {
        return pattern.source.includes('2160') ? '2160p' :
               pattern.source.includes('1080') ? '1080p' :
               pattern.source.includes('720') ? '720p' : '480p';
      }
    }
    
    return 'unknown';
  }

  private extractQualityFromName(name: string | undefined): string {
    const nameLower = (name || '').toLowerCase();
    
    const qualityPatterns = [
      /2160p|4k/i,
      /1080p/i, 
      /720p/i,
      /480p/i
    ];
    
    for (const pattern of qualityPatterns) {
      if (pattern.test(nameLower)) {
        return pattern.source.includes('2160') ? '2160p' :
               pattern.source.includes('1080') ? '1080p' :
               pattern.source.includes('720') ? '720p' : '480p';
      }
    }
    
    return 'unknown';
  }

  private async fetchTitleFromImdb(request: StreamRequest): Promise<string | null> {
    const imdbId = this.extractImdbIdFromRequest(request);
    
    if (!imdbId) {
      return null;
    }

    try {
      const title = await this.imdbScraper.getTitleFromImdbId(imdbId);
      if (title) {
        this.logger.debug('Retrieved title from IMDB', { imdbId, title });
        return title;
      }
    } catch (error) {
      this.logger.error('IMDB title fetch error', {
        imdbId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return null;
  }

  private sortFilesByEpisode(files: RDFile[]): RDFile[] {
    const filesWithEpisodeInfo = files.map(file => ({
      file,
      episodeInfo: this.extractEpisodeInfo(file.path)
    }));

    return filesWithEpisodeInfo
      .sort((a, b) => this.compareEpisodeInfo(a.episodeInfo, b.episodeInfo))
      .map(item => item.file);
  }

  private extractEpisodeInfo(filename: string): EpisodeInfo {
    for (const pattern of this.episodePatterns) {
      const match = filename.match(pattern);
      if (match) {
        let season = 1;
        let episode = 0;

        if (pattern.source.includes('x') || pattern.source.includes('s\\d+e')) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          episode = parseInt(match[1]);
        } else if (pattern.source === '^(\\d+)$') {
          episode = parseInt(match[1]);
        } else if (match.length >= 3) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }

        if (!isNaN(season) && !isNaN(episode) && season > 0 && episode > 0) {
          return {
            season,
            episode,
            rawMatch: match[0]
          };
        }
      }
    }

    const fallbackMatch = filename.match(/\d+/);
    const fallbackNumber = fallbackMatch ? parseInt(fallbackMatch[0]) : 0;
    
    return {
      season: 1,
      episode: fallbackNumber,
      rawMatch: fallbackMatch ? fallbackMatch[0] : 'unknown'
    };
  }

  private compareEpisodeInfo(a: EpisodeInfo, b: EpisodeInfo): number {
    if (a.season !== b.season) {
      return a.season - b.season;
    }
    
    if (a.episode !== b.episode) {
      return a.episode - b.episode;
    }
    
    return 0;
  }

  private filterPromotionalFiles(files: RDFile[]): RDFile[] {
    return files.filter(file => {
      const filename = file.path.toLowerCase();
      const isPromotional = this.promotionalKeywords.some(keyword => filename.includes(keyword));
      
      if (isPromotional) {
        this.logger.debug('Filtered promotional file', {
          filename: file.path,
          keywords: this.promotionalKeywords.filter(keyword => filename.includes(keyword))
        });
      }
      
      return !isPromotional;
    });
  }

  private identifyMainFile(files: RDFile[]): RDFile | null {
    const filteredFiles = this.filterPromotionalFiles(files);

    if (filteredFiles.length === 0) {
      return null;
    }

    const sortedFiles = filteredFiles.sort((a, b) => b.bytes - a.bytes);
    return sortedFiles[0];
  }

  private async processMagnetSafely(magnet: CuratedMagnet, request: StreamRequest): Promise<Stream | null> {
    try {
      return await this.processMagnet(magnet, request);
    } catch (error) {
      this.logger.error('Magnet processing error', {
        requestId: request.id,
        magnetTitle: magnet.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private async processMagnet(magnet: CuratedMagnet, request: StreamRequest): Promise<Stream | null> {
    const magnetHash = this.extractHashFromMagnet(magnet.magnet);
    if (!magnetHash) {
      this.logger.debug('Invalid magnet hash', { requestId: request.id, magnetTitle: magnet.title });
      return null;
    }

    const processResult = await this.rdService.processTorrent(magnet.magnet, request.apiKey!);
    
    if (!processResult.added || !processResult.torrentId) {
      this.logger.debug('Failed to process curated magnet', { requestId: request.id, magnetTitle: magnet.title });
      return null;
    }

    const torrentId = processResult.torrentId;
    const torrentInfo = await this.rdService.getTorrentInfo(torrentId, request.apiKey!);
    const videoFiles = this.filterAndSortVideoFiles(torrentInfo.files || []);
    
    if (videoFiles.length === 0) {
      this.logger.debug('No video files in curated magnet', { requestId: request.id, magnetTitle: magnet.title });
      return null;
    }

    const requestEpisode = this.extractEpisodeFromRequest(request.id);
    
    if (requestEpisode.isValid) {
      return await this.processSpecificEpisode(magnet, request, torrentId, videoFiles, requestEpisode, torrentInfo);
    } else {
      return await this.processAllEpisodes(magnet, request, torrentId, videoFiles, torrentInfo);
    }
  }

  private async processSpecificEpisode(
    magnet: CuratedMagnet, 
    request: StreamRequest, 
    torrentId: string, 
    videoFiles: RDFile[],
    requestEpisode: RequestEpisodeInfo,
    torrentInfo: RDTorrentInfo
  ): Promise<Stream | null> {

    const targetFile = this.findEpisodeFile(videoFiles, requestEpisode.season, requestEpisode.episode);
    
    if (!targetFile) {
      this.logger.debug('Target episode file not found in curated magnet', { 
        requestId: request.id, 
        season: requestEpisode.season,
        episode: requestEpisode.episode,
        availableFiles: videoFiles.map(f => f.path)
      });
      return null;
    }

    try {
      const streamLink = await this.rdService.getStreamLinkForFile(torrentId, targetFile.id, request.apiKey!);
      
      if (!streamLink) {
        this.logger.debug('No stream link for target episode file', { 
          requestId: request.id, 
          torrentId, 
          fileId: targetFile.id 
        });
        return null;
      }

      const streamTitle = this.generateEpisodeStreamTitle(magnet, requestEpisode.season, requestEpisode.episode);
      const streamName = `Brasil RD - ${magnet.quality} - S${requestEpisode.season}E${requestEpisode.episode}`;
      
      const stream: Stream = {
        title: streamTitle,
        url: streamLink,
        name: streamName,
        description: `Conteudo curado - ${magnet.language} - Episodio ${requestEpisode.episode}`,
        behaviorHints: {
          notWebReady: false, // CORREÇÃO MOBILE
          bingeGroup: `br-${request.id}`,
          filename: this.sanitizeFilename(`${magnet.title} S${requestEpisode.season}E${requestEpisode.episode}`)
        },
        torrentId: torrentId,
        status: 'downloaded'
      };

      this.logger.debug('Successfully created stream from curated magnet for specific episode', {
        requestId: request.id,
        season: requestEpisode.season,
        episode: requestEpisode.episode,
        torrentId,
        status: stream.status
      });

      return stream;

    } catch (error) {
      this.logger.error('Specific episode processing failed', {
        requestId: request.id,
        magnetTitle: magnet.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private async processAllEpisodes(
    magnet: CuratedMagnet, 
    request: StreamRequest, 
    torrentId: string, 
    videoFiles: RDFile[],
    torrentInfo: RDTorrentInfo
  ): Promise<Stream | null> {

    try {
      const mainFile = this.identifyMainFile(videoFiles);
      if (!mainFile) {
        this.logger.debug('No main file found in curated magnet', { requestId: request.id, magnetTitle: magnet.title });
        return null;
      }

      const streamLink = await this.rdService.getStreamLinkForFile(torrentId, mainFile.id, request.apiKey!);
      
      if (!streamLink) {
        this.logger.debug('No stream link available for torrent', { requestId: request.id, torrentId });
        return null;
      }

      const streamTitle = this.generateStreamTitle(magnet);
      const streamName = `Brasil RD - ${magnet.quality}`;
      
      const stream: Stream = {
        title: streamTitle,
        url: streamLink,
        name: streamName,
        description: `Conteudo curado - ${magnet.language} - Colecao Completa`,
        behaviorHints: {
          notWebReady: false, // CORREÇÃO MOBILE
          bingeGroup: `br-${request.id}`,
          filename: this.sanitizeFilename(magnet.title)
        },
        torrentId: torrentId,
        status: 'downloaded'
      };

      this.logger.debug('Successfully created stream from curated magnet for all episodes', {
        requestId: request.id,
        magnetTitle: magnet.title,
        torrentId,
        status: stream.status
      });

      return stream;

    } catch (error) {
      this.logger.error('All episodes processing failed', {
        requestId: request.id,
        magnetTitle: magnet.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private extractEpisodeFromRequest(requestId: string): RequestEpisodeInfo {
    const defaultResult = { season: 1, episode: 1, isValid: false };
    
    if (!requestId || typeof requestId !== 'string') {
      return defaultResult;
    }

    const match = requestId.match(/tt\d+:(\d+):(\d+)/);
    
    if (!match) {
      return defaultResult;
    }

    const season = parseInt(match[1]);
    const episode = parseInt(match[2]);

    if (isNaN(season) || isNaN(episode) || season < 1 || episode < 1) {
      return defaultResult;
    }

    return {
      season,
      episode,
      isValid: true
    };
  }

  private findEpisodeFile(files: RDFile[], targetSeason: number, targetEpisode: number): RDFile | null {
    for (const file of files) {
      const episodeInfo = this.extractEpisodeInfo(file.path);
      
      if (episodeInfo.season === targetSeason && episodeInfo.episode === targetEpisode) {
        return file;
      }
    }

    return null;
  }

  private filterAndSortVideoFiles(files: RDFile[]): RDFile[] {
    const videoFiles = files.filter(file => {
      const filename = file.path.toLowerCase();
      return this.videoExtensions.some(ext => filename.endsWith(ext));
    });

    const cleanVideoFiles = this.filterPromotionalFiles(videoFiles);
    return this.sortFilesByEpisode(cleanVideoFiles);
  }

  private generateStreamTitle(magnet: CuratedMagnet): string {
    const qualityTag = `[${magnet.quality.toUpperCase()}]`;
    const curatedTag = '[BR-CURATED]';
    const seedTag = magnet.seeds > 10 ? `[${magnet.seeds} seeds]` : '';
    const languageTag = magnet.language === 'pt-BR' ? '[PT-BR]' : `[${magnet.language.toUpperCase()}]`;
    
    return `${magnet.title} ${qualityTag} ${languageTag} ${curatedTag} ${seedTag}`.trim().replace(/\s+/g, ' ');
  }

  private generateEpisodeStreamTitle(magnet: CuratedMagnet, season: number, episode: number): string {
    const baseTitle = this.generateStreamTitle(magnet);
    const episodeTag = `[S${season}E${episode}]`;
    return `${baseTitle} ${episodeTag}`.trim();
  }

  private extractHashFromMagnet(magnet: string): string | null {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
  }

  private generateCacheKey(request: StreamRequest): string {
    return `streams:${request.type}:${request.id}`;
  }

  private sortStreamsByQuality(streams: Stream[]): Stream[] {
    return streams.sort((a, b) => {
      const scoreA = this.calculateQualityScore(a.name || '');
      const scoreB = this.calculateQualityScore(b.name || '');
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      if (a.status === 'downloaded' && b.status !== 'downloaded') {
        return -1;
      }
      if (b.status === 'downloaded' && a.status !== 'downloaded') {
        return 1;
      }
      
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  private calculateQualityScore(name: string | undefined): number {
    const nameLower = (name || '').toLowerCase();
    
    for (const [quality, qualityScore] of Object.entries(this.qualityPriority)) {
      if (nameLower.includes(quality.toLowerCase())) {
        return qualityScore;
      }
    }

    return 0;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
  }

  addCuratedMagnet(magnet: CuratedMagnet): void {
    this.magnetService.addMagnet(magnet);
    this.invalidateRelatedCache(magnet.imdbId);
    this.logger.info('Added curated magnet and invalidated cache', { imdbId: magnet.imdbId, title: magnet.title });
  }

  removeCuratedMagnet(imdbId: string, magnetLink: string): boolean {
    const removed = this.magnetService.removeMagnet(imdbId, magnetLink);
    if (removed) {
      this.invalidateRelatedCache(imdbId);
      this.logger.info('Removed curated magnet and invalidated cache', { imdbId, magnetLink });
    }
    return removed;
  }

  private invalidateRelatedCache(imdbId: string): void {
    const cachePatterns = [
      `streams:movie:${imdbId}`,
      `streams:series:${imdbId}`,
      `streams:series:${imdbId}:*`
    ];

    for (const pattern of cachePatterns) {
      this.cacheService.delete(pattern);
    }

    const seasonCacheKeys = Array.from(this.seasonCache.keys()).filter(key => 
      key.includes(imdbId)
    );
    
    for (const key of seasonCacheKeys) {
      this.seasonCache.delete(key);
    }

    this.logger.debug('Invalidated related cache', { imdbId, cachePatterns: cachePatterns.length, seasonCacheKeys: seasonCacheKeys.length });
  }

  getStats(): { 
    cache: { size: number; keys: string[] }; 
    magnets: { totalMagnets: number; uniqueTitles: number };
    torrentCache: { size: number; entries: string[] };
    seasonCache: { size: number; entries: string[] };
  } {
    return {
      cache: this.cacheService.getStats(),
      magnets: this.magnetService.getStats(),
      torrentCache: {
        size: this.torrentCache.size,
        entries: Array.from(this.torrentCache.keys())
      },
      seasonCache: {
        size: this.seasonCache.size,
        entries: Array.from(this.seasonCache.keys())
      }
    };
  }

  clearCache(): void {
    this.cacheService.clear();
    this.torrentCache.clear();
    this.seasonCache.clear();
    this.logger.info('Cleared all caches');
  }

  validateMagnet(magnet: string): boolean {
    if (!magnet.startsWith('magnet:?')) {
      return false;
    }

    const hash = this.extractHashFromMagnet(magnet);
    if (!hash) {
      return false;
    }
    return hash.length >= 32 && hash.length <= 40;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}