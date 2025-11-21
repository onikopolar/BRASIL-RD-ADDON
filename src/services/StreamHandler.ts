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

class QualityDetector {
  private readonly qualityPatterns = [
    { pattern: /\.2160p\./i, quality: '2160p', confidence: 100 },
    { pattern: /\.4k\./i, quality: '2160p', confidence: 100 },
    { pattern: /\b2160p\b/i, quality: '2160p', confidence: 98 },
    { pattern: /\b4k\b/i, quality: '2160p', confidence: 98 },
    { pattern: /2160p/i, quality: '2160p', confidence: 95 },
    { pattern: /4k/i, quality: '2160p', confidence: 95 },
    { pattern: /\buhd\b/i, quality: '2160p', confidence: 90 },
    { pattern: /\bultra.hd\b/i, quality: '2160p', confidence: 90 },
    
    { pattern: /\.1080p\./i, quality: '1080p', confidence: 100 },
    { pattern: /\b1080p\b/i, quality: '1080p', confidence: 98 },
    { pattern: /1080p/i, quality: '1080p', confidence: 95 },
    { pattern: /\bfhd\b/i, quality: '1080p', confidence: 90 },
    { pattern: /\bfull.hd\b/i, quality: '1080p', confidence: 90 },
    
    { pattern: /\.720p\./i, quality: '720p', confidence: 100 },
    { pattern: /\b720p\b/i, quality: '720p', confidence: 98 },
    { pattern: /720p/i, quality: '720p', confidence: 95 },
    { pattern: /\bhd.rip\b/i, quality: '720p', confidence: 85 },
    
    { pattern: /\.hd\./i, quality: 'HD', confidence: 90 },
    { pattern: /\bhd\b/i, quality: 'HD', confidence: 80 },
    { pattern: /\bhigh.def\b/i, quality: 'HD', confidence: 80 },

    { pattern: /\.web-dl\./i, quality: '1080p', confidence: 95 },
    { pattern: /\.bluray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.blu-ray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.remux\./i, quality: '2160p', confidence: 95 },
    { pattern: /\.webrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.hdtv\./i, quality: '720p', confidence: 80 },
    { pattern: /\.brrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.bdrip\./i, quality: '1080p', confidence: 85 }
  ];

  private readonly exactPatterns = [
    { pattern: /\b2160p\b/i, quality: '2160p' },
    { pattern: /\b4k\b/i, quality: '2160p' },
    { pattern: /\b1080p\b/i, quality: '1080p' },
    { pattern: /\b720p\b/i, quality: '720p' },
    { pattern: /\bhd\b/i, quality: 'HD' }
  ];

  private readonly allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);

  extractQuality(title: string): string {
    const cleanTitle = title.toLowerCase();
    
    for (const { pattern, quality, confidence } of this.qualityPatterns) {
      if (pattern.test(cleanTitle) && confidence >= 95) {
        return quality;
      }
    }

    for (const { pattern, quality } of this.exactPatterns) {
      if (pattern.test(cleanTitle)) {
        return quality;
      }
    }

    for (const { pattern, quality, confidence } of this.qualityPatterns) {
      if (pattern.test(cleanTitle) && confidence >= 80) {
        return quality;
      }
    }

    return this.inferQualityFromContext(cleanTitle);
  }

  private inferQualityFromContext(titleLower: string): string {
    if (titleLower.includes('remux') || titleLower.includes('web-dl')) {
      return '1080p';
    }
    
    if (titleLower.includes('bluray') || titleLower.includes('blu-ray')) {
      return '1080p';
    }
    
    if (titleLower.includes('hdtv')) {
      return '720p';
    }
    
    return 'HD';
  }

  extractQualityFromFilename(filename: string): string {
    return this.extractQuality(filename);
  }

  extractQualityFromStreamName(name: string | undefined): string {
    if (!name) return 'HD';
    return this.extractQuality(name);
  }

  isValidQuality(quality: string): boolean {
    return this.allowedQualities.has(quality);
  }
}

export class StreamHandler {
  private readonly rdService: RealDebridService;
  private readonly magnetService: CuratedMagnetService;
  private readonly cacheService: CacheService;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly qualityDetector: QualityDetector;
  private readonly logger: Logger;

