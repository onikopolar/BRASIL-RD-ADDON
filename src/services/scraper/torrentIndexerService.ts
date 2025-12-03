import axios from 'axios';
import { TorrentResult, TorrentIndexerResult } from './torrentTypes';

export class TorrentIndexerService {
    private readonly baseUrl = 'https://torrent-indexer.darklyn.org';
    private readonly timeout = 15000;

    async search(
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number
    ): Promise<TorrentResult[]> {
        if (!query || query.trim().length === 0) {
            return [];
        }

        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params: any = {
                q: query.toLowerCase(),
                filter_results: 'true',
                category: category
            };

            if (targetSeason && type === 'series') {
                params.season = targetSeason.toString();
            }

            const response = await axios.get(`${this.baseUrl}/search`, {
                timeout: this.timeout,
                headers: this.getHeaders(),
                params
            });

            const data = response.data;
            
            if (!data.results || !Array.isArray(data.results)) {
                return [];
            }

            const results = data.results.slice(0, 20);
            const mappedResults = results.map((indexerResult: TorrentIndexerResult) => 
                this.mapTorrentIndexerResult(indexerResult, type)
            ).filter(Boolean) as TorrentResult[];

            return mappedResults;

        } catch (error) {
            // Silenciosamente retorna array vazio em caso de erro
            return [];
        }
    }

    private mapTorrentIndexerResult(
        indexerResult: TorrentIndexerResult,
        type: 'movie' | 'series'
    ): TorrentResult | null {
        if (!indexerResult.title || !indexerResult.magnet_link) {
            return null;
        }

        const quality = this.extractQuality(indexerResult.title);
        
        if (!this.isAllowedQuality(quality)) {
            return null;
        }

        const seasonNumber = this.extractSeasonNumber(indexerResult.title);

        return {
            title: this.cleanTitle(indexerResult.title),
            magnet: indexerResult.magnet_link,
            seeders: indexerResult.seed_count || this.estimateSeeders('TorrentIndexer', quality),
            leechers: indexerResult.leech_count || 0,
            size: indexerResult.size || 'Size not specified',
            quality: quality,
            provider: 'TorrentIndexer',
            language: this.extractLanguage(indexerResult.title),
            type,
            relevanceScore: 100,
            sizeInBytes: this.calculateSizeInBytes(indexerResult.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(indexerResult.date || Date.now()),
            confidence: 0.5
        };
    }

    private extractQuality(title: string): string {
        const qualityPatterns = [
            { pattern: /\b2160p\b/i, quality: '2160p' },
            { pattern: /\b4k\b/i, quality: '2160p' },
            { pattern: /\b1080p\b/i, quality: '1080p' },
            { pattern: /\b720p\b/i, quality: '720p' },
            { pattern: /\bhd\b/i, quality: 'HD' }
        ];

        const cleanTitle = title.toLowerCase();
        
        for (const { pattern, quality } of qualityPatterns) {
            if (pattern.test(cleanTitle)) {
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

    private extractSeasonNumber(text: string): number | null {
        const patterns = [
            /temporada\s*(\d+)/i,
            /(\d+)\s*temporada/i,
            /season\s*(\d+)/i,
            /s(\d+)/i,
            /(\d+)\s*ª?\s*temp/i
        ];

        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }

    private isAllowedQuality(quality: string): boolean {
        const allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
        return allowedQualities.has(quality);
    }

    private cleanTitle(title: string): string {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .trim();
    }

    private extractLanguage(title: string): string {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('dual')) return 'pt-BR,en';
        if (titleLower.includes('dublado')) return 'pt-BR';
        if (titleLower.includes('legendado')) return 'pt';
        return 'pt-BR';
    }

    private calculateSizeInBytes(sizeStr: string): number {
        if (!sizeStr || sizeStr === 'Size not specified') {
            return 1.5 * 1024 * 1024 * 1024; // 1.5 GB default
        }
        
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match) return 1.5 * 1024 * 1024 * 1024;

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        if (unit === 'GB' || unit === 'G') return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M') return value * 1024 * 1024;

        return 1.5 * 1024 * 1024 * 1024;
    }

    private estimateSeeders(provider: string, quality: string): number {
        const baseSeeders: Record<string, number> = {
            'TorrentIndexer': 70,
            'BLUDV': 80,
            'Starck Filmes': 60,
            'BaixaFilmesTorrent': 50
        };

        const qualityMultiplier: Record<string, number> = {
            '2160p': 1.5,
            '1080p': 1.3,
            '720p': 1.0,
            'HD': 1.1
        };

        const base = baseSeeders[provider] || 30;
        const multiplier = qualityMultiplier[quality] || 1.0;
        return Math.round(base * multiplier);
    }

    private getHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
}