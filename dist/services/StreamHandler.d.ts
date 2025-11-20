import { TorrentResult } from './TorrentScraperService';
import { Stream, StreamRequest, CuratedMagnet } from '../types/index';
export declare class StreamHandler {
    private readonly rdService;
    private readonly magnetService;
    private readonly cacheService;
    private readonly torrentScraper;
    private readonly imdbScraper;
    private readonly qualityDetector;
    private readonly logger;
    private readonly processingConfig;
    private readonly qualityPriority;
    private readonly videoExtensions;
    private readonly episodePatterns;
    private readonly promotionalKeywords;
    private readonly torrentCache;
    private readonly seasonCache;
    private readonly torrentCacheTTL;
    private readonly downloadTimeout;
    private readonly downloadPollInterval;
    private readonly scrapedMagnetsCache;
    private readonly lazyLoadingStreams;
    constructor();
    handleStreamRequest(request: StreamRequest): Promise<{
        streams: Stream[];
    }>;
    private createLazyLoadingUrl;
    handleLazyLoadingClick(requestId: string, magnetHash: string, apiKey: string): Promise<{
        streamUrl: string;
        filename: string;
    } | null>;
    processUserSelectedMagnet(magnet: string, title: string, quality: string, request: StreamRequest): Promise<Stream | null>;
    private updateCacheWithDownloadedStream;
    private waitForTorrentDownload;
    getAvailableMagnets(request: StreamRequest): Promise<TorrentResult[]>;
    private applyMobileCompatibilityFilter;
    private calculateDynamicCacheTTL;
    private processStreamRequest;
    private processSeriesRequest;
    private processMovieRequest;
    private createStremioCompatibleLazyStreams;
    private createLazyLoadingStreams;
    private processCuratedMagnets;
    private processMagnetSafely;
    private processMagnet;
    private extractSeasonFromTitle;
    private extractImdbIdFromRequest;
    private getSeasonCacheKey;
    private getOrAddSeasonTorrent;
    private processEpisodeFromSeason;
    private processSpecificEpisode;
    private processAllEpisodes;
    private extractEpisodeFromRequest;
    private findEpisodeFile;
    private filterAndSortVideoFiles;
    private generateStreamTitle;
    private generateEpisodeStreamTitle;
    private extractHashFromMagnet;
    private generateCacheKey;
    private sortStreamsByQuality;
    private calculateQualityScore;
    private sanitizeFilename;
    addCuratedMagnet(magnet: CuratedMagnet): void;
    removeCuratedMagnet(imdbId: string, magnetLink: string): boolean;
    private invalidateRelatedCache;
    getStats(): {
        cache: {
            size: number;
            keys: string[];
        };
        magnets: {
            totalMagnets: number;
            uniqueTitles: number;
        };
        torrentCache: {
            size: number;
            entries: string[];
        };
        seasonCache: {
            size: number;
            entries: string[];
        };
        scrapedMagnetsCache: {
            size: number;
            entries: string[];
        };
        lazyLoadingStreams: {
            size: number;
            entries: string[];
        };
    };
    clearCache(): void;
    validateMagnet(magnet: string): boolean;
    private fetchTitleFromImdb;
    private sortFilesByEpisode;
    private extractEpisodeInfo;
    private compareEpisodeInfo;
    private filterPromotionalFiles;
    private identifyMainFile;
    private delay;
}
