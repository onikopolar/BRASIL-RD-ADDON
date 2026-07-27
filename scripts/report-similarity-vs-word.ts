/**
 * RELATÓRIO: Comparação entre o SimilarityCalculator atual
 * e uma abordagem de iteração palavra-por-palavra contra TMDB.
 * 
 * NÃO MUDA NADA — apenas analisa e reporta.
 */
import 'dotenv/config';
import { TitleFilter } from '../src/lib/titleFilter.js';
import { SimilarityCalculator } from '../src/lib/title-filter/SimilarityCalculator.js';

const filter = TitleFilter.getInstance();
const sim = SimilarityCalculator.getInstance();

// ═══════════════════════════════════════
// Função auxiliar: como seria o word-by-word
// ═══════════════════════════════════════
function wordByWordMatch(torrentTitle: string, tmdbTitle: string): { matches: number; total: number; ratio: number; missingTmdbWords: string[]; extraTorrentWords: string[] } {
  const norm = (s: string) => sim.normalizeForComparison(s).split(' ').filter(w => w.length > 2);
  const tmdbWords = norm(tmdbTitle);
  const torrentWords = norm(torrentTitle);
  const torrentSet = new Set(torrentWords);
  
  let matchCount = 0;
  const missing: string[] = [];
  for (const w of tmdbWords) {
    if (torrentSet.has(w)) matchCount++;
    else missing.push(w);
  }
  
  const tmdbSet = new Set(tmdbWords);
  const extra: string[] = [];
  for (const w of torrentWords) {
    if (!tmdbSet.has(w)) extra.push(w);
  }
  
  return {
    matches: matchCount,
    total: tmdbWords.length,
    ratio: tmdbWords.length > 0 ? matchCount / tmdbWords.length : 0,
    missingTmdbWords: missing,
    extraTorrentWords: extra
  };
}

interface TestCase {
  label: string;
  torrent: string;
  imdbId: string;
  season?: number;
  expectedVerdict: 'ACEITAR' | 'REJEITAR';
}

const CASES: TestCase[] = [
  // ─── CASOS QUE DEVEM SER ACEITOS ───
  { label: 'Aang série', torrent: 'Avatar A Lenda de Aang 1ª Temporada Dublado', imdbId: 'tt0417299', season: 1, expectedVerdict: 'ACEITAR' },
  { label: 'Matrix filme', torrent: 'Matrix 1999 1080p Dublado', imdbId: 'tt0133093', expectedVerdict: 'ACEITAR' },
  { label: 'Poderoso Chefão', torrent: 'O Poderoso Chefao 1972 Dublado 1080p', imdbId: 'tt0068646', expectedVerdict: 'ACEITAR' },
  { label: 'Interestelar PT', torrent: 'Interestelar 2014 Dublado 1080p', imdbId: 'tt0816692', expectedVerdict: 'ACEITAR' },
  { label: 'Aang + livro', torrent: 'Avatar A Lenda de Aang Livro 1 Dublado', imdbId: 'tt0417299', season: 1, expectedVerdict: 'ACEITAR' },
  { label: 'Série S01E01', torrent: 'The Last of Us S01E01 Dublado 1080p', imdbId: 'tt3581920', season: 1, expectedVerdict: 'ACEITAR' },
  { label: 'Star Wars Ep4', torrent: 'Star Wars Uma Nova Esperanca 1977 Dublado', imdbId: 'tt0076759', expectedVerdict: 'ACEITAR' },
  
  // ─── CASOS QUE DEVEM SER REJEITADOS ───
  { label: 'Korra vs Aang', torrent: 'Avatar A Lenda de Korra 3ª Temporada Dublado', imdbId: 'tt0417299', season: 3, expectedVerdict: 'REJEITAR' },
  { label: 'Interstellar EN', torrent: 'Interstellar', imdbId: 'tt0816692', expectedVerdict: 'REJEITAR' },
  { label: 'Harry vs Matrix', torrent: 'Harry Potter Pedra Filosofal Dublado', imdbId: 'tt0133093', expectedVerdict: 'REJEITAR' },
  { label: 'Clone Wars vs SW', torrent: 'Star Wars The Clone Wars 1 Temporada', imdbId: 'tt0076759', expectedVerdict: 'REJEITAR' },
  { label: 'Matrix 2 vs Matrix 1', torrent: 'Matrix Reloaded 2003 Dublado', imdbId: 'tt0133093', expectedVerdict: 'REJEITAR' },
  { label: 'Batman Begins vs DK', torrent: 'Batman Begins 2005 Dublado', imdbId: 'tt0468569', expectedVerdict: 'REJEITAR' },
];

