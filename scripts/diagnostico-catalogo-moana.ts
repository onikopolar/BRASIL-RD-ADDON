// Diagnóstico: qual IMDB o catálogo retorna pra "Moana"?
import 'dotenv/config';

const OMDB_KEY = process.env.OMDB_API_KEY;
const TMDB_KEY = process.env.TMDB_API_KEY;

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 CATÁLOGO: busca "Moana"');
  console.log('═══════════════════════════════════════════\n');

  // 1. OMDb search
  console.log('📡 1. OMDb search "Moana":');
  if (OMDB_KEY) {
    try {
      const url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&s=Moana&type=movie`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.Search) {
        for (const m of data.Search) {
          console.log(`   ${m.imdbID} | ${m.Year} | ${m.Title}`);
        }
      } else {
        console.log('   Nenhum resultado:', JSON.stringify(data));
      }
    } catch (e: any) {
      console.log('   ❌', e.message);
    }
  } else {
    console.log('   ⚠️ OMDB_API_KEY não configurada');
  }

  // 2. TMDB search
  console.log('\n📡 2. TMDB search "Moana" (pt-BR):');
  if (TMDB_KEY) {
    try {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=Moana&language=pt-BR`;
      const r = await fetch(url);
      const data = await r.json();
      if (data.results) {
        for (const m of data.results.slice(0, 5)) {
          // Pega o IMDB ID via external_ids
          const extUrl = `https://api.themoviedb.org/3/movie/${m.id}/external_ids?api_key=${TMDB_KEY}`;
          const extR = await fetch(extUrl);
          const extData = await extR.json();
          console.log(`   ${extData.imdb_id || 'N/A'} | ${m.release_date?.substring(0,4) || '?'} | ${m.title} (${m.original_title}) | TMDB:${m.id}`);
        }
      }
    } catch (e: any) {
      console.log('   ❌', e.message);
    }
  }

  // 3. OMDb detail do tt27419466
  console.log('\n📡 3. OMDb detail tt27419466:');
  if (OMDB_KEY) {
    try {
      const url = `https://www.omdbapi.com/?apikey=${OMDB_KEY}&i=tt27419466`;
      const r = await fetch(url);
      const data = await r.json();
      console.log(JSON.stringify({
        Title: data.Title,
        Year: data.Year,
        Type: data.Type,
        Genre: data.Genre,
        Director: data.Director,
        Plot: data.Plot?.substring(0, 100),
      }, null, 2));
    } catch (e: any) {
      console.log('   ❌', e.message);
    }
  }

  console.log('\n✅ Concluído');
}

main().catch(console.error);
