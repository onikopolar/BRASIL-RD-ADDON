import axios from 'axios';
import * as cheerio from 'cheerio';
import { BludvScraper } from './src/services/scraper/bludvScraper';

(async () => {
  const scraper = new BludvScraper();
  const url = 'https://bludvfilmes1.xyz/see-1a-temporada-torrent-web-dl-720p-1080p-dual-audio-download-2019/';
  const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  const $ = cheerio.load(res.data);
  const torrents = await (scraper as any).scrapePost(url, 'series', undefined, undefined);
  console.log('Torrents sem imdbId/targetSeason:', torrents.length);
  torrents.forEach((t: any, i: number) => {
    console.log(`${i}:`, { title: t.title, episode: t.episode, htmlTitle: t.htmlTitle });
  });
})();
