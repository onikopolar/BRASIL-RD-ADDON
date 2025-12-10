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
    },
    {
        name: 'Starck Filmes',
        baseUrl: 'https://www.starckfilmes-v6.com',
        searchPath: '/?s=',
        itemSelector: '.movies, .slide-item, .post-catalog, .item',
        titleSelector: 'h3.sl-title', // CORRIGIDO: Título está no h3, não no link
        linkSelector: 'a', // Link está em um elemento 'a' separado
        priority: 1,
        timeout: 15000,
        needsIndividualPageScrape: true
    }
];

export const torrentIndexerConfig = {
    baseUrl: 'https://torrent-indexer.darklyn.org',
    timeout: 15000,
    enabled: true,
    priority: 5
};
