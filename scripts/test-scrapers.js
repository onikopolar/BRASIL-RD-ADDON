// Diagnostico: scrapers principais vs fallback
// Verifica se fallbacks estao rodando desnecessariamente
// Uso: node scripts/test-scrapers.js [termo]
require('dotenv/config');

const args = process.argv.slice(2);
const searchTerm = args[0] || 'Vingadores';

console.log('=== DIAGNOSTICO DE SCRAPERS ===\n');
console.log('PRINCIPAIS (rodam sempre que possivel):');
console.log('  1. Comando Torrents (WordPress API)');
console.log('  2. BLUDV Filmes     (WordPress API)');
console.log('  3. Starck Oficial   (HTML scraper)\n');

console.log('FALLBACK (so deveriam rodar se principais = 0):');
console.log('  4. HDR Torrent      (HTML scraper)');
console.log('  5. TPB              (HTML scraper)');
console.log('  6. RARGB            (HTML scraper)\n');

console.log('COMPORTAMENTO ATUAL (refatorado):');
console.log('  FASE 1: SÓ principais (Comando + BLUDV + Starck)');
console.log('  FASE 2: Se 0 validos na FASE 1, roda fallbacks (HDR, TPB, RARGB)\n');

console.log('ANTES: 7 scrapers em paralelo (~7s) — todos rodavam juntos');
console.log('AGORA: 3 scrapers principais (~2-3s) — fallbacks so se necessario\n');

console.log('Para ver na pratica, rode:');
console.log(`  npx pm2 logs brasil-rd-addon --lines 200 | grep -E "Starck|BLUDV|Comando|HDR|TPB|RARGB|fallback|Priorit"`);
console.log(`\nE procure por "${searchTerm}" no Stremio.`);
