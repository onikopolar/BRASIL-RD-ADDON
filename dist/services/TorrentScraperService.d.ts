export interface TorrentResult {
    title: string;
    magnet: string;
    seeders: number;
    leechers: number;
    size: string;
    quality: string;
    provider: string;
    language: string;
    type: 'movie' | 'series';
    relevanceScore: number;
    sizeInBytes: number;
    season?: number;
    lastUpdated: Date;
    confidence: number;
    realDebridAdded: boolean;
    realDebridId?: string;
}
export declare class TorrentScraperService {
    private readonly providers;
    private readonly torrentIndexerConfig;
    private readonly maxRetries;
    private readonly retryDelay;
    private readonly allowedQualities;
    private readonly qualityPriority;
    private readonly ignoredWords;
    private readonly promotionalKeywords;
    private readonly qualityPatterns;
    constructor();
    searchTorrents(query: string, type?: 'movie' | 'series', targetSeason?: number): Promise<TorrentResult[]>;
    /**
     * NOVA FUNÇÃO: Adiciona um magnet específico ao Real-Debrid quando o usuário clica na stream
     * Esta função será chamada pelo StreamHandler quando o usuário selecionar uma stream
     */
    addMagnetToRealDebrid(magnet: string, title: string, quality: string): Promise<{
        success: boolean;
        realDebridId?: string;
        error?: string;
    }>;
    /**
     * NOVA FUNÇÃO: Verifica o status de um torrent no Real-Debrid
     * Será usada para verificar se o torrent já foi baixado após o usuário clicar
     */
    checkRealDebridStatus(realDebridId: string): Promise<{
        status: 'downloaded' | 'downloading' | 'error';
        progress: number;
    }>;
    /**
     * NOVA FUNÇÃO: Obtém a URL de stream de um torrent já baixado no Real-Debrid
     */
    getRealDebridStreamUrl(realDebridId: string): Promise<{
        streamUrl: string;
        filename: string;
    } | null>;
    private extractMagnetHash;
    private generateRealDebridId;
    private applyTitleQualityMatchFiltering;
    private normalizeTitleForMatching;
    private generateTitleMatchPatterns;
    private doesTitleMatchSearch;
    private calculateTitleQualityRelevanceScore;
    private groupResultsByQuality;
    private selectBestFromEachQualityGroup;
    private isValidContent;
    private isPromotionalContent;
    private extractQuality;
    private inferQualityFromContext;
    private extractMainTitle;
    private extractSeasonNumber;
    private searchTorrentIndexer;
    private mapTorrentIndexerResult;
    private getTorrentIndexerHeaders;
    private generateSeasonQueries;
    private processSettledResults;
    private cleanTitle;
    private extractLanguage;
    private calculateSizeInBytes;
    private estimateSeeders;
    private searchProvider;
    private searchViaAPI;
    private searchViaHTML;
    private parseAPIResults;
    private parseHtmlResults;
    private createTorrentResultFromAPI;
    private createTorrentResult;
    private extractMagnetFromContent;
    private extractSizeFromContent;
    private extractSize;
    private enrichWithMagnets;
    private fetchMagnetForResult;
    private getAPIHeaders;
    private fetchWithRetry;
    private getRequestHeaders;
    private delay;
    private logSearchResults;
}
