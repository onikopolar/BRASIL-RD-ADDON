// Teste: descobre TODOS os marcadores de seção no HTML dos posts do BLUDV
// Uso: npx tsx scripts/test-bludv-section-markers.ts
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

async function fetchPosts(query: string): Promise<string[]> {
  const encoded = encodeURIComponent(query);
  const searchUrl = `${BASE_URL}/?s=${encoded}`;
  const res = await axios.get(searchUrl, AXIOS_OPTS);
  const $ = cheerio.load(res.data);
  const postUrls: string[] = [];

  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href.includes('bludvfilmes.xyz')) return;
    const path = href.replace(/^https?:\/\/bludvfilmes\.xyz/, '').replace(/\/$/, '');
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 1 && segments[0].length > 20 && segments[0].includes('-')) {
      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${segments[0]}/`;
      if (!postUrls.includes(fullUrl)) postUrls.push(fullUrl);
    }
  });
  return postUrls.slice(0, 5);
}

interface SectionMarker {
  text: string;
  type: 'dual' | 'dublado' | 'legendado' | 'legenda' | 'outro';
  hasAsteriscos: boolean;
  htmlContext: string;
}

async function analyzePost(url: string): Promise<{ url: string; title: string; markers: SectionMarker[]; sections: string[] }> {
  const res = await axios.get(url, AXIOS_OPTS);
  const $ = cheerio.load(res.data);
  const postTitle = $('h1').first().text().trim();
  const fullText = $('.content').text() || '';
  
  // Encontra TODOS os markers de seção no texto
  // Padrão 1: ***ALGO*** ou **ALGO**
  const asteriskMarkers = fullText.match(/\*{2,3}\s*[^'*]+?\s*\*{2,3}/g) || [];
  
  // Padrão 2: palavras-chave soltas que podem indicar seção
  const keywordMarkers = fullText.match(/\b(?:legendado|legendada|legenda|dublado|dublada|dual\s+[áa]udio|dual)\b/gi) || [];

  const markers: SectionMarker[] = [];
  
  // Analisa cada marker com ***
  for (const m of asteriskMarkers) {
    const clean = m.replace(/\*/g, '').trim();
    let type: SectionMarker['type'] = 'outro';
    if (/dual|dublado/i.test(clean)) type = 'dual';
    else if (/legendad[oa]|legenda/i.test(clean)) type = 'legendado';
    
    markers.push({ text: m, type, hasAsteriscos: true, htmlContext: '' });
  }
  
  // Palavras-chave sem ***
  for (const kw of [...new Set(keywordMarkers)]) {
    const alreadyInAsterisk = markers.some(m => m.text.toLowerCase().includes(kw.toLowerCase()));
    if (!alreadyInAsterisk) {
      let type: SectionMarker['type'] = 'outro';
      if (/dual|dublado/i.test(kw)) type = 'dual';
      else if (/legendad[oa]/i.test(kw)) type = 'legendado';
      else if (/legenda/i.test(kw)) type = 'legenda';
      markers.push({ text: kw, type, hasAsteriscos: false, htmlContext: '' });
    }
  }

  // Extrai seções entre os markers (ordem em que aparecem)
  const allSectionStarts = asteriskMarkers.map(m => ({
    text: m, index: fullText.indexOf(m)
  })).filter(s => s.index !== -1).sort((a, b) => a.index - b.index);
  
  const sections: string[] = [];
  for (let i = 0; i < allSectionStarts.length; i++) {
    const startIdx = allSectionStarts[i].index;
    const endIdx = i + 1 < allSectionStarts.length ? allSectionStarts[i + 1].index : fullText.length;
    const sectionText = fullText.substring(startIdx, Math.min(endIdx, startIdx + 200));
    sections.push(sectionText.replace(/\s+/g, ' ').trim());
  }

  return { url, title: postTitle, markers, sections };
}

async function main() {
  const queries = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['matrix', 'velozes', 'vingadores'];
  
  const allMarkers = new Map<string, { count: number; examples: string[]; hasAsteriscos: boolean }>();

  for (const query of queries) {
    console.log(`\n🔍 Buscando "${query}"...`);
    const posts = await fetchPosts(query);
    console.log(`  ${posts.length} posts encontrados`);

    for (const postUrl of posts) {
      try {
        const analysis = await analyzePost(postUrl);
        
        if (analysis.markers.length > 0) {
          console.log(`\n📄 ${analysis.title.substring(0, 70)}`);
          
          // Mostra marcadores na ordem
          for (const m of analysis.markers) {
            const prefix = m.hasAsteriscos ? '⭐' : '  ';
            console.log(`   ${prefix} [${m.type.toUpperCase()}] "${m.text}"`);
            
            const key = m.text.toLowerCase().replace(/\*/g, '').trim();
            if (!allMarkers.has(key)) {
              allMarkers.set(key, { count: 0, examples: [], hasAsteriscos: m.hasAsteriscos });
            }
            const entry = allMarkers.get(key)!;
            entry.count++;
            if (entry.examples.length < 2) entry.examples.push(analysis.title.substring(0, 60));
          }
          
          // Mostra seções
          if (analysis.sections.length > 1) {
            console.log('   ── Seções em ordem: ──');
            for (const s of analysis.sections) {
              console.log(`     → ${s.substring(0, 120)}`);
            }
          }
        }
      } catch (err: any) {
        console.log(`  ⚠️ Erro: ${err.message}`);
      }
    }
  }

  // ═══ SUMÁRIO FINAL ═══
  console.log('\n\n╔══════════════════════════════════════════════════╗');
  console.log('║       SUMÁRIO: TODOS OS MARCADORES DE SEÇÃO      ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  const sorted = [...allMarkers.entries()].sort((a, b) => b[1].count - a[1].count);
  
  for (const [text, info] of sorted) {
    const tipo = /dual|dublado/i.test(text) ? 'DUAL' 
      : /legendad[oa]/i.test(text) ? 'LEGENDADO'
      : /legenda\b/i.test(text) ? 'LEGENDA'
      : 'OUTRO';
    const ast = info.hasAsteriscos ? '⭐' : '  ';
    console.log(`${ast} [${tipo}] "${text}" — ${info.count}x`);
  }
}

main().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
