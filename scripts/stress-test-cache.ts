/**
 * STRESS TEST: Pré-compilação de regexes + CacheManager setInterval
 * 
 * Testa:
 * 1. normalizeForComparison com milhares de títulos variados
 * 2. CacheManager: escrita massiva + verificação de cleanup
 * 3. Memória e tempo de execução
 */
import 'dotenv/config';
import { SimilarityCalculator } from '../src/lib/title-filter/SimilarityCalculator.js';
import { CacheManager } from '../src/lib/title-filter/CacheManager.js';
import { TitleCleaner } from '../src/lib/title-filter/TitleCleaner.js';

const sim = SimilarityCalculator.getInstance();
const cache = CacheManager.getInstance();
const cleaner = TitleCleaner.getInstance();

// ─── Base de títulos realistas (PT-BR) ───
const TITLES = [
  'Avatar - A Lenda de Korra 3ª Temporada BDRip 720p Dublado',
  'Avatar A Lenda de Aang 1ª Temporada Bluray 720p Dublado - Download 2005',
  'Matrix 1999 1080p Dublado BluRay x264 AC3 5.1',
  'Vingadores Ultimato 2019 4K HDR Dublado WEB-DL',
  'O Poderoso Chefao 1972 Dublado 1080p BluRay',
  'Star Wars Uma Nova Esperanca 1977 Dublado 720p',
  'Breaking Bad 1 Temporada Completa Dublado 1080p',
  'Game of Thrones 8 Temporada 4K HDR Dublado',
  'Stranger Things 4 Temporada WEB-DL 1080p Dual Audio',
  'The Last of Us S01E01 Dublado 1080p HBO Max',
  'John Wick 4 Baba Yaga 2023 Dublado 4K',
  'Batman O Cavaleiro das Trevas 2008 Dublado 1080p',
  'Interestelar 2014 Dublado 1080p BluRay x265',
  'Clube da Luta 1999 Dublado 1080p',
  'Forrest Gump O Contador de Historias 1994 Dublado 720p',
  'Pulp Fiction Tempo de Violencia 1994 Dublado 1080p',
  'O Senhor dos Aneis A Sociedade do Anel 2001 Estendido Dublado 4K',
  'Tropa de Elite 2007 Nacional 1080p',
  'Cidade de Deus 2002 Nacional 1080p',
  'Toy Story 1995 Dublado 1080p',
  'Shrek 2001 Dublado 1080p',
  'O Rei Leao 1994 Dublado 720p',
  'Velozes e Furiosos 7 2015 Dublado 1080p BluRay',
  'Dark 1 Temporada Dublado 1080p Netflix',
  'La Casa de Papel 5 Temporada Dublado 4K',
];

function formatMem(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function formatMs(ms: number): string {
  if (ms < 1000) return ms.toFixed(2) + ' ms';
  return (ms / 1000).toFixed(2) + ' s';
}

// ═══════════════════════════════════════════════════════
// TESTE 1: normalizeForComparison em massa
// ═══════════════════════════════════════════════════════
async function testNormalizeForComparison() {
  console.log('═'.repeat(70));
  console.log('TESTE 1: normalizeForComparison — 50.000 chamadas');
  console.log('═'.repeat(70));

  const ITERATIONS = 50_000;
  const memBefore = process.memoryUsage().heapUsed;

  // Warmup (JIT)
  for (let i = 0; i < 100; i++) {
    sim.normalizeForComparison(TITLES[i % TITLES.length], 'movie');
  }

  // Teste real
  const start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    const title = TITLES[i % TITLES.length];
    const type = i % 3 === 0 ? 'movie' as const : 'tv' as const;
    sim.normalizeForComparison(title, type);
  }
  const elapsed = performance.now() - start;

  const memAfter = process.memoryUsage().heapUsed;
  const memDelta = memAfter - memBefore;

  console.log(`   Chamadas:     ${ITERATIONS.toLocaleString()}`);
  console.log(`   Tempo total:  ${formatMs(elapsed)}`);
  console.log(`   Por chamada:  ${(elapsed / ITERATIONS * 1000).toFixed(2)} μs`);
  console.log(`   Chamadas/s:   ${(ITERATIONS / (elapsed / 1000)).toFixed(0)}`);
  console.log(`   Memória:      ${formatMem(memBefore)} → ${formatMem(memAfter)} (Δ ${formatMem(memDelta)})`);

  // Mostra exemplos
  console.log('\n   Exemplos de normalização:');
  const samples = [TITLES[0], TITLES[1], TITLES[2]];
  for (const t of samples) {
    const n = sim.normalizeForComparison(t, t.includes('Temporada') ? 'tv' : 'movie');
    console.log(`     "${t.substring(0, 50)}..."`);
    console.log(`     → "${n}"`);
  }

  return { elapsed, iterations: ITERATIONS, memDelta };
}

