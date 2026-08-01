const axios = require('axios');
const cheerio = require('cheerio');
const dns = require('dns');
const https = require('https');
const tls = require('tls');

dns.setServers(['8.8.8.8', '1.1.1.1']);

const dnsAgent = new https.Agent({
  createConnection: (options, cb) => {
    const hostname = options.hostname || options.host || '';
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      const sock = tls.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false });
      sock.on('secureConnect', () => cb(null, sock));
      sock.on('error', cb);
    });
  }
});

const lookup = (hostname, _opts, cb) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

(async () => {
  const url = 'https://bludvfilmes.xyz/rick-and-morty-5a-temporada-torrent-web-dl-720p-1080p-4k-dual-audio-2021-download-legendado/';
  console.log('Fetching...');
  const r = await axios.get(url, {
    timeout: 15000, httpsAgent: dnsAgent, lookup,
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
    console.log('[' + i + '] btih=' + (btih ? btih[1].substring(0, 12) : '?') + ' dn="' + (dn ? decodeURIComponent(dn[1].replace(/\+/g, ' ')).substring(0, 80) : 'sem dn') + '"');
  });

  const text = $('.content').text() || '';
  const audio = text.match(/Áudio[:\s]*([^\n]+)/i);
  console.log('Áudio:', audio ? audio[1].trim() : 'N/A');
  const quality = text.match(/Qualidade[:\s]*([^\n]+)/i);
  console.log('Qualidade:', quality ? quality[1].trim() : 'N/A');
  const size = text.match(/Tamanho[:\s]*([^\n]+)/i);
  console.log('Tamanho:', size ? size[1].trim() : 'N/A');
})();
