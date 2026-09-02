import { BludvScraper } from './src/services/scraper/bludvScraper';

(async () => {
  const scraper = new BludvScraper();
  const url = 'https://bludvfilmes1.xyz/see-1a-temporada-torrent-web-dl-720p-1080p-dual-audio-download-2019/';

  console.log('Testando com IMDb correto (tt7949218)...');
  const torrents = await (scraper as any).scrapePost(url, 'series', 1, 'tt7949218');
  console.log('Torrents extraídos:', torrents.length);
  torrents.forEach((t: any, i: number) => {
    console.log(`${i}:`, {
      title: t.title,
      episode: t.episode,
      htmlTitle: t.htmlTitle,
      imdbConfirmed: t.imdbConfirmed,
    });
  });
})();
