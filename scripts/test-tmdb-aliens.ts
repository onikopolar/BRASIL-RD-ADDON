/**
 * Testa o que o TmdbHtmlScraper retorna para tt0090605 (Aliens)
 * Uso: npx tsx scripts/test-tmdb-aliens.ts
 */

import { getTmdbTitlesViaHtml } from '../src/catalogo/TmdbHtmlScraper.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';

async function main() {
  console.log('═'.repeat(70));
  console.log('🔬 TESTE: Pipeline COMPLETO SimilarityCalculator para Aliens');
  console.log('═'.repeat(70));

  const calc = SimilarityCalculator.getInstance();

  const testTorrents = [
    'Aliens.O.Resgate.Versão.Estendida.1986.BluRay.1080p.x264.DUAL.2.0-SF',
    'Cowboys & Aliens (2011) BDRip 1080p Dublado ToTTi9',
    'Alien - Romulus 2024 WEB-DL 1080p x264 DUAL 5.1',
  ];

  for (const torrent of testTorrents) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`📥 "${torrent}"`);
    
    const result = await calc.smartTitleContainsCheck(torrent, 'tt0090605');
    
    console.log(`   matches:   ${result.matches}`);
    console.log(`   similarity: ${result.similarity}`);
    console.log(`   reason:    "${result.reason}"`);
    console.log(`   mediaType: ${result.mediaType || 'N/A'}`);
  }
}

main().catch(console.error);
