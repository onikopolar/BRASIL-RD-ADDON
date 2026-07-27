/**
 * TESTE REAL: Scraping verdadeiro + comparação ATUAL vs NOVA similaridade.
 * Busca torrents reais de várias fontes e compara os vereditos.
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

// ═════════════════════════════════════════════════════
// NOVA similaridade: iteração dupla
// ═════════════════════════════════════════════════════
const IGNORE = new Set([
  '1080p', '720p', '2160p', '4k', 'bluray', 'bdrip', 'web-dl', 'webrip', 'brrip',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc', 'dublado', 'dublada', 'dublagem',
  'dual', 'legendado', 'legendada', 'legenda', 'audio', 'áudio', 'download', 'torrent',
  'baixar', 'baixe', 'nacional', 'internacional', 'estendido', 'estendida', 'uncut',
  'a', 'o', 'de', 'do', 'da', 'e', 'em', 'no', 'na', 'um', 'uma', 'the', 'of', 'in',
  'on', 'at', 'to', 'for', 'and', 'or', 'is', 'it', 'an', 'completa', 'completo',
]);

function isIgn(w: string) { return w.length <= 2 || IGNORE.has(w) || /^\d+$/.test(w); }

function analyzeDual(torrentTitle: string, allTmdbTitles: string[]) {
  const norm = (s: string) => sim.normalizeForComparison(s).split(' ').filter(w => w.length > 0 && !isIgn(w));
  const tWords = norm(torrentTitle);
  const tSet = new Set(tWords);
  
  const allTmdbWords = new Set<string>();
  const tmdbTitlesNorm: { words: string[] }[] = [];
  for (const title of allTmdbTitles) {
    const words = norm(title);
    words.forEach(w => allTmdbWords.add(w));
    tmdbTitlesNorm.push({ words });
  }

  const foreign: string[] = [];
  for (const w of tWords) {
    if (!allTmdbWords.has(w)) foreign.push(w);
  }

  let bestMatch = { matched: 0, total: 0, missing: [] as string[] };
  for (const tmdb of tmdbTitlesNorm) {
    let m = 0; const missing: string[] = [];
    for (const tw of tmdb.words) {
      if (tSet.has(tw)) m++; else missing.push(tw);
    }
    if (m > bestMatch.matched) bestMatch = { matched: m, total: tmdb.words.length, missing };
  }

  const allFound = bestMatch.missing.length === 0;
  const ratio = bestMatch.total > 0 ? bestMatch.matched / bestMatch.total : 0;

  let verdict = 'ACCEPT', reason = '';
  if (bestMatch.matched === 0) { verdict = 'REJECT'; reason = 'Nada bateu'; }
  else if (allFound && foreign.length === 0) { reason = 'Perfeito'; }
  else if (allFound && foreign.length > 0 && bestMatch.total <= 2) { verdict = 'REJECT'; reason = `Curto(${bestMatch.total}p)+estranhas:[${foreign.join(',')}]`; }
  else if (allFound && foreign.length > 0) { reason = `OK+${foreign.length}extras:[${foreign.join(',')}]`; }
  else if (!allFound && foreign.length > 0) { verdict = 'REJECT'; reason = `Faltam:[${bestMatch.missing.join(',')}]+estranhas:[${foreign.join(',')}]`; }
  else { verdict = ratio >= 0.6 ? 'ACCEPT' : 'REJECT'; reason = `Faltam:[${bestMatch.missing.join(',')}](${(ratio*100).toFixed(0)}%)`; }

  return { verdict, reason, matched: bestMatch.matched, total: bestMatch.total, foreign, missing: bestMatch.missing };
}

// ═════════════════════════════════════════════════════
// CASOS DE TESTE REAIS
// ═════════════════════════════════════════════════════
const TESTS = [
  { query: 'Avatar A Lenda de Aang',     imdbId: 'tt0417299', type: 'series' as const, season: 1 },
  { query: 'Matrix',                      imdbId: 'tt0133093', type: 'movie' as const },
  { query: 'Interestelar',               imdbId: 'tt0816692', type: 'movie' as const },
  { query: 'Star Wars',                   imdbId: 'tt0076759', type: 'movie' as const },
  { query: 'Batman Cavaleiro das Trevas', imdbId: 'tt0468569', type: 'movie' as const },
  { query: 'Game of Thrones',             imdbId: 'tt0944947', type: 'series' as const, season: 1 },
];

async function main() {
  console.log('═'.repeat(95));
  console.log('TESTE REAL: Scraping verdadeiro + Comparação ATUAL vs NOVA similaridade');
  console.log('═'.repeat(95));

  for (const test of TESTS) {
    console.log(`\n${'━'.repeat(95)}`);
    console.log(`🎯 Buscando: "${test.query}" → ${test.imdbId} (${test.type})`);
    console.log(`${'━'.repeat(95)}`);

    // Busca real
    const results = await scraper.searchTorrents(test.query, test.type, test.season, undefined, test.imdbId);
    console.log(`   Scraper retornou ${results.length} torrents brutos`);

    if (results.length === 0) { console.log('   ⚠️ Nenhum resultado\n'); continue; }

    // TMDB titles para o algoritmo novo
    const titles = await imdb.getTitlesFromImdbId(test.imdbId, test.season);

    // Cabeçalho
    console.log(`   ${'Torrent'.padEnd(45)} | ATUAL | NOVA | Motivo`);
    console.log(`   ${'─'.repeat(45)}─┼───────┼──────┼──────`);

    let atualOk = 0, novaOk = 0, diff = 0;

    for (const r of results.slice(0, 15)) {
      const shortTitle = r.title.substring(0, 43).padEnd(43);
      
      // ATUAL
      const atual = await filter.doTitlesMatch(r.title, test.imdbId, test.season);
      const aV = atual.matches ? '✅' : '❌';
      
      // NOVA
      const nova = analyzeDual(r.title, titles.allTitles);
      const nV = nova.verdict === 'ACCEPT' ? '✅' : '❌';

      if (atual.matches) atualOk++;
      if (nova.verdict === 'ACCEPT') novaOk++;
      if (atual.matches !== (nova.verdict === 'ACCEPT')) diff++;

      const motivo = nova.reason.substring(0, 35);
      console.log(`   ${shortTitle} | ${aV}    | ${nV}   | ${motivo}`);
    }

    console.log(`   ${'─'.repeat(45)}─┴───────┴──────┴──────`);
    console.log(`   ATUAL: ${atualOk}/${Math.min(15, results.length)} aceitos | NOVA: ${novaOk}/${Math.min(15, results.length)} aceitos | Divergências: ${diff}`);
  }

  console.log('\n' + '═'.repeat(95));
  console.log('FIM');
  console.log('═'.repeat(95));
}

main().catch(e => { console.error(e); process.exit(1); });
