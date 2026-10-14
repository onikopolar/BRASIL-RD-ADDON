import { WordPressScraper, wpNegativeStats, wpNegativeClear } from '../dist/services/scraper/wordpressScraper.js';

const scraper = new WordPressScraper();
wpNegativeClear();

console.log('\n=== 1ª busca (deve bater no site) ===');
const t0 = Date.now();
const r1 = await scraper.search('goodbye lara 1ª temporada', 'series', 1);
console.log(`resultados=${r1.length} em ${Date.now() - t0}ms`);

console.log('\n=== 2ª busca (deve ser cache hit) ===');
const t1 = Date.now();
const r2 = await scraper.search('goodbye lara 1ª temporada', 'series', 1);
console.log(`resultados=${r2.length} em ${Date.now() - t1}ms`);

console.log('\n=== Stats do cache ===');
console.log(JSON.stringify(wpNegativeStats(), null, 2));
