const { StreamHandler } = require('./dist/services/StreamHandler');

async function debugSeriesRequest() {
  console.log('��� DEBUGANDO REQUISIÇÕES DE SÉRIES\n');
  
  const handler = new StreamHandler();
  
  // Monkey patch para interceptar chamadas
  const originalHandle = handler.handle;
  
  handler.handle = async function(request) {
    console.log('��� REQUEST RECEBIDO:');
    console.log('   Tipo:', request.type);
    console.log('   ID:', request.id);
    console.log('   IMDb ID:', request.imdbId);
    console.log('   Título:', request.title);
    
    // Extrair info do episódio
    const episodeInfo = this.episodeMatcher.extractEpisodeFromRequest(request.id);
    console.log('   Info Episódio:', {
      season: episodeInfo.season,
      episode: episodeInfo.episode,
      isValid: episodeInfo.isValid
    });
    
    // Verificar formato do ID
    const hasSeasonEpisode = request.id.match(/tt\d+:(\d+):(\d+)/);
    console.log('   Formato correto?:', hasSeasonEpisode ? 'SIM' : 'NÃO');
    
    console.log('---\n');
    
    // Chamar método original
    return originalHandle.call(this, request);
  };
  
  console.log('Handler pronto para interceptar requisições.');
  console.log('Inicie o servidor e faça uma requisição de série para ver os logs.\n');
  
  return handler;
}

// Testar com um exemplo
async function testExample() {
  console.log('��� TESTANDO EXEMPLOS:\n');
  
  const handler = new StreamHandler();
  const matcher = handler.episodeMatcher;
  
  const testRequests = [
    { type: 'series', id: 'tt1234567:1:5', title: 'Série Teste S01E05' },
    { type: 'series', id: 'tt1234567', title: 'Série Teste sem episódio' },
    { type: 'movie', id: 'tt9876543', title: 'Filme Teste' }
  ];
  
  for (const req of testRequests) {
    console.log(`Teste: ${req.title}`);
    console.log(`ID: ${req.id}`);
    
    const episodeInfo = matcher.extractEpisodeFromRequest(req.id);
    console.log(`Episódio: S${episodeInfo.season}E${episodeInfo.episode}, Válido: ${episodeInfo.isValid}`);
    
    const imdbMatch = req.id.match(/^(tt\d+)/);
    console.log(`IMDb ID extraído: ${imdbMatch ? imdbMatch[1] : 'NÃO'}`);
    
    console.log('---\n');
  }
}

if (require.main === module) {
  testExample().then(() => {
    console.log('\nPara debug em tempo real, execute:');
    console.log('const debug = require("./debug_series_request");');
    console.log('const handler = await debug.debugSeriesRequest();');
    console.log('// Use o handler no seu servidor');
  });
}

module.exports = { debugSeriesRequest, StreamHandler };
