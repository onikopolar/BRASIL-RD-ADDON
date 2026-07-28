/**
 * Teste de estresse nos scrapers
 * 
 * Testa TorrentIndexer API + WordPress (BLUDV, Comando, StarckFilmes)
 * com multiplas queries populares. Mede tempo, resultados e erros.
 * 
 * Uso: node scripts/teste-scrapers.js
 */

const axios = require('axios');
const cheerio = require('cheerio');
const https = require('https');
const tls = require('tls');
const dns = require('dns');

// Forca DNS publico para bypass de bloqueios de operadora
dns.setServers(['8.8.8.8', '1.1.1.1']);

// Agente HTTPS customizado: resolve IP via Google DNS + conecta com SNI correto

// Funcao lookup customizada: usa dns.resolve4 em vez de dns.lookup
// para bypassar o DNS do sistema que nao resolve certos dominios
function criarLookup() {
  return (hostname, opts, cb) => {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      cb(null, addresses[0], 4);
    });
  };
}

class AgenteDns extends https.Agent {
  createConnection(options, cb) {
    const hostname = options.hostname || options.host || '';
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0],
        port: options.port || 443,
        servername: hostname,
        rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
  }
}

const agenteHttps = new AgenteDns({ keepAlive: true });

// ============================================================================
// CONFIGURACAO
// ============================================================================

const TORRENT_INDEXER_URL = 'https://torrent-indexer.darklyn.org';
const TIMEOUT_PADRAO = 15000;

const WP_SITES = [
  { nome: 'BLUDV Filmes',     url: 'https://bludvfilmes.xyz',        timeout: 15000 },
  { nome: 'Comando Torrents', url: 'https://comando1.com',           timeout: 15000 },
  { nome: 'StarckFilmes',     url: 'https://www.starckfilmes.net',   timeout: 15000 },
];

const QUERIES = [
  { nome: 'Filme',     query: 'vingadores ultimato',                    tipo: 'movies' },
  { nome: 'Serie',     query: 'avatar a lenda de aang temporada 3',     tipo: 'tv' },
  { nome: 'Animacao',  query: 'homem aranha no aranhaverso',            tipo: 'movies' },
  { nome: 'Dorama',    query: 'round 6',                                tipo: 'tv' },
];

// ============================================================================
// CORES
// ============================================================================

