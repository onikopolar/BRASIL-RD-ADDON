// Teste: dump do HTML de um post do BLUDV pra ver a estrutura real
// Uso: npx tsx scripts/test-bludv-html-dump.ts
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

const BASE_URL = 'https://bludvfilmes.xyz';
const AXIOS_OPTS = {
  timeout: 15000, httpsAgent: dnsAgent, lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

async function main() {
  // Busca um post que tenha LEGENDADO (ex: Matrix Resurrections ou Vingadores Ultimato)
  const encoded = encodeURIComponent('matrix resurrections');
  const searchUrl = `${BASE_URL}/?s=${encoded}`;
  const res = await axios.get(searchUrl, AXIOS_OPTS);
  const $ = cheerio.load(res.data);
  
  // Pega o primeiro post
  const firstLink = $('a[href]').toArray().find(el => {
    const href = ($(el).attr('href') || '').trim();
    if (!href.includes('bludvfilmes.xyz')) return false;
    const path = href.replace(/^https?:\/\/bludvfilmes\.xyz/, '').replace(/\/$/, '');
    const segments = path.split('/').filter(Boolean);
    return segments.length === 1 && segments[0].length > 20 && segments[0].includes('-');
  });

  if (!firstLink) { console.log('Post não encontrado'); return; }
  
  const postUrl = ($(firstLink).attr('href') || '').trim();
  console.log(`📄 URL: ${postUrl}\n`);

  const postRes = await axios.get(postUrl, AXIOS_OPTS);
  const $$ = cheerio.load(postRes.data);

  // ═══ ANÁLISE DO .content ═══
  const contentEl = $$('.content').first();
  console.log('══════ .content — HTML bruto (primeiros 3000 chars) ══════');
  console.log((contentEl.html() || '').substring(0, 3000));
  
  console.log('\n\n══════ .content — TEXTO puro ══════');
  console.log((contentEl.text() || '').substring(0, 2000));

  console.log('\n\n══════ MAGNETS encontrados ══════');
  const magnets = $$('a[href^="magnet:"]').toArray();
  console.log(`Total: ${magnets.length}`);
  magnets.forEach((el, i) => {
    const magnet = $$(el).attr('href') || '';
    const dnMatch = magnet.match(/dn=([^&]+)/i);
    const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ').substring(0, 80) : '?';
    // Pega o texto ao redor (pai ou irmão)
    const parentText = $$(el).parent().text().trim().substring(0, 50);
    console.log(`  [${i}] dn="${dn}"`);
    console.log(`      parentText="${parentText}"`);
    
    // Verifica se tem LEGENDADO perto
    const context = $$(el).parent().parent().text().trim().substring(0, 100);
    const hasLegendado = /legendado|legendada/i.test(context);
    console.log(`      LEGENDADO no contexto: ${hasLegendado ? '⚠️ SIM' : '✅ não'}`);
  });

  // ═══ ESTRUTURA: headings e blocos ═══
  console.log('\n\n══════ HEADINGS no .content ══════');
  $$('.content h1, .content h2, .content h3, .content h4, .content strong, .content b').each((i, el) => {
    const tag = (el as any).tagName || '?';
    const text = $$(el).text().trim();
    if (text.length > 2 && text.length < 100) {
      console.log(`  <${tag}> "${text}"`);
    }
  });
}

main().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
