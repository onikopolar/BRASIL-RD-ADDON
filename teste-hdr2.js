const BASE = 'https://hdrtorrents.net';
const Q = 'harry potter';

async function dump(url, opts = {}) {
  const t0 = Date.now();
  const res = await fetch(url, {
    ...opts,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept': 'text/html,application/json',
      ...(opts.headers || {}),
    },
  });
  const body = await res.text();
  console.log(`\n=== ${opts.method || 'GET'} ${url} ===`);
  console.log(`status=${res.status} ct=${res.headers.get('content-type')} bytes=${body.length} ${Date.now()-t0}ms`);
  if (res.headers.get('location')) console.log(`location: ${res.headers.get('location')}`);

  // procura qualquer coisa relacionada ao termo
  const idx = body.toLowerCase().indexOf('harry');
  const idxP = body.toLowerCase().indexOf('potter');
  console.log(`índice 'harry': ${idx} | índice 'potter': ${idxP}`);

  // amostra em volta se achou
  if (idx !== -1) {
    console.log('contexto:', body.substring(Math.max(0, idx-100), idx+200).replace(/\s+/g, ' '));
  }

  // procura por links de post do tipo /slug-com-hifens/
  const links = body.match(/href="(https?:\/\/hdrtorrents\.net\/[a-z0-9-]{15,}\/?)"/gi) || [];
  console.log(`links de post detectados: ${links.length}`);
  console.log(links.slice(0, 5).join('\n'));

  // procura por form de busca
  const formMatch = body.match(/<form[^>]*>[\s\S]{0,500}?<\/form>/i);
  if (formMatch) {
    const limpo = formMatch[0].replace(/\s+/g, ' ').substring(0, 400);
    console.log('form de busca encontrado:', limpo);
  }
}

(async () => {
  await dump(`${BASE}/?s=${encodeURIComponent(Q)}`);
  await dump(`${BASE}/?s=${encodeURIComponent(Q)}`, { headers: { 'Referer': BASE } });

  // testa POST com campos comuns
  for (const campo of ['busca', 's', 'q', 'search']) {
    const params = new URLSearchParams();
    params.append(campo, Q);
    await dump(`${BASE}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': BASE },
      body: params.toString(),
    });
  }
})();
