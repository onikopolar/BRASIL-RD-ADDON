import { ScraperProvider } from './torrentTypes';

export const scraperProviders: ScraperProvider[] = [
    {
        name: 'Starck Filmes',
        baseUrl: 'https://www.starckfilmes-v3.com',
        searchPath: '/?s=',
        itemSelector: '.item',
        titleSelector: 'h3 a',
        linkSelector: 'a',
        priority: 3,
        timeout: 8000
    },
    {
        name: 'BaixaFilmesTorrent',
        baseUrl: 'https://baixafilmestorrent.com',
        searchPath: '/?s=',
        itemSelector: '.post',
        titleSelector: 'h2 a',
        linkSelector: 'a',
        priority: 2,
        timeout: 8000
    },
    {
        name: 'BLUDV',
        baseUrl: 'https://bludv.net',
        searchPath: '/?s=',
        itemSelector: '.post',
        titleSelector: 'div.title a',
        linkSelector: 'div.title a',
        priority: 4,
        timeout: 10000,
        usesAPI: true,
        apiEndpoint: '/wp-json/wp/v2/posts'
    },
    {
        name: 'Comando Torrents',
        baseUrl: 'https://comando.la',
        searchPath: '/?s=',
        itemSelector: '.single-view, .blog-view',
        titleSelector: 'h1.entry-title a, h2.entry-title a',
        linkSelector: 'h1.entry-title a, h2.entry-title a',
        priority: 3,
        timeout: 8000
    }
];

export const torrentIndexerConfig = {
    baseUrl: 'https://torrent-indexer.darklyn.org',
    timeout: 15000,
    enabled: true,
    priority: 5
};