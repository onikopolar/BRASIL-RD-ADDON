// Teste: verifica originalTitle + exclusão de legendados no WordPress/Comando scraper
// Uso: npx tsx scripts/test-comando-scraper.ts "matrix"
import { WordPressScraper } from '../src/services/scraper/wordpressScraper.js';

async function main() {
  const scraper = new WordPressScraper();
  const query = process.argv[2] || 'matrix';

  console.log(`\n🔍 Buscando "${query}" no Comando/Starck...\n`);

  const results = await scraper.search(query, 'movie');

  console.log(`📊 Total de resultados: ${results.length}\n`);

  let dualCount = 0;
  let legendadoCount = 0;

  for (let i = 0; i < Math.min(results.length, 12); i++) {
    const r = results[i];
    const isLegendado = /legendado|legendada/i.test(r.title);
    if (isLegendado) legendadoCount++; else dualCount++;
    const icon = isLegendado ? '⚠️ LEGENDADO' : '✅ DUAL';
    console.log(`─── ${i + 1} [${icon}] ${r.provider} ───`);
    console.log(`  title:         ${r.title?.substring(0, 80) || '(vazio)'}`);
    console.log(`  originalTitle: ${r.originalTitle || '❌ NÃO EXTRAÍDO'}`);
    console.log(`  quality:       ${r.quality}`);
    console.log(`  language:      ${r.language}`);
    console.log(`  size:          ${r.size}`);
    console.log('');
  }

  const comOriginalTitle = results.filter(r => r.originalTitle);
  const semOriginalTitle = results.filter(r => !r.originalTitle);

  console.log(`\n📈 Estatísticas:`);
  console.log(`  ✅ DUAL:              ${dualCount}`);
  console.log(`  ⚠️ LEGENDADO:         ${legendadoCount}`);
  console.log(`  Com originalTitle:    ${comOriginalTitle.length}`);
  console.log(`  Sem originalTitle:    ${semOriginalTitle.length}`);
  
  if (legendadoCount > 0) {
    console.log(`\n❌ ALERTA: ${legendadoCount} magnets LEGENDADO vazando!`);
  } else {
    console.log(`\n✅ Nenhum magnet LEGENDADO — filtro funcionando!`);
  }
}

main().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
