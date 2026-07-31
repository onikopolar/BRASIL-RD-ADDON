// Script: Teste unitário das condições A-G do SimilarityCalculator
// Testa a lógica interna sem depender de API externa (TMDB mockado)
// Roda com: node scripts/test-similarity.js
require('dotenv/config');
const { SimilarityCalculator } = require('../dist/titulos/SimilarityCalculator.js');

const calc = SimilarityCalculator.getInstance();

const testCases = [
  // ═══ MORTAL KOMBAT ═══
  {
    label: 'MK2 legítimo (com "2" + ano certo)',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat 2 2026 WEB-DL 1080p x264 DUAL 5.1',
    torrentYear: 2026,
    expected: true,
  },
  {
    label: 'MK2 legítimo (com "2", sem ano no título)',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat 2 720P Dublado',
    torrentYear: null,
    expected: true,
  },
  {
    label: 'MK1 infiltrado em MK2 (sem "2", sem ano)',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat (em avi Dublado PT BR)',
    torrentYear: null,
    expected: false, // G:X — sem número de sequência
  },
  {
    label: 'MK original buscando MK original (deve aceitar)',
    tmdbTitles: ['Mortal Kombat'],
    tmdbYear: 2021,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat 2021 1080p DUAL',
    torrentYear: 2021,
    expected: true,
  },
  {
    label: 'MK Annihilation buscando MK2 (nome diferente → F:X)',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat Annihilation 1997 1080p',
    torrentYear: 1997,
    expected: false, // F:X (annihilation) + C:X (ano 1997≠2026)
  },
  {
    label: 'MK2 buscando MK original (ano errado → C:X)',
    tmdbTitles: ['Mortal Kombat'],
    tmdbYear: 2021,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat 2 2026 WEB-DL',
    torrentYear: 2026,
    expected: false, // C:X (ano divergente) + G:X? (não, TMDB=1 palavra → G:OK) → C:X
  },

  // ═══ VELOZES E FURIOSOS ═══
  {
    label: 'Velozes 10 legítimo',
    tmdbTitles: ['Velozes e Furiosos 10', 'Fast X'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'Velozes e Furiosos 10 2023 1080p DUAL',
    torrentYear: 2023,
    expected: true,
  },
  {
    label: 'Velozes 1 infiltrado em Velozes 10 (sem nº)',
    tmdbTitles: ['Velozes e Furiosos 10', 'Fast X'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'Velozes e Furiosos 2001 1080p DUAL',
    torrentYear: 2001,
    expected: false, // C:X (ano 2001≠2023) + G:X (sem 10)
  },

  // ═══ MISSÃO IMPOSSÍVEL ═══
  {
    label: 'MI7 legítimo (subtítulo, sem nº no TMDB)',
    tmdbTitles: ['Missão Impossível Acerto de Contas', 'Mission Impossible Dead Reckoning'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mission Impossible Dead Reckoning 2023 1080p',
    torrentYear: 2023,
    expected: true,
  },
  {
    label: 'MI1 infiltrado em MI7',
    tmdbTitles: ['Missão Impossível Acerto de Contas', 'Mission Impossible Dead Reckoning'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mission Impossible 1996 1080p',
    torrentYear: 1996,
    expected: false, // C:X (ano 1996≠2023)
  },

  // ═══ JOHN WICK ═══
  {
    label: 'John Wick 4 legítimo',
    tmdbTitles: ['John Wick 4 Baba Yaga', 'John Wick Chapter 4'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'John Wick 4 Baba Yaga 2023 1080p DUAL',
    torrentYear: 2023,
    expected: true,
  },
  {
    label: 'John Wick 1 infiltrado em JW4 (sem 4)',
    tmdbTitles: ['John Wick 4 Baba Yaga', 'John Wick Chapter 4'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'John Wick 2014 1080p DUAL',
    torrentYear: 2014,
    expected: false, // C:X + G:X
  },

  // ═══ FILMES NORMAIS (não sequência) ═══
  {
    label: 'Filme normal — Matrix',
    tmdbTitles: ['Matrix'],
    tmdbYear: 1999,
    tmdbMediaType: 'movie',
    torrentTitle: 'Matrix 1999 1080p DUAL',
    torrentYear: 1999,
    expected: true,
  },
  {
    label: 'Filme normal — Matrix (sem ano no título)',
    tmdbTitles: ['Matrix'],
    tmdbYear: 1999,
    tmdbMediaType: 'movie',
    torrentTitle: 'Matrix 1080p DUAL',
    torrentYear: null,
    expected: true,
  },

  // ═══ CASOS DIFÍCEIS ═══
  {
    label: 'Título pontilhado — MK2',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal.Kombat.2.2026.WEB-DL.1080p.x264.DUAL.5.1-STARCKFILMES',
    torrentYear: 2026,
    expected: true,
  },
  {
    label: '"Máquinas Mortais" NÃO é Mortal Kombat',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Máquinas.Mortais.2018.1080p.x264.WEB-DL.DUAL.2.0-SF',
    torrentYear: 2018,
    expected: false, // A:X (palavras TMDB faltando)
  },
  {
    label: 'Série: The Last of Us S01E01',
    tmdbTitles: ['The Last of Us'],
    tmdbYear: 2023,
    tmdbMediaType: 'tv',
    torrentTitle: 'The Last of Us S01E01 1080p DUAL',
    torrentYear: 2023,
    season: 1,
    expected: true,
  },
  {
    label: 'MK Legacy (série) NÃO é MK2 filme',
    tmdbTitles: ['Mortal Kombat 2', 'Mortal Kombat II'],
    tmdbYear: 2026,
    tmdbMediaType: 'movie',
    torrentTitle: 'Mortal Kombat: Legacy - Stagione 1-2 (2011-2013) [COMPLETA] 1080p H265',
    torrentYear: 2011,
    expected: false, // C:X (ano) + F:X (legacy/stagione)
  },

  // ═══ BUG: TMDB 1 palavra — "The Witcher A Origem" NÃO é "FROM" ═══
  {
    label: '"The Witcher A Origem" NÃO é "FROM (Origem)"',
    tmdbTitles: ['Origem', 'From'],
    tmdbYear: 2022,
    tmdbMediaType: 'tv',
    torrentTitle: 'The.Witcher.A.Origem.S01.1080p.WEB-DL.DUAL.5.1',
    torrentYear: null,
    season: 1,
    expected: false, // C:X — TMDB 1 palavra sem SxxExx → rejeita ambiguidade
  },
  {
    label: '"FROM S01E07" DEVE ser "FROM (Origem)"',
    tmdbTitles: ['Origem', 'From'],
    tmdbYear: 2022,
    tmdbMediaType: 'tv',
    torrentTitle: 'From.S01E07.1080p.WEB-DL.DUAL.5.1',
    torrentYear: null,
    season: 1,
    expected: true, // tem S01E07 → evidência suficiente
  },

  // ═══ BUGS REAIS DO BANCO ═══
  {
    label: '"Mestres do Assalto" NAO e "Mestres do Ar" (tt0427340)',
    tmdbTitles: ['Mestres do Ar', 'Masters of the Air'],
    tmdbYear: 2024,
    tmdbMediaType: 'tv',
    torrentTitle: 'Mestres.do.Assalto.2025.1080p.x264.WEB-DL.DUAL.5.1-SF',
    torrentYear: 2025,
    expected: false, // C:X (ano 2025≠2024) + F:X (assalto ≠ ar)
  },
  {
    label: '"Mestres do Universo" NAO e "Mestres do Ar" (tt0427340)',
    tmdbTitles: ['Mestres do Ar', 'Masters of the Air'],
    tmdbYear: 2024,
    tmdbMediaType: 'tv',
    torrentTitle: 'Mestres.do.Universo.2026.WEB-DL.2160p.x265.DV.HDR10.DUAL.5.1-STARCKFILMES',
    torrentYear: 2026,
    expected: false, // C:X (ano 2026≠2024) + F:X (universo ≠ ar)
  },
  {
    label: '"Master of the Air S01E06" DEVE ser "Mestres do Ar"',
    tmdbTitles: ['Mestres do Ar', 'Masters of the Air'],
    tmdbYear: 2024,
    tmdbMediaType: 'tv',
    torrentTitle: 'Masters.of.the.Air.S01E06.1080p.WEB-DL.DUAL',
    torrentYear: 2024,
    season: 1,
    expected: true, // titulo quase igual + SxxExx
  },
  {
    label: '"Joy Ride 2021" NAO e "Joy Ride 2023/Loucas em Apuros" (tt15268244)',
    tmdbTitles: ['Loucas em Apuros', 'Joy Ride'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'Joy.Ride.2021.1080p.WEBRip.Legendado.mkv',
    torrentYear: 2021,
    expected: false, // C:X (ano 2021≠2023)
  },
  {
    label: '"Loucas em Apuros 2023" DEVE ser "Joy Ride" (tt15268244)',
    tmdbTitles: ['Loucas em Apuros', 'Joy Ride'],
    tmdbYear: 2023,
    tmdbMediaType: 'movie',
    torrentTitle: 'Loucas em Apuros.2023.BluRay.1080p.x264.DUAL.5.1',
    torrentYear: 2023,
    expected: true,
  },
  {
    label: 'Vingadores EXTRAS NAO deveria estar no catalogo',
    tmdbTitles: ['Vingadores Guerra Infinita', 'Avengers Infinity War'],
    tmdbYear: 2018,
    tmdbMediaType: 'movie',
    torrentTitle: 'Vingadores - Guerra Infinita - EXTRAS 2018 (1080p)',
    torrentYear: 2018,
    expected: false, // F:X ("extras" fora do padrao TMDB)
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
