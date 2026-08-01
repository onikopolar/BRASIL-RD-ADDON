// Teste profundo do RARGB - busca brecha HTML
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

const baseOpts = { timeout: 8000, httpsAgent: dnsAgent, lookup, validateStatus: () => true };

async function testar(url, desc, extraHeaders = {}) {
  const start = Date.now();
  try {
    const res = await axios.get(url, {
      ...baseOpts,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html', ...extraHeaders },
    });
    const time = Date.now() - start;
    const $ = cheerio.load(res.data);
    const hasMagnets = (res.data.match(/magnet:/gi) || []).length;
    const hasTorrent = (res.data.match(/torrent/gi) || []).length;
    const title = $('title').text().trim().substring(0, 70);
    const bodyLen = res.data.length;
    
    // Detecta Cloudflare ou JS rendering
    const isJS = res.data.includes('document.getElementById') || res.data.includes('window.') || res.data.includes('challenge');
    const isCF = res.data.includes('cf-browser') || res.data.includes('_cf_chl');
    
    console.log(`  [${res.status}] ${time}ms | ${(bodyLen/1024).toFixed(1)}KB | ${hasMagnets > 0 ? '🧲'+hasMagnets : ''} ${isJS ? '⚠️JS' : ''} ${isCF ? '🛡️CF' : ''} | "${title}"`);
    
    return { status: res.status, time, hasMagnets, isJS, isCF, bodyLen };
  } catch (e) {
    console.log(`  ❌ ${e.code || e.message}`);
    return null;
  }
}

async function main() {
  console.log('🔍 RARGB - Teste profundo de acesso HTML\n');

  // 1. Várias URLs de busca
  console.log('📡 Testando URLs de busca:');
  const searchUrls = [
    ['https://rargb.to/search/?search=Avatar+Fire+and+Ash', 'search/?search='],
    ['https://rargb.to/search/Avatar%20Fire%20and%20Ash', 'search/query'],
    ['https://rargb.to/?s=Avatar+Fire+and+Ash', '?s= (WP style)'],
    ['https://rargb.to/search/?q=Avatar+Fire+and+Ash', 'search/?q='],
    ['https://rargb.to/?search=Avatar+Fire+and+Ash', '?search='],
    ['https://rargb.to/index.php?page=search&q=Avatar+Fire+and+Ash', 'index.php search'],
  ];
  for (const [url, desc] of searchUrls) {
    process.stdout.write(`  ${desc.padEnd(25)} `);
    await testar(url, desc);
  }

  // 2. User-Agents diferentes
  console.log('\n🕵️ User-Agents diferentes:');
  const uas = {
    'Googlebot': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Bingbot': 'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'Curl': 'curl/8.0',
    'Mobile': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0 Mobile Safari/537.36',
    'Old IE': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)',
  };
  const baseSearch = 'https://rargb.to/search/?search=Avatar+Fire+and+Ash';
  for (const [name, ua] of Object.entries(uas)) {
    process.stdout.write(`  ${name.padEnd(15)} `);
    await testar(baseSearch, name, { 'User-Agent': ua });
  }

  // 3. Página inicial e categorias
  console.log('\n🏠 Páginas base:');
  const baseUrls = [
    ['https://rargb.to/', 'Home'],
    ['https://rargb.to/torrents.php', 'torrents.php'],
    ['https://rargb.to/browse.php', 'browse.php'],
    ['https://rargb.to/latest/', 'latest/'],
    ['https://rargb.to/top100', 'top100'],
  ];
  for (const [url, desc] of baseUrls) {
    process.stdout.write(`  ${desc.padEnd(20)} `);
    await testar(url, desc);
  }

  // 4. Checa se tem RSS/feed
  console.log('\n📰 RSS/Feed:');
  const feedUrls = [
    ['https://rargb.to/rss.xml', 'rss.xml'],
    ['https://rargb.to/feed/', 'feed/'],
    ['https://rargb.to/rss/', 'rss/'],
    ['https://rargb.to/feed.xml', 'feed.xml'],
  ];
  for (const [url, desc] of feedUrls) {
    process.stdout.write(`  ${desc.padEnd(20)} `);
    await testar(url, desc);
  }
}

main().catch(e => console.error(e));
