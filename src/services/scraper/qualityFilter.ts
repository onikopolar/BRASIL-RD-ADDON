import { TorrentResult } from './torrentTypes';
export class QualityFilter {
    private readonly allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
    
    private readonly qualityPriority: Record<string, number> = {
        '2160p': 400,
        '1080p': 300,
        '720p': 200,
        'HD': 150
    };

    isAllowedQuality(quality: string): boolean {
        return this.allowedQualities.has(quality);
    }

    getQualityPriority(quality: string): number {
        return this.qualityPriority[quality] || 100;
    }

    groupByQuality(results: TorrentResult[]): Map<string, TorrentResult[]> {
        const groups = new Map<string, TorrentResult[]>();
        
        for (const quality of this.allowedQualities) {
            groups.set(quality, []);
        }
        
        for (const result of results) {
            if (this.allowedQualities.has(result.quality)) {
                groups.get(result.quality)!.push(result);
            }
        }
        
        return groups;
    }
}
