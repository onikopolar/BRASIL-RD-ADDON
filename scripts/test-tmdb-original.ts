/**
 * Testa TMDB original_title/original_name fallback
 * Uso: npx tsx scripts/test-tmdb-original.ts
 */

import 'dotenv/config';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';

async function main() {
  const scraper = ImdbScraperService.getInstance();

  const tests = [
    { imdbId: 'tt39245629', label: 'O Espantalho (TV)' },
    { imdbId: 'tt5476182', label: 'Hellraiser Judgment (movie)' },
    { imdbId: 'tt0090605', label: 'Aliens (movie)' },
  ];

  for (const { imdbId, label } of tests) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`🔬 ${label} (${imdbId})`);
    
    const result = await scraper.getTitlesFromImdbId(imdbId);
    if (!result) {
      console.log('   ❌ null');
      continue;
    }
    console.log(`   originalTitle:   "${result.originalTitle}"`);
    console.log(`   portugueseTitle:  "${result.portugueseTitle}"`);
    console.log(`   year:             ${result.year}`);
    console.log(`   mediaType:        ${result.mediaType}`);
    console.log(`   allTitles:        [${result.allTitles.join(', ')}]`);
    
    const empty = !result.originalTitle;
    console.log(`   originalTitle vazio? ${empty ? '❌ SIM (bug!)' : '✅ OK'}`);
  }
}

main().catch(console.error);
