const BASE = 'https://hdrtorrents.net';
const Q = 'harry potter';

const urls = [
  // WordPress API padrão
  `${BASE}/wp-json/wp/v2/posts?search=${encodeURIComponent(Q)}&per_page=5&_fields=id,title,link`,
  `${BASE}/wp-json/wp/v2/search?search=${encodeURIComponent(Q)}&per_page=5`,
  // Busca clássica WP
  `${BASE}/?s=${encodeURIComponent(Q)}`,
  // O que o scraper usa hoje (suspeito)
  `${BASE}/index.php?busca=${encodeURIComponent(Q)}`,
  // Alternativas comuns
  `${BASE}/busca?q=${encodeURIComponent(Q)}`,
  `${BASE}/search?q=${encodeURIComponent(Q)}`,
  `${BASE}/search/${encodeURIComponent(Q)}`,
  `${BASE}/?q=${encodeURIComponent(Q)}`,
];

async function testa(url) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/json',
      },
      redirect: 'manual',
    });
    const body = await res.text();
    const ms = Date.now() - t0;
    const ct = res.headers.get('content-type') || '-';

    // Sinais de vida
    const temJsonPosts = body.includes('"rendered"') || body.includes('"post_title"');
    const temHarry = /harry\s*potter/i.test(body);
    const tamanhoKb = (body.length / 1024).toFixed(1);
    const preview = body.substring(0, 120).replace(/\s+/g, ' ').trim();

    console.log(`\n${url}`);
    console.log(`  status=${res.status} | ct=${ct.split(';')[0]} | ${tamanhoKb}KB | ${ms}ms`);
    console.log(`  jsonPosts=${temJsonPosts} | temHarry=${temHarry}`);
    console.log(`  preview: ${preview}`);
  } catch (e) {
    console.log(`\n${url}`);
    console.log(`  ERRO: ${e.message}`);
  }
}

(async () => {
  for (const u of urls) await testa(u);
})();
