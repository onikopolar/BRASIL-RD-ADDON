/**
 * Script de diagnóstico: busca torrents para um IMDB ID específico
 * e mostra o pipeline completo de scraping/filtragem com detalhes.
 * 
 * Uso: npx tsx scripts/diagnostico.ts <imdbId> [season] [episode]
 * Ex:  npx tsx scripts/diagnostico.ts tt0206512 3 36
 */
import { TorrentScraperService } from '../src/services/scraper/TorrentScraperService.js';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';
import { TitleFilter } from '../src/titulos/titleFilter.js';
import { analisarMagnet } from '../src/magnet/magnetHelper.js';
import { Logger } from '../src/utils/logger.js';

const logger = new Logger('Diagnostico');

interface Resultado {
  provider: string;
  titulo: string;
  originalTitle?: string;
  year?: number;
  idioma: string;
  qualidade: string;
  magnetPreview: string;
  filtroResultado: string;
  motivo: string;
}

async function main() {
  const args = process.argv.slice(2);
  const imdbId = args[0] || 'tt0206512'; // SpongeBob default
  const season = args[1] ? parseInt(args[1]) : 3;
  const episode = args[2] ? parseInt(args[2]) : 36;

  console.log(`\n🔍 DIAGNÓSTICO: ${imdbId} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`);
  console.log('═'.repeat(70));

  // ── Passo 1: Buscar dados IMDB/TMDB ──
  console.log('\n📡 Passo 1: Buscando dados TMDB...');
  const imdbScraper = ImdbScraperService.getInstance();
  const tmdb = await imdbScraper.getTitlesFromImdbId(imdbId, season);
  console.log(`   Título original: "${tmdb?.originalTitle}"`);
  console.log(`   Título PT: "${tmdb?.portugueseTitle}"`);
  console.log(`   Ano: ${tmdb?.year}`);
  console.log(`   Tipo: ${tmdb?.mediaType}`);
  console.log(`   All titles: [${tmdb?.allTitles?.join(', ')}]`);

  if (!tmdb?.originalTitle) {
    console.log('\n❌ Sem dados TMDB — abortando.');
    return;
  }

  // ── Passo 2: Scrape ──
  console.log(`\n🔎 Passo 2: Buscando "${tmdb.originalTitle} Temporada ${season}" nos scrapers...`);
  const scraper = new TorrentScraperService();
  const searchQuery = `${tmdb.originalTitle} Temporada ${season}`;
  const torrents = await scraper.searchTorrents(searchQuery, 'series', season, tmdb.year ?? undefined, imdbId);

  console.log(`\n📦 ${torrents.length} torrents brutos encontrados:\n`);

  const titleFilter = new TitleFilter();
  const resultados: Resultado[] = [];

  for (let i = 0; i < torrents.length; i++) {
    const t = torrents[i];
    const magnetData = await analisarMagnet(t.magnet).catch(() => null);
    const tituloParaValidar = t.originalTitle || magnetData?.nome || t.title;
    const tituloParaIdioma = magnetData?.nome || t.title;

    // ── Filtro de idioma + similaridade ──
    const result = await titleFilter.titulosCombinam(
      tituloParaValidar,      // originalTitle (do HTML) → similaridade
      imdbId,                 // IMDB ID
      season,                 // temporada alvo
      episode,                // episódio alvo
      tituloParaIdioma,       // canonicalName (dn magnet) → idioma + S/E
      t.year                  // ano extraído do scraper
    );

    const status = result.matches ? '✅ APROVADO' : '❌ REJEITADO';
    const r: Resultado = {
      provider: t.provider,
      titulo: t.title.substring(0, 70),
      originalTitle: t.originalTitle?.substring(0, 50),
      year: t.year,
      idioma: t.language || '?',
      qualidade: t.quality || '?',
      magnetPreview: t.magnet.substring(0, 60),
      filtroResultado: status,
      motivo: result.reason || result.motivo || '?',
    };
    resultados.push(r);
  }

  // ── Exibe tabela ──
  console.log(`${'Prov'.padEnd(8)} ${'Status'.padEnd(11)} ${'OriginalTitle'.padEnd(30)} ${'Ano'.padEnd(6)} ${'Motivo'}`);
  console.log('─'.repeat(100));
  for (const r of resultados) {
    console.log(
      `${r.provider.padEnd(8)} ${r.filtroResultado.padEnd(11)} ${(r.originalTitle || r.titulo).padEnd(30).substring(0, 30)} ${String(r.year || '-').padEnd(6)} ${r.motivo}`
    );
  }

  // ── Resumo ──
  const aprovados = resultados.filter(r => r.filtroResultado.includes('APROVADO'));
  const rejeitados = resultados.filter(r => r.filtroResultado.includes('REJEITADO'));
  console.log(`\n📊 Resumo: ${aprovados.length} aprovados, ${rejeitados.length} rejeitados (${torrents.length} total)`);

  if (aprovados.length > 0) {
    console.log('\n✅ Aprovados:');
    aprovados.forEach(r => console.log(`   [${r.provider}] ${r.originalTitle || r.titulo} | ${r.motivo}`));
  }
  if (rejeitados.length > 0) {
    console.log('\n❌ Rejeitados:');
    rejeitados.forEach(r => console.log(`   [${r.provider}] ${r.originalTitle || r.titulo} | ${r.motivo}`));
  }

  // ── Detalhe dos títulos ──
  console.log('\n📝 Títulos completos dos torrents:');
  torrents.forEach((t, i) => {
    console.log(`   [${i}] ${t.provider} | dn: "${t.title}" | originalTitle: "${t.originalTitle || 'N/D'}" | ano: ${t.year || 'N/D'}`);
  });
}

main().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
