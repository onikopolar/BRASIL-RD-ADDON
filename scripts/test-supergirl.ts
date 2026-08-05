// Teste completo do fluxo Supergirl 2026 (filme) vs Supergirl 2017 (série)
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';
import { TitleFilter } from '../src/titulos/titleFilter.js';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';

async function main() {
  const imdbId = 'tt8814476'; // Supergirl (2026 movie)
  const simCalc = SimilarityCalculator.getInstance();
  const titleFilter = TitleFilter.getInstance();

  // 1. Dados TMDB reais
  console.log('=== 1. TMDB DATA ===');
  const imdb = ImdbScraperService.getInstance();
  const tmdb = await imdb.getTitlesFromImdbId(imdbId);
  console.log('  originalTitle:', tmdb?.originalTitle);
  console.log('  year:', tmdb?.year);
  console.log('  mediaType:', tmdb?.mediaType);
  console.log('  allTitles:', tmdb?.allTitles);

  // 2. Casos de teste: torrents que NÃO deveriam passar
  const casos = [
    // Correto (filme 2026)
    { titulo: 'Supergirl 2026 WEB-DL 1080p x264 DUAL 5.1', anoScraper: 2026, esperado: true, desc: 'Filme 2026 ✅' },
    // ERRADO (série 2017) - NÃO deveria passar
    { titulo: 'Supergirl 2017 - S03E03 [WEB-DL] WWW.BLUDV.COM', anoScraper: 2017, esperado: false, desc: 'Série 2017 S03E03 ❌' },
    { titulo: 'supergirl 2016 1ª temporada completa 720p web dl x264 dual bludv', anoScraper: 2016, esperado: false, desc: 'Série 2016 pack ❌' },
    { titulo: 'Supergirl.S05E05.720p.WEB-DL.DUAL.COMANDOTORRENTS.mkv', anoScraper: 2019, esperado: false, desc: 'Série 2019 S05E05 ❌' },
    // Sem ano do scraper (fallback regex)
    { titulo: 'Supergirl 2017 - S03E03 [WEB-DL] WWW.BLUDV.COM', anoScraper: undefined, esperado: false, desc: 'Série 2017 (sem ano scraper) ❌' },
  ];

  console.log('\n=== 2. FLUXO COMPLETO (titleFilter.titulosCombinam) ===');
  for (const c of casos) {
    // originalTitle do HTML (sem ano) → similaridade
    // canonicalName (dn magnet) → temporada/episódio
    const originalTitle = 'Supergirl'; // o que o scraper extrai do HTML
    const canonicalName = c.titulo;    // nome do magnet (dn=)
    
    const result = await titleFilter.titulosCombinam(
      originalTitle,   // tituloTorrent (originalTitle do HTML)
      imdbId,          // IMDB ID
      undefined,       // temporadaAlvo (filme)
      undefined,       // episodioAlvo
      canonicalName,   // tituloParaIdioma (dn magnet - detecção S/E)
      c.anoScraper     // anoDoScraper
    );

    const status = result.matches ? (c.esperado ? '✅ OK' : '❌ FALSO POSITIVO') : (c.esperado ? '❌ FALSO NEGATIVO' : '✅ OK');
    console.log(`  [${status}] ${c.desc}`);
    console.log(`    matches: ${result.matches} | similarity: ${result.similarity} | reason: ${result.reason}`);
    console.log(`    torrentMetadata: season=${result.torrentMetadata?.season} episode=${result.torrentMetadata?.episode}`);
  }

  // 3. Debug direto do SimilarityCalculator
  console.log('\n=== 3. SIMILARITY CALCULATOR DIRETO ===');
  for (const c of casos.slice(0, 3)) {
    const result = await simCalc.smartTitleContainsCheck(
      'Supergirl',     // originalTitle (do HTML)
      imdbId,
      { year: c.anoScraper, season: undefined }, // torrentMetadata
      c.titulo         // rawTitleForLanguage (dn magnet)
    );
    console.log(`  [${c.desc}]: matches=${result.matches} similarity=${result.similarity} reason=${result.reason}`);
  }
}

main().catch(e => console.error('Erro:', e));
