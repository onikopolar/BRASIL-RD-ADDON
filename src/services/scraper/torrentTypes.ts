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
    episode?: number;
    /** Título original extraído do HTML do post (ex: BLUDV "Título Original: ...") */
    originalTitle?: string;
    /** Ano de lançamento extraído do HTML do post (ex: "Lançamento: 2020") */
    year?: number;
    /** Nome canônico extraído do magnet (campo dn via magnetHelper) */
    canonicalName?: string;
    /** Contexto HTML com informações de episódio (ex: "EPISÓDIO 01: 1080p") */
    htmlTitle?: string;
    lastUpdated: Date;
    confidence: number;
}

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

export interface ScraperProvider {
    name: string;
    baseUrl: string;
    searchPath: string;
    itemSelector: string;
    titleSelector: string;
    linkSelector: string;
    priority: number;
    timeout: number;
    requiresVPN?: boolean;
    usesAPI?: boolean;
    apiEndpoint?: string;
    needsIndividualPageScrape?: boolean;
}

export interface QualityPattern {
    pattern: RegExp;
    quality: string;
    confidence: number;
}