// ═══════════════════════════════════════════════════════
// TESTE 2: CacheManager — escrita massiva + verificação
// ═══════════════════════════════════════════════════════
async function testCacheManager() {
  console.log('\n' + '═'.repeat(70));
  console.log('TESTE 2: CacheManager — 100.000 escritas + leituras');
  console.log('═'.repeat(70));

  const memBefore = process.memoryUsage().heapUsed;

  // Enche o cache de processados
  const startWrite = performance.now();
  for (let i = 0; i < 100_000; i++) {
    const key = `torrent_${i}_${TITLES[i % TITLES.length].substring(0, 20)}`;
    cache.markAsProcessed(key);
  }
  const writeElapsed = performance.now() - startWrite;

  // Verifica 50% de hits + 50% de misses
  const startRead = performance.now();
  let hits = 0;
  let misses = 0;
  for (let i = 0; i < 100_000; i++) {
    const key = i < 50_000
      ? `torrent_${i}_${TITLES[i % TITLES.length].substring(0, 20)}`  // deve existir
      : `never_seen_${i}`;                                              // não existe
    if (cache.isAlreadyProcessed(key)) hits++;
    else misses++;
  }
  const readElapsed = performance.now() - startRead;

  const memAfter = process.memoryUsage().heapUsed;

  console.log(`   Escritas:     ${(100_000).toLocaleString()} em ${formatMs(writeElapsed)}`);
  console.log(`   Leituras:     ${(100_000).toLocaleString()} em ${formatMs(readElapsed)}`);
  console.log(`   Hits:         ${hits.toLocaleString()} (${(hits/100_000*100).toFixed(1)}%)`);
  console.log(`   Misses:       ${misses.toLocaleString()} (${(misses/100_000*100).toFixed(1)}%)`);
  console.log(`   Média leitura: ${(readElapsed / 100_000 * 1000).toFixed(2)} μs`);
  console.log(`   Memória:      ${formatMem(memBefore)} → ${formatMem(memAfter)} (Δ ${formatMem(memAfter - memBefore)})`);

  return { writeElapsed, readElapsed, hits, misses };
}

// ═══════════════════════════════════════════════════════
// TESTE 3: TitleCleaner — cache de títulos limpos
// ═══════════════════════════════════════════════════════
async function testTitleCleaner() {
  console.log('\n' + '═'.repeat(70));
  console.log('TESTE 3: TitleCleaner — 20.000 extrações com cache');
  console.log('═'.repeat(70));

  const memBefore = process.memoryUsage().heapUsed;

  // Primeira passada: popula cache
  const start1 = performance.now();
  for (let i = 0; i < 1_000; i++) {
    cleaner.extractCleanTitle(TITLES[i % TITLES.length]);
  }
  const elapsed1 = performance.now() - start1;

  // Segunda passada: tudo do cache
  const start2 = performance.now();
  for (let i = 0; i < 20_000; i++) {
    cleaner.extractCleanTitle(TITLES[i % TITLES.length]);
  }
  const elapsed2 = performance.now() - start2;

  const memAfter = process.memoryUsage().heapUsed;

  console.log(`   Populando:    1.000 chamadas em ${formatMs(elapsed1)}`);
  console.log(`   Cache hit:    20.000 chamadas em ${formatMs(elapsed2)}`);
  console.log(`   Por chamada:  ${(elapsed2 / 20_000 * 1000).toFixed(2)} μs (cache)`);
  console.log(`   Speedup:      ${(elapsed1 / 1000 / (elapsed2 / 20000)).toFixed(1)}x mais rápido com cache`);
  console.log(`   Memória:      ${formatMem(memBefore)} → ${formatMem(memAfter)}`);

  return { elapsed1, elapsed2 };
}

