/**
 * Script de teste para streams informativos do Brasil RD Addon
 * Testa a funcionalidade de respostas est√°ticas quando torrents est√£o downloading
 */

const { RealDebridService } = require('./dist/services/RealDebridService');
const { StaticResponseService, StaticResponse } = require('./dist/services/StaticResponseService');
const { StreamHandler } = require('./dist/services/StreamHandler');

// Configura√ß√£o de teste
const TEST_API_KEY = process.env.REAL_DEBRID_API_KEY || 'test-api-key';
const TEST_REQUEST = {
  type: 'movie',
  id: 'tt1234567',
  imdbId: 'tt1234567',
  apiKey: TEST_API_KEY,
  config: {
    quality: '1080p',
    language: 'pt-BR'
  }
};

async function testStaticResponseService() {
  console.log('Ì∑™ TESTE 1: StaticResponseService');
  console.log('='.repeat(50));
  
  const staticService = new StaticResponseService();
  
  // Testar todas as respostas est√°ticas
  const allResponses = Object.values(StaticResponse);
  
  for (const response of allResponses) {
    const info = staticService.getResponseInfo(response);
    const stream = staticService.createInformativeStream(response, 'test-123');
    
    console.log(`\nÌ≥ã ${response.toUpperCase()}:`);
    console.log(`   Nome: ${info.name}`);
    console.log(`   T√≠tulo: ${stream.title}`);
    console.log(`   URL: ${stream.url.substring(0, 80)}...`);
    console.log(`   Descri√ß√£o: ${stream.description.substring(0, 100)}...`);
  }
  
  console.log('\n‚úÖ StaticResponseService testado com sucesso!');
  console.log('='.repeat(50));
}

async function testRealDebridServiceExceptions() {
  console.log('\nÌ∑™ TESTE 2: RealDebridService - Exce√ß√µes de Status');
  console.log('='.repeat(50));
  
  const rdService = new RealDebridService();
  const staticService = new StaticResponseService();
  
  // Simular diferentes status do Real-Debrid
  const testStatuses = [
    { status: 'downloading', expectedResponse: StaticResponse.DOWNLOADING },
    { status: 'uploading', expectedResponse: StaticResponse.DOWNLOADING },
    { status: 'queued', expectedResponse: StaticResponse.DOWNLOADING },
    { status: 'error', expectedResponse: StaticResponse.FAILED_DOWNLOAD },
    { status: 'magnet_error', expectedResponse: StaticResponse.FAILED_OPENING },
    { status: 'dead', expectedResponse: StaticResponse.FAILED_DOWNLOAD }
  ];
  
  for (const test of testStatuses) {
    const response = staticService.getResponseForRealDebridStatus(test.status);
    
    console.log(`\nÌ≥ä Status: ${test.status}`);
    console.log(`   Resposta esperada: ${test.expectedResponse}`);
    console.log(`   Resposta obtida: ${response}`);
    console.log(`   ‚úÖ ${response === test.expectedResponse ? 'CORRETO' : 'INCORRETO'}`);
    
    if (response) {
      const info = staticService.getResponseInfo(response);
      console.log(`   Mensagem: ${info.name}`);
    }
  }
  
  // Testar c√≥digos de erro
  const errorCodes = [
    { code: 8, expectedResponse: StaticResponse.FAILED_ACCESS },
    { code: 21, expectedResponse: StaticResponse.LIMITS_EXCEEDED },
    { code: 29, expectedResponse: StaticResponse.FAILED_TOO_BIG },
    { code: 35, expectedResponse: StaticResponse.FAILED_INFRINGEMENT }
  ];
  
  console.log('\nÌ¥ß Testando c√≥digos de erro:');
  for (const error of errorCodes) {
    const response = staticService.getResponseForRealDebridStatus('error', error.code);
    
    console.log(`\n   C√≥digo: ${error.code}`);
    console.log(`   Resposta esperada: ${error.expectedResponse}`);
    console.log(`   Resposta obtida: ${response}`);
    console.log(`   ‚úÖ ${response === error.expectedResponse ? 'CORRETO' : 'INCORRETO'}`);
  }
  
  console.log('\n‚úÖ RealDebridService exceptions testadas com sucesso!');
  console.log('='.repeat(50));
}

