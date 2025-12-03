const { StreamHandler } = require('./dist/services/StreamHandler');

async function monitorarSalvamentoSeries() {
  console.log('Ì¥ç MONITORANDO SALVAMENTO DE S√âRIES\n');
  
  const handler = new StreamHandler();
  
  // Interceptar saveValidTorrentsToCatalog
  const originalSave = handler.saveValidTorrentsToCatalog;
  
  handler.saveValidTorrentsToCatalog = async function(validTorrents, request, episodeInfo) {
    console.log('\nÌ≥• SALVANDO TORRENTS NO CAT√ÅLOGO');
    console.log('===============================');
    console.log('Request ID:', request.id);
    console.log('Request Type:', request.type);
    console.log('Episode Info:', {
      season: episodeInfo.season,
      episode: episodeInfo.episode,
      isValid: episodeInfo.isValid
    });
    
    // Extrair IMDb ID
    const imdbId = this.extractImdbIdFromRequest(request);
    console.log('IMDb ID extra√≠do:', imdbId);
    
    console.log('\nTorrents v√°lidos:');
    validTorrents.forEach((torrent, i) => {
      console.log(`\n[${i + 1}] ${torrent.title}`);
      console.log(`   Seeds: ${torrent.seeders}, Quality: ${torrent.quality}`);
      
      // Extrair metadados do t√≠tulo
      const metadata = this.titleFilter.extractSeriesMetadata(torrent.title);
      console.log(`   Metadados extra√≠dos: S${metadata.season || '?'}E${metadata.episode || '?'}`);
      console.log(`   HasEpisodeInfo: ${metadata.hasEpisodeInfo}`);
      
      // O que ser√° salvo?
      const seasonToSave = episodeInfo.isValid ? episodeInfo.season : metadata.season;
      const episodeToSave = episodeInfo.isValid ? episodeInfo.episode : metadata.episode;
      console.log(`   Ser√° salvo como: S${seasonToSave || '?'}E${episodeToSave || '?'}`);
      console.log(`   (Usando: ${episodeInfo.isValid ? 'episodeInfo' : 'metadata'})`);
    });
    
    console.log('\n' + '='.repeat(50) + '\n');
    
    // Chamar m√©todo original
    return originalSave.call(this, validTorrents, request, episodeInfo);
  };
  
  // Interceptar autoAddMagnet
  const { AutoMagnetService } = require('./dist/services/AutoMagnetService');
  const originalAutoAdd = AutoMagnetService.prototype.autoAddMagnet;
  
  AutoMagnetService.prototype.autoAddMagnet = async function(...args) {
    console.log('\nÌ∑≤ AUTO ADD MAGNET CHAMADO');
    console.log('==========================');
    console.log('T√≠tulo:', args[1]);
    console.log('IMDb ID:', args[2]);
    console.log('Tipo:', args[3]);
    console.log('Season:', args[7]);
    console.log('Episode:', args[8]);
    
    const result = await originalAutoAdd.apply(this, args);
    
    console.log('Resultado:', {
      success: result.success,
      magnetAdded: result.magnetAdded,
      message: result.message
    });
    
    return result;
  };
  
  console.log('Monitoramento ativado!');
  console.log('O handler agora vai logar todos os salvamentos de s√©ries.');
  
  return handler;
}

// Teste com exemplo
async function testarExemplo() {
  const handler = await monitorarSalvamentoSeries();
  
  // Simular uma requisi√ß√£o
  const request = {
    type: 'series',
    id: 'tt0903747:1:1', // Breaking Bad S01E01
    imdbId: 'tt0903747',
    title: 'Breaking Bad'
  };
  
  const episodeInfo = handler.episodeMatcher.extractEpisodeFromRequest(request.id);
  
  const torrentsSimulados = [
    {
      title: 'Breaking Bad S01E01 1080p WEB-DL',
      magnet: 'magnet:?xt=urn:btih:TEST123',
      seeders: 50,
      quality: '1080p'
    },
    {
      title: 'Breaking Bad Temporada 1 Episodio 1 HD',
      magnet: 'magnet:?xt=urn:btih:TEST456',
      seeders: 30,
      quality: '720p'
    },
    {
      title: 'Breaking Bad 1x01 720p', // Formato diferente
      magnet: 'magnet:?xt=urn:btih:TEST789',
      seeders: 25,
      quality: '720p'
    }
  ];
  
  console.log('\nÌ∑™ TESTANDO COM EXEMPLO SIMULADO');
  console.log('=================================\n');
  
  await handler.saveValidTorrentsToCatalog(torrentsSimulados, request, episodeInfo);
}

if (require.main === module) {
  testarExemplo().catch(console.error);
}

module.exports = { monitorarSalvamentoSeries };
