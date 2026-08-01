// Teste do BludvScraper HTML — debug por que 0 magnets
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';

dns.setServers(['8.8.8.8', '1.1.1.1']);

class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    (dns as any).resolve4(hostname, (err: any, addresses: string[]) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0], port: options.port || 443,
        servername: hostname, rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined as any;
  }
}

const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupCustomizado = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

const OPTS = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
};

async function main() {
  const query = 'Rick and Morty';
  const baseUrl = 'https://bludvfilmes.xyz';
  const searchUrl = `${baseUrl}/?s=${encodeURIComponent(query)}`;

  console.log(`\n🔍 Buscando: ${searchUrl}`);

  // Passo 1: Buscar posts
  const res = await axios.get(searchUrl, OPTS);
  const $ = cheerio.load(res.data);

  // Debug: ver estrutura real da página
  console.log(`\n📄 Título: "${$('title').text().trim()}"`);

  // Foca no container principal que tem os resultados
  const container = $('.container');
  console.log(`\n🏗️ .container → ${container.children().length} filhos:`);
  
  // Procura todos os links DENTRO do container
  const containerLinks = $('.container a[href]');
  console.log(`\n🔗 Links dentro de .container: ${containerLinks.length}`);
  containerLinks.each((i, el) => {
    if (i < 15) {
      const href = $(el).attr('href') || '';
      const text = $(el).text().trim().substring(0, 80);
      console.log(`  [${i}] ${href.substring(0, 80)}`);
      console.log(`       "${text}"`);
    }
  });

  // Também procura no section dentro de main
  const mainSection = $('main section');
  console.log(`\n📦 main section → ${mainSection.length} seções, ${mainSection.find('a[href]').length} links`);

  // Filtra links que são posts (não categoria, tag, ou lixo)
  const postLinks: string[] = [];
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    // Um post no BLUDV tem padrão: /slug-com-nome-do-post/
    // Categorias são curtas: /filmes/, /series/, /lancamento/2024/
    // Posts são longos e descritivos
    const path = href.replace(/^https?:\/\/bludvfilmes\.xyz/, '').replace(/\/$/, '');
    const segments = path.split('/').filter(Boolean);
    
    // Posts têm 1 segmento longo e descritivo, categorias têm 1-2 segmentos curtos
    if (segments.length === 1 && segments[0].length > 20 && segments[0].includes('-')) {
      const fullUrl = href.startsWith('http') ? href : `https://bludvfilmes.xyz${path}/`;
      if (!postLinks.includes(fullUrl)) {
        postLinks.push(fullUrl);
      }
    }
  });

  console.log(`\n📝 Links de post (slug longo, 1 segmento): ${postLinks.length}`);
  postLinks.slice(0, 8).forEach((href, i) => {
    console.log(`  [${i}] ${href}`);
  });

  if (!postLinks.length) {
    console.log('\n❌ Nenhum link de post. Todos os links da página:');
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href') || '';
      if (i < 20 && href.length > 5) console.log(`  ${href.substring(0, 100)}`);
    });
    return;
  }

  const firstLink = postLinks[0];

  console.log(`\n📝 Post #1: ${firstLink}`);

  // Passo 2: Scrapear o post
  const postRes = await axios.get(firstLink, OPTS);
  const $$ = cheerio.load(postRes.data);

  // Post title from the page's title tag (more reliable on BLUDV)
  const pageTitle = $$('title').first().text().trim().replace(/\s*[-–]\s*BLUDV FILMES.*$/, '');
  console.log(`  Título (title tag): "${pageTitle.substring(0, 80)}"`);
  
  // Also try h1
  const h1Title = $$('h1').first().text().trim();
  console.log(`  Título (h1): "${h1Title.substring(0, 80)}"`);

  // Procurar magnets - BLUDV usa .content como wrapper principal
  const contentHtml = $$('.content').html() || $$('body').html() || '';
  const magnetCount = (contentHtml.match(/magnet:/g) || []).length;
  console.log(`\n🧲 Magnets no HTML: ${magnetCount}`);

  // cheerio links
  const magnetLinks = $$('a[href^="magnet:"]');
  console.log(`🧲 cheerio a[href^="magnet:"]: ${magnetLinks.length}`);

  if (magnetCount > 0) {
    const magnetRegex = /magnet:\?xt=urn:btih:[a-fA-F0-9]{32,40}[^"'\s<>]*/g;
    const matches = contentHtml.match(magnetRegex);
    console.log('\nPrimeiros magnets:');
    (matches || []).slice(0, 5).forEach(m => {
      const dnMatch = m.match(/[&?]dn=([^&]+)/i);
      const dn = dnMatch ? decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')).substring(0, 70) : 'sem dn';
      console.log(`  dn="${dn}"`);
    });
  } else {
    console.log('\n⚠️ Nenhum magnet. Amostra do .content:');
    console.log(contentHtml.substring(0, 500));
  }
}

main().catch(err => console.error('Erro:', err.message));