  private readonly processingConfig: StreamProcessingConfig = {
    maxConcurrentTorrents: 2,
    delayBetweenTorrents: 1000,
    allowPendingStreams: true,
    maxPendingStreams: 8,
    cacheTTL: {
      downloaded: 86400000,
      downloading: 300000,
      error: 120000
    }
  };

  private readonly qualityPriority: Record<string, number> = {
    '2160p': 5,
    '1080p': 4,
    '720p': 3,
    'HD': 2
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
    this.qualityDetector = new QualityDetector();
    this.logger = new Logger('StreamHandler');
    
    this.logger.info('StreamHandler initialized with lazy loading support', {
      processingConfig: this.processingConfig,
      qualityDetection: '100% igual ao TorrentScraperService'
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
          const qualities = cachedStreams.map(s => 
            this.qualityDetector.extractQualityFromStreamName(s.name)
          );
          this.logger.debug('Returning cached downloaded streams', { 
            requestId, 
            cacheKey,
            streamCount: cachedStreams.length,
            qualities
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
      
      streams = this.applyMobileCompatibilityFilter(streams);
      
      // DEBUG: Log das URLs que estão sendo retornadas
      this.logger.debug('DEBUG - URLs sendo retornadas para o cliente:', {
        requestId,
        streamCount: streams.length,
        urls: streams.map(s => ({
          url: s.url,
          title: s.title,
          status: s.status
        }))
      });
      
      if (streams.length > 0) {
        const cacheTTL = this.calculateDynamicCacheTTL(streams);
        this.cacheService.set(cacheKey, streams, cacheTTL);
        
        const qualities = streams.map(s => 
          this.qualityDetector.extractQualityFromStreamName(s.name)
        );
        
        this.logger.info('Cached new mobile-compatible streams', { 
          requestId, 
          cacheKey, 
          streamCount: streams.length,
          cacheTTL: `${cacheTTL / 60000}min`,
          qualities,
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

  private applyMobileCompatibilityFilter(streams: Stream[]): Stream[] {
    return streams.filter(stream => {
      if (!stream.url || !stream.url.startsWith('http')) {
        return false;
      }
      
      if (stream.status !== 'downloaded' && stream.status !== 'ready' && stream.status !== 'pending') {
        return false;
      }
      
      const quality = this.qualityDetector.extractQualityFromStreamName(stream.name);
      if (!this.qualityDetector.isValidQuality(quality)) {
        return false;
      }
      
      return true;
    }).map(stream => {
      stream.behaviorHints = {
        ...stream.behaviorHints,
        notWebReady: false
      };
      
      if (stream.name) {
        const currentQuality = this.qualityDetector.extractQualityFromStreamName(stream.name);
        if (!stream.name.match(/(2160p|1080p|720p|HD)/i)) {
          stream.name = `Brasil RD | ${currentQuality.toUpperCase()}`;
        }
      }
      
      return stream;
    });
  }

  private calculateDynamicCacheTTL(streams: Stream[]): number {
    if (streams.length === 0) {
      return this.processingConfig.cacheTTL.error;
    }

    if (streams.every(stream => stream.status === 'downloaded')) {
      return this.processingConfig.cacheTTL.downloaded;
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
    
    try {
      const title = await this.fetchTitleFromImdb(request);
      if (!title) {
        this.logger.debug('No title found from IMDB for series scraping', { requestId: request.id });
        return await this.fallbackToRegularScraping(title || request.id, request);
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
        return await this.fallbackToRegularScraping(request.id, request);
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

    const streams = await this.processTorrentsWithRateLimit(torrentResults, request);
    
    const streamQualities = streams.map(s => 
      this.qualityDetector.extractQualityFromStreamName(s.name)
    );
    
    this.logger.info('Completed torrent processing', {
      requestId: request.id,
      totalStreams: streams.length,
      qualities: streamQualities,
      statuses: streams.map(s => s.status)
    });

    return this.sortStreamsByQuality(streams);
  }

   private async processTorrentsWithRateLimit(
    torrents: ScrapedTorrent[], 
    request: StreamRequest
  ): Promise<Stream[]> {
    const allStreams: Stream[] = [];
    
    console.log('DEBUG processTorrentsWithRateLimit: Iniciando processamento de', torrents.length, 'torrents');
    
    for (let i = 0; i < torrents.length; i += this.processingConfig.maxConcurrentTorrents) {
      const batch = torrents.slice(i, i + this.processingConfig.maxConcurrentTorrents);
      
      console.log('DEBUG: Processando batch', Math.floor(i / this.processingConfig.maxConcurrentTorrents) + 1, 'com', batch.length, 'torrents');
      
      this.logger.debug('Processing torrent batch', {
        requestId: request.id,
        batchIndex: Math.floor(i / this.processingConfig.maxConcurrentTorrents) + 1,
        batchSize: batch.length,
        qualities: batch.map(t => t.quality)
      });

      const batchPromises = batch.map(async (torrent) => {
        try {
          console.log('DEBUG: Iniciando processamento LAZY para torrent:', torrent.title);
          console.log('DEBUG: Provider:', torrent.provider, 'Quality:', torrent.quality);
          
          const streamResult = await this.processScrapedTorrentLazy(torrent, request);
          
          if (streamResult) {
            console.log('DEBUG: Stream result obtido para:', torrent.title);
            return streamResult;
          } else {
            console.log('DEBUG: Nenhum stream result para:', torrent.title);
          }
        } catch (error) {
          console.log('DEBUG: ERRO no processamento de:', torrent.title, error);
          this.logger.error('Torrent processing failed in batch', {
            requestId: request.id,
            title: torrent.title,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
        return null;
      });

      const batchResults = await Promise.allSettled(batchPromises);
      
      console.log('DEBUG: Batch results:', batchResults.length, 'resultados');
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value !== null) {
          console.log('DEBUG: Resultado fulfilled para índice', index);
          const streams = Array.isArray(result.value) ? result.value : [result.value];
          allStreams.push(...streams);
          console.log('DEBUG: Adicionados', streams.length, 'streams ao total');
        } else if (result.status === 'rejected') {
          console.log('DEBUG: Resultado rejected para índice', index, result.reason);
        }
      });

      console.log('DEBUG: Total de streams após batch:', allStreams.length);

      if (i + this.processingConfig.maxConcurrentTorrents < torrents.length) {
        console.log('DEBUG: Aguardando delay entre batches');
        await this.delay(this.processingConfig.delayBetweenTorrents);
      }
    }

    console.log('DEBUG processTorrentsWithRateLimit: Processamento finalizado. Total streams:', allStreams.length);
    return allStreams;
  }

  private generateLazyResolveUrl(magnet: string, apiKey: string): string {
    const encodedMagnet = Buffer.from(magnet).toString('base64');
    
    console.log('DEBUG generateLazyResolveUrl: Iniciando');
    console.log('DEBUG generateLazyResolveUrl - Variáveis:', {
        RAILWAY_STATIC_URL: process.env.RAILWAY_STATIC_URL,
        NODE_ENV: process.env.NODE_ENV,
        RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT
    });
    
    const domain = process.env.RAILWAY_STATIC_URL || (process.env.NODE_ENV === 'production' ? 'brasil-rd-addon.up.railway.app' : 'localhost:7000');
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    
    const url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${apiKey}`;
    
    console.log('DEBUG generateLazyResolveUrl - URL gerada:', url);
    console.log('DEBUG generateLazyResolveUrl - Domain usado:', domain);
    console.log('DEBUG generateLazyResolveUrl - Protocol usado:', protocol);
    
    return url;
}

  private async analyzeTorrentFilesLazy(magnet: string): Promise<Array<{id: number, path: string, bytes: number}>> {
    return [{
      id: 0,
      path: 'video_file.mp4',
      bytes: 1024 * 1024 * 1024
    }];
  }

  private async processScrapedTorrentLazy(torrent: ScrapedTorrent, request: StreamRequest): Promise<Stream | Stream[] | null> {
    const requestId = request.id;

    try {
      const videoFiles = await this.analyzeTorrentFilesLazy(torrent.magnet);
      if (videoFiles.length === 0) {
        this.logger.debug('No video files found in torrent analysis', { requestId, title: torrent.title });
        return null;
      }

      const cleanVideoFiles = this.filterPromotionalFiles(videoFiles);
      if (cleanVideoFiles.length === 0) {
        this.logger.debug('No valid video files after promotional filter', { requestId });
        return null;
      }

      if (request.type === 'series') {
        return await this.processSeriesTorrentLazy(torrent, request, cleanVideoFiles);
      } else {
        return await this.processMovieTorrentLazy(torrent, request, cleanVideoFiles);
      }

    } catch (error) {
      this.logger.error('Lazy torrent processing failed', {
        requestId,
        title: torrent.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  private async processMovieTorrentLazy(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    cleanVideoFiles: Array<{id: number, path: string, bytes: number}>
  ): Promise<Stream | null> {
    if (cleanVideoFiles.length === 0) {
        return null;
    }

    try {
        const lazyUrl = this.generateLazyResolveUrl(torrent.magnet, request.apiKey!);
        
        const fileQuality = this.qualityDetector.extractQualityFromFilename(torrent.title) || torrent.quality || 'HD';
        const stream: Stream = {
            title: `${torrent.title} [${torrent.provider}] [LAZY]`,
            url: lazyUrl,
            name: `Brasil RD | ${fileQuality.toUpperCase()}`,
            description: `Clique para carregar via Real-Debrid | ${torrent.language}`,
            behaviorHints: {
                notWebReady: false,
                bingeGroup: `br-lazy-${request.id}`,
                filename: this.sanitizeFilename(torrent.title)
            },
            magnet: torrent.magnet,
            isPending: true,
            status: 'pending'
        };
        return stream;

    } catch (error) {
        this.logger.error('Lazy movie torrent processing failed', {
            requestId: request.id,
            title: torrent.title,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
  }

  private async processSeriesTorrentLazy(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    cleanVideoFiles: Array<{id: number, path: string, bytes: number}>
  ): Promise<Stream[] | null> {
    const requestEpisode = this.extractEpisodeFromRequest(request.id);
    const streams: Stream[] = [];

    if (requestEpisode.isValid) {
        if (cleanVideoFiles.length === 0) {
            this.logger.debug('No files found for specific episode', {
                requestId: request.id,
                season: requestEpisode.season,
                episode: requestEpisode.episode
            });
            return null;
        }

        const validStreams: Stream[] = [];
        
        for (const file of cleanVideoFiles) {
            try {
                const lazyUrl = this.generateLazyResolveUrl(torrent.magnet, request.apiKey!);
                const fileQuality = this.qualityDetector.extractQualityFromFilename(torrent.title);
                
                const stream = this.createSeriesStreamLazy(
                    torrent, 
                    request, 
                    lazyUrl, 
                    torrent.title, 
                    requestEpisode.season, 
                    requestEpisode.episode,
                    fileQuality
                );
                
                validStreams.push(stream);
                
            } catch (error) {
                continue;
            }
        }

        return validStreams.length > 0 ? validStreams : null;

    } else {
        if (cleanVideoFiles.length === 0) {
            this.logger.debug('No main file found for series torrent', { requestId: request.id });
            return null;
        }

        try {
            const lazyUrl = this.generateLazyResolveUrl(torrent.magnet, request.apiKey!);
            const fileQuality = this.qualityDetector.extractQualityFromFilename(torrent.title);
            const stream = this.createSeriesStreamLazy(
                torrent, request, lazyUrl, torrent.title, 1, 1, fileQuality
            );
            streams.push(stream);
        } catch (error) {
            return null;
        }
    }

    return streams.length > 0 ? streams : null;
  }

  private createSeriesStreamLazy(
    torrent: ScrapedTorrent,
    request: StreamRequest,
    streamUrl: string,
    filePath: string,
    season: number,
    episode: number,
    quality: string
  ): Stream {
    const detectedQuality = this.qualityDetector.extractQuality(filePath);
    const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;

    return {
      title: `${torrent.title} [${torrent.provider}] ${episodeTag} [LAZY]`,
      url: streamUrl,
      name: `Brasil RD | ${detectedQuality.toUpperCase()} | ${episodeTag}`,
      description: `Clique para carregar via Real-Debrid | ${torrent.language} | ${episodeTag}`,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-lazy-${request.id}-${season}`,
        filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
      },
      magnet: torrent.magnet,
      isPending: true,
      status: 'pending'
    };
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

      const fileQuality = this.qualityDetector.extractQualityFromFilename(targetFile.path);
      const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;

      const stream: Stream = {
        title: `${title} ${episodeTag}`,
        url: streamLink,
        name: `Brasil RD | ${fileQuality.toUpperCase()} | ${episodeTag}`,
        description: `Conteúdo via temporada completa | ${episodeTag}`,
        behaviorHints: {
          notWebReady: false,
          bingeGroup: `br-season-${imdbId}-${season}`,
          filename: this.sanitizeFilename(`${title} ${episodeTag}`)
        },
        torrentId: torrentId,
        status: 'downloaded'
      };

      this.logger.debug('Successfully created stream from season episode', { 
        requestId, 
        season, 
        episode,
        quality: fileQuality
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
    const qualityGroups = this.groupMagnetsByQuality(magnets);
    const bestMagnets = this.selectBestFromEachQualityGroup(qualityGroups);
    
    const streams: Stream[] = [];
    
    for (const magnet of bestMagnets) {
      const stream = this.processMagnetLazy(magnet, request);
      if (stream) {
        streams.push(stream);
        this.logger.debug('Created lazy stream for quality', {
          requestId: request.id,
          magnetTitle: magnet.title,
          quality: magnet.quality
        });
      }
    }
    
    this.logger.info('Processed multiple quality streams', {
      requestId: request.id,
      totalQualities: streams.length,
      qualities: streams.map(s => this.qualityDetector.extractQualityFromStreamName(s.name))
    });

    return this.sortStreamsByQuality(streams);
  }

  private groupMagnetsByQuality(magnets: CuratedMagnet[]): Map<string, CuratedMagnet[]> {
    const groups = new Map<string, CuratedMagnet[]>();
    
    const allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
    for (const quality of allowedQualities) {
      groups.set(quality, []);
    }
    
    for (const magnet of magnets) {
      const quality = this.qualityDetector.extractQualityFromFilename(magnet.title);
      if (allowedQualities.has(quality)) {
        groups.get(quality)!.push(magnet);
      }
    }
    
    return groups;
  }

  private selectBestFromEachQualityGroup(qualityGroups: Map<string, CuratedMagnet[]>): CuratedMagnet[] {
    const bestMagnets: CuratedMagnet[] = [];
    const qualityOrder = ['2160p', '1080p', '720p', 'HD'];
    
    for (const quality of qualityOrder) {
      const group = qualityGroups.get(quality);
      if (group && group.length > 0) {
        const bestInQuality = group.sort((a, b) => {
          const aScore = a.title.length;
          const bScore = b.title.length;
          return bScore - aScore;
        })[0];
        
        bestMagnets.push(bestInQuality);
        
        this.logger.debug('Selected best magnet for quality', {
          quality,
          magnetTitle: bestInQuality.title,
          alternatives: group.length
        });
      }
    }
    
    return bestMagnets;
  }

  private createLazyStream(
    title: string,
    name: string,
    description: string,
    magnet: string,
    apiKey: string,
    quality: string,
    behaviorHints?: any
  ): Stream {
    const encodedMagnet = Buffer.from(magnet).toString('base64');
    const resolveUrl = `http://localhost:7000/resolve/${encodedMagnet}?apiKey=${apiKey}`;
    
    return {
      title: title,
      url: resolveUrl,
      name: name,
      description: description,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-lazy-${Date.now()}`,
        filename: this.sanitizeFilename(title),
        ...behaviorHints
      },
      magnet: magnet,
      isPending: true,
      status: 'pending'
    };
  }

  private processMagnetLazy(magnet: CuratedMagnet, request: StreamRequest): Stream | null {
    const magnetHash = this.extractHashFromMagnet(magnet.magnet);
    if (!magnetHash) {
      this.logger.debug('Invalid magnet hash', { requestId: request.id, magnetTitle: magnet.title });
      return null;
    }

    const quality = this.qualityDetector.extractQualityFromFilename(magnet.title);
    
    return this.createLazyStream(
      magnet.title,
    `Brasil RD | ${quality.toUpperCase()} | ON-DEMAND BR`,
`Conteúdo curado | ${magnet.language} | Clique para carregar`,
      magnet.magnet,
      request.apiKey!,
      quality
    );
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
      
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  private calculateQualityScore(name: string | undefined): number {
    if (!name) return 0;
    
    const quality = this.qualityDetector.extractQualityFromStreamName(name);
    return this.qualityPriority[quality] || 0;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[<>:"/\\|?*]/g, '_').substring(0, 255);
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

  private filterPromotionalFiles(files: any[]): any[] {
    return files.filter(file => {
      const filename = file.path.toLowerCase();
      return !this.promotionalKeywords.some(keyword => filename.includes(keyword));
    });
  }

  private identifyMainFile(files: any[]): any | null {
    return files.length > 0 ? files[0] : null;
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