// testWordpressSimple.ts — Teste do WordPressScraper com a nova lógica
// Uso: npm run build && node dist/testWordpressSimple.js "a casa do dragao"

import { WordPressScraper } from './services/scraper/wordpressScraper.js';

async function main() {
  const args = process.argv.slice(2);
  const query = args[0] || 'a casa do dragao';
  const type = 'series';

  console.log(`\n🔍 Testando WordPressScraper para: "${query}"`);
  console.log('═'.repeat(60));

  const scraper = new WordPressScraper();
  const start = Date.now();

  try {
    const results = await scraper.search(query, type);
    const elapsed = Date.now() - start;

    console.log(`✅ Concluído em ${elapsed}ms`);
    console.log(`📦 Total de torrents encontrados: ${results.length}`);

    if (results.length === 0) {
      console.log('⚠️ Nenhum resultado.');
      return;
    }

    // Mostra detalhes dos primeiros 5
    console.log('\n📋 Primeiros resultados:');
    for (let i = 0; i < Math.min(5, results.length); i++) {
      const t = results[i];
      console.log(`\n${i+1}. ${t.title}`);
      console.log(`   🎯 qualidade: ${t.quality} | tamanho: ${t.size} | provider: ${t.provider}`);
      console.log(`   📅 season: ${t.season ?? 'N/A'} | episode: ${t.episode ?? 'N/A'}`);
      console.log(`   📛 canonicalName: ${t.canonicalName ?? 'N/A'}`);
      console.log(`   📝 htmlTitle: ${(t.htmlTitle || '').substring(0, 60)}`);
      if (t.magnet) {
        console.log(`   🔗 magnet: ${t.magnet.substring(0, 80)}...`);
      }
    }

    // Estatísticas rápidas
    const comEpisode = results.filter(t => t.episode !== undefined).length;
    const comHtmlTitle = results.filter(t => t.htmlTitle).length;
    console.log(`\n📊 Estatísticas: ${comEpisode}/${results.length} com episode | ${comHtmlTitle}/${results.length} com htmlTitle`);

  } catch (err) {
    console.error('❌ Erro:', err);
  }
}

main().catch(console.error);