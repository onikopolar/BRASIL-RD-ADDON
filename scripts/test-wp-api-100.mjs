import axios from 'axios';

const BASE = 'https://comando1.com';
const CAT_SERIES = 43;

const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
};

(async () => {
  const url = `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent('modern family')}&per_page=100&_fields=id,title,date&categories=${CAT_SERIES}`;

  console.log('Buscando "modern family" com per_page=100...\n');

  const r = await axios.get(url, { timeout: 20000, headers });
  const posts = r.data;

  console.log(`Total retornado: ${posts.length}\n`);

  const relevantes = posts.filter(p => /modern\s*family/i.test(p.title?.rendered || ''));

  console.log(`Posts com "Modern Family" no título: ${relevantes.length}\n`);
  for (const p of relevantes) {
    const titulo = (p.title.rendered || '').replace(/<[^>]+>/g, '').trim();
    const data = p.date?.substring(0, 10) || '-';
    console.log(`  [${p.id}] ${data} | ${titulo.substring(0, 100)}`);
  }

  console.log('\n--- Buscando "Modern Family 9" diretamente ---\n');

  const url2 = `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent('Modern Family 9')}&per_page=100&_fields=id,title,date&categories=${CAT_SERIES}`;
  const r2 = await axios.get(url2, { timeout: 20000, headers });
  const posts2 = r2.data;

  console.log(`Total retornado: ${posts2.length}\n`);
  for (const p of posts2) {
    const titulo = (p.title.rendered || '').replace(/<[^>]+>/g, '').trim();
    const data = p.date?.substring(0, 10) || '-';
    console.log(`  [${p.id}] ${data} | ${titulo.substring(0, 100)}`);
  }
})();
