const { StaticResponseService, StaticResponse } = require('./dist/services/StaticResponseService');

const service = new StaticResponseService();

console.log('í·ª Testando sistema de respostas estÃ¡ticas...\n');

// Testar cada resposta
Object.values(StaticResponse).forEach(response => {
    const info = service.getResponseInfo(response);
    console.log(`í³¹ ${response}:`);
    console.log(`   Nome: ${info.name}`);
    console.log(`   URL: ${info.url}`);
    console.log(`   Tipo: ${info.url.endsWith('.mp4') ? 'âœ… VÃ­deo MP4' : 'âŒ NÃ£o Ã© vÃ­deo'}`);
    console.log('');
});

// Testar mapeamento de status do Real-Debrid
console.log('í´„ Testando mapeamento de status do Real-Debrid:');
const testStatuses = [
    'downloading',
    'uploading', 
    'queued',
    'magnet_conversion',
    'waiting_files_selection',
    'error',
    'magnet_error',
    'dead',
    'unknown_status'
];

testStatuses.forEach(status => {
    const response = service.getResponseForRealDebridStatus(status);
    console.log(`   ${status} â†’ ${response || 'null'}`);
});

console.log('\nâœ… Teste concluÃ­do!');
