export interface TorrentIndexerResult {
    title: string;
    magnet_link: string;
    seed_count: number;
    leech_count: number;
    size: string;
    info_hash: string;
    date: string;
    details: string;
    original_title?: string;
    imdb?: string;
}
export interface TorrentIndexerSearchResponse {
    results: TorrentIndexerResult[];
    count: number;
}
export declare class TorrentIndexerService {
    private readonly baseUrl;
    private readonly mirrors;
    private readonly logger;
    private currentMirrorIndex;
    constructor();
    searchTorrents(query: string, indexer?: string, // 'search' para cache global ou nome específico
    category?: 'movies' | 'tv', season?: number, limit?: number): Promise<TorrentIndexerResult[]>;
    private retryWithNextMirror;
    private filterRelevantResults;
    private getQualityScore;
    private getCurrentMirror;
    private getAPIHeaders;
    private delay;
    getAvailableIndexers(): {
        id: string;
        name: string;
        description: string;
    }[];
    testAllMirrors(): Promise<{
        mirror: string;
        status: boolean;
        responseTime: number;
    }[]>;
}
