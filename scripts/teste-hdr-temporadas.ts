import { searchHdr } from '../src/services/scraper/hdrScraper.js';

async function main() {
const r = await searchHdr('doctor who');

// Filtra os magnets do post "todas as temporadas" (tem S01-S09, 1-9temporada no nome)
const todas = r.filter(m => {
  const t = (m.magnet + m.title).toLowerCase();
  return /s0[1-9]|1temporada|2temporada|3temporada|4temporada|5temporada|6temporada|7temporada|8temporada|9temporada/.test(t);
});

console.log('📦 Magnets do post "todas as temporadas":', todas.length);
for (const m of todas) {
  const dn = decodeURIComponent((m.magnet.match(/dn=([^&]+)/)?.[1] || '???')).substring(0, 80);
  console.log(`   ${dn}`);
  console.log(`   Idioma: ${m.language} | Qualidade: ${m.size}`);
}
console.log(`\n📊 Total geral HDR: ${r.length} magnets`);
}

main().catch(console.error);
