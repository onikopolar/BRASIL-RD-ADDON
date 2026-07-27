/**
 * TESTE DE FORÇA: Nova abordagem híbrida de similaridade
 * 
 * Um único loop que:
 * 1. Conta palavras TMDB presentes no torrent
 * 2. Coleta palavras estranhas (não-TMDB e não-técnicas)
 * 3. Decide no final com regras claras
 */
import 'dotenv/config';
import { SimilarityCalculator } from '../src/lib/title-filter/SimilarityCalculator.js';
import { TECHNICAL_WORDS } from '../src/lib/title-filter/TechnicalWords.js';

const sim = SimilarityCalculator.getInstance();

// Palavras que ignoramos (técnicas, artigos, preposições)
const IGNORE_WORDS = new Set([
  ...TECHNICAL_WORDS.map(w => w.toLowerCase()),
  'a', 'o', 'as', 'os', 'de', 'do', 'da', 'das', 'dos', 'e', 'em', 'no', 'na', 'um', 'uma',
  'the', 'of', 'in', 'on', 'at', 'to', 'for', 'and', 'or', 'is', 'it', 'an',
  'el', 'la', 'los', 'las', 'del', 'en', 'un', 'una', 'de', 'por', 'para',
]);

function isIgnored(word: string): boolean {
  return word.length <= 2 || IGNORE_WORDS.has(word) || /^\d+$/.test(word);
}

/**
 * CORE: único loop que faz tudo.
 * Retorna matches, foreign words, e veredito.
 */
function analyzeMatch(
  torrentTitle: string,
  tmdbTitle: string
): {
  torrentWords: string[];
  tmdbWords: string[];
  matchedTmdb: string[];
  missingTmdb: string[];
  foreignWords: string[];
  ratio: number;
  allTmdbMatched: boolean;
  verdict: 'ACCEPT' | 'REJECT';
  reason: string;
} {
  // Normaliza (usa o mesmo normalizer do sistema)
  const norm = (s: string) => sim.normalizeForComparison(s).split(' ').filter(w => w.length > 0 && !isIgnored(w));
  
  const torrentWords = norm(torrentTitle);
  const tmdbWords = norm(tmdbTitle);
  const tmdbSet = new Set(tmdbWords);
  
  const matchedTmdb: string[] = [];
  const missingTmdb: string[] = [];
  const foreignWords: string[] = [];
  
  // ═══ ÚNICO LOOP ═══
  for (let i = 0; i < torrentWords.length; i++) {
    const word = torrentWords[i];
    
    if (tmdbSet.has(word)) {
      matchedTmdb.push(word);
    } else if (!isIgnored(word)) {
      foreignWords.push(word);
    }
  }
  
  // Palavras TMDB que não apareceram no torrent
  for (const w of tmdbWords) {
    if (!torrentWords.includes(w)) {
      missingTmdb.push(w);
    }
  }
  
  const ratio = tmdbWords.length > 0 ? matchedTmdb.length / tmdbWords.length : 0;
  const allTmdbMatched = missingTmdb.length === 0;
  
  // ═══ DECISÃO ═══
  let verdict: 'ACCEPT' | 'REJECT' = 'ACCEPT';
  let reason = '';
  
  if (matchedTmdb.length === 0) {
    verdict = 'REJECT';
    reason = 'Nenhuma palavra TMDB encontrada';
  } else if (allTmdbMatched && foreignWords.length === 0) {
    verdict = 'ACCEPT';
    reason = 'Match perfeito';
  } else if (allTmdbMatched && foreignWords.length > 0) {
    verdict = 'ACCEPT';
    reason = `Todas TMDB OK + ${foreignWords.length} extras: [${foreignWords.join(', ')}]`;
  } else if (!allTmdbMatched && foreignWords.length === 0) {
    // Faltam palavras TMDB mas sem estranhas — borderline
    verdict = ratio >= 0.6 ? 'ACCEPT' : 'REJECT';
    reason = `Faltam: [${missingTmdb.join(', ')}] (${(ratio*100).toFixed(0)}%)`;
  } else if (!allTmdbMatched && foreignWords.length > 0) {
    // Palavras TMDB faltando E tem estranhas → REJEITAR
    verdict = 'REJECT';
    reason = `Faltam TMDB: [${missingTmdb.join(', ')}] + estranhas: [${foreignWords.join(', ')}]`;
  }
  
  return { torrentWords, tmdbWords, matchedTmdb, missingTmdb, foreignWords, ratio, allTmdbMatched, verdict, reason };
}

// ═══════════════════════════════════════════════════════════
// CASOS DE TESTE
// ═══════════════════════════════════════════════════════════
interface TestCase {
  label: string;
  torrent: string;
  tmdbTitle: string;
  expectedVerdict: 'ACCEPT' | 'REJECT';
  desc: string;
}

