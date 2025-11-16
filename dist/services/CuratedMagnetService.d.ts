import { CuratedMagnet, StreamRequest } from '../types/index';
export declare class CuratedMagnetService {
    private magnets;
    private logger;
    constructor();
    private initializeDefaultMagnets;
    /**
     * Extracts base IMDb ID from Stremio format
     * Examples:
     * - "tt1942683:1:1" -> "tt1942683" (series episode)
     * - "tt0317219" -> "tt0317219" (movie)
     */
    private extractBaseImdbId;
    /**
     * Validates magnet data structure
     */
    private validateMagnet;
    addMagnet(magnet: CuratedMagnet): void;
    removeMagnet(imdbId: string, magnetLink: string): boolean;
    searchMagnets(request: StreamRequest): CuratedMagnet[];
    private sortByQualityAndSeeds;
    getAllMagnets(): CuratedMagnet[];
    getMagnetsByImdbId(imdbId: string): CuratedMagnet[];
    getStats(): {
        totalMagnets: number;
        uniqueTitles: number;
        catalogSize: number;
    };
    clearAllMagnets(): void;
}
