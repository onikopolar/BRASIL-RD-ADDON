// Teste específico: HDR magnets do post "todas as temporadas" chegam na similarity?
import 'dotenv/config';
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';
import { TitleFilter } from '../src/titulos/titleFilter.js';
import { analisarMagnet } from '../src/lib/magnetHelper.js';

const imdbId = 'tt0436992';
const season = 4;

async function main() {
  const scraper = new TorrentScraperService();
  const hdrResults = await (await import('../src/services/scraper/hdrScraper.js')).searchHdr('doctor who', 'series');
  
  const titleFilter = TitleFilter.getInstance();
  const simCalc = SimilarityCalculator.getInstance();

  console.log(`Total HDR: ${hdrResults.length}`);
  
  let count = 0;
  for (const r of hdrResults) {
    const magnet = r.magnet;
    const dados = await analisarMagnet(magnet).catch(() => null);
    const nome = dados?.nome || r.title;
    
    // Só os que parecem ser season packs (não episódios soltos)
    if (!/temporada|s\d{1,2}(?!\d*e)|season\s*\d/i.test(nome)) continue;
    
    count++;
    const ptCheck = titleFilter.verificarIdiomaDetalhado(nome);
    const simCheck = await simCalc.smartTitleContainsCheck(nome, imdbId, { season });
    
    const seasonMatch = nome.match(/s(\d{1,2})|(\d+)temporada|season\s*(\d{1,2})/i);
    const detectedSeason = seasonMatch ? (seasonMatch[1] || seasonMatch[2] || seasonMatch[3]) : '?';
    
    console.log(`\n[S${detectedSeason}] ${nome.substring(0, 80)}`);
    console.log(`   PT? ${ptCheck.ehPortugues} | Language: ${r.language}`);
    console.log(`   Sim: ${simCheck.matches ? '✅' : '❌'} ${simCheck.reason}`);
  }
  
  console.log(`\nTotal season packs: ${count}`);
}

main().catch(console.error);