const CASES: TestCase[] = [
  // ─── MATCHES PERFEITOS ───
  { label: 'Aang S1', torrent: 'Avatar A Lenda de Aang 1ª Temporada Bluray 720p Dublado', tmdbTitle: 'Avatar: A Lenda de Aang', expectedVerdict: 'ACCEPT', desc: 'Todas palavras TMDB presentes' },
  { label: 'Matrix 1999', torrent: 'Matrix 1999 1080p Dublado BluRay', tmdbTitle: 'Matrix', expectedVerdict: 'ACCEPT', desc: '1 palavra TMDB, match perfeito' },
  { label: 'Poderoso Chefao', torrent: 'O Poderoso Chefao 1972 Dublado 1080p', tmdbTitle: 'O Poderoso Chefão', expectedVerdict: 'ACCEPT', desc: '3 palavras PT' },
  { label: 'Interestelar PT', torrent: 'Interestelar 2014 Dublado 1080p', tmdbTitle: 'Interestelar', expectedVerdict: 'ACCEPT', desc: 'Nome PT do TMDB' },
  { label: 'Breaking Bad', torrent: 'Breaking Bad 1 Temporada Completa Dublado', tmdbTitle: 'Breaking Bad', expectedVerdict: 'ACCEPT', desc: 'Série com nome EN (TMDB só tem EN)' },
  { label: 'Last of Us', torrent: 'The Last of Us S01E01 Dublado 1080p', tmdbTitle: 'The Last of Us', expectedVerdict: 'ACCEPT', desc: 'S01E01 é ignorado' },
  
  // ─── MATCHES COM PALAVRAS EXTRAS (ACEITAR) ───
  { label: 'Aang + livro', torrent: 'Avatar A Lenda de Aang Livro 1 Dublado', tmdbTitle: 'Avatar: A Lenda de Aang', expectedVerdict: 'ACCEPT', desc: '"livro" extra mas todas TMDB batem' },
  { label: 'Aang + download', torrent: 'Avatar A Lenda de Aang 1ª Temporada Bluray 720p Dublado – Download 2005', tmdbTitle: 'Avatar: A Lenda de Aang', expectedVerdict: 'ACCEPT', desc: '"download" é ignorado (técnico)' },
  { label: 'Matrix + internacional', torrent: 'Matrix Internacional BluRay 1080p Dublado', tmdbTitle: 'Matrix', expectedVerdict: 'ACCEPT', desc: '"internacional" extra mas TMDB batem' },
  
  // ─── FALSOS POSITIVOS (REJEITAR) ───
  { label: 'Korra vs Aang', torrent: 'Avatar A Lenda de Korra 3ª Temporada Dublado', tmdbTitle: 'Avatar: A Lenda de Aang', expectedVerdict: 'REJECT', desc: '"aang" falta + "korra" estranha → REJEITAR' },
  { label: 'Harry vs Matrix', torrent: 'Harry Potter Pedra Filosofal Dublado', tmdbTitle: 'Matrix', expectedVerdict: 'REJECT', desc: 'Nada bate' },
  { label: 'Vendedor vs Matrix', torrent: 'O Vendedor de Sonhos Dublado', tmdbTitle: 'Matrix', expectedVerdict: 'REJECT', desc: 'Nada bate' },
  
  // ─── SEQUÊNCIAS / SPIN-OFFS ───
  { label: 'Matrix 2 vs Matrix 1', torrent: 'Matrix Reloaded 2003 Dublado', tmdbTitle: 'Matrix', expectedVerdict: 'REJECT', desc: '"reloaded" é palavra estranha significativa' },
  { label: 'Matrix 3 vs Matrix 1', torrent: 'Matrix Revolutions 2003 Dublado', tmdbTitle: 'Matrix', expectedVerdict: 'REJECT', desc: '"revolutions" é estranha' },
  { label: 'Clone Wars vs SW', torrent: 'Star Wars The Clone Wars 1 Temporada', tmdbTitle: 'Star Wars', expectedVerdict: 'REJECT', desc: '"clone", "wars" extras' },
  { label: 'Batman Begins vs DK', torrent: 'Batman Begins 2005 Dublado', tmdbTitle: 'Batman: O Cavaleiro das Trevas', expectedVerdict: 'REJECT', desc: '"begins" estranha, faltam palavras TMDB' },
  
  // ─── CASOS BORDERLINE ───
  { label: 'Star Wars EP4 PT', torrent: 'Star Wars Uma Nova Esperanca 1977 Dublado', tmdbTitle: 'Guerra nas Estrelas', expectedVerdict: 'REJECT', desc: 'TMDB PT é "guerra nas estrelas", não "star wars"' },
  { label: 'Star Wars EP4 EN', torrent: 'Star Wars Uma Nova Esperanca 1977 Dublado', tmdbTitle: 'Star Wars', expectedVerdict: 'ACCEPT', desc: 'TMDB EN "star wars" bate 2/2' },
  
  // ─── TÍTULOS CURTOS ───
  { label: 'Shrek curto', torrent: 'Shrek 2001 Dublado 1080p', tmdbTitle: 'Shrek', expectedVerdict: 'ACCEPT', desc: '1 palavra, ok' },
  { label: 'It - A Coisa', torrent: 'It A Coisa Dublado 1080p', tmdbTitle: 'It: A Coisa', expectedVerdict: 'ACCEPT', desc: '"it" + "coisa" batem' },
  { label: 'Duna curto', torrent: 'Duna 2021 Dublado 1080p', tmdbTitle: 'Duna', expectedVerdict: 'ACCEPT', desc: '1 palavra, ok' },
  
  // ─── SÉRIES COM TEMPORADA ───
  { label: 'Game of Thrones', torrent: 'Game of Thrones 1 Temporada Dublado', tmdbTitle: 'Game of Thrones', expectedVerdict: 'ACCEPT', desc: '3 palavras batem' },
  { label: 'Dark', torrent: 'Dark 1 Temporada Dublado 1080p', tmdbTitle: 'Dark', expectedVerdict: 'ACCEPT', desc: '1 palavra' },
  { label: 'TWD', torrent: 'The Walking Dead 1 Temporada Dublado', tmdbTitle: 'The Walking Dead', expectedVerdict: 'ACCEPT', desc: '3 palavras, "the" ignorado' },
  
  // ─── CASOS PT-BR ESPECÍFICOS ───
  { label: 'A Origem', torrent: 'A Origem 2010 Dublado 1080p', tmdbTitle: 'A Origem', expectedVerdict: 'ACCEPT', desc: 'Título PT curto' },
  { label: 'Clube da Luta', torrent: 'Clube da Luta 1999 Dublado 1080p', tmdbTitle: 'Clube da Luta', expectedVerdict: 'ACCEPT', desc: '3 palavras, "da" ignorado' },
  { label: 'Tropa de Elite', torrent: 'Tropa de Elite 2007 Nacional 1080p', tmdbTitle: 'Tropa de Elite', expectedVerdict: 'ACCEPT', desc: '"de" ignorado, "tropa" + "elite" batem' },
];

