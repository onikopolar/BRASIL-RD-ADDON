const BASE = 'https://hdrtorrents.net';
const Q = 'harry potter';

async function raw(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    redirect: 'manual',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      ...(opts.headers || {}),
    },
  });
  console.log(`\n${opts.method || 'GET'} ${url}`);
  console.log(`  status=${res.status}`);
  console.log(`  location=${res.headers.get('location') || '-'}`);
  console.log(`  set-cookie=${(res.headers.get('set-cookie') || '-').substring(0, 80)}`);
  return res;
}

(async () => {
  // 1. Onde o 302 aponta?
  const r1 = await raw(`${BASE}/index.php?busca=${encodeURIComponent(Q)}`);
  const loc = r1.headers.get('location');
  if (loc) {
    const seguir = loc.startsWith('http') ? loc : `${BASE}${loc}`;
    await raw(seguir);
  }

  // 2. Sitemap existe?
  for (const s of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-posts.xml', '/wp-sitemap.xml', '/robots.txt']) {
    const r = await raw(`${BASE}${s}`);
    if (r.status === 200) {
      const txt = await r.text();
      console.log(`  bytes=${txt.length} | preview: ${txt.substring(0, 150).replace(/\s+/g,' ')}`);
    }
  }

  // 3. admin-ajax.php funciona pra busca?
  for (const action of ['search', 'busca', 'ajax_search', 'get_posts', 'search_posts']) {
    const body = new URLSearchParams();
    body.append('action', action);
    body.append('s', Q);
    body.append('busca', Q);
    body.append('query', Q);
    await raw(`${BASE}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  }
})();
