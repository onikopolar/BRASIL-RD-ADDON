// debug-salvamento.js
const { StreamHandler } = require('./dist/services/StreamHandler');

async function debugSalvamento() {
  console.log('Ì¥ç DEBUGANDO SALVAMENTO NO FLUXO REAL\n');
  
  // Criar handler com logs extras
  const handler = new StreamHandler();
  
  // Adicionar log no saveValidTorrentsToCatalog
  const originalSave = handler.saveValidTorrentsToCatalog;
  handler.saveValidTorrentsToCatalog = async function(...args) {
    console.log('Ì≤æ SAVEVALIDTORRENTSTOCATALOG CHAMADO!');
    console.log('   validTorrents:', args[0]?.length || 0);
    console.log('   requestId:', args[1]?.id);
    
    try {
      const result = await originalSave.apply(this, args);
      console.log('‚úÖ saveValidTorrentsToCatalog COMPLETADO');
      return result;
    } catch (error) {
      console.error('‚ùå ERRO:', error.message);
      throw error;
    }
  };
  
  // Adicionar log no AutoMagnetService
  const { AutoMagnetService } = require('./dist/services/AutoMagnetService');
  const originalAutoAdd = AutoMagnetService.prototype.autoAddMagnet;
  
  AutoMagnetService.prototype.autoAddMagnet = async function(...args) {
    console.log('ÌæØ AUTOMAGNETSERVICE.AUTOADDMAGNET CHAMADO!');
    console.log('   t√≠tulo:', args[1]);
    console.log('   season:', args[7]);
    console.log('   episode:', args[8]);
    
    try {
      const result = await originalAutoAdd.apply(this, args);
      console.log('‚úÖ autoAddMagnet resultado:', {
        success: result.success,
        magnetAdded: result.magnetAdded,
        reason: result.message
      });
      return result;
    } catch (error) {
      console.error('‚ùå ERRO no autoAddMagnet:', error.message);
      throw error;
    }
  };
  
  // Fazer uma busca
  const request = {
    id: 'tt0944947:8:4',
    type: 'series',
    apiKey: 'test',
    imdbId: 'tt0944947'
  };
  
  console.log('\nÌ∫Ä Executando busca...');
  
  try {
    const resultado = await handler.handleStreamRequest(request);
    console.log('\nÌ≥¶ Resultado final:', resultado.streams.length, 'streams');
    
    if (resultado.streams.length > 0) {
      console.log('Primeiro stream:', resultado.streams[0].title);
    }
  } catch (error) {
    console.error('‚ùå Erro geral:', error.message);
  }
  
  console.log('\nÌ¥ç VERIFICA√á√ÉO:');
  console.log('Se N√ÉO viu "SAVEVALIDTORRENTSTOCATALOG CHAMADO!" ent√£o o problema √© que');
  console.log('o m√©todo N√ÉO est√° sendo chamado no fluxo real!');
}

debugSalvamento();
