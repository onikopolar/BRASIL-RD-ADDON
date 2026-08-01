// Teste rápido: ver magnets do BLUDV S05
import axios from 'axios';
import * as cheerio from 'cheerio';
import { agenteHttps, lookupCustomizado } from '../dist/services/scraper/wordpressScraper.js';

(async () => {
  const r = await axios.get('https://bludvfilmes.xyz/rick-and-morty-5a-temporada-torrent-web-dl-720p-1080p-4k-dual-audio-2021-download-legendado/', {
    timeout: 15000, httpsAgent: agenteHttps, lookup: lookupCustomizado,
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
  });
  const $ = cheerio.load(r.data);
  console.log('h1:', $('h1').first().text().trim().substring(0, 80));

  const magnets = $('a[href^="magnet:"]');
  console.log('Magnets:', magnets.length);
  magnets.each((i, el) => {
    const href = $(el).attr('href') || '';
    const dn = href.match(/[&?]dn=([^&]+)/i);
    const btih = href.match(/btih:([a-fA-F0-9]+)/i);
    console.log(`[${i}] btih=${btih ? btih[1].substring(0, 12) : '?'} dn="${dn ? decodeURIComponent(dn[1].replace(/\+/g, ' ')).substring(0, 80) : 'sem dn'}"`);
  });

  // Metadata
  const text = $('.content').text() || '';
  const audio = text.match(/Áudio[:\s]*([^\n]+)/i);
  console.log('Áudio:', audio ? audio[1].trim() : 'N/A');
})();
