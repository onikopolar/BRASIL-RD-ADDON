// Manifest do Addon Brasil RD
// Versao sincronizada automaticamente com package.json

import { version as versaoProjeto } from '../../package.json';

export const manifest = {
    id: 'org.brasilrd.addon',

    version: versaoProjeto,
    
    // Informações básicas
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte ao Torbox',
    
    // Imagens
    logo: `${process.env.BASE_URL || 'http://localhost:7000'}/videos/logo.png`,
    background: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/background-1920x1080.jpg',
    contactEmail: '',
    
    // Recursos e tipos suportados
    // Incluindo 'anime' e 'other' para maior compatibilidade com Torrentio
    resources: ['stream'],
    types: ['movie', 'series', 'anime', 'other'],
    
    // Catálogos vazios - foco em busca por ID
    catalogs: [],
    
    // Prefixos de ID suportados
    idPrefixes: ['tt', 'tmdb', 'tvdb', 'imdb'],
    
    // Comportamento do addon
    // IMPORTANTE: configurationRequired: false para funcionar no Stremio Web
    behaviorHints: {
        configurable: true,           // Usuário pode configurar
        configurationRequired: false, // NÃO requer configuração para usar (FIX WEB)
        adult: false,                 // Conteúdo não adulto
        p2p: false                    // Não usa P2P
    },
    
    // Configuração opcional (API Key do Torbox)
    config: [
        {
            key: 'apiKey',
            type: 'text',
            title: 'Chave de API do Torbox',
            required: true,           // Requerido para funcionalidade completa
            placeholder: 'Cole sua chave de API do Torbox aqui'
        }
    ]
};

// Log para debug - versão atual
console.log('[Manifest] Brasil RD v1.0.1 - configurationRequired: false (Web Fix)');