const C = { reset: '\x1b[0m', green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m', bold: '\x1b[1m', dim: '\x1b[2m' };

// ============================================================================
// HELPERS
// ============================================================================

function agora() { return new Date().toISOString().substring(11, 23); }

function duracao(inicio) { return `${(Date.now() - inicio)}ms`; }

function barra(titulo) {
  console.log(`\n${C.bold}${C.cyan}${'═'.repeat(70)}${C.reset}`);
  console.log(`${C.bold}${C.cyan}  ${titulo}${C.reset}`);
  console.log(`${C.bold}${C.cyan}${'═'.repeat(70)}${C.reset}\n`);
}

// ============================================================================
// TESTE: TorrentIndexer API
// ============================================================================

async function testarTorrentIndexer() {
  barra('TORRENT INDEXER API');
  console.log(`${C.dim}URL base: ${TORRENT_INDEXER_URL}${C.reset}\n`);

  const resultados = [];

  for (const q of QUERIES) {
    const inicio = Date.now();
    console.log(`  [${agora()}] ${C.yellow}Consultando${C.reset}: "${q.query}" (${q.tipo})`);

    try {
      const params = { q: q.query, filter_results: 'true', category: q.tipo };
      const response = await axios.get(`${TORRENT_INDEXER_URL}/search`, {
                httpsAgent: agenteHttps,
                lookup: criarLookup(),
        timeout: TIMEOUT_PADRAO,
        headers: { 'User-Agent': 'Brasil-RD-Teste/1.0', 'Accept': 'application/json' },
        params
      });

      const data = response.data;
      const total = data.results?.length || 0;
      const comMagnet = data.results?.filter(r => r.magnet_link).length || 0;
      const qualidade = data.results?.map(r => r.title?.match(/\b(2160p|1080p|720p|4k)\b/i)?.[0]).filter(Boolean) || [];

      console.log(`    ${C.green}✓${C.reset} ${total} resultados (${comMagnet} com magnet) em ${duracao(inicio)}`);
      console.log(`      Primeiro: ${data.results?.[0]?.title?.substring(0, 70) || 'N/A'}`);
      if (qualidade.length > 0) console.log(`      Qualidades: ${[...new Set(qualidade)].join(', ')}`);

      resultados.push({ query: q.nome, total, comMagnet, tempo: Date.now() - inicio, erro: null });

    } catch (erro) {
      console.log(`    ${C.red}✗${C.reset} ${erro.code || 'ERRO'}: ${erro.message?.substring(0, 80)} (${duracao(inicio)})`);
      resultados.push({ query: q.nome, total: 0, comMagnet: 0, tempo: Date.now() - inicio, erro: erro.message });
    }
  }

  return resultados;
}

// ============================================================================
// TESTE: WordPress Scrapers
// ============================================================================

async function testarWordPress() {
  barra('WORDPRESS SCRAPERS');

  for (const site of WP_SITES) {
    console.log(`  ${C.bold}Site: ${site.nome}${C.reset}`);
    console.log(`  ${C.dim}URL: ${site.url}${C.reset}\n`);
    const resultados = [];

    for (const q of QUERIES) {
      const inicio = Date.now();
      const url = `${site.url}/wp-json/wp/v2/posts?search=${encodeURIComponent(q.query)}&per_page=10`;
      console.log(`    [${agora()}] Buscando: "${q.query}"`);

      try {
        const response = await axios.get(url, {
          timeout: site.timeout,
          httpsAgent: agenteHttps,
          lookup: criarLookup(),
          headers: { 'User-Agent': 'Brasil-RD-Teste/1.0', 'Accept': 'application/json' },
          validateStatus: () => true,
        });

        if (response.status !== 200) {
          console.log(`      ${C.red}✗${C.reset} HTTP ${response.status} (${duracao(inicio)})`);
          resultados.push({ query: q.nome, status: response.status, posts: 0, comMagnet: 0, tempo: Date.now() - inicio, erro: `HTTP ${response.status}` });
          continue;
        }

        const posts = Array.isArray(response.data) ? response.data : [];
        let comMagnet = 0;

        for (const post of posts.slice(0, 3)) {
          try {
            const conteudo = post.content?.rendered || '';
            const $ = cheerio.load(conteudo);
            const magnets = $('a[href^="magnet:"]');
            comMagnet += magnets.length;
          } catch {}
        }

        console.log(`      ${C.green}✓${C.reset} ${posts.length} posts (${comMagnet} magnets) em ${duracao(inicio)}`);
        if (posts.length > 0) {
          console.log(`      Primeiro: ${posts[0].title?.rendered?.substring(0, 70) || 'N/A'}`);
        }

        resultados.push({ query: q.nome, status: response.status, posts: posts.length, comMagnet, tempo: Date.now() - inicio, erro: null });

      } catch (erro) {
        const msg = erro.code === 'ECONNABORTED' ? 'TIMEOUT' : (erro.code || 'ERRO');
        console.log(`      ${C.red}✗${C.reset} ${msg}: ${erro.message?.substring(0, 80)} (${duracao(inicio)})`);
        resultados.push({ query: q.nome, status: 0, posts: 0, comMagnet: 0, tempo: Date.now() - inicio, erro: erro.message });
      }
    }

    console.log();
    resultados.forEach(r => {
      const status = r.erro ? C.red + 'FALHOU' : C.green + 'OK';
      console.log(`    ${status}${C.reset} | ${r.query.padEnd(10)} | ${String(r.posts || r.total || 0).padStart(3)} resultados | ${String(r.tempo).padStart(5)}ms`);
    });
  }
}

// ============================================================================
// TESTE: Latencia (ping nos dominios)
// ============================================================================

async function testarLatencia() {
  barra('LATENCIA (PING)');

  const dominios = [
    { nome: 'TorrentIndexer', url: TORRENT_INDEXER_URL },
    ...WP_SITES.map(s => ({ nome: s.nome, url: s.url })),
  ];

  for (const d of dominios) {
    const inicio = Date.now();
    try {
      await axios.get(d.url, {
        httpsAgent: agenteHttps,
        lookup: criarLookup(),
        timeout: 10000,
        headers: { 'User-Agent': 'Brasil-RD-Teste/1.0' },
        validateStatus: () => true,
      });
      console.log(`  ${C.green}✓${C.reset} ${d.nome.padEnd(18)} | ${duracao(inicio)}`);
    } catch (erro) {
      console.log(`  ${C.red}✗${C.reset} ${d.nome.padEnd(18)} | ${erro.code || 'ERRO'} (${duracao(inicio)})`);
    }
  }
}

// ============================================================================
// RESUMO FINAL
// ============================================================================

function resumoFinal(resultadosIndexer, inicioGeral) {
  barra('RESUMO FINAL');

  console.log(`${C.dim}Tempo total do teste: ${duracao(inicioGeral)}${C.reset}\n`);

  console.log(`${C.bold}TorrentIndexer:${C.reset}`);
  resultadosIndexer.forEach(r => {
    const status = r.erro ? C.red + '✗' : C.green + '✓';
    console.log(`  ${status}${C.reset} ${r.query.padEnd(10)} | ${String(r.comMagnet).padStart(3)} com magnet | ${String(r.tempo).padStart(6)}ms`);
  });

  console.log(`\n${C.yellow}${C.bold}ATENCAO:${C.reset}`);
  console.log(`  • Se algum scraper falhou com TIMEOUT, verifique o ${C.bold}timeout${C.reset} no codigo`);
  console.log(`  • Se todos falharam, pode ser bloqueio de ${C.bold}IP/dNS${C.reset} na hospedagem`);
  console.log(`  • TorrentIndexer retorna 0 resultados = query muito especifica`);
  console.log(`  • WordPress retorna muitos posts mas 0 magnets = regex de magnet quebrada`);
}

// ============================================================================
// MAIN
// ============================================================================

(async () => {
  const inicioGeral = Date.now();

  console.clear();
  console.log(`\n${C.bold}${C.cyan}  ╔══════════════════════════════════════════════════════════╗`);
  console.log(`  ║     TESTE DE ESTRESSE NOS SCRAPERS - BRASIL RD ADDON      ║`);
  console.log(`  ╚══════════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Inicio: ${new Date().toISOString()}`);
  console.log(`  Node:   ${process.version}`);
  console.log(`  CWD:    ${process.cwd()}`);

  // 1. Latencia
  await testarLatencia();

  // 2. TorrentIndexer
  const resultadosIndexer = await testarTorrentIndexer();

  // 3. WordPress
  await testarWordPress();

  // 4. Resumo
  resumoFinal(resultadosIndexer, inicioGeral);

  console.log(`\n  Fim: ${new Date().toISOString()}\n`);

})().catch(erro => {
  console.error(`${C.red}FATAL:${C.reset}`, erro);
  process.exit(1);
});
