// Teste detalhado: verifica quantos magnets cada post Starck tem
// Uso: npx tsx scripts/test-starck-detalhado.ts "matrix"
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
      const sock = tls.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined as any;
  }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupCustomizado = (hostname: string, _opts: any, cb: any) => { dns.resolve4(hostname, (err, addresses) => { if (err) return cb(err); cb(null, addresses[0], 4); }); };
const BASE = 'https://www.starck-oficial.com';
const AXIOS_OPTS = { timeout: 15000, httpsAgent: dnsAgent, lookup: lookupCustomizado, headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html', 'Accept-Language': 'pt-BR,pt;q=0.9' } };

async function main() {
  const query = process.argv[2] || 'matrix';
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

  for (let pi = 0; pi < Math.min(postUrls.length, 4); pi++) {
    const postUrl = postUrls[pi];
    console.log(`\n📄 ${postUrl.split('/').pop()}`);

    const postRes = await axios.get(postUrl, AXIOS_OPTS);
    const html = postRes.data;
    const $$ = cheerio.load(html);

    // Todos os base64 decodificados
    const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
    let match;
    let totalBase64 = 0;
    let validMagnets = 0;
    let dualCount = 0;
    let legendadoCount = 0;

    const allDecoded: { magnet: string; dn: string; isLegendado: boolean }[] = [];

    while ((match = b64Regex.exec(html)) !== null) {
      totalBase64++;
      try {
        const decoded = Buffer.from(match[0], 'base64').toString('latin1').replace(/&amp;/gi, '&');
        if (!decoded.startsWith('magnet:?')) continue;
        validMagnets++;
        const dnMatch = decoded.match(/dn=([^&]+)/i);
        const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : '?';
        const isLeg = /legendado|legendada/i.test(dn);
        if (isLeg) legendadoCount++; else dualCount++;
        allDecoded.push({ magnet: decoded, dn, isLegendado: isLeg });
      } catch {}
    }

    console.log(`  Base64 total: ${totalBase64} | Magnets válidos: ${validMagnets} | 🔵DUAL: ${dualCount} | 🔴LEG: ${legendadoCount}`);
    
    for (let i = 0; i < allDecoded.length; i++) {
      const m = allDecoded[i];
      console.log(`    [${i + 1}] ${m.isLegendado ? '🔴' : '🔵'} "${m.dn.substring(0, 90)}"`);
    }
  }
}
main().catch(err => { console.error('❌', err.message); process.exit(1); });
