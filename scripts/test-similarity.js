// Script: Teste unitário das condições A-G do SimilarityCalculator
// Testa a lógica interna sem depender de API externa (TMDB mockado)
// Roda com: node scripts/test-similarity.js
require('dotenv/config');
const { SimilarityCalculator } = require('../dist/titulos/SimilarityCalculator.js');

const calc = SimilarityCalculator.getInstance();

const testCases = [
  // ═══ BUG SUPER GIRL: série salva como filme ═══
  {
    label: 'Supergirl S04E21 COMO SERIE (tv)',
    tmdbTitles: ['Supergirl'],
    tmdbYear: 2015,
    tmdbMediaType: 'tv',
    torrentTitle: '[ACESSE comando1.com] Supergirl S04E21 [720p] [WEB-DL] [DUAL]',
    torrentYear: 2015,
    season: 4,
    expected: true, // S04E21 + nome bate = série correta
  },
  {
    label: 'Supergirl S04E21 COMO FILME (movie) — era o bug',
    tmdbTitles: ['Supergirl'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: '[ACESSE comando1.com] Supergirl S04E21 [720p] [WEB-DL] [DUAL]',
    torrentYear: 2015,
    expected: false, // E:X — SxxExx em filme é suspeito
  },

  // ═══ MANDALORIAN & GROGU: PT tem "Star Wars", EN não ═══
  {
    label: 'Mandalorian & Grogu filme (Star Wars no título)',
    tmdbTitles: ['Star Wars O Mandaloriano e Grogu', 'The Mandalorian and Grogu'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Star.Wars.The.Mandalorian.And.Grogu.2026.1080p.WEBRip.Dublado.mkv',
    torrentYear: 2026,
    expected: true, // F deve usar palavras de AMBOS os títulos TMDB
  },
];

// ─── Execução ───

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const movieInfo = {
    allTitles: tc.tmdbTitles,
    mediaType: tc.tmdbMediaType || 'movie',
    year: tc.tmdbYear,
  };

  // Chama compararTitulos diretamente (método privado acessado via any)
  const resultado = calc['compararTitulos'](
    tc.torrentTitle,
    movieInfo,
    tc.torrentYear ?? null,
    tc.season
  );

  const status = resultado.matches ? '✅ ACEITO' : '❌ REJEITADO';
  const ok = resultado.matches === tc.expected;

  if (!ok) {
    failed++;
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`🔥 FALHOU: ${tc.label}`);
    console.log(`   Esperado: ${tc.expected ? 'ACEITAR' : 'REJEITAR'} | Resultado: ${status}`);
    console.log(`   Torrent: "${tc.torrentTitle}"`);
    console.log(`   TMDB:    [${tc.tmdbTitles.join(' | ')}] ano=${tc.tmdbYear}`);
    console.log(`   Motivo:  ${resultado.reason}`);
    console.log(`${'═'.repeat(70)}`);
  } else {
    passed++;
  }

  console.log(`${ok ? '   ' : '🔥 '}${status} | ${tc.label}`);
  console.log(`      Motivo: ${resultado.reason}`);
}

console.log(`\n${'═'.repeat(50)}`);
console.log(`RESULTADO: ${passed}/${testCases.length} passaram`);
if (failed > 0) {
  console.log(`🔥 ${failed} FALHAS detectadas`);
  process.exit(1);
} else {
  console.log(`✅ TODOS OS TESTES PASSARAM!`);
}