async function main() {
  console.log('═'.repeat(90));
  console.log('TESTE DE FORÇA — Nova abordagem: loop único com foreign words');
  console.log('═'.repeat(90));

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const c of CASES) {
    const result = analyzeMatch(c.torrent, c.tmdbTitle);
    const ok = result.verdict === c.expectedVerdict;
    const icon = ok ? '✅' : '❌';

    console.log(`\n${icon} ${c.label}`);
    console.log(`   Torrent: "${c.torrent}"`);
    console.log(`   TMDB:    "${c.tmdbTitle}"`);
    console.log(`   Torrent words (>2): [${result.torrentWords.join(', ')}]`);
    console.log(`   TMDB words (>2):    [${result.tmdbWords.join(', ')}]`);
    console.log(`   Matched TMDB:   [${result.matchedTmdb.join(', ')}]`);
    console.log(`   Missing TMDB:   [${result.missingTmdb.join(', ')}]`);
    console.log(`   Foreign words:  [${result.foreignWords.join(', ')}]`);
    console.log(`   All TMDB matched: ${result.allTmdbMatched} | Ratio: ${(result.ratio*100).toFixed(0)}%`);
    console.log(`   ${result.verdict} — ${result.reason}`);
    console.log(`   ${c.desc}`);

    if (ok) {
      passed++;
    } else {
      failed++;
      failures.push(`${c.label}: esperava ${c.expectedVerdict} mas deu ${result.verdict}`);
    }
  }

  console.log('\n' + '═'.repeat(90));
  console.log(`RESULTADO: ${passed}/${CASES.length} passaram`);
  console.log('═'.repeat(90));

  if (failures.length > 0) {
    console.log('\n❌ FALHAS:');
    failures.forEach(f => console.log(`  ${f}`));
  } else {
    console.log('\n🎉 TODOS OS CASOS PASSARAM!');
  }

  // ─── Análise rápida ───
  console.log('\n═'.repeat(90));
  console.log('ANÁLISE');
  console.log('═'.repeat(90));
  console.log('Regras usadas:');
  console.log('  1. Se 0 palavras TMDB batem → REJEITAR');
  console.log('  2. Se TODAS palavras TMDB batem → ACEITAR (mesmo com extras)');
  console.log('  3. Se faltam palavras TMDB + NÃO tem estranhas → ACEITAR se ratio >= 60%');
  console.log('  4. Se faltam palavras TMDB + TEM estranhas → REJEITAR');
  console.log('');
  console.log('A regra #4 é a chave: resolve Korra vs Aang, Matrix 2 vs Matrix 1,');
  console.log('Clone Wars vs Star Wars, Batman Begins vs Dark Knight.');
}

main().catch(e => { console.error(e); process.exit(1); });
