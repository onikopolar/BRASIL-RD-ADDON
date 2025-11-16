import { RDTorrentInfo, RDFile } from '../types/index';
export declare class RealDebridService {
    private readonly client;
    private readonly logger;
    private readonly maxRetries;
    private readonly baseDelay;
    constructor();
    private validateConfiguration;
    private createHttpClient;
    private setupInterceptors;
    addMagnet(magnetLink: string): Promise<string>;
    getTorrentInfo(torrentId: string): Promise<RDTorrentInfo>;
    selectFiles(torrentId: string, fileIds?: string): Promise<void>;
    unrestrictLink(link: string): Promise<string>;
    getStreamLinkForFile(torrentId: string, fileId: number): Promise<string | null>;
    getStreamLinkForTorrent(torrentId: string): Promise<string | null>;
    getTorrentFiles(torrentId: string): Promise<RDFile[]>;
    findExistingTorrent(magnetHash: string): Promise<RDTorrentInfo | null>;
    processTorrent(magnetLink: string): Promise<{
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
