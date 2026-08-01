// Teste HDR Scraper — Doctor Who "todas as temporadas"
import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { agenteHttps, lookupCustomizado } from '../src/services/scraper/wordpressScraper.js';
import { searchHdr, HdrTorrent } from '../src/services/scraper/hdrScraper.js';

const HDR_BASE = 'https://hdrtorrent.com';
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
  console.log('═══════════════════════════════════════════');
  console.log('🔍 TESTE HDR: Doctor Who');
  console.log('═══════════════════════════════════════════\n');

  // ═══ PASSO 1: Busca no HDR ═══
  console.log('📡 PASSO 1: Busca HDR "doctor who"');
  const searchUrl = `${HDR_BASE}/index.php?s=${encodeURIComponent('doctor who')}`;

  let searchResults: { title: string; href: string }[] = [];
  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const seen = new Set<string>();
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 5) return;
      if (href.includes('/categoria/') || href.includes('/tag/') || href === '/' || href.includes('#')) return;
      if (seen.has(href)) return;
      seen.add(href);
      const fullUrl = href.startsWith('http') ? href : `${HDR_BASE}${href}`;
      searchResults.push({ title: text.substring(0, 100), href: fullUrl });
    });

    console.log(`   Encontrados ${searchResults.length} links na busca\n`);
    for (let i = 0; i < Math.min(searchResults.length, 15); i++) {
      const r = searchResults[i];
      const temTodas = r.title.toLowerCase().includes('todas as temporadas') ? ' ⭐ TODAS TEMPORADAS!' : '';
      console.log(`   [${i}] ${r.title.substring(0, 80)}${temTodas}`);
      console.log(`       ${r.href.substring(0, 100)}`);
    }
  } catch (e: any) {
    console.log('   ❌ Erro na busca:', e.message);
    return;
  }

  // ═══ PASSO 2: Visita o post "todas as temporadas" ═══
  const todasPost = searchResults.find(r =>
    r.title.toLowerCase().includes('todas as temporadas')
  );

  if (!todasPost) {
    console.log('\n⚠️ Post "todas as temporadas" NÃO encontrado na busca!');
    console.log('   O scraper não conseguiria achar esse post.\n');

    // Tenta acessar diretamente a URL
    console.log('📡 Tentando acessar diretamente:');
    const directUrl = 'https://hdrtorrent.com/doctor-who-todas-as-temporadas-torrent-download/';
    try {
      const res = await axios.get(directUrl, axiosConfig);
      console.log('   ✅ Página acessível! Status:', res.status);
      console.log(`   Tamanho HTML: ${res.data.length} bytes`);
    } catch (e: any) {
      console.log('   ❌ Erro:', e.message);
    }
    return;
  }

  console.log(`\n📡 PASSO 2: Visitando post "todas as temporadas"`);
  console.log(`   URL: ${todasPost.href}`);

  try {
    const res = await axios.get(todasPost.href, axiosConfig);
    const $ = cheerio.load(res.data);

    const pageTitle = $('title').text().replace(/Torrent.*$/i, '').trim();
    console.log(`   Título da página: ${pageTitle}`);
    console.log(`   Tamanho HTML: ${res.data.length} bytes`);

    // ═══ PASSO 3: Extrai todos os magnets ═══
    console.log('\n📡 PASSO 3: Magnets encontrados');
    const magnets = $('a[href^="magnet:"]');
    console.log(`   Total de links magnet: ${magnets.length}`);

    let count = 0;
    magnets.each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const btihMatch = href.match(/btih:([a-fA-F0-9]{40})/i);
      if (!btihMatch) return;

      count++;
      const parentText = $(el).parent().text().trim().substring(0, 120);
      const dnMatch = href.match(/dn=([^&]+)/);
      const name = dnMatch ? decodeURIComponent(dnMatch[1]).substring(0, 80) : '???';

      // Procura qualidade e idioma no texto próximo
      const qualityMatch = parentText.match(/(\d{3,4}p|4K|HD|FullHD)/i);
      const hasDual = /dual|dublado|dublada/i.test(parentText.toLowerCase());

      console.log(`   [${count}] ${name}`);
      if (qualityMatch) console.log(`        Qualidade: ${qualityMatch[0]}`);
      console.log(`        Idioma: ${hasDual ? 'Dual/Dublado' : extractLang(parentText)}`);

      if (count >= 20) return false; // limita
    });

    console.log(`\n   Total magnets válidos: ${count}`);

    // ═══ PASSO 4: Compara com o scraper oficial ═══
    console.log('\n📡 PASSO 4: Scraper oficial searchHdr("doctor who")');
    const startTime = Date.now();
    const scraperResults = await searchHdr('doctor who');
    const duration = Date.now() - startTime;

    console.log(`   Resultados: ${scraperResults.length} magnets em ${duration}ms`);
    for (let i = 0; i < Math.min(scraperResults.length, 10); i++) {
      const r = scraperResults[i];
      console.log(`   [${i}] ${r.title.substring(0, 80)} | ${r.language} | ${r.size}`);
    }

    if (scraperResults.length === 0) {
      console.log('\n   ⚠️ SCRAPER OFICIAL RETORNOU 0 RESULTADOS!');
      console.log('   Causas possíveis:');
      console.log('   1. Post não aparece na busca do HDR');
      console.log('   2. Post é filtrado (categoria/tag)');
      console.log('   3. Post não tem magnet links detectáveis');
    }
  } catch (e: any) {
    console.log('   ❌ Erro ao visitar post:', e.message);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ Teste concluído');
}

function extractLang(text: string): string {
  const t = text.toLowerCase();
  if (t.includes('dual')) return 'Dual';
  if (/dublado|dublada/.test(t)) return 'Dublado';
  if (/legendado/.test(t)) return 'Legendado';
  if (/nacional/.test(t)) return 'Nacional';
  return '?';
}

main().catch(console.error);
