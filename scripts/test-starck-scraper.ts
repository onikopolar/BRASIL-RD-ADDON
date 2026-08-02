// Teste: verifica originalTitle + exclusão de legendados no Starck scraper
// Uso: npx tsx scripts/test-starck-scraper.ts "matrix"
import { searchStarck } from '../src/services/scraper/starckScraper.js';

async function main() {
  const query = process.argv[2] || 'matrix';
  console.log(`\n🔍 Buscando "${query}" no Starck...\n`);

  const results = await searchStarck(query, 'movie');

  console.log(`📊 Total de resultados: ${results.length}\n`);

  let dualCount = 0;
  let legendadoCount = 0;

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const r = results[i];
    const dnMatch = r.magnet.match(/dn=([^&]+)/i);
    const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : '?';
    const isLegendado = /legendado|legendada/i.test(dn);
    if (isLegendado) legendadoCount++; else dualCount++;
    const icon = isLegendado ? '⚠️ LEGENDADO' : '✅ DUAL';
    console.log(`─── ${i + 1} [${icon}] ───`);
    console.log(`  dn:            ${dn.substring(0, 80)}`);
    console.log(`  originalTitle: ${r.originalTitle || '❌ NÃO EXTRAÍDO'}`);
    console.log('');
  }

  const comOriginalTitle = results.filter(r => r.originalTitle);

  console.log(`\n📈 Estatísticas:`);
  console.log(`  ✅ DUAL:              ${dualCount}`);
  console.log(`  ⚠️ LEGENDADO:         ${legendadoCount}`);
  console.log(`  Com originalTitle:    ${comOriginalTitle.length}`);
  
  if (legendadoCount > 0) {
    console.log(`\n❌ ALERTA: ${legendadoCount} magnets LEGENDADO vazando!`);
  } else {
    console.log(`\n✅ Nenhum magnet LEGENDADO — filtro funcionando!`);
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
