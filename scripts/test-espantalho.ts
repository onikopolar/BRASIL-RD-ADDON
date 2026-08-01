/**
 * Testa pipeline completo para O Espantalho
 * Uso: npx tsx scripts/test-espantalho.ts
 */

import 'dotenv/config';
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService.js';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';

async function main() {
  const imdbId = 'tt39245629';
  console.log('═'.repeat(70));
  console.log(`🔬 Pipeline completo: O Espantalho (${imdbId})`);
  console.log('═'.repeat(70));

  // 1. TMDB
  const tmdb = ImdbScraperService.getInstance();
  const titles = await tmdb.getTitlesFromImdbId(imdbId);
  if (!titles) { console.log('❌ Sem dados TMDB'); return; }

  console.log(`\n📋 TMDB:`);
  console.log(`   originalTitle:   "${titles.originalTitle}"`);
  console.log(`   portugueseTitle:  "${titles.portugueseTitle}"`);
  console.log(`   portugueseRaw:    "${titles.portugueseTitleRaw}"`);
  console.log(`   allTitles:        [${titles.allTitles.join(', ')}]`);
  console.log(`   year:             ${titles.year}`);
  console.log(`   mediaType:        ${titles.mediaType}`);

  // 2. Scraping
  console.log(`\n🔍 Scraping...`);
  const scraper = new TorrentScraperService();
  const results = await scraper.searchTorrents(
    titles.allTitles[titles.allTitles.length - 1], // PT primeiro
    titles.mediaType || 'tv',
    1, // season 1
    titles.year,
    imdbId
  );

  console.log(`\n📊 ${results.length} magnets encontrados`);
  if (results.length > 0) {
    const byProvider: Record<string, number> = {};
    for (const r of results) byProvider[r.provider] = (byProvider[r.provider] || 0) + 1;
    console.log('   Providers:', JSON.stringify(byProvider));
    console.log('\n   Amostra (primeiros 5):');
    for (const r of results.slice(0, 5)) {
      console.log(`   [${r.provider}] ${r.title?.substring(0, 80)}`);
    }
  }
}

main().catch(console.error);
