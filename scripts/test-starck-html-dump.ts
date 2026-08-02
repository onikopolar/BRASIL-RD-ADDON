// Teste: dump do HTML de um post do Starck pra ver estrutura real
// Uso: npx tsx scripts/test-starck-html-dump.ts
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

const BASE = 'https://www.starck-oficial.com';
const AXIOS_OPTS = {
  timeout: 15000, httpsAgent: dnsAgent, lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9',
  },
};

async function main() {
  const query = process.argv[2] || 'matrix';
  console.log(`\n🔍 Buscando "${query}" no Starck...\n`);

  const searchUrl = `${BASE}/?s=${encodeURIComponent(query)}`;
  const res = await axios.get(searchUrl, AXIOS_OPTS);
  const $ = cheerio.load(res.data);

  const postUrls: string[] = [];
  $('a[href*="/catalog/"]').each((_i, el) => {
    const href = $(el).attr('href');
    const text = $(el).text().trim();
    if (!href || !text || text.length < 5 || text === 'Detalhes') return;
    const fullUrl = href.startsWith('http') ? href : `${BASE}${href}`;
    if (!postUrls.includes(fullUrl)) postUrls.push(fullUrl);
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

      // ═══ HTML bruto (área de conteúdo) ═══
      const contentHtml = $$('.entry-content, .post-content, article, .content, main').first().html() || $$('body').html() || '';
      console.log(`\n── HTML conteúdo (2000 chars) ──`);
      console.log(contentHtml.substring(0, 2000));

      // ═══ TEXTO puro ═══
      const fullText = ($$('body').text() || '').replace(/\s+/g, ' ').trim();
      console.log(`\n── TEXTO puro (1500 chars) ──`);
      console.log(fullText.substring(0, 1500));

      // ═══ TÍTULO ORIGINAL ═══
      const origEl = $$('b, strong, th, td, span, p').toArray().find(el => /T[ií]tulo\s+Original/i.test($$(el).text()));
      if (origEl) {
        const parentHtml = $$(origEl).parent().html() || '';
        const elHtml = $$(origEl).toString();
        const idx = parentHtml.indexOf(elHtml);
        if (idx !== -1) {
          const after = parentHtml.substring(idx + elHtml.length);
          const endIdx = after.indexOf('<');
          const raw = endIdx !== -1 ? after.substring(0, endIdx) : after.substring(0, 100);
          console.log(`\n── TÍTULO ORIGINAL ──`);
          console.log(`✅ "${raw.replace(/^[:\s]+/, '').trim()}"`);
        }
      } else {
        // Tenta achar em texto corrido
        const om = fullText.match(/T[ií]tulo\s+Original[:\s]+([A-Za-z0-9][^:]{2,80}?)(?:\s+(?:Lan[çc]|G[êe]|Idioma|Qualidade|Formato|Dura[çc]|Tamanho|Cl[aá]|Legenda|Imdb|SINOPSE|Download|Baixar))/i);
        console.log(`\n── TÍTULO ORIGINAL ──`);
        console.log(om ? `✅ "${om[1].trim()}"` : '❌ Não encontrado');
      }

      // ═══ HEADINGS ═══
      console.log(`\n── HEADINGS ──`);
      const headings = $$('h1, h2, h3, h4, strong, b').toArray();
      for (const el of headings.slice(0, 25)) {
        const tag = (el as any).tagName || '?';
        const text = $$(el).text().trim();
        if (text.length > 3 && text.length < 120) {
          const isDual = /dual|dublado/i.test(text) ? '🔵' : '';
          const isLeg = /legendado|legendada/i.test(text) ? '🔴' : '';
          const marker = isDual || isLeg || ' ';
          console.log(`  <${tag}> ${marker} "${text}"`);
        }
      }

      // ═══ MAGNETS (base64) ═══
      console.log(`\n── MAGNETS ──`);
      const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
      let match;
      let magnetCount = 0;
      while ((match = b64Regex.exec(contentHtml)) !== null && magnetCount < 5) {
        const b64 = match[0];
        try {
          const decoded = Buffer.from(b64, 'base64').toString('latin1').replace(/&amp;/gi, '&');
          if (!decoded.startsWith('magnet:?')) continue;
          magnetCount++;
          const dnMatch = decoded.match(/dn=([^&]+)/i);
          const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ').substring(0, 70) : '?';
          const isLeg = /legendado|legendada/i.test(dn) ? '🔴' : '🔵';
          console.log(`  [${magnetCount}] ${isLeg} "${dn}"`);
        } catch {}
      }
      console.log(`  (mostrando primeiros ${magnetCount} magnets)`);

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
