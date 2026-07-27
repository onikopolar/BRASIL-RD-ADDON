/**
 * Investiga especificamente Interestelar (tt0816692)
 * Mostra cada torrent do scraping e o que o filtro novo faria.
 */
import 'dotenv/config';
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService.js';
import { TitleFilter } from '../src/lib/titleFilter.js';
import { ImdbScraperService } from '../src/services/ImdbScraperService.js';
import { SimilarityCalculator } from '../src/lib/title-filter/SimilarityCalculator.js';

const scraper = new TorrentScraperService();
const filter = TitleFilter.getInstance();
const imdb = ImdbScraperService.getInstance();
const sim = SimilarityCalculator.getInstance();

const IMDB_ID = 'tt0816692';

const IGNORE = new Set([
  '1080p','720p','2160p','4k','bluray','bdrip','web-dl','webrip','brrip',
  'x264','x265','h264','h265','hevc','avc',
  'dublado','dublada','dublagem','dual','legendado','legendada','legenda',
  'audio','áudio','download','torrent','baixar','baixe','nacional',
  'internacional','estendido','estendida','uncut','directors','cut',
  'a','o','de','do','da','e','em','no','na','um','uma',
  'the','of','in','on','at','to','for','and','or','is','it','an',
]);

function isIgnored(w: string) { return w.length <= 2 || IGNORE.has(w) || /^\d+$/.test(w); }

function norm(s: string) {
  return sim.normalizeForComparison(s).split(' ').filter(w => w.length > 0 && !isIgnored(w));
}

async function main() {
  console.log('═'.repeat(80));
  console.log('🔍 INTERESTELAR (tt0816692) — scraping real');
  console.log('═'.repeat(80));

  const titles = await imdb.getTitlesFromImdbId(IMDB_ID);
  console.log(`TMDB allTitles: [${titles.allTitles.join(' | ')}]`);
  console.log(`TMDB PT: ${titles.portugueseTitle}`);
  console.log(`TMDB EN: ${titles.originalTitle}\n`);

  const results = await scraper.searchTorrents('Interestelar', 'movie', undefined, undefined, IMDB_ID);
  console.log(`Scraper: ${results.length} resultados brutos\n`);

  let atualOk = 0;
  let wordOk = 0;
  let total = 0;

  for (const r of results) {
    total++;
    const current = await filter.doTitlesMatch(r.title, IMDB_ID);

    // Análise word-by-word dual
    const tw = norm(r.title);
    const allTmdbSet = new Set<string>();
    titles.allTitles.forEach(t => norm(t).forEach(w => allTmdbSet.add(w)));

    const foreign: string[] = [];
    for (const w of tw) {
      if (!allTmdbSet.has(w) && !isIgnored(w)) foreign.push(w);
    }

    // Melhor match TMDB
    let bestT = '', bestM = 0, bestTot = 0, bestMiss: string[] = [];
    for (const t of titles.allTitles) {
      const tmdbW = norm(t);
      let m = 0;
      const miss: string[] = [];
      for (const w of tmdbW) {
        if (tw.includes(w)) m++; else miss.push(w);
      }
      if (m > bestM || (m === bestM && miss.length < bestMiss.length)) {
        bestM = m; bestTot = tmdbW.length; bestMiss = miss; bestT = t;
      }
    }

    const allFound = bestMiss.length === 0;
    const wordVerdict = (!allFound && foreign.length > 0) ? '❌' :
                         (!allFound && bestM === 0) ? '❌' :
                         (allFound && foreign.length > 0 && bestTot <= 2) ? '❌' :
                         '✅';

    // Só mostra divergências ou títulos interessantes
    const curIcon = current.matches ? '✅' : '❌';
    if (curIcon !== wordVerdict || foreign.length > 0) {
      console.log(`${curIcon} atual | ${wordVerdict} word | "${r.title.substring(0, 90)}"`);
      console.log(`   words: [${tw.join(', ')}]`);
      console.log(`   best TMDB: "${bestT}" [${bestM}/${bestTot}] miss=[${bestMiss}] foreign=[${foreign}]`);
      if (current.matches) atualOk++;
      if (wordVerdict === '✅') wordOk++;
    }
  }

  console.log(`\n═`.repeat(80));
  console.log(`Total: ${total} | ATUAL aceitou: ${atualOk} | WORD aceitaria: ${wordOk}`);
}

main().catch(e => { console.error(e); process.exit(1); });
