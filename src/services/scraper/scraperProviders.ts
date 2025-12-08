import { ScraperProvider } from './torrentTypes';

export const scraperProviders: ScraperProvider[] = [
{
    name: 'Pop Torrent',
    baseUrl: 'https://poptorrent.org',
    searchPath: '/?s=',
    itemSelector: 'article, .post, .item, [class*="post-"]',
    titleSelector: 'h2 a, h3 a, .title a, .entry-title a',
    linkSelector: 'a',
    priority: 2,
    timeout: 10000
}
];

export const torrentIndexerConfig = {
    baseUrl: 'https://torrent-indexer.darklyn.org',
    timeout: 15000,
    enabled: true,
    priority: 5
};