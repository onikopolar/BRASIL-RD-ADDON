/**
 * test-wp-legendado.ts
 * Testa o filtro anti-legendado do WordPress Scraper
 * Uso: npx tsx scripts/test-wp-legendado.ts
 */
import 'dotenv/config';
import { WordPressScraper } from '../src/services/scraper/wordpressScraper.js';

async function main() {
  const scraper = new WordPressScraper();
  
  const testes = [
    { query: 'A Queda', type: 'movie' as const, desc: 'Filme: A Queda (Fall 2022)' },
    { query: 'Trem Bala', type: 'movie' as const, desc: 'Filme: Trem Bala (Bullet Train)' },
  ];

  for (const { query, type, desc } of testes) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`🔍 TESTE: ${desc}`);
    console.log(`   Query: "${query}" | Tipo: ${type}`);
    console.log(`${'='.repeat(70)}\n`);

    const results = await scraper.search(query, type);
    
    // Agrupa por provider
    const byProvider = new Map<string, typeof results>();
    for (const r of results) {
      if (!byProvider.has(r.provider)) byProvider.set(r.provider, []);
      byProvider.get(r.provider)!.push(r);
    }

    for (const [provider, torrents] of byProvider) {
      console.log(`\n📦 ${provider}: ${torrents.length} magnets`);
      
      // Separa por idioma
      const dual = torrents.filter(t => /dual|dublado|dublad/i.test(t.language));
      const legendado = torrents.filter(t => !/dual|dublado|dublad/i.test(t.language));
      
      console.log(`   Dual/Dublado: ${dual.length}`);
      dual.slice(0, 5).forEach(t => {
        console.log(`      ✅ [${t.quality}] ${t.title.substring(0, 80)} | ${t.language}`);
      });
      
      console.log(`   Legendado/Outros: ${legendado.length}`);
      legendado.slice(0, 3).forEach(t => {
        console.log(`      ❌ (FILTRADO?) [${t.quality}] ${t.title.substring(0, 80)} | ${t.language}`);
      });
      
      if (legendado.length === 0) {
        console.log(`   🎉 NENHUM legendado — filtro funcionando!`);
      } else if (legendado.length > 0) {
        console.log(`   ⚠️ ${legendado.length} legendados passaram — verificar filtro`);
      }
    }

    if (results.length === 0) {
      console.log(`\n   ❌ NENHUM resultado encontrado`);
    }
    console.log(`\n   Total geral: ${results.length} magnets\n`);
  }
}

main().catch(console.error);
