import axios from 'axios';

const CAT_SERIES = 43;
const CAT_FILMES = 38;
const BASE = 'https://comando1.com';

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
};

const queries = [
  { q: 'modern family', cat: CAT_SERIES },
  { q: 'familia moderna', cat: CAT_SERIES },
  { q: 'modern family 9ª temporada', cat: CAT_SERIES },
  { q: 'familia moderna 9ª temporada', cat: CAT_SERIES },
  { q: 'modern family', cat: CAT_FILMES },
];

(async () => {
  for (const { q, cat } of queries) {
    const url = `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=20&_fields=id,title&categories=${cat}`;

    console.log(`\n${'='.repeat(70)}`);
    console.log(`QUERY: "${q}" | cat=${cat} (${cat === CAT_SERIES ? 'SERIES' : 'FILMES'})`);
    console.log(`${'='.repeat(70)}`);

    try {
      const r = await axios.get(url, { timeout: 15000, headers });
      const posts = r.data;

      if (!Array.isArray(posts) || posts.length === 0) {
        console.log(`  → 0 resultados`);
        continue;
      }

      console.log(`  → ${posts.length} resultados:`);
      for (const p of posts) {
        const titulo = (p.title?.rendered || '').replace(/<[^>]+>/g, '').trim();
        console.log(`     [${p.id}] ${titulo.substring(0, 90)}`);
      }
    } catch (err) {
      console.log(`  → ERRO: ${err.response?.status || ''} ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 500));
  }

  console.log('\n');
})();