// ═══════════════════════════════════════════════════════
// TESTE 4: Concorrência — múltiplas threads simuladas
// ═══════════════════════════════════════════════════════
async function testConcurrency() {
  console.log('\n' + '═'.repeat(70));
  console.log('TESTE 4: Concorrência — 100 "requests" simultâneos');
  console.log('═'.repeat(70));

  const start = performance.now();
  const tasks = Array.from({ length: 100 }, async (_, idx) => {
    // Cada "request" faz várias normalizações + cache hits
    for (let i = 0; i < 50; i++) {
      const title = TITLES[(idx + i) % TITLES.length];
      sim.normalizeForComparison(title, idx % 2 === 0 ? 'movie' : 'tv');
      cache.markAsProcessed(`req_${idx}_${i}`);
    }
    for (let i = 0; i < 50; i++) {
      cache.isAlreadyProcessed(`req_${idx}_${i}`);
    }
  });

  await Promise.all(tasks);
  const elapsed = performance.now() - start;

  console.log(`   Tasks paralelas:  100`);
  console.log(`   Ops por task:     100 (50 norm + 50 cache) = 10.000 total`);
  console.log(`   Tempo total:      ${formatMs(elapsed)}`);
  console.log(`   Ops/segundo:      ${(10_000 / (elapsed / 1000)).toFixed(0)}`);

  return { elapsed };
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   STRESS TEST — Pré-compilação Regex + CacheManager Timer    ║');
  console.log('║   Avalia: normalizeForComparison, CacheManager, TitleCleaner ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`   Node: ${process.version} | PID: ${process.pid}`);
  console.log(`   Memória inicial: ${formatMem(process.memoryUsage().heapUsed)}`);

  const results: Record<string, any> = {};

  try {
    results.test1 = await testNormalizeForComparison();
    results.test2 = await testCacheManager();
    results.test3 = await testTitleCleaner();
    results.test4 = await testConcurrency();
  } catch (err) {
    console.error('\n❌ ERRO durante o teste:', err);
    process.exit(1);
  }

  // ─── Resumo final ───
  console.log('\n' + '═'.repeat(70));
  console.log('RESUMO FINAL');
  console.log('═'.repeat(70));

  console.log(`\n   normalizeForComparison:`);
  console.log(`     ${(results.test1.iterations).toLocaleString()} chamadas em ${formatMs(results.test1.elapsed)}`);
  console.log(`     ${(results.test1.iterations / (results.test1.elapsed / 1000)).toFixed(0)} chamadas/s`);
  console.log(`     ${(results.test1.elapsed / results.test1.iterations * 1000).toFixed(2)} μs/chamada`);

  console.log(`\n   CacheManager:`);
  console.log(`     ${(results.test2.hits + results.test2.misses).toLocaleString()} leituras em ${formatMs(results.test2.readElapsed)}`);
  console.log(`     Hits: ${results.test2.hits.toLocaleString()} | Misses: ${results.test2.misses.toLocaleString()}`);

  console.log(`\n   TitleCleaner:`);
  console.log(`     20.000 cache hits em ${formatMs(results.test3.elapsed2)}`);
  console.log(`     ${results.test3.speedup}x mais rápido que sem cache`);

  console.log(`\n   Concorrência:`);
  console.log(`     100 tasks paralelas em ${formatMs(results.test4.elapsed)}`);

  const finalMem = process.memoryUsage().heapUsed;
  console.log(`\n   Memória final: ${formatMem(finalMem)}`);

  // Health check
  console.log('\n' + '═'.repeat(70));
  console.log('🏥 HEALTH CHECK');
  console.log('═'.repeat(70));

  // Verifica se a normalização ainda funciona corretamente
  const check1 = sim.normalizeForComparison('Avatar - A Lenda de Aang 1ª Temporada Dublado', 'tv');
  const ok1 = check1 === 'avatar lenda aang';
  console.log(`   Aang → "${check1}" ${ok1 ? '✅' : '❌'}`);

  const check2 = sim.normalizeForComparison('Matrix 1999 1080p Dublado', 'movie');
  const ok2 = check2 === 'matrix';
  console.log(`   Matrix → "${check2}" ${ok2 ? '✅' : '❌'}`);

  const check3 = sim.normalizeForComparison('Vingadores Ultimato 2019 4K Dublado', 'movie');
  const ok3 = check3 === 'vingadores ultimato';
  console.log(`   Ultimato → "${check3}" ${ok3 ? '✅' : '❌'}`);

  const allOk = ok1 && ok2 && ok3;
  console.log(`\n   ${allOk ? '✅ TODOS OS CHECKS PASSARAM' : '❌ HOUVE FALHAS'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
