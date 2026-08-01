// Teste: onde está o post "todas as temporadas" na busca?
import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { agenteHttps, lookupCustomizado } from '../src/services/scraper/wordpressScraper.js';

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
  console.log('🔍 Buscando posição do post "todas as temporadas"\n');

  const queries = [
    'doctor who',
    'doctor who todas as temporadas',
    'doctor who temporadas',
  ];

  for (const query of queries) {
    console.log(`📡 Busca: "${query}"`);
    const searchUrl = `${HDR_BASE}/index.php?s=${encodeURIComponent(query)}`;
    try {
      const res = await axios.get(searchUrl, axiosConfig);
      const $ = cheerio.load(res.data);

      const seen = new Set<string>();
      const results: { title: string; href: string }[] = [];

      $('a[href]').each((_i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (!href || !text || text.length < 5) return;
        if (href.includes('/categoria/') || href.includes('/tag/') || href === '/' || href.includes('#') || href.endsWith('/series/') || href.endsWith('/filmes/') || href.endsWith('/animacao/')) return;
        if (seen.has(href)) return;
        seen.add(href);
        const fullUrl = href.startsWith('http') ? href : `${HDR_BASE}${href}`;
        results.push({ title: text.substring(0, 100), href: fullUrl });
      });

      // Procura o post
      const idx = results.findIndex(r =>
        r.href.includes('todas-as-temporadas') || r.title.toLowerCase().includes('todas as temporadas')
      );

      if (idx >= 0) {
        console.log(`   ✅ Encontrado na posição ${idx} (total: ${results.length} resultados)`);
        console.log(`   📄 ${results[idx].title.substring(0, 80)}`);
      } else {
        console.log(`   ❌ NÃO encontrado (total: ${results.length} resultados)`);
        // Mostra os últimos 5 pra ver se tá perto
        console.log('   Últimos 5 resultados:');
        for (let i = Math.max(0, results.length - 5); i < results.length; i++) {
          console.log(`   [${i}] ${results[i].title.substring(0, 70)}`);
        }
      }

      // Se a busca contém séries Doctor Who, mostra quantas na primeira página
      const dwCount = results.filter(r => /doctor who/i.test(r.title)).length;
      console.log(`   Series Doctor Who na pagina: ${dwCount}`);
      console.log('');
    } catch (e: any) {
      console.log(`   ❌ Erro: ${e.message}\n`);
    }
  }
}

main().catch(console.error);
