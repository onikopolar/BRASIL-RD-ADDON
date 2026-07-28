// Testa queries no TPB para achar torrents PT do Flashpoint Paradox
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';

dns.setServers(['8.8.8.8', '1.1.1.1']);

class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    dns.resolve4(options.hostname || options.host || '', (err, addresses) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0],
        port: options.port || 443,
        servername: options.hostname,
        rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
  }
}
const agent = new DnsAgent({ keepAlive: true });

async function searchTPB(mirror: string, query: string, format: 'search' | 's') {
  const encoded = encodeURIComponent(query);
  const url = format === 'search'
    ? `${mirror}/search/${encoded}/1/99/0`
    : `${mirror}/s/?q=${encoded}&category=0`;
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      httpsAgent: agent,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
    });
    const $ = cheerio.load(res.data);
    const titles: string[] = [];
    $('table tr').each((_i, row) => {
      const tds = $(row).find('td');
      if (tds.length >= 3) {
        const link = $(tds[1]).find('a.detLink');
        if (link.length) titles.push(link.text().trim());
      }
    });
    return titles;
  } catch {
    return [];
  }
}

(async () => {
  const MIRRORS = [
    'https://piratebay.live',
    'https://tpb.party',
    'https://1.piratebays.to',
    'https://www4.thepiratebay3.co',
  ];
  const FORMATS: Array<'search' | 's'> = ['search', 's'];

  // Diferentes variações da query PT
  const QUERIES = [
    // Com acentos e pontuação original
    'Liga da Justiça - Ponto De Ignição',
    'Liga da Justiça: Ponto de Ignição',
    'Liga da Justiça Ponto De Ignição',
    // Sem acentos (o que o TMDB retorna)
    'liga da justica ponto de ignicao',
    // Só título principal
    'Liga da Justiça',
    'Liga da Justica',
    // Só subtítulo
    'Ponto De Ignição',
    'Ponto de Ignição',
  ];

  console.log('🔍 Testando queries no TPB para achar "Liga da Justiça: Ponto de Ignição"\n');

  for (const mirror of MIRRORS) {
    for (const query of QUERIES) {
      for (const fmt of FORMATS) {
        const titles = await searchTPB(mirror, query, fmt);
        if (titles.length === 0) continue;

        const ptMatches = titles.filter(t =>
          /ponto.*igni[cç][aã]o/i.test(t) || /flashpoint.*paradox/i.test(t)
        );
        const icon = ptMatches.length > 0 ? '✅' : '  ';
        const info = `${mirror.split('//')[1]} | ${fmt.padEnd(6)} | "${query.substring(0, 40)}" → ${String(titles.length).padStart(3)} total`;

        if (ptMatches.length > 0) {
          console.log(`${icon} ${info} | ${ptMatches.length} match PT:`);
          ptMatches.forEach(t => console.log(`     📄 ${t}`));
        } else if (titles.length >= 5) {
          // Mostra só queries com resultados significativos
          console.log(`${icon} ${info}`);
        }
      }
    }
  }

  // Teste extra: acessar o torrent diretamente pelo infoHash que o usuário mostrou
  console.log('\n--- Teste direto: torrent /8748634 ---');
  for (const mirror of MIRRORS) {
    try {
      const res = await axios.get(`${mirror}/torrent/8748634`, {
        timeout: 10000,
        httpsAgent: agent,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const $ = cheerio.load(res.data);
      const title = $('title').text().trim();
      console.log(`  ${mirror.split('//')[1]}: ${title || 'SEM TÍTULO'}`);
    } catch {
      console.log(`  ${mirror.split('//')[1]}: ❌ offline`);
    }
  }

  console.log('\n✅ Done.');
})();
