const { TorrentScraperService } = require('./dist/services/scraper/TorrentScraperService');

async function testIntegration() {
    console.log('Testando integração do Starck Filmes...\n');
    
    const scraper = new TorrentScraperService();
    
    console.log('1. Estatísticas do scraper:');
    const stats = scraper.getStats();
    console.log(JSON.stringify(stats, null, 2));
    
    console.log('\n2. Testando busca específica...');
    try {
        const results = await scraper.searchTorrents('Bom Menino', 'movie');
        
        console.log(`\nResultados encontrados: ${results.length}`);
        
        // Filtrar resultados do Starck Filmes
        const starckResults = results.filter(r => r.provider === 'Starck Filmes');
        const popResults = results.filter(r => r.provider === 'Pop Torrent');
        const indexerResults = results.filter(r => r.provider === 'TorrentIndexer');
        
        console.log(`\nDistribuição por provedor:`);
        console.log(`  Starck Filmes: ${starckResults.length}`);
        console.log(`  Pop Torrent: ${popResults.length}`);
        console.log(`  TorrentIndexer: ${indexerResults.length}`);
        
        if (starckResults.length > 0) {
            console.log(`\nPrimeiro resultado do Starck Filmes:`);
            console.log(`  Título: ${starckResults[0].title}`);
            console.log(`  Magnet: ${starckResults[0].magnet.substring(0, 80)}...`);
            console.log(`  Qualidade: ${starckResults[0].quality}`);
        }
        
    } catch (error) {
        console.error('Erro na busca:', error.message);
    }
}

testIntegration();
