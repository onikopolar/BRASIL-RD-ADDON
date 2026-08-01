import 'dotenv/config';
import { TitleFilter } from '../src/titulos/titleFilter.js';
import { MetadataExtractor } from '../src/titulos/MetadataExtractor.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService.js';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';
import { analisarMagnet } from '../src/lib/magnetHelper.js';

const imdbId = 'tt0436992';
const season = 4;
const episode = 2;

async function main() {
  const tf = TitleFilter.getInstance();
  const me = new MetadataExtractor();
  
  // Pega resultados reais do scraper
  const imdb = ImdbScraperService.getInstance();
  const tmdb = await imdb.getTitlesFromImdbId(imdbId, season);
  const scraper = new TorrentScraperService();
  const torrents = await scraper.searchTorrents(
    `${tmdb.originalTitle} Temporada ${season}`, 'series', season, tmdb.year, imdbId
  );
  
  // Parse magnets
  const dados = await Promise.all(torrents.map(t => analisarMagnet(t.magnet).catch(() => null)));
  
  console.log(`Total scraped: ${torrents.length}\n`);
  
  // Filtra HDR
  const hdr = torrents.filter((t, i) => {
    dados[i]; // só pra mapear
    return t.provider === 'HDR Torrent';
  });
  console.log(`HDR torrents: ${hdr.length}`);
  
  let pass = 0, fail = 0;
  for (let i = 0; i < torrents.length; i++) {
    const t = torrents[i];
    if (t.provider !== 'HDR Torrent') continue;
    
    const nome = dados[i]?.nome || t.title;
    
    // Simula titulosCombinam passo a passo
    const metadados = me.extractSeriesMetadata(nome);
    
    if (i < 10) {
      console.log(`\n[${t.provider}] ${nome.substring(0, 70)}`);
      console.log(`  season=${metadados.season} episode=${metadados.episode} isComplete=${metadados.isCompleteSeason}`);
    }
    
    // Step 1: season check
    if (season !== undefined && metadados.season && metadados.season !== season) {
      fail++;
      if (fail <= 5) console.log(`  ❌ Season mismatch: ${metadados.season} vs ${season}`);
      continue;
    }
    
    // Step 2: episode check
    if (episode !== undefined && metadados.season) {
      // (episodeMatcher check - skipping for now)
    }
    
    // Step 3: similarity
    const result = await tf.titulosCombinam(nome, imdbId, season, episode);
    
    if (result.matches) {
      pass++;
      console.log(`  ✅ PASSOU! ${result.reason}`);
    } else {
      fail++;
      if (fail <= 8) console.log(`  ❌ ${result.reason}`);
    }
  }
  
  console.log(`\n📊 HDR: ${pass} pass, ${fail} fail`);
}

main().catch(console.error);
