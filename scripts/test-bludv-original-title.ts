// Teste: verifica se o BludvScraper extrai "Título Original" do HTML do post
// Uso: npx tsx scripts/test-bludv-original-title.ts

import { BludvScraper } from '../src/services/scraper/bludvScraper.js';

async function main() {
  const scraper = new BludvScraper();
  const query = process.argv[2] || 'matrix';

  console.log(`\n🔍 Buscando "${query}" no BLUDV...\n`);

  const results = await scraper.search(query, 'movie');

  console.log(`📊 Total de resultados: ${results.length}\n`);

  for (let i = 0; i < Math.min(results.length, 10); i++) {
    const r = results[i];
    const isLegendado = /legendado|legendada/i.test(r.title);
    const icon = isLegendado ? '⚠️ LEGENDADO' : '✅ DUAL';
    console.log(`─── Resultado ${i + 1} [${icon}] ───`);
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
  console.log(`  Com originalTitle:    ${comOriginalTitle.length}`);
  console.log(`  Sem originalTitle:    ${semOriginalTitle.length}`);
  
  if (comOriginalTitle.length > 0) {
    console.log(`\n✅ Títulos originais extraídos:`);
    comOriginalTitle.forEach(r => {
      console.log(`  "${r.title?.substring(0, 50)}..." → originalTitle: "${r.originalTitle}"`);
    });
  }
  
  if (semOriginalTitle.length > 0 && results.length > 0) {
    console.log(`\n⚠️  Resultados SEM originalTitle (possível problema no regex):`);
    semOriginalTitle.forEach(r => {
      console.log(`  "${r.title?.substring(0, 80)}"`);
    });
  }
}

main().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
