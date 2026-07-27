/**
 * TESTE v2: Iteração DUPLA — torrent vs TMDB + TMDB vs torrent
 * Usa TODOS os allTitles do TMDB pra não perder nenhuma palavra.
 */
import 'dotenv/config';
import { SimilarityCalculator } from '../src/lib/title-filter/SimilarityCalculator.js';
import { ImdbScraperService } from '../src/services/ImdbScraperService.js';

const sim = SimilarityCalculator.getInstance();
const imdb = ImdbScraperService.getInstance();

const IGNORE = new Set([
  '1080p', '720p', '2160p', '4k', 'bluray', 'bdrip', 'web-dl', 'webrip', 'brrip',
  'x264', 'x265', 'h264', 'h265', 'hevc', 'avc',
  'dublado', 'dublada', 'dublagem', 'dual', 'legendado', 'legendada', 'legenda',
  'audio', 'áudio', 'download', 'torrent', 'baixar', 'baixe', 'nacional',
  'internacional', 'estendido', 'estendida', 'uncut', 'directors', 'cut',
  'a', 'o', 'de', 'do', 'da', 'e', 'em', 'no', 'na', 'um', 'uma',
  'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'it', 'an',
]);

function isIgnored(w: string): boolean {
  return w.length <= 2 || IGNORE.has(w) || /^\d+$/.test(w);
}

function normalize(s: string): string[] {
  return sim.normalizeForComparison(s)
    .split(' ')
    .filter(w => w.length > 0 && !isIgnored(w));
}

/**
 * Algoritmo: iteração DUPLA
 * 
 * PASSO 1: itera palavras do TORRENT
 *   - se está em ALGUM título TMDB → ok
 *   - se não está em NENHUM título TMDB → foreignWord
 * 
 * PASSO 2: itera palavras de CADA título TMDB
 *   - se está no torrent → tmdbMatched++
 *   - se NÃO está no torrent → tmdbMissing
 * 
 * DECISÃO: baseada em matched/missing/foreign combinados
 */
function analyzeDual(
  torrentTitle: string,
  allTmdbTitles: string[]
): {
  torrentWords: string[];
  allTmdbWords: string[];
  foreignWords: string[];
  bestTitle: string;
  bestMatched: number;
  bestTotal: number;
  bestMissing: string[];
  verdict: 'ACCEPT' | 'REJECT';
  reason: string;
} {
  const torrentWords = normalize(torrentTitle);
  const torrentSet = new Set(torrentWords);

  // Coleta TODAS as palavras de TODOS os títulos TMDB
  const allTmdbWords = new Set<string>();
  const tmdbTitlesNormalized: { original: string; words: string[] }[] = [];

  for (const title of allTmdbTitles) {
    const words = normalize(title);
    words.forEach(w => allTmdbWords.add(w));
    tmdbTitlesNormalized.push({ original: title, words });
  }

  // ═══ PASSO 1: itera TORRENT → coleta foreign words ═══
  const foreignWords: string[] = [];
  for (let i = 0; i < torrentWords.length; i++) {
    const word = torrentWords[i];
    if (!allTmdbWords.has(word) && !isIgnored(word)) {
      foreignWords.push(word);
    }
  }

  // ═══ PASSO 2: itera CADA título TMDB → acha o melhor match ═══
  let bestTitle = '';
  let bestMatched = 0;
  let bestTotal = 0;
  let bestMissing: string[] = [];

  for (const tmdbTitle of tmdbTitlesNormalized) {
    let matched = 0;
    const missing: string[] = [];

    // Itera palavras deste título TMDB contra o torrent
    for (let j = 0; j < tmdbTitle.words.length; j++) {
      const tmdbWord = tmdbTitle.words[j];
      if (torrentSet.has(tmdbWord)) {
        matched++;
      } else {
        missing.push(tmdbWord);
      }
    }

    // Guarda o melhor (mais palavras TMDB encontradas)
    if (matched > bestMatched || (matched === bestMatched && missing.length < bestMissing.length)) {
      bestMatched = matched;
      bestTotal = tmdbTitle.words.length;
      bestMissing = missing;
      bestTitle = tmdbTitle.original;
    }
  }

  // ═══ PASSO 3: DECISÃO ═══
  const allTmdbFound = bestMissing.length === 0;
  const ratio = bestTotal > 0 ? bestMatched / bestTotal : 0;

  let verdict: 'ACCEPT' | 'REJECT' = 'ACCEPT';
  let reason = '';

  if (bestMatched === 0) {
    verdict = 'REJECT';
    reason = 'Nenhuma palavra TMDB encontrada';
  } else if (allTmdbFound && foreignWords.length === 0) {
    verdict = 'ACCEPT';
    reason = 'Match completo bidirecional';
  } else if (allTmdbFound && foreignWords.length > 0 && bestTotal <= 2) {
    verdict = 'REJECT';
    reason = `TMDB curto (${bestTotal}p) + estranhas: [${foreignWords.join(', ')}]`;
  } else if (allTmdbFound && foreignWords.length > 0) {
    verdict = 'ACCEPT';
    reason = `TMDB completo + ${foreignWords.length} extras: [${foreignWords.join(', ')}]`;
  } else if (!allTmdbFound && foreignWords.length > 0) {
    verdict = 'REJECT';
    reason = `Faltam: [${bestMissing.join(', ')}] + estranhas: [${foreignWords.join(', ')}]`;
  } else {
    verdict = ratio >= 0.6 ? 'ACCEPT' : 'REJECT';
    reason = `Faltam: [${bestMissing.join(', ')}] (${(ratio*100).toFixed(0)}%)`;
  }

  return {
    torrentWords: torrentWords,
    allTmdbWords: [...allTmdbWords],
    foreignWords,
    bestTitle, bestMatched, bestTotal, bestMissing,
    verdict, reason
  };
}

