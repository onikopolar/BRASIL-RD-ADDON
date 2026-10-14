import axios from 'axios';

const BASE = 'https://comando1.com';
const CAT_SERIES = 43;

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

(async () => {
  const q = 'modern family 9ª temporada';

  console.log(`Query: "${q}"\n`);

  for (const perPage of [20, 100]) {
    const url = `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(q)}&per_page=${perPage}&_fields=id,title&categories=${CAT_SERIES}`;
    const r = await axios.get(url, { headers, timeout: 20000 });
    const posts = r.data;

    const s9 = posts.find(p => /Modern Family 9/i.test(p.title?.rendered || ''));

    console.log(`per_page=${perPage}: ${posts.length} posts | S9 encontrado? ${s9 ? `SIM ([${s9.id}] ${s9.title.rendered.substring(0, 60)})` : 'NÃO'}`);
  }
})();
