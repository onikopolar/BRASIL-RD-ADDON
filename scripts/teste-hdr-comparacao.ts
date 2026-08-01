// Diagnóstico: comparar magnets reais do post vs o que o scraper extrai
import axios from 'axios';
import * as cheerio from 'cheerio';
import { agenteHttps, lookupCustomizado } from '../src/services/scraper/wordpressScraper.js';
import { searchHdr } from '../src/services/scraper/hdrScraper.js';

const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
};

async function main() {
  const postUrl = 'https://hdrtorrent.com/doctor-who-todas-as-temporadas-torrent-download/';
  
  console.log('🔍 MAGNETS REAIS DO POST (direto do HTML)');
  console.log('═'.repeat(60));
  
  const res = await axios.get(postUrl, axiosConfig);
  const $ = cheerio.load(res.data);
  
  const magnetsRaw: { index: number; name: string; magnet: string }[] = [];
  $('a[href^="magnet:"]').each((i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const btihMatch = href.match(/btih:([a-fA-F0-9]{40})/i);
    if (!btihMatch) return;
    const dnMatch = href.match(/dn=([^&]+)/);
    const name = dnMatch ? decodeURIComponent(dnMatch[1]).substring(0, 100) : '???';
    magnetsRaw.push({ index: i, name, magnet: href.substring(0, 120) });
  });
  
  console.log(`Total de links magnet no HTML: ${magnetsRaw.length}\n`);
  for (const m of magnetsRaw) {
    // Detecta qual temporada
    const t = m.name.toLowerCase();
    const seasonMatch = t.match(/s(\d{1,2})|(\d+)temporada|season\s*(\d{1,2})/i);
    let season = '?';
    if (seasonMatch) {
      season = (seasonMatch[1] || seasonMatch[2] || seasonMatch[3]).padStart(2, '0');
    }
    console.log(`[S${season}] ${m.name.substring(0, 90)}`);
  }

  // ═══ Agora compara com o scraper ═══
  console.log('\n🔍 MAGNETS VINDOS DO SCRAPER');
  console.log('═'.repeat(60));
  
  const scraperResults = await searchHdr('doctor who');
  
  // Filtra só os que parecem vir do post "todas as temporadas"
  // (magnets com "temporada", "S0", "season" no nome)
  const doPost = scraperResults.filter(m => {
    const t = (m.magnet + m.title).toLowerCase();
    return /temporada|s\d{1,2}|season\s*\d/i.test(t) && !/joy|igreja|risadinha|imensidão|14ª|inside/i.test(t);
  });
  
  console.log(`Total do scraper que parecem ser do post: ${doPost.length}\n`);
  
  const seen = new Set<string>();
  for (const m of doPost) {
    const dnMatch = m.magnet.match(/dn=([^&]+)/);
    const name = dnMatch ? decodeURIComponent(dnMatch[1]).substring(0, 90) : m.title.substring(0, 90);
    const key = (m.magnet.match(/btih:([a-fA-F0-9]{40})/i)?.[1] || '').substring(0, 10);
    if (seen.has(key)) continue;
    seen.add(key);
    
    const t = name.toLowerCase();
    const seasonMatch = t.match(/s(\d{1,2})|(\d+)temporada|season\s*(\d{1,2})/i);
    let season = '?';
    if (seasonMatch) {
      season = (seasonMatch[1] || seasonMatch[2] || seasonMatch[3]).padStart(2, '0');
    }
    console.log(`[S${season}] ${name}`);
  }
  
  // ═══ Comparação ═══
  console.log('\n📊 COMPARAÇÃO');
  console.log(`Magnets no HTML: ${magnetsRaw.length}`);
  console.log(`Magnets do scraper (do post): ${new Set(doPost.map(m => m.magnet.match(/btih:([a-fA-F0-9]{40})/i)?.[1] || '')).size}`);
}

main().catch(console.error);
