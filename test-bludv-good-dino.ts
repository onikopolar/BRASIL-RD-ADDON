import { BludvScraper } from './src/services/scraper/bludvScraper';

async function testarBomDinossauro() {
  const scraper = new BludvScraper();

  console.log('════════════════════════════════════════');
  console.log('TESTE 1: searchPosts (pré-filtro)');
  console.log('════════════════════════════════════════');
  const posts = await (scraper as any).searchPosts(
    'o bom dinossauro',
    undefined,
    ['o bom dinossauro', 'o bom dinossauro 2015', 'the good dinosaur']
  );
  console.log('Posts encontrados:', posts.length);
  posts.forEach((p: any, i: number) => console.log(`${i}: ${p.title} -> ${p.url}`));

  console.log('\n════════════════════════════════════════');
  console.log('TESTE 2: scrapePost com IMDb correto (tt1979388)');
  console.log('════════════════════════════════════════');
  const postCorreto = posts[0];
  if (postCorreto) {
    const torrents = await (scraper as any).scrapePost(postCorreto.url, 'movie', undefined, 'tt1979388');
    console.log('Torrents extraídos:', torrents.length);
    torrents.forEach((t: any, i: number) => {
      console.log(`\n${i}:`, {
        title: t.title,
        originalTitle: t.originalTitle,
        year: t.year,
        years: t.years,
        imdbConfirmed: t.imdbConfirmed,
        quality: t.quality,
        language: t.language,
        provider: t.provider,
        magnetInicio: t.magnet?.substring(0, 60),
      });
    });
  }

  console.log('\n════════════════════════════════════════');
  console.log('TESTE 3: scrapePost com IMDb incorreto (tt9999999)');
  console.log('════════════════════════════════════════');
  if (postCorreto) {
    const torrentsErrados = await (scraper as any).scrapePost(postCorreto.url, 'movie', undefined, 'tt9999999');
    console.log('Torrents extraídos (deve ser 0):', torrentsErrados.length);
  }

  console.log('\n════════════════════════════════════════');
  console.log('TESTE 4: search (fluxo completo)');
  console.log('════════════════════════════════════════');
  const comImdb = await scraper.search(
    'o bom dinossauro',
    'movie',
    undefined,
    ['o bom dinossauro', 'o bom dinossauro 2015', 'the good dinosaur'],
    'tt1979388'
  );
  const semImdb = await scraper.search(
    'o bom dinossauro',
    'movie',
    undefined,
    ['o bom dinossauro', 'o bom dinossauro 2015', 'the good dinosaur']
  );
  const imdbErrado = await scraper.search(
    'o bom dinossauro',
    'movie',
    undefined,
    ['o bom dinossauro', 'o bom dinossauro 2015', 'the good dinosaur'],
    'tt9999999'
  );
  console.log('Com IMDb correto:', comImdb.length);
  console.log('Sem IMDb:', semImdb.length);
  console.log('Com IMDb errado:', imdbErrado.length);
}

testarBomDinossauro().catch(err => {
  console.error('Erro geral no teste:', err);
  process.exit(1);
});
