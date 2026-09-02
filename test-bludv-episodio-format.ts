import * as cheerio from 'cheerio';
import { BludvScraper } from './src/services/scraper/bludvScraper';

const htmlExemplo = `
<div class="content">
  <center><span style="color: #008B00;"><strong><em>VERSÃO MKV DUAL ÁUDIO</em></strong></span></center>
  <p><strong>EPISÓDIOS 01 E 02:</strong> <a href="magnet:?xt=urn:btih:KC5F47IN7UNLOICS7K2LRFA3CIG62YDG&dn=See%202019%20-%20S01E01-02%20(720p)%20LAPUMiA">720p</a><br>
  <strong>EPISÓDIO 03 AO 05:</strong> <a href="magnet:?xt=urn:btih:QI3DEUK7PN4SFRNA4F4FEHMEPX36ICN3&dn=See%202019%20-%20S01E03-05%20(720p)%20LAPUMiA">720p</a><br>
  <strong>EPISÓDIO 07:</strong> <a href="magnet:?xt=urn:btih:CHSQBYGGGN26C667XF27BN32O7NIXACJ&dn=See.S01E07.720p.WEB-DL.DUAL.mkv">720p</a></p>
</div>
`;

const scraper = new BludvScraper();
const $ = cheerio.load(htmlExemplo);
const contentHtml = $('.content').html() || '';

console.log('Testando extractDirectMagnets...');
const direct = (scraper as any).extractDirectMagnets($, contentHtml);
console.log('Magnets diretos extraídos:', direct.length);
direct.forEach((item: any, i: number) => {
  console.log(`${i}: linkText="${item.linkText}" | fullContext="${item.fullContextText.substring(0, 80)}" | magnet="${item.magnet.substring(0, 60)}"`);
});

console.log('\nTestando cleanHtmlTitle para cada magnet...');
direct.forEach((item: any, i: number) => {
  const clean = (scraper as any).cleanHtmlTitle(item.fullContextText, item.linkText);
  console.log(`${i}: cleanHtmlTitle =`, clean);
});
