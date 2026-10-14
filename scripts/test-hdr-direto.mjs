// Importa o HdrScraper compilado e testa todos os estágios da busca.
// Uso: node scripts/test-hdr-direto.mjs "rick and morty"

const QUERY = process.argv[2] || 'rick and morty';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const section = t => console.log(`\n${c.bold}${c.cyan}══ ${t} ══${c.reset}`);
const ok = t => console.log(`${c.green}✅ ${t}${c.reset}`);
const fail = t => console.log(`${c.red}❌ ${t}${c.reset}`);
const warn = t => console.log(`${c.yellow}⚠️  ${t}${c.reset}`);
const info = (k, v) => console.log(`   ${c.dim}${k}:${c.reset} ${v}`);

(async () => {
  console.log(`${c.bold}${c.magenta}🧪 HdrScraper direto — "${QUERY}"${c.reset}`);

  let hdr;
  try {
    hdr = await import('../dist/services/scraper/hdrScraper.js');
  } catch (e) {
    fail(`Não consegui importar do dist. Roda 'npm run build' antes. Erro: ${e.message}`);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════
  section('1) URL de busca');
  // ═══════════════════════════════════════════════════════════════════
  const url = hdr.montarUrlBusca(QUERY);
  info('URL', url);
  info('BROWSER_HEADERS.User-Agent', hdr.BROWSER_HEADERS['User-Agent']);

  // ═══════════════════════════════════════════════════════════════════
  section('2) fetchComSessao direto (RAW)');
  // ═══════════════════════════════════════════════════════════════════
  try {
    const html = await hdr.fetchComSessao(url);
    ok(`fetch retornou ${html.length} bytes`);
    info('tem CollectionPage?', html.includes('CollectionPage') ? 'SIM' : 'NÃO');
    info('tem "Just a moment"?', html.includes('Just a moment') ? 'SIM (Cloudflare challenge)' : 'não');
    info('tem "403" no corpo?', /\b403\b/.test(html) ? 'SIM' : 'não');
  } catch (err) {
    fail(`fetch falhou: ${err.response?.status || ''} ${err.message}`);
    warn('Se for 403, o WAF tá bloqueando o axios/curl antes de qualquer parse.');
    warn('Nesse caso, o HDR não é acessível via HTTP client — precisa de browser real.');
  }

  // ═══════════════════════════════════════════════════════════════════
  section('3) searchHdrLinks — só a lista (JSON-LD)');
  // ═══════════════════════════════════════════════════════════════════
  try {
    const links = await hdr.searchHdrLinks(QUERY);
    ok(`${links.length} links encontrados`);
    for (const l of links.slice(0, 10)) {
      console.log(`   ${c.dim}•${c.reset} ${l.title.substring(0, 70)}`);
      console.log(`     ${c.dim}${l.postUrl}${c.reset}`);
    }
    if (links.length > 10) console.log(`   ... +${links.length - 10}`);
  } catch (err) {
    fail(`searchHdrLinks falhou: ${err.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  section('4) searchHdr — pipeline completa (abre cada post)');
  // ═══════════════════════════════════════════════════════════════════
  try {
    const t0 = Date.now();
    const torrents = await hdr.searchHdr(QUERY, 'series', undefined, [QUERY]);
    const dur = Date.now() - t0;
    ok(`${torrents.length} torrents em ${dur}ms`);
    for (const t of torrents.slice(0, 5)) {
      console.log(`   ${c.dim}•${c.reset} ${t.title.substring(0, 70)}`);
      info('  infoHash', t.infoHash);
      info('  size', t.size || '-');
      info('  lang', t.language || '-');
      info('  originalTitle', t.originalTitle || '-');
      info('  season/episode', `${t.season ?? '-'}/${t.episode ?? '-'}`);
      console.log('');
    }
    if (torrents.length > 5) console.log(`   ... +${torrents.length - 5}`);
  } catch (err) {
    fail(`searchHdr falhou: ${err.message}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  section('5) processarPostHdr — abre 1 post específico');
  // ═══════════════════════════════════════════════════════════════════
  try {
    const links = await hdr.searchHdrLinks(QUERY);
    if (links.length === 0) {
      warn('Sem links pra testar post individual');
    } else {
      const item = links[0];
      info('Post escolhido', item.title);
      const r = await hdr.processarPostHdr(item, undefined, undefined, 'series');
      ok(`${r.torrents.length} torrents no post, imdbConfirmed=${r.imdbConfirmed}`);
    }
  } catch (err) {
    fail(`processarPostHdr falhou: ${err.message}`);
  }

  console.log(`\n${c.bold}${c.magenta}🏁 Fim${c.reset}\n`);
})();
