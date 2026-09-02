import * as cheerio from 'cheerio';
import { BludvScraper } from './src/services/scraper/bludvScraper';

const htmlExemplo = `
<div class="content">
  <center><span style="color: #008B00;"><strong><em>VERSÃO MKV DUAL ÁUDIO</em></strong></span></center>
  <p><strong>EPISÓDIOS 01 E 02:</strong> <a href="magnet:?xt=urn:btih:KC5F47IN7UNLOICS7K2LRFA3CIG62YDG&dn=See%202019%20-%20S01E01-02%20(720p)%20LAPUMiA">720p</a><br>
  <strong>EPISÓDIO 03:</strong> <a href="magnet:?xt=urn:btih:QI3DEUK7PN4SFRNA4F4FEHMEPX36ICN3&dn=See%202019%20-%20S01E3%20REPACK%20V2%20(720p)%20LAPUMiA">720p</a><br>
  <strong>EPISÓDIO 07:</strong> <a href="magnet:?xt=urn:btih:CHSQBYGGGN26C667XF27BN32O7NIXACJ&dn=See.S01E07.720p.WEB-DL.DUAL.mkv">720p</a></p>
  <hr>
  <center><span style="color: #008B00;"><strong><em>VERSÃO MKV LEGENDADO</em></strong></span></center>
  <p><strong>EPISÓDIO 01:</strong> <a href="magnet:?xt=urn:btih:2bf7162e037bbc123daaf17138f76c2c1bd53e55&dn=See.S01E01.Godflame.720p.WEB-DL.DD5.1.H264-CasStudio%5Brartv%5D">720p</a></p>
</div>
`;

const scraper = new BludvScraper();
const $ = cheerio.load(htmlExemplo);
const contentHtml = $('.content').html() || '';

console.log('Testando extractDirectMagnets...');
const direct = (scraper as any).extractDirectMagnets($, contentHtml);
console.log('Magnets diretos extraídos:', direct.length);
direct.forEach((item: any, i: number) => {
  console.log(`${i}:`, item.linkText, item.magnet?.substring(0, 60));
});

console.log('\nTestando extractDualSectionProtectorLinks...');
const dualLinks = (scraper as any).extractDualSectionProtectorLinks($, contentHtml);
console.log('Links dual/protetor:', dualLinks.length);

console.log('\nTestando extractPostMetadata...');
const metadata = (scraper as any).extractPostMetadata($, contentHtml);
console.log('Metadata:', metadata);
