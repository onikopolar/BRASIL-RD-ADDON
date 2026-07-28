// Teste TPB: buscar torrents PT-BR em múltiplos mirrors
import axios from 'axios';
import * as cheerio from 'cheerio';

const MIRRORS = [
  { url: 'https://piratebay.live', priority: 1 },
  { url: 'https://1.piratebays.to', priority: 2 },
  { url: 'https://tpb.party', priority: 3 },
];

const PT_INDICATORS = ['dual', 'dublado', 'dublada', 'legendado', 'portugues', 'pt-br', 'ptbr', 'nacional', 'brasil'];

function scrapeFlexible($: any): TpbTorrent[] {
  const torrents: TpbTorrent[] = [];

  // Tenta múltiplos seletores de tabela
  const rows = $('table tr').toArray().filter(row => {
    const tds = $(row).find('td');
    return tds.length >= 3; // pelo menos 3 colunas
  });

  for (const row of rows) {
    const tds = $(row).find('td');
    if (tds.length < 3) continue;

    // Acha a coluna com o título + magnet
    let title = '';
    let magnetLink = '';

    for (let i = 0; i < tds.length; i++) {
      const td = $(tds[i]);
      const magnetA = td.find('a[href^="magnet:"]').first().attr('href');
      if (magnetA) {
        magnetLink = magnetA;
        title = td.find('a').first().text().trim() || td.text().trim();
        break;
      }
    }

    if (!title || !magnetLink) continue;

    const infoHashMatch = magnetLink.match(/btih:([a-fA-F0-9]{40})/i);
    if (!infoHashMatch) continue;

    // Acha seeders/leechers — geralmente as últimas 2 colunas
    let seeders = 0, leechers = 0;
    for (let i = tds.length - 1; i >= 1; i--) {
      const val = parseInt($(tds[i]).text().trim());
      if (!isNaN(val) && val > 0) {
        if (!leechers) { leechers = val; }
        else if (!seeders) { seeders = val; break; }
      }
    }

    torrents.push({
      title,
      magnet: magnetLink,
      seeders,
      leechers,
      infoHash: infoHashMatch[1].toLowerCase(),
    });
  }

  return torrents;
}

async function testMirror(baseUrl: string, query: string) {
  const searchUrl = `${baseUrl}/search/${encodeURIComponent(query)}/1/99/0`;
  try {
    const res = await axios.get(searchUrl, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    const $ = cheerio.load(res.data);
    const all = scrapeFlexible($);

    const pt = all.filter(t => {
      const lower = t.title.toLowerCase();
      return PT_INDICATORS.some(ind => lower.includes(ind));
    });

    console.log(`\n=== ${baseUrl} ===`);
    console.log(`  HTML: ${res.data.length} chars`);
    console.log(`  Total: ${all.length} | Com indicador PT: ${pt.length}`);

    if (pt.length > 0) {
      console.log(`  PT torrents:`);
      pt.forEach(t => console.log(`    ✅ ${t.title.substring(0, 90)} | Seeds: ${t.seeders} | Hash: ${t.infoHash.substring(0, 12)}`));
    }
    if (all.length > 0 && all.length <= 5) {
      console.log(`  Todos:`);
      all.forEach(t => console.log(`    - ${t.title.substring(0, 90)}`));
    }
    return { all, pt };
  } catch (err: any) {
    console.log(`\n=== ${baseUrl} ===`);
    console.log(`  ❌ ${err.code || err.message}`);
    return { all: [], pt: [] };
  }
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║   TESTE TPB — PT-BR torrents        ║');
  console.log('╚══════════════════════════════════════╝');

  // Query em português (testa se o mirror suporta busca PT)
  const queryPt = 'liga da justiça ponto de ignição';

  for (const mirror of MIRRORS.sort((a, b) => a.priority - b.priority)) {
    await testMirror(mirror.url, queryPt);
  }

  console.log('\n=== RESUMO ===');
  console.log('Se 1.piratebays.to retornou > 0 com PT, adicionar como mirror principal.');
  console.log('Se retornou 0, verificar HTML do mirror (formato diferente).');
}

main().catch(console.error);
