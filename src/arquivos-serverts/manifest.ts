// Manifest do Addon Brasil RD
// Version: 1.0.1 - Foco em compatibilidade Web/Mobile
// Fix: configurationRequired: false para funcionar no Stremio Web

export const manifest = {
    // Identificação única do addon
    id: 'org.brasilrd.addon',

    // Versionamento Semântico: 1.0.1 (minor update para compatibilidade)
    version: '1.0.1',
    
    // Informações básicas
    name: 'Brasil RD',
    description: 'Addon brasileiro com suporte ao Torbox',
    
    // Imagens (placeholders do Stremio)
    logo: 'https://raw.githubusercontent.com/Stremio/stremio-art/main/placeholder/icon-256.png',
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