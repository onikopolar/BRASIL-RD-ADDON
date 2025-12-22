"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.torrentIndexerConfig = exports.scraperProviders = void 0;
exports.scraperProviders = [
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
        baseUrl: 'https://starckfilmes-v8.com',
        searchPath: '/?s=',
        itemSelector: '.movies, .slide-item, .post-catalog, .item',
        titleSelector: 'h3.sl-title',
        linkSelector: 'a',
        priority: 1,
        timeout: 15000,
        needsIndividualPageScrape: true
    }
];
exports.torrentIndexerConfig = {
    baseUrl: 'https://torrent-indexer.darklyn.org',
    timeout: 15000,
    enabled: true,
    priority: 5
};
