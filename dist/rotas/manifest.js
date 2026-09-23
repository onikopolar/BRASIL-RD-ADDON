"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.manifest = void 0;
const package_json_1 = require("../../package.json");
exports.manifest = {
    id: 'org.brasilrd.addon',
    version: package_json_1.version,
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte ao Torbox',
    logo: `${process.env.BASE_URL || 'http://localhost:7000'}/videos/logo.png`,
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
        p2p: false,
        preferredAudioLanguage: 'por'
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
