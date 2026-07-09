import { ScraperProvider } from './torrentTypes';

// Apenas scrapers ativos e verificados
// WordPress API scraper (BLUDV) está em wordpressScraper.ts
export const scraperProviders: ScraperProvider[] = [
    // Scrapers HTML diretos desativados - domínios offline
    // Mantidos como referência para futuros sites
];

export const torrentIndexerConfig = {
    baseUrl: 'https://torrent-indexer.darklyn.org',
    timeout: 15000,
    enabled: true,
    priority: 5
};
