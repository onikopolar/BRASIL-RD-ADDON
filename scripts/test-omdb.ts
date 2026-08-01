/**
 * Testa OMDB + IMDb fallback para um IMDB ID
 * Uso: npx tsx scripts/test-omdb.ts tt43595399
 */

import 'dotenv/config';
import axios from 'axios';

const imdbId = process.argv[2] || 'tt43595399';

async function testOmdb() {
  const key = process.env.OMDB_API_KEY || 'trilogy';
  console.log(`🔬 OMDB (${key.substring(0,4)}...):`);
  try {
    const r = await axios.get(`http://www.omdbapi.com/?i=${imdbId}&apikey=${key}`, { timeout: 10000, headers: { 'User-Agent': 'BrasilRD/1.0' } });
    console.log('   ', r.data.Response === 'True' ? `✅ "${r.data.Title}" (${r.data.Year}) [${r.data.Type}]` : `❌ ${r.data.Error}`);
  } catch (e: any) { console.log('   ❌', e.message); }
}

async function testTmdbFind() {
  console.log(`\n🔬 TMDB Find direto:`);
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) { console.log('   ⚠️  TMDB_API_KEY não configurada'); return; }
  try {
    const r = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, { params: { api_key: apiKey, external_source: 'imdb_id' }, timeout: 10000 });
    const m = r.data?.movie_results?.[0];
    const t = r.data?.tv_results?.[0];
    if (m) console.log(`   ✅ movie: "${m.title}" (${m.release_date?.substring(0,4)}) id=${m.id}`);
    else if (t) console.log(`   ✅ tv: "${t.name}" (${t.first_air_date?.substring(0,4)}) id=${t.id}`);
    else console.log('   ❌ Nenhum resultado');
  } catch (e: any) { console.log('   ❌', e.message); }
}

async function testFullPipeline() {
  console.log(`\n🔬 Pipeline completo:`);
  const { getTmdbTitlesViaHtml } = await import('../src/catalogo/TmdbHtmlScraper.js');
  const result = await getTmdbTitlesViaHtml(imdbId);
  if (result) {
    console.log(`   ✅ "${result.originalTitle}" PT="${result.portugueseTitle}" [${result.mediaType}] year=${result.year}`);
    console.log(`   allTitles: [${result.allTitles.join(', ')}]`);
  } else {
    console.log('   ❌ Pipeline falhou completamente');
  }
}

(async () => {
  await testOmdb();
  await testTmdbFind();
  await testFullPipeline();
})();