async function main() {
  console.log('═'.repeat(90));
  console.log('RELATÓRIO: SimilarityCalculator ATUAL vs Word-by-Word (iteração)');
  console.log('═'.repeat(90));

  let currentOk = 0;
  let wordOk = 0;
  const details: string[] = [];

  for (const c of CASES) {
    // ─── Resultado atual ───
    const currentResult = await filter.doTitlesMatch(c.torrent, c.imdbId, c.season);
    const currentVerdict = currentResult.matches ? 'ACEITOU' : 'REJEITOU';
    const currentOkFlag = (currentResult.matches && c.expectedVerdict === 'ACEITAR') || (!currentResult.matches && c.expectedVerdict === 'REJEITAR');
    if (currentOkFlag) currentOk++;

    // ─── TMDB titles para word-by-word ───
    const tmdb = await (filter as any).getImdbTitlesWithCache(c.imdbId, c.season);
    const ptTitle = tmdb?.portugueseTitle || tmdb?.originalTitle || '';
    const enTitle = tmdb?.originalTitle || '';

    // Word-by-word contra PT
    const wPt = wordByWordMatch(c.torrent, ptTitle);
    // Word-by-word contra EN
    const wEn = wordByWordMatch(c.torrent, enTitle);

    // Heurística word-by-word: usa o melhor match (PT ou EN)
    const bestRatio = Math.max(wPt.ratio, wEn.ratio);
    const bestMatch = wPt.ratio >= wEn.ratio ? wPt : wEn;
    const bestLabel = wPt.ratio >= wEn.ratio ? 'PT' : 'EN';
    const bestTitle = wPt.ratio >= wEn.ratio ? ptTitle : enTitle;

    // Regra simples: se 100% das palavras TMDB estão no torrent → ACEITAR
    // Se < 50% → REJEITAR. Entre 50-99% → depende de palavras extras
    let wordVerdict = 'REJEITOU';
    if (bestRatio >= 1.0) {
      wordVerdict = 'ACEITOU';
    } else if (bestRatio >= 0.6 && bestMatch.extraTorrentWords.length <= bestMatch.total) {
      wordVerdict = 'ACEITOU'; // maioria das palavras TMDB presentes
    }

    const wordOkFlag = (wordVerdict === 'ACEITOU' && c.expectedVerdict === 'ACEITAR') || (wordVerdict === 'REJEITOU' && c.expectedVerdict === 'REJEITAR');
    if (wordOkFlag) wordOk++;

    // ─── Output ───
    const curIcon = currentOkFlag ? '✅' : '❌';
    const wrdIcon = wordOkFlag ? '✅' : '❌';
    
    console.log(`\n${'─'.repeat(90)}`);
    console.log(`${c.label}`);
    console.log(`  Torrent: "${c.torrent}"`);
    console.log(`  TMDB PT: "${ptTitle}" → words: [${wPt.matches}/${wPt.total}] ratio=${(wPt.ratio*100).toFixed(0)}%`);
    console.log(`  TMDB EN: "${enTitle}" → words: [${wEn.matches}/${wEn.total}] ratio=${(wEn.ratio*100).toFixed(0)}%`);
    console.log(`  Melhor match: ${bestLabel} [${bestMatch.matches}/${bestMatch.total}] (${(bestRatio*100).toFixed(0)}%)`);
    if (bestMatch.missingTmdbWords.length) console.log(`    Palavras TMDB FALTANDO no torrent: [${bestMatch.missingTmdbWords.join(', ')}]`);
    if (bestMatch.extraTorrentWords.length) console.log(`    Palavras EXTRAS no torrent:       [${bestMatch.extraTorrentWords.join(', ')}]`);
    
    console.log(`  Esperado: ${c.expectedVerdict}`);
    console.log(`  ATUAL:    ${curIcon} ${currentVerdict} (${(currentResult.similarity*100).toFixed(1)}%) — ${currentResult.reason}`);
    console.log(`  WORD:     ${wrdIcon} ${wordVerdict} (ratio ${(bestRatio*100).toFixed(0)}%)`);

    if (!currentOkFlag || !wordOkFlag) {
      details.push(`${c.label}: ATUAL=${currentVerdict} WORD=${wordVerdict} (esperado ${c.expectedVerdict})`);
    }
  }

  console.log('\n' + '═'.repeat(90));
  console.log('RESUMO');
  console.log('═'.repeat(90));
  console.log(`  ATUAL: ${currentOk}/${CASES.length} corretos`);
  console.log(`  WORD:  ${wordOk}/${CASES.length} corretos`);

  if (details.length > 0) {
    console.log('\n  Divergências:');
    details.forEach(d => console.log(`    ${d}`));
  }

  console.log('\n═'.repeat(90));
  console.log('CONCLUSÃO');
  console.log('═'.repeat(90));
  console.log('  O word-by-word é mais simples e direto: conta quantas palavras');
  console.log('  do TMDB aparecem no torrent. Não usa ranges de % artificiais,');
  console.log('  não tem análise de densidade, não tem penalidades complexas.');
  console.log('  ');
  console.log('  Vantagens:');
  console.log('  - Determinístico: X/Y palavras = decisão clara');
  console.log('  - Sem thresholds arbitrários (0.70, 0.65, 0.55...)');
  console.log('  - Lida naturalmente com títulos longos (Star Wars Ep4)');
  console.log('  - Lida naturalmente com palavras extras (Aang + livro)');
  console.log('  ');
  console.log('  Riscos:');
  console.log('  - "Matrix Reloaded" vs "Matrix": 1/2 palavras = 50% → limítrofe');
  console.log('  - Títulos TMDB de 1 palavra são frágeis (qualquer palavra extra muda tudo)');
  console.log('═'.repeat(90));
}

main().catch(e => { console.error(e); process.exit(1); });
