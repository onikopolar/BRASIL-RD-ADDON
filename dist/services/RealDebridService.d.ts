import { RDTorrentInfo, RDFile } from '../types/index';
export declare class RealDebridService {
    private readonly logger;
    private readonly maxRetries;
    private readonly baseDelay;
    constructor();
    private createHttpClient;
    private setupInterceptors;
    addMagnet(magnetLink: string, apiKey: string): Promise<string>;
    getTorrentInfo(torrentId: string, apiKey: string): Promise<RDTorrentInfo>;
    selectFiles(torrentId: string, apiKey: string, fileIds?: string): Promise<void>;
    unrestrictLink(link: string, apiKey: string): Promise<string>;
    getStreamLinkForFile(torrentId: string, fileId: number, apiKey: string): Promise<string | null>;
    getStreamLinkForTorrent(torrentId: string, apiKey: string): Promise<string | null>;
    getTorrentFiles(torrentId: string, apiKey: string): Promise<RDFile[]>;
    findExistingTorrent(magnetHash: string, apiKey: string): Promise<RDTorrentInfo | null>;
    processTorrent(magnetLink: string, apiKey: string): Promise<{
        added: boolean;
        ready: boolean;
        status: string;
        torrentId?: string;
        progress?: number;
    }>;
    private retryableRequest;
    private isRetryableError;
    private validateMagnetLink;
    private validateTorrentId;
    private extractMagnetHash;
    private sanitizeLink;
    private getErrorMessage;
    private delay;
}
