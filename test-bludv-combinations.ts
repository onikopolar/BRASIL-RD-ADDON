import axios from 'axios';
import * as cheerio from 'cheerio';
import { BludvScraper } from './src/services/scraper/bludvScraper';

(async () => {
  const scraper = new BludvScraper();
  const url = 'https://bludvfilmes1.xyz/see-1a-temporada-torrent-web-dl-720p-1080p-dual-audio-download-2019/';

  const cenarios = [
    { nome: 'com season=1', season: 1, imdbId: undefined },
    { nome: 'com imdbId correto', season: undefined, imdbId: 'tt7284870' },
    { nome: 'com season=1 e imdbId correto', season: 1, imdbId: 'tt7284870' },
  ];

  for (const cenario of cenarios) {
    try {
      const torrents = await (scraper as any).scrapePost(url, 'series', cenario.season, cenario.imdbId);
      console.log(`${cenario.nome}:`, torrents.length);
    } catch (err: any) {
      console.log(`${cenario.nome}: ERRO`, err.message);
    }
  }
})();
