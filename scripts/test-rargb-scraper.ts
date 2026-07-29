import { searchRargb } from '../src/services/scraper/rargbScraper';

async function main() {
  console.log('=== rargbScraper module test ===\n');

  const results = await searchRargb('impuros', 'series');
  console.log(`Resultados: ${results.length}\n`);
  results.forEach((t, i) => {
    console.log(`${i + 1}. ${t.title.substring(0, 70)}`);
    console.log(`   infoHash: ${t.infoHash}  S:${t.seeders} L:${t.leechers}  ${t.size}`);
  });
}
main().catch(e => { console.error(e); process.exit(1); });
