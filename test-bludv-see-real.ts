import axios from 'axios';
import * as cheerio from 'cheerio';
import { BludvScraper } from './src/services/scraper/bludvScraper';

async function testarUrlReal() {
  const url = 'https://bludvfilmes1.xyz/see-1a-temporada-torrent-web-dl-720p-1080p-dual-audio-download-2019/';
  console.log('Acessando', url);
  const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  console.log('Status:', res.status);
  const $ = cheerio.load(res.data);
  const scraper = new BludvScraper();
  const postTitle = $('h1').first().text().trim() || $('title').first().text().trim();
  console.log('Título do post:', postTitle);
  const contentHtml = $('.content').html() || $('body').html() || '';

  console.log('\n--- Testando extractDirectMagnets ---');
  const direct = (scraper as any).extractDirectMagnets($, contentHtml);
  console.log('Magnets diretos:', direct.length);
  direct.forEach((item: any, i: number) => {
    console.log(`${i}: linkText="${item.linkText}" | fullContext="${item.fullContextText.substring(0, 80)}" | magnet="${item.magnet.substring(0, 60)}"`);
  });

  console.log('\n--- Testando extractDualSectionProtectorLinks ---');
  const dual = (scraper as any).extractDualSectionProtectorLinks($, contentHtml);
  console.log('Links protetor dual:', dual.length);
  dual.forEach((item: any, i: number) => {
    console.log(`${i}: url="${item.url.substring(0, 60)}" | linkText="${item.linkText}"`);
  });

  console.log('\n--- Testando scrapePost com IMDb correto (tt7284870) ---');
  const torrents = await (scraper as any).scrapePost(url, 'series', 1, 'tt7284870');
  console.log('Torrents extraídos:', torrents.length);
  torrents.forEach((t: any, i: number) => {
    console.log(`\n${i}:`, {
      title: t.title,
      htmlTitle: t.htmlTitle,
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

  console.log('\n--- Testando scrapePost com IMDb errado (tt9999999) ---');
  const torrentsErrados = await (scraper as any).scrapePost(url, 'series', 1, 'tt9999999');
  console.log('Torrents errados (deve ser 0):', torrentsErrados.length);
}

testarUrlReal().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
