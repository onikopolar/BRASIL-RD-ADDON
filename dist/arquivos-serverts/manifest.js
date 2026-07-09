"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manifest = void 0;
exports.manifest = {
    id: 'org.brasilrd.addon',
    version: '1.0.1',
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte ao Torbox',
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',
    resources: ['stream'],
    types: ['movie', 'series', 'anime', 'other'],
    catalogs: [],
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb'],
    behaviorHints: {
        configurable: true,
        configurationRequired: false,
        adult: false,
        p2p: false
    },
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave de API do Torbox',
            required: true,
            placeholder: 'Cole sua chave de API do Torbox aqui'
        }
    ]
};
console.log('[Manifest] Brasil RD v1.0.1 - configurationRequired: false (Web Fix)');
