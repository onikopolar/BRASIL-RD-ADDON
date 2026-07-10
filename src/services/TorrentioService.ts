import axios from 'axios';
import { Logger } from '../utils/logger';

export interface TorrentioStream {
    name: string;
    title: string;
    infoHash: string;
    fileIdx: number;
    behaviorHints?: {
        bingeGroup?: string;
        filename?: string;
    };
}

export interface TorrentioResult {
    title: string;
    magnet: string;
    infoHash: string;
    seeders: number;
    size: string;
    quality: string;
    provider: string;
    language: string;
    type: 'movie' | 'series';
}

export class TorrentioService {
    private readonly logger = new Logger('TorrentioService');
    private readonly baseUrl = 'https://torrentio.strem.fun';

    /**
     * Busca streams no Torrentio para um IMDb ID.
     * Retorna apenas resultados com áudio em português (Dual/Dublado).
     */
    async search(type: 'movie' | 'series', imdbId: string, season?: number, episode?: number): Promise<TorrentioResult[]> {
        const startTime = Date.now();

        try {
            // Monta URL: /stream/movie/tt2820466.json ou /stream/series/tt2820466:1:1.json
            let path: string;
            if (type === 'series' && season !== undefined && episode !== undefined) {
                path = `/stream/series/${imdbId}:${season}:${episode}.json`;
            } else if (type === 'series' && season !== undefined) {
                path = `/stream/series/${imdbId}:${season}.json`;
            } else {
                path = `/stream/${type}/${imdbId}.json`;
            }

            const url = `${this.baseUrl}${path}`;
            this.logger.debug(`🔍 Buscando Torrentio: ${url}`);

            const response = await axios.get(url, {
                timeout: 12000,
                headers: { 'User-Agent': 'Stremio/4.4' }
            });

            const streams: TorrentioStream[] = response.data?.streams || [];
            const elapsed = Date.now() - startTime;

            this.logger.debug(`Torrentio retornou ${streams.length} streams em ${elapsed}ms`);

            // Filtrar apenas streams PT-BR
            const ptStreams = streams.filter(s => this.isPortugueseStream(s));
            this.logger.debug(`${ptStreams.length} streams PT-BR encontrados no Torrentio`);

            // Converter para formato interno
            const results = ptStreams.map(s => this.convertToResult(s, type));
            return results;

        } catch (error: any) {
            const elapsed = Date.now() - startTime;
            this.logger.warn('Erro ao buscar Torrentio', {
                imdbId,
                erro: error.message,
                tempo: `${elapsed}ms`
            });
            return [];
        }
    }

    /**
     * Verifica se o stream é em português (Dual Audio, Dublado, PT-BR)
     */
    private isPortugueseStream(stream: TorrentioStream): boolean {
        const text = `${stream.title} ${stream.name}`.toLowerCase();
        return /dual|dublado|portugues|português|pt-br|ptbr|nacional|🇧🇷|🇵🇹/.test(text);
    }

    /**
     * Converte um stream do Torrentio para o formato interno ScrapedTorrent-compatível
     */
    private convertToResult(stream: TorrentioStream, type: 'movie' | 'series'): TorrentioResult {
        const title = this.extractCleanTitle(stream.title);
        const infoHash = stream.infoHash;
        const magnet = `magnet:?xt=urn:btih:${infoHash}`;

        // Extrai seeds, tamanho e qualidade do título
        const seeders = this.extractSeeders(stream.title);
        const size = this.extractSize(stream.title);
        const quality = this.extractQuality(stream.title);
        const provider = this.extractProvider(stream.title);

        return {
            title,
            magnet,
            infoHash,
            seeders,
            size,
            quality,
            provider,
            language: 'pt-BR',
            type
        };
    }

    /**
     * Extrai o título limpo do formato Torrentio:
     * "Liga da Justiça - Ponto De Ignição 1080p_D\n👤 1 💾 1.29 GB ⚙️ ThePirateBay\nDual Audio"
     */
    private extractCleanTitle(rawTitle: string): string {
        // Remove emojis, metadados e quebras de linha
        let clean = rawTitle
            .replace(/\n.*$/s, '') // Remove tudo após primeira quebra de linha
            .replace(/[👤💾⚙️🇧🇷🇵🇹🇬🇧🇺🇸]/g, '') // Remove emojis
            .replace(/\s+/g, ' ') // Normaliza espaços
            .trim();

        // Remove sufixos de qualidade duplicados
        clean = clean.replace(/[\s_]*1080p_D$/i, ' 1080p Dual Audio');
        clean = clean.replace(/[\s_]*720p_D$/i, ' 720p Dual Audio');
        clean = clean.replace(/[\s_]*4K_D$/i, ' 4K Dual Audio');

        return clean;
    }

    private extractSeeders(title: string): number {
        // Padrão: 👤 1 💾 (👤 seguido de número)
        const match = title.match(/👤\s*(\d+)/);
        return match ? parseInt(match[1]) : 0;
    }

    private extractSize(title: string): string {
        // Padrão: 💾 1.29 GB
        const match = title.match(/💾\s*([\d.]+)\s*(GB|MB|TB)/i);
        return match ? `${match[1]} ${match[2].toUpperCase()}` : 'Tamanho não especificado';
    }

    private extractQuality(title: string): string {
        const lower = title.toLowerCase();
        if (lower.includes('4k') || lower.includes('2160p')) return '4K';
        if (lower.includes('1080p')) return '1080p';
        if (lower.includes('720p')) return '720p';
        if (lower.includes('480p')) return '480p';
        return 'HD';
    }

    private extractProvider(title: string): string {
        // Padrão: ⚙️ ThePirateBay
        const match = title.match(/⚙️\s*(\S+)/);
        return match ? match[1] : 'Torrentio';
    }
}
