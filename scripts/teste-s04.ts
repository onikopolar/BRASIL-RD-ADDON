// Diagnóstico Doctor Who S04: passo a passo da pipeline de filtragem
import 'dotenv/config';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';
import { TitleFilter } from '../src/titulos/titleFilter.js';
import { analisarMagnet } from '../src/lib/magnetHelper.js';

const imdbId = 'tt0436992';
const season = 4;

async function main() {
  // 1. TMDB
  console.log('📡 1. TMDB:');
  const imdb = ImdbScraperService.getInstance();
  const tmdb = await imdb.getTitlesFromImdbId(imdbId, season);
  console.log(`   "${tmdb.originalTitle}" | Ano S${season}: ${tmdb.year}`);

  // 2. Scrapers
  console.log('\n📡 2. Scraping:');
  const scraper = new TorrentScraperService();
  const query = `${tmdb.originalTitle} Temporada ${season}`;
  const torrents = await scraper.searchTorrents(query, 'series', season, tmdb.year, imdbId);
  console.log(`   Total: ${torrents.length}`);

  // 3. Parse magnets
  console.log('\n📡 3. Parse magnets:');
  const dados = await Promise.all(torrents.map(t => analisarMagnet(t.magnet).catch(() => null)));
  const withNames = torrents.map((t, i) => ({
    ...t,
    canonicalName: dados[i]?.nome || null
  }));

  // 4. PT-BR filter
  console.log('\n📡 4. Filtro PT-BR:');
  const titleFilter = TitleFilter.getInstance();
  let ptCount = 0, enCount = 0;
  const enEx: string[] = [];
  
  for (const t of withNames) {
    const nome = t.canonicalName || t.title;
    const result = titleFilter.verificarIdiomaDetalhado(nome);
    if (t.language && /legendado/i.test(t.language)) { enCount++; if (enEx.length < 3) enEx.push(`[LEG] ${nome.substring(0,70)}`); continue; }
    if (result.ehPortugues) ptCount++;
    else { enCount++; if (enEx.length < 8) enEx.push(`[${t.provider}] ${nome.substring(0,70)}`); }
  }
  console.log(`   PT: ${ptCount} | EN: ${enCount}`);
  for (const e of enEx) console.log(`     ${e}`);

  // 5. Similarity
  console.log('\n📡 5. Similarity (amostra de 30 PT-BR):');
  const simCalc = SimilarityCalculator.getInstance();
  const ptTorrents = withNames.filter(t => {
    const nome = t.canonicalName || t.title;
    if (t.language && /legendado/i.test(t.language)) return false;
    return titleFilter.verificarIdiomaDetalhado(nome).ehPortugues;
  });

  let pass = 0, fail = 0;
  const reasons = new Map<string, number>();
  
  for (const t of ptTorrents.slice(0, 50)) {
    const nome = t.canonicalName || t.title;
    const result = await simCalc.smartTitleContainsCheck(nome, imdbId, { season });
    
    if (result.matches) {
      pass++;
      console.log(`   ✅ ${nome.substring(0, 75)}`);
    } else {
      fail++;
      const r = result.reason || '?';
      reasons.set(r, (reasons.get(r) || 0) + 1);
      if (fail <= 12) console.log(`   ❌ ${nome.substring(0, 75)}\n      ${r}`);
    }
  }
  
  console.log(`\n   Pass: ${pass} | Fail: ${fail}`);
  console.log('   Motivos:');
  for (const [r, c] of reasons) console.log(`     [${c}x] ${r}`);

  // 6. Análise separada por provider
  console.log('\n📡 6. Por provider (HDR):');
  const hdrTorrents = ptTorrents.filter(t => t.provider === 'HDR Torrent');
  console.log(`   Total HDR PT-BR: ${hdrTorrents.length}`);
  let hdrPass = 0, hdrFail = 0;
  for (const t of hdrTorrents.slice(0, 15)) {
    const nome = t.canonicalName || t.title;
    const result = await simCalc.smartTitleContainsCheck(nome, imdbId, { season });
    if (result.matches) {
      hdrPass++;
      console.log(`   ✅ ${nome.substring(0, 70)}`);
    } else {
      hdrFail++;
      console.log(`   ❌ ${nome.substring(0, 70)}\n      ${result.reason}`);
    }
  }
  console.log(`   HDR Pass: ${hdrPass} | Fail: ${hdrFail}`);
}

main().catch(console.error);
