// Diagnóstico: Moana 2 (tt27419466) — por que year=2026?
import 'dotenv/config';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';

async function main() {
  const imdb = ImdbScraperService.getInstance();
  
  console.log('═══════════════════════════════════════════');
  console.log('🔍 DIAGNÓSTICO: Moana 2 (tt27419466)');
  console.log('═══════════════════════════════════════════\n');

  // 1. Busca direta no TMDB (com API key)
  console.log('📡 1. TMDB API (com API key):');
  const apiKey = process.env.TMDB_API_KEY;
  console.log(`   TMDB_API_KEY presente: ${!!apiKey}`);
  if (apiKey) console.log(`   TMDB_API_KEY preview: ${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`);

  try {
    // Buscar pelo IMDB ID
    const result = await imdb.getTitlesFromImdbId('tt27419466');
    console.log('\n📊 Resultado TMDB:');
    console.log(JSON.stringify({
      originalTitle: result.originalTitle,
      portugueseTitle: result.portugueseTitle,
      year: result.year,
      mediaType: result.mediaType,
      allTitles: result.allTitles,
    }, null, 2));
  } catch (e: any) {
    console.log('   ❌ Erro:', e.message);
  }

  // 2. Busca direta na API do TMDB (raw)
  console.log('\n📡 2. TMDB API raw (busca por IMDB ID):');
  try {
    const url = `https://api.themoviedb.org/3/find/tt27419466?api_key=${apiKey}&external_source=imdb_id&language=pt-BR`;
    const response = await fetch(url);
    const data = await response.json();
    console.log('   movie_results:', JSON.stringify(data.movie_results?.map((m: any) => ({
      id: m.id,
      title: m.title,
      original_title: m.original_title,
      release_date: m.release_date,
      overview: m.overview?.substring(0, 80)
    })), null, 2));
    console.log('   tv_results:', JSON.stringify(data.tv_results?.map((m: any) => ({
      id: m.id,
      name: m.name,
      original_name: m.original_name,
      first_air_date: m.first_air_date
    })), null, 2));
  } catch (e: any) {
    console.log('   ❌ Erro:', e.message);
  }

  // 3. Detalhes do filme pelo TMDB ID
  console.log('\n📡 3. TMDB movie details (pt-BR):');
  try {
    // Primeiro pega o tmdbId
    const findUrl = `https://api.themoviedb.org/3/find/tt27419466?api_key=${apiKey}&external_source=imdb_id`;
    const findResp = await fetch(findUrl);
    const findData = await findResp.json();
    const tmdbId = findData.movie_results?.[0]?.id;
    
    if (tmdbId) {
      const detailUrl = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&language=pt-BR`;
      const detailResp = await fetch(detailUrl);
      const detailData = await detailResp.json();
      console.log(JSON.stringify({
        id: detailData.id,
        title: detailData.title,
        original_title: detailData.original_title,
        release_date: detailData.release_date,
        status: detailData.status,
        belongs_to_collection: detailData.belongs_to_collection
      }, null, 2));
    }
  } catch (e: any) {
    console.log('   ❌ Erro:', e.message);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ Diagnóstico concluído');
}

main().catch(console.error);
