// Teste: dump do HTML de um post do HDR Torrent pra ver estrutura real
// Uso: npx tsx scripts/test-hdr-html-dump.ts
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';

dns.setServers(['8.8.8.8', '1.1.1.1']);

class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    (dns as any).resolve4(hostname, (err: any, addresses: string[]) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined as any;
  }
}

const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupCustomizado = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

const HDR_BASE = 'https://hdrtorrent.com';
const AXIOS_OPTS = {
  timeout: 15000, httpsAgent: dnsAgent, lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9',
  },
};

async function main() {
  const query = process.argv[2] || 'matrix';
  console.log(`\n🔍 Buscando "${query}" no HDR Torrent...\n`);

  const searchUrl = `${HDR_BASE}/index.php?s=${encodeURIComponent(query)}`;
  const res = await axios.get(searchUrl, AXIOS_OPTS);
  const $ = cheerio.load(res.data);

  const postUrls: string[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text || text.length < 10) return;
    if (href.includes('/categoria/') || href.includes('/tag/') || href === '/' || href.includes('#')) return;
    if (seen.has(href)) return;
    seen.add(href);
    const fullUrl = href.startsWith('http') ? href : `${HDR_BASE}${href}`;
    postUrls.push(fullUrl);
  });

  const posts = postUrls.slice(0, 3);
  console.log(`${posts.length} posts encontrados\n`);

  for (let pi = 0; pi < posts.length; pi++) {
    const postUrl = posts[pi];
    console.log(`${'═'.repeat(70)}`);
    console.log(`📄 Post ${pi + 1}: ${postUrl}`);
    
    try {
      const postRes = await axios.get(postUrl, AXIOS_OPTS);
      const $$ = cheerio.load(postRes.data);
      const pageTitle = $$('title').text().trim();
      console.log(`   Título: ${pageTitle}`);

      // ═══ HTML bruto ═══
      const bodyHtml = $$('body').html() || '';
      console.log(`\n── HTML (primeiros 2000 chars) ──`);
      console.log(bodyHtml.substring(0, 2000));

      // ═══ TEXTO puro ═══
      const fullText = ($$('body').text() || '').replace(/\s+/g, ' ').trim();
      console.log(`\n── TEXTO puro (1500 chars) ──`);
      console.log(fullText.substring(0, 1500));

      // ═══ TÍTULO ORIGINAL ═══
      const origMatch = fullText.match(/T[ií]tulo\s+Original[: ]+([^\n]+?)(?:\s*\||\s*G[êe]nero|\s*Dura[çc][ãa]o|\s*Lan[çc]amento|\s*Qualidade|\s*Formato|\s*[ÁA]udio|\s*Legenda|\s*Tamanho|\s*IMDb|\s*SINOPSE)/i);
      console.log(`\n── TÍTULO ORIGINAL ──`);
      console.log(origMatch ? `✅ "${origMatch[1].trim()}"` : '❌ Não encontrado');

      // ═══ HEADINGS ═══
      console.log(`\n── HEADINGS ──`);
      const headings = $$('h1, h2, h3, h4, strong, b, p').toArray();
      for (const el of headings.slice(0, 40)) {
        const tag = (el as any).tagName || '?';
        const text = $$(el).text().trim();
        if (text.length > 3 && text.length < 120) {
          const isDual = /dual|dublado|dublada/i.test(text) ? '🔵' : '';
          const isLeg = /legendado|legendada/i.test(text) ? '🔴' : '';
          const marker = isDual || isLeg || ' ';
          console.log(`  <${tag}> ${marker} "${text}"`);
        }
      }

      // ═══ MAGNETS ═══
      console.log(`\n── MAGNETS ──`);
      const magnets = $$('a[href^="magnet:"]').toArray();
      console.log(`Total: ${magnets.length}`);
      for (let i = 0; i < Math.min(magnets.length, 8); i++) {
        const el = magnets[i];
        const href = $$(el).attr('href') || '';
        const dnMatch = href.match(/dn=([^&]+)/i);
        const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ').substring(0, 70) : '?';
        const parentText = $$(el).parent().text().trim().substring(0, 80);
        const lang = /dual|dublado/i.test(parentText.toLowerCase()) ? '🔵 DUAL' : /legendado/i.test(parentText.toLowerCase()) ? '🔴 LEG' : '  ?';
        console.log(`  [${i}] ${lang} "${dn}"`);
        console.log(`       parent: "${parentText}"`);
      }

      // ═══ SEÇÕES ═══
      console.log(`\n── SEÇÕES (ordem no HTML) ──`);
      const sectionRe = /\b(DUAL\s+[ÁA]UDIO|DUBLADO|LEGENDADO|LEGENDA)\b/gi;
      let m;
      while ((m = sectionRe.exec(fullText)) !== null) {
        const ctx = fullText.substring(Math.max(0, m.index - 30), m.index + m.text.length + 30);
        const icon = /dual|dublado/i.test(m[0]) ? '🔵' : '🔴';
        console.log(`  ${icon} pos=${m.index} "${m[0]}" → ...${ctx.replace(/\s+/g, ' ')}...`);
      }
    } catch (err: any) {
      console.log(`  ⚠️ Erro: ${err.message}`);
    }
    console.log();
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