// ═══════════════════════════
// TESTES COM TMDB REAL
// ═══════════════════════════
interface TestCase {
  label: string;
  torrent: string;
  imdbId: string;
  season?: number;
  expected: 'ACCEPT' | 'REJECT';
}

const CASES: TestCase[] = [
  { label: 'Aang S1',     torrent: 'Avatar A Lenda de Aang 1ª Temporada Dublado',              imdbId: 'tt0417299', season: 1, expected: 'ACCEPT' },
  { label: 'Korra vs Aang', torrent: 'Avatar A Lenda de Korra 3ª Temporada Dublado',            imdbId: 'tt0417299', season: 3, expected: 'REJECT' },
  { label: 'Matrix 1',    torrent: 'Matrix 1999 1080p Dublado',                                 imdbId: 'tt0133093', expected: 'ACCEPT' },
  { label: 'Matrix 2',    torrent: 'Matrix Reloaded 2003 Dublado',                              imdbId: 'tt0133093', expected: 'REJECT' },
  { label: 'Matrix 3',    torrent: 'Matrix Revolutions 2003 Dublado',                           imdbId: 'tt0133093', expected: 'REJECT' },
  { label: 'Interestelar', torrent: 'Interestelar 2014 Dublado 1080p',                         imdbId: 'tt0816692', expected: 'ACCEPT' },
  { label: 'Interstellar', torrent: 'Interstellar 2014',                                        imdbId: 'tt0816692', expected: 'REJECT' },
  { label: 'Clone Wars',  torrent: 'Star Wars The Clone Wars 1 Temporada',                      imdbId: 'tt0076759', expected: 'REJECT' },
  { label: 'SW Ep4 PT',   torrent: 'Star Wars Uma Nova Esperanca 1977 Dublado',                 imdbId: 'tt0076759', expected: 'ACCEPT' },
  { label: 'Batman Begins',torrent: 'Batman Begins 2005 Dublado',                               imdbId: 'tt0468569', expected: 'REJECT' },
  { label: 'Harry Potter', torrent: 'Harry Potter Pedra Filosofal Dublado',                    imdbId: 'tt0133093', expected: 'REJECT' },
  { label: 'Aang + livro',torrent: 'Avatar A Lenda de Aang Livro 1 Dublado',                   imdbId: 'tt0417299', season: 1, expected: 'ACCEPT' },
];

async function main() {
  console.log('═'.repeat(90));
  console.log('TESTE v2: Iteração DUPLA (torrent↔TMDB) com todos allTitles');
  console.log('═'.repeat(90));

  let passed = 0;
  let failed = 0;

  for (const c of CASES) {
    const titles = await imdb.getTitlesFromImdbId(c.imdbId, c.season);
    const result = analyzeDual(c.torrent, titles.allTitles);
    const ok = result.verdict === c.expected;
    const icon = ok ? '✅' : '❌';

    console.log(`\n${icon} ${c.label}`);
    console.log(`   Torrent: "${c.torrent}"`);
    console.log(`   TMDB titles: [${titles.allTitles.join(' | ')}]`);
    console.log(`   Torrent words: [${result.torrentWords.join(', ')}]`);
    console.log(`   All TMDB words: [${result.allTmdbWords.join(', ')}]`);
    console.log(`   Best match: "${result.bestTitle}" [${result.bestMatched}/${result.bestTotal}]`);
    if (result.bestMissing.length) console.log(`     TMDB missing: [${result.bestMissing.join(', ')}]`);
    if (result.foreignWords.length) console.log(`     Foreign:      [${result.foreignWords.join(', ')}]`);
    console.log(`   ${result.verdict} — ${result.reason}`);

    if (ok) passed++; else failed++;
  }

  console.log(`\n${'═'.repeat(90)}`);
  console.log(`${passed}/${CASES.length} passaram`);
  if (failed === 0) console.log('🎉 TODOS PASSARAM!');
}

main().catch(e => { console.error(e); process.exit(1); });
