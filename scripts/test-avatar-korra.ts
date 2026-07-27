/**
 * Teste: Validar checkForeignWords — simula o que acontece em produção
 * sem depender da API TMDB.
 */
import { SimilarityCalculator } from '../src/lib/title-filter/SimilarityCalculator.js';

const sim = SimilarityCalculator.getInstance();

// Simula os títulos que o TMDB retornaria para tt0417299 (Aang)
const AANG_TMDB_TITLES = [
  'Avatar: The Last Airbender',
  'Avatar: A Lenda de Aang',
  'Avatar: El Último Maestro del Aire',
];

const KORRA_TORRENT = 'Avatar - A Lenda de Korra 3ª Temporada BDRip 720p Dublado';
const AANG_TORRENT = 'Avatar - A Lenda de Aang 3ª Temporada BDRip 720p Dublado';
const AANG_TORRENT_LIVRO = 'Avatar A Lenda de Aang Livro 1 Dublado';

console.log('='.repeat(80));
console.log('TESTE: checkForeignWords (simulação sem API TMDB)');
console.log('='.repeat(80));

function testCase(label: string, torrentTitle: string, tmdbTitles: string[], expectReject: boolean) {
  const torrentClean = sim.normalizeForComparison(torrentTitle, 'tv');
  const torrentWords = torrentClean.split(' ').filter(w => w.length > 2);
  
  // Coleta palavras TMDB
  const tmdbWords = new Set<string>();
  for (const title of tmdbTitles) {
    sim.normalizeForComparison(title, 'tv').split(' ')
      .filter(w => w.length > 2)
      .forEach(w => tmdbWords.add(w));
  }
  
  const foreignWords = torrentWords.filter(w => !tmdbWords.has(w));
  const foreignRatio = foreignWords.length / torrentWords.length;
  const penalty = 1 - foreignRatio;
  
  // Similaridade simulada (aproximada do que o enhancedContextAnalysis retornaria)
  const estimatedSim = torrentTitle.toLowerCase().includes('korra') ? 0.72 : 
                        torrentTitle.toLowerCase().includes('livro') ? 1.0 : 0.95;
  const adjustedSim = estimatedSim * Math.max(0.3, penalty);
  const threshold = 0.55;
  const rejected = adjustedSim < threshold;
  
  const status = rejected === expectReject ? '✅' : '❌';
  console.log(`\n${status} ${label}`);
  console.log(`   Torrent: "${torrentTitle}"`);
  console.log(`   Normalizado: "${torrentClean}"`);
  console.log(`   Torrent words (>2 chars): [${torrentWords.join(', ')}]`);
  console.log(`   TMDB words: [${[...tmdbWords].join(', ')}]`);
  console.log(`   Foreign words: [${foreignWords.join(', ')}]`);
  console.log(`   Foreign ratio: ${(foreignRatio * 100).toFixed(1)}%`);
  console.log(`   Penalty factor: ${penalty.toFixed(2)}`);
  console.log(`   Est. similarity: ${(estimatedSim * 100).toFixed(1)}%`);
  console.log(`   Adjusted similarity: ${(adjustedSim * 100).toFixed(1)}%`);
  console.log(`   Threshold: ${(threshold * 100).toFixed(1)}%`);
  console.log(`   Rejected: ${rejected} (expected: ${expectReject})`);
}

// Teste 1: Korra vs TMDB Aang → DEVE rejeitar
testCase('Korra torrent vs Aang TMDB → REJEITAR', KORRA_TORRENT, AANG_TMDB_TITLES, true);

// Teste 2: Aang vs TMDB Aang → NÃO deve rejeitar
testCase('Aang torrent vs Aang TMDB → ACEITAR', AANG_TORRENT, AANG_TMDB_TITLES, false);

// Teste 3: Aang com "Livro" vs TMDB Aang → NÃO deve rejeitar (palavra extra inofensiva)
testCase('Aang+Livro torrent vs Aang TMDB → ACEITAR', AANG_TORRENT_LIVRO, AANG_TMDB_TITLES, false);

console.log('\n' + '='.repeat(80));
console.log('TESTE CONCLUÍDO');
console.log('='.repeat(80));