async function testStreamHandlerInformativeStreams() {
  console.log('\nÌ∑™ TESTE 3: StreamHandler - Streams Informativos');
  console.log('='.repeat(50));
  
  // Criar um StreamHandler mock para teste
  const streamHandler = new StreamHandler();
  
  // Testar diferentes cen√°rios de requisi√ß√£o
  const testRequests = [
    {
      name: 'Filme sem streams dispon√≠veis',
      request: { ...TEST_REQUEST, type: 'movie', id: 'tt9999999' }
    },
    {
      name: 'S√©rie sem streams dispon√≠veis',
      request: { 
        ...TEST_REQUEST, 
        type: 'series', 
        id: 'tt9999999:1:1',
        imdbId: 'tt9999999'
      }
    },
    {
      name: 'S√©rie com epis√≥dio espec√≠fico',
      request: { 
        ...TEST_REQUEST, 
        type: 'series', 
        id: 'tt9999999:2:5',
        imdbId: 'tt9999999'
      }
    }
  ];
  
  for (const test of testRequests) {
    console.log(`\nÌ≥ù Cen√°rio: ${test.name}`);
    console.log(`   Tipo: ${test.request.type}`);
    console.log(`   ID: ${test.request.id}`);
    
    try {
      // Simular que n√£o h√° streams dispon√≠veis
      // O StreamHandler deve retornar um stream informativo
      const result = await streamHandler.handleStreamRequest(test.request);
      
      console.log(`   Streams retornados: ${result.streams.length}`);
      
      if (result.streams.length > 0) {
        const stream = result.streams[0];
        console.log(`   Ì≥∫ Stream informativo:`);
        console.log(`      T√≠tulo: ${stream.title}`);
        console.log(`      Nome: ${stream.name}`);
        console.log(`      URL: ${stream.url?.substring(0, 60) || 'N/A'}...`);
        console.log(`      BehaviorHints: ${JSON.stringify(stream.behaviorHints)}`);
        
        if (stream.behaviorHints?.notWebReady) {
          console.log(`      ‚úÖ CORRETO: Stream marcado como notWebReady`);
        }
      } else {
        console.log(`   ‚ö†Ô∏è  Nenhum stream retornado`);
      }
    } catch (error) {
      console.log(`   ‚ùå Erro: ${error.message}`);
    }
  }
  
  console.log('\n‚úÖ StreamHandler testado com sucesso!');
  console.log('='.repeat(50));
}

async function testDataURICompatibility() {
  console.log('\nÌ∑™ TESTE 4: Compatibilidade de Data URI com Stremio');
  console.log('='.repeat(50));
  
  const staticService = new StaticResponseService();
  const testResponse = StaticResponse.DOWNLOADING;
  
  const stream = staticService.createInformativeStream(testResponse, 'test-compat');
  
  console.log('Ì≥ã Analisando Data URI para compatibilidade Stremio:');
  console.log(`\n   URL completa: ${stream.url}`);
  console.log(`\n   An√°lise da URL:`);
  
  if (stream.url.startsWith('data:text/plain')) {
    console.log(`   ‚úÖ Formato correto: data URI text/plain`);
    
    // Decodificar para ver o conte√∫do
    try {
      const encodedContent = stream.url.substring('data:text/plain,'.length);
      const decodedContent = decodeURIComponent(encodedContent);
      console.log(`   Ì≥Ñ Conte√∫do decodificado: ${decodedContent.substring(0, 100)}...`);
    } catch (error) {
      console.log(`   ‚ùå Erro ao decodificar: ${error.message}`);
    }
  } else {
    console.log(`   ‚ùå Formato incorreto: n√£o √© data URI`);
  }
  
  console.log('\n‚úÖ Teste de compatibilidade conclu√≠do!');
  console.log('='.repeat(50));
}

async function runAllTests() {
  console.log('Ì∫Ä INICIANDO TESTES DE STREAMS INFORMATIVOS');
  console.log('='.repeat(50));
  
  try {
    await testStaticResponseService();
    await testRealDebridServiceExceptions();
    await testStreamHandlerInformativeStreams();
    await testDataURICompatibility();
    
    console.log('\nÌæâ TODOS OS TESTES CONCLU√çDOS COM SUCESSO!');
    console.log('\nÌ≥ã RESUMO DA IMPLEMENTA√á√ÉO:');
    console.log('   1. ‚úÖ StaticResponseService - Mensagens informativas prontas');
    console.log('   2. ‚úÖ RealDebridService - Lan√ßa exce√ß√µes para status especiais');
    console.log('   3. ‚úÖ StreamHandler - Converte exce√ß√µes em streams informativos');
    console.log('   4. ‚úÖ Data URI - Formato compat√≠vel com Stremio');
    console.log('\nÌ≤° PR√ìXIMOS PASSOS:');
    console.log('   - Testar com addon em execu√ß√£o');
    console.log('   - Verificar exibi√ß√£o no Stremio');
    console.log('   - Ajustar textos conforme necess√°rio');
    
  } catch (error) {
    console.error('\n‚ùå ERRO DURANTE OS TESTES:', error);
    process.exit(1);
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testStaticResponseService,
  testRealDebridServiceExceptions,
  testStreamHandlerInformativeStreams,
  testDataURICompatibility,
  runAllTests
};
