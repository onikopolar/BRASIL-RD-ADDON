import { BludvScraper } from './src/services/scraper/bludvScraper';

async function testarSee() {
  const scraper = new BludvScraper();

  console.log('════════════════════════════════════════');
  console.log('TESTE 1: searchPosts para See 1ª temporada');
  console.log('════════════════════════════════════════');
  const posts = await (scraper as any).searchPosts(
    'see 1 temporada',
    1,
    ['see 1 temporada', 'see primeira temporada']
  );
  console.log('Posts encontrados:', posts.length);
  posts.forEach((p: any, i: number) => console.log(`${i}: ${p.title} -> ${p.url}`));

  if (posts.length === 0) {
    console.log('Nenhum post encontrado.');
    return;
  }

  const post = posts[0];
  console.log('\nPost escolhido:', post.title);

  console.log('\n════════════════════════════════════════');
  console.log('TESTE 2: scrapePost com IMDb correto (tt7284870)');
  console.log('════════════════════════════════════════');
  const torrents = await (scraper as any).scrapePost(post.url, 'series', 1, 'tt7284870');
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
      season: t.season,
      episode: t.episode,
      magnetInicio: t.magnet?.substring(0, 60),
    });
  });

  console.log('\n════════════════════════════════════════');
  console.log('TESTE 3: scrapePost com IMDb errado (tt9999999)');
  console.log('════════════════════════════════════════');
  const torrentsErrados = await (scraper as any).scrapePost(post.url, 'series', 1, 'tt9999999');
  console.log('Torrents extraídos (deve ser 0):', torrentsErrados.length);
}

testarSee().catch(err => {
  console.error('Erro geral no teste:', err);
  process.exit(1);
});
