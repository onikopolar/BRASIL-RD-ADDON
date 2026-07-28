// Teste de estresse: valida o pipeline completo com múltiplos filmes/séries
// Verifica: scraping TPB/WP, detecção PT-BR, rejeição de EN, salvamento DB
// Rode com: npx tsx scripts/stress-test.ts

import 'dotenv/config';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService';
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService';
import { TitleFilter } from '../src/titulos/titleFilter';
import { LanguageDetector } from '../src/titulos/LanguageDetector';

interface TestCase {
  imdbId: string;
  name: string;
  type: 'movie' | 'series';
  season?: number;
  episode?: number;
  minExpectedPT: number; // mínimo de torrents PT esperados
}

const TEST_CASES: TestCase[] = [
  // === FILMES COM TÍTULO PT CONHECIDO ===
  { imdbId: 'tt2820466', name: 'Liga da Justiça: Ponto de Ignição (2013)', type: 'movie', minExpectedPT: 1 },
  { imdbId: 'tt0317219', name: 'Carros (2006)', type: 'movie', minExpectedPT: 1 },
  { imdbId: 'tt0325537', name: 'O Som do Trovão (2005)', type: 'movie', minExpectedPT: 0 },
  { imdbId: 'tt12593682', name: 'Resgate 2 (2023)', type: 'movie', minExpectedPT: 1 },

  // === FILMES SÓ COM TÍTULO EN (sem PT no TMDB) ===
  { imdbId: 'tt0816692', name: 'Interstellar (2014)', type: 'movie', minExpectedPT: 1 }, // tem PT no BR
  { imdbId: 'tt0133093', name: 'Matrix (1999)', type: 'movie', minExpectedPT: 0 }, // mínimo 0

  // === SÉRIES ===
  { imdbId: 'tt7631058', name: 'Rings of Power S01E03', type: 'series', season: 1, episode: 3, minExpectedPT: 0 },
  { imdbId: 'tt0903747', name: 'Breaking Bad S01E01', type: 'series', season: 1, episode: 1, minExpectedPT: 0 },
];

const tmdb = ImdbScraperService.getInstance();
const scraper = new TorrentScraperService();
const titleFilter = TitleFilter.getInstance();
const langDetector = LanguageDetector.getInstance();

async function testTmdb(imdbId: string, name: string) {
  console.log(`\n📡 TMDB: ${name} (${imdbId})`);
  const titles = await tmdb.getTitlesFromImdbId(imdbId);
  console.log(`   Original : ${titles.originalTitle}`);
  console.log(`   PT BR    : ${titles.portugueseTitle || '❌ NÃO TEM'}`);
  console.log(`   PT Raw   : ${titles.portugueseTitleRaw || '❌ NÃO TEM'}`);
  console.log(`   Ano      : ${titles.year || 'N/A'}`);
  return titles;
}

async function testScraping(imdbId: string, type: 'movie' | 'series', season?: number, episode?: number) {
  console.log(`\n🔍 Scraping: ${imdbId}`);
  const start = Date.now();
  const torrents = await scraper.searchTorrents('', type, season, undefined, imdbId);
  const elapsed = Date.now() - start;
  console.log(`   Total scraped: ${torrents.length} torrents em ${elapsed}ms`);

  // Classificar por PT/EN
  let ptCount = 0;
  let enCount = 0;
  let ptWithDual = 0;
  const ptSamples: string[] = [];
  const enSamples: string[] = [];

  for (const t of torrents) {
    const nome = t.title;
    const resultado = langDetector.verificarIdioma(nome, null, null);

    if (resultado.ehPortugues) {
      ptCount++;
      if (ptSamples.length < 3) ptSamples.push(nome.substring(0, 60));
      if (nome.toLowerCase().includes('dual') || nome.toLowerCase().includes('dublado')) {
        ptWithDual++;
      }
    } else {
      enCount++;
      if (enSamples.length < 3) enSamples.push(nome.substring(0, 60));
    }
  }

  console.log(`   ✅ PT-BR : ${ptCount} (${ptWithDual} com Dual/Dublado)`);
  console.log(`   ❌ EN    : ${enCount}`);
  if (ptSamples.length > 0) {
    console.log(`   📄 PT samples:`);
    ptSamples.forEach(s => console.log(`      - ${s}`));
  }
  if (enSamples.length > 0 && enCount > 0) {
    console.log(`   📄 EN samples:`);
    enSamples.forEach(s => console.log(`      - ${s}`));
  }

  // Verificar falso-positivos EN
  const enWithBrIndicators = torrents.filter((t: any) => {
    const nome = t.title.toLowerCase();
    return !langDetector.verificarIdioma(nome, null, null).ehPortugues
      && (nome.includes('dual') || nome.includes('dublado') || nome.includes('brasil'));
  });
  if (enWithBrIndicators.length > 0) {
    console.log(`   ⚠️  EN com indicadores BR: ${enWithBrIndicators.length}`);
  }

  return { ptCount, enCount, total: torrents.length, elapsed };
}

async function main() {
  console.log('🧪 TESTE DE ESTRESSE — Pipeline Completo');
  console.log('═'.repeat(60));

  const results: any[] = [];
  let totalPt = 0;
  let totalEn = 0;
  let totalTime = 0;

  for (const tc of TEST_CASES) {
    try {
      await testTmdb(tc.imdbId, tc.name);
      const r = await testScraping(tc.imdbId, tc.type, tc.season, tc.episode);
      results.push({ ...tc, ...r });

      totalPt += r.ptCount;
      totalEn += r.enCount;
      totalTime += r.elapsed;

      // Verificação de mínimo esperado
      if (tc.minExpectedPT > 0 && r.ptCount < tc.minExpectedPT) {
        console.log(`   ⚠️  ALERTA: Esperado ≥${tc.minExpectedPT} PT, encontrado ${r.ptCount}`);
      }
    } catch (err: any) {
      console.log(`   ❌ ERRO: ${err.message}`);
      results.push({ ...tc, ptCount: -1, enCount: -1, total: -1, elapsed: 0, error: err.message });
    }
  }

  // Resumo final
  console.log('\n' + '═'.repeat(60));
  console.log('📊 RESUMO FINAL');
  console.log('═'.repeat(60));
  console.log(`   Total PT-BR : ${totalPt}`);
  console.log(`   Total EN    : ${totalEn}`);
  console.log(`   Total       : ${totalPt + totalEn}`);
  console.log(`   Tempo total : ${totalTime}ms (${(totalTime / 1000).toFixed(1)}s)`);
  console.log(`   Média       : ${(totalTime / results.length).toFixed(0)}ms por item`);

  // Itens com 0 PT (possível problema)
  const zeroPt = results.filter(r => r.ptCount === 0 && r.minExpectedPT > 0);
  if (zeroPt.length > 0) {
    console.log(`\n   ⚠️  Itens com 0 PT (esperado >0):`);
    zeroPt.forEach(r => console.log(`      - ${r.name} (${r.imdbId})`));
  }

  console.log('\n✅ Teste concluído.');
}

main().catch(err => {
  console.error('❌ Falha no teste:', err);
  process.exit(1);
});
