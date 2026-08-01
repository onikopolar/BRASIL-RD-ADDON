const {BludvScraper} = require('../dist/services/scraper/bludvScraper.js');
const s = new BludvScraper();

async function test(query, type) {
  console.log(`\n🔍 "${query}" (${type}):`);
  const r = await s.search(query, type);
  console.log(`  Total: ${r.length} | DUAL: ${r.filter(t=>t.title.toLowerCase().includes('dual')).length} | rartv/ntb: ${r.filter(t=>t.title.includes('rartv')||t.title.includes('ntb')).length}`);
  if (r.length) {
    // Mostra variedade de títulos
    const titles = [...new Set(r.map(t=>t.title.substring(0,70)))];
    console.log(`  Únicos: ${titles.length}`);
    titles.slice(0, 5).forEach(t => console.log(`    ${t}`));
  }
}

(async () => {
  await test('Matrix', 'movie');
  await test('Vingadores', 'movie');
  await test('Breaking Bad', 'series');
  await test('Game of Thrones', 'series');
  console.log('');
})();

