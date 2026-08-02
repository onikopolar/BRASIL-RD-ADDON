// Teste: dump do HTML de um post do Comando (comando1.com) pra ver estrutura real
// Uso: npx tsx scripts/test-comando-html-dump.ts
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

const BASE_URL = 'https://comando1.com';
const AXIOS_OPTS = {
  timeout: 15000, httpsAgent: dnsAgent, lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

async function main() {
  const query = process.argv[2] || 'matrix';
  console.log(`\n🔍 Buscando "${query}" no Comando via WP API...\n`);

  // Usa a WordPress REST API (igual o scraper)
  const encoded = encodeURIComponent(query);
  const apiUrl = `${BASE_URL}/wp-json/wp/v2/posts?search=${encoded}&per_page=3&_fields=id,title,link,content,excerpt,date`;
  const res = await axios.get(apiUrl, AXIOS_OPTS);

  if (!Array.isArray(res.data) || res.data.length === 0) {
    console.log('Nenhum post encontrado');
    return;
  }

  for (let pi = 0; pi < res.data.length; pi++) {
    const post = res.data[pi];
    const title = post.title?.rendered || '';
    const content = post.content?.rendered || '';
    const $ = cheerio.load(content);

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📄 Post ${pi + 1}: ${title.substring(0, 80)}`);
    console.log(`${'═'.repeat(70)}`);

    // ═══ HTML bruto (primeiros 2000 chars) ═══
    console.log('\n── HTML bruto (primeiros 2500 chars) ──');
    console.log(content.substring(0, 2500));

    // ═══ TEXTO puro ═══
    const fullText = ($('body').text() || $.text() || '').replace(/\s+/g, ' ').trim();
    console.log('\n── TEXTO puro (primeiros 1500 chars) ──');
    console.log(fullText.substring(0, 1500));

    // ═══ HEADINGS (h2, h3, h4, strong, b, p) ═══
    console.log('\n── HEADINGS no conteúdo ──');
    const headings = $('h2, h3, h4, strong, b, p').toArray();
    for (const el of headings) {
      const tag = (el as any).tagName || '?';
      const text = $(el).text().trim();
      if (text.length > 3 && text.length < 120) {
        const isDual = /dual|dublado/i.test(text) ? '🔵 DUAL' : '';
        const isLegendado = /legendado|legendada|legenda/i.test(text) ? '🔴 LEG' : '';
        const marker = isDual || isLegendado || '  ';
        console.log(`  <${tag}> ${marker} "${text}"`);
      }
    }

    // ═══ MAGNETS ═══
    console.log('\n── MAGNETS ──');
    const magnets = $('a[href^="magnet:"]').toArray();
    console.log(`Total: ${magnets.length}`);
    for (let i = 0; i < Math.min(magnets.length, 8); i++) {
      const el = magnets[i];
      const magnet = $(el).attr('href') || '';
      const dnMatch = magnet.match(/dn=([^&]+)/i);
      const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ').substring(0, 70) : '?';
      
      // Verifica se está antes ou depois de LEGENDADO
      const elHtml = $(el).toString();
      const elPos = content.indexOf(elHtml);
      const legendadoMatch = content.match(/legendado|legendada/i);
      const legendadoPos = legendadoMatch ? legendadoMatch.index! : -1;
      const afterLegendado = legendadoPos !== -1 && elPos > legendadoPos;
      
      console.log(`  [${i}] ${afterLegendado ? '🔴' : '🔵'} "${dn}"`);
      
      // Texto ao redor
      const parentText = $(el).parent().text().trim().substring(0, 80);
      console.log(`       parent: "${parentText}"`);
    }

    // ═══ TÍTULO ORIGINAL ═══
    const originalTitleMatch = fullText.match(/T[ií]tulo\s+Original[: ]+([^\n]+?)(?:\s*\||\s*G[êe]nero|\s*Dura[çc][ãa]o|\s*Lan[çc]amento|\s*Qualidade|\s*Formato|\s*[ÁA]udio|\s*Legenda|\s*Tamanho|\s*IMDb|\s*SINOPSE)/i);
    console.log('\n── TÍTULO ORIGINAL ──');
    console.log(originalTitleMatch ? `✅ "${originalTitleMatch[1].trim()}"` : '❌ Não encontrado');

    // ═══ SEÇÕES: procura marcadores de DUAL e LEGENDADO ═══
    console.log('\n── SEÇÕES (DUAL vs LEGENDADO) ──');
    const sectionMarkers: { type: string; text: string; pos: number }[] = [];
    
    // Procura por padrões de seção DUAL
    const dualMatches = content.match(/DUAL\s+[ÁA]UDIO|DUBLADO/gi);
    if (dualMatches) {
      for (const m of dualMatches) {
        const pos = content.indexOf(m);
        if (pos !== -1) sectionMarkers.push({ type: 'DUAL', text: m, pos });
      }
    }
    
    // Procura por padrões LEGENDADO
    const legendadoMatches = content.match(/LEGENDADO|LEGENDA/gi);
    if (legendadoMatches) {
      for (const m of legendadoMatches) {
        const pos = content.indexOf(m);
        if (pos !== -1) sectionMarkers.push({ type: 'LEGENDADO', text: m, pos });
      }
    }
    
    sectionMarkers.sort((a, b) => a.pos - b.pos);
    for (const sm of sectionMarkers) {
      const context = content.substring(Math.max(0, sm.pos - 30), sm.pos + sm.text.length + 30).replace(/\s+/g, ' ');
      console.log(`  ${sm.type === 'DUAL' ? '🔵' : '🔴'} pos=${sm.pos} "${sm.text}" → ...${context}...`);
    }

    if (pi >= 1) break; // só 2 posts
  }
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
