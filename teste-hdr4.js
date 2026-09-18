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
  const body = await res.text();
  const temResultado = /harry\s*potter/i.test(body) || /potter/i.test(body);
  console.log(`\n${opts.method || 'GET'} ${url}`);
  console.log(`  status=${res.status} ct=${res.headers.get('content-type')} bytes=${body.length}`);
  console.log(`  location=${res.headers.get('location') || '-'}`);
  console.log(`  contém 'potter'? ${temResultado}`);

  // Conta links de post
  const links = body.match(/href="(https?:\/\/hdrtorrents\.net\/[a-z0-9-]{15,}\/?)"/gi) || [];
  console.log(`  post links: ${links.length}`);
  if (links.length > 0 && links.length < 5) {
    console.log(`  amostra: ${links.slice(0, 5).join(' | ')}`);
  }

  // Mostra o título da página se houver
  const titleMatch = body.match(/<title>([^<]*)<\/title>/i);
  if (titleMatch) console.log(`  title: ${titleMatch[1]}`);
}

(async () => {
  // 1. robots completo
  console.log('=== ROBOTS COMPLETO ===');
  const rb = await fetch(`${BASE}/robots.txt`);
  console.log(await rb.text());

  // 2. variações do parâmetro de busca
  for (const url of [
    `${BASE}/index.php?busca=harry+potter`,
    `${BASE}/index.php?busca=harry%20potter&submit=`,
    `${BASE}/index.php?busca=harry`,
    `${BASE}/index.php?busca=`,
    `${BASE}/index.php`,
  ]) {
    await raw(url);
  }

  // 3. POST em index.php
  const body = new URLSearchParams();
  body.append('busca', Q);
  await raw(`${BASE}/index.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  // 4. rotas alternativas de busca
  for (const path of [
    `/busca/harry-potter`,
    `/search/harry-potter`,
    `/torrent/harry-potter`,
    `/harry-potter`,
  ]) {
    await raw(`${BASE}${path}`);
  }
})();
