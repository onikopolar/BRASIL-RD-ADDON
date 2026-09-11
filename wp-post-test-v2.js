const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const wp = require(path.join(__dirname, 'dist/services/scraper/wordpressScraper.js'));
const { WordPressScraper, jsonAxiosConfig, WP_SITES } = wp;

const POST_ID = 258088;
const POST_TITLE = 'Reacher 4ª Temporada Torrent (2026) Dual Áudio 5.1 WEB-DL 1080p';
const PROVIDER = WP_SITES[0].name;
const IMDB = 'tt9288030';

function linha(t) {
  console.log('\n' + '='.repeat(74));
  console.log('  ' + t);
  console.log('='.repeat(74));
}
function sub(t) { console.log('\n  ── ' + t + ' ──'); }
function json(o) { console.log(JSON.stringify(o, null, 2)); }
function ok(v) { return v ? '✅' : '❌'; }

(async () => {
  const scraper = new WordPressScraper();

  // ═══════════════════════════════════════════════════════════════
  linha('SETUP: baixando post via API do WP');
  // ═══════════════════════════════════════════════════════════════
  const url = `https://comando1.com/wp-json/wp/v2/posts/${POST_ID}?_fields=id,title,link,content`;
  const res = await axios.get(url, jsonAxiosConfig);
  const post = res.data;
  const html = post.content.rendered;
  const $ = cheerio.load(html);

  console.log(`  Título: ${post.title.rendered}`);
  console.log(`  Link:   ${post.link}`);
  console.log(`  HTML:   ${html.length} bytes`);

  // ═══════════════════════════════════════════════════════════════
  linha('FIX #1: detectSectionType com acento + rejeição de CTA');
  // ═══════════════════════════════════════════════════════════════
  const casosDeteccao = [
    // Deve ser DUAL
    { texto: 'VERSÃO MKV DUAL ÁUDIO', esperado: 'DUAL' },
    { texto: 'VERSÃO DUAL ÁUDIO', esperado: 'DUAL' },
    { texto: 'DUBLADO', esperado: 'DUAL' },
    { texto: 'Nacional', esperado: 'DUAL' },
    { texto: 'Dual Áudio', esperado: 'DUAL' },
    // Deve ser LEGENDADO
    { texto: 'LEGENDADO', esperado: 'LEGENDADO' },
    { texto: 'VERSÃO LEGENDADA', esperado: 'LEGENDADO' },
    // Deve ser OUTRO (CTA/botão/trailer/texto longo)
    { texto: 'ASSISTIR ONLINE DUBLADO', esperado: 'OUTRO' },
    { texto: 'BAIXAR TORRENT', esperado: 'OUTRO' },
    { texto: 'DOWNLOAD', esperado: 'OUTRO' },
    { texto: 'Trailer de Reacher 4ª Temporada Torrent (2026) Dual Áudio 5.1 WEB-DL 1080p', esperado: 'OUTRO' },
    { texto: 'Algum texto muito longo que passa de vinte e cinco caracteres', esperado: 'OUTRO' },
  ];
  let acertos = 0;
  for (const c of casosDeteccao) {
    const resultado = scraper.detectSectionType(c.texto);
    const passou = resultado === c.esperado;
    if (passou) acertos++;
    console.log(`  ${ok(passou)} "${c.texto.substring(0, 55)}"`);
    console.log(`      esperado: ${c.esperado} | obtido: ${resultado}`);
  }
  console.log(`\n  Acertos: ${acertos}/${casosDeteccao.length}`);

  // ═══════════════════════════════════════════════════════════════
  linha('FIX #2: findSectionBoundaries no post real (não deve mais pegar CTA)');
  // ═══════════════════════════════════════════════════════════════
  const boundaries = scraper.findSectionBoundaries($, html);
  json(boundaries);

  if (boundaries.dualIndex !== null) {
    sub('Contexto 80 chars ao redor de dualIndex');
    console.log('  ' + html.substring(boundaries.dualIndex - 30, boundaries.dualIndex + 80).replace(/\n/g, ' '));
  } else {
    console.log('  dualIndex é null — nenhum cabeçalho DUAL detectado');
  }
  if (boundaries.legendadoIndex !== null) {
    sub('Contexto 80 chars ao redor de legendadoIndex');
    console.log('  ' + html.substring(boundaries.legendadoIndex - 30, boundaries.legendadoIndex + 80).replace(/\n/g, ' '));
  }

  // ═══════════════════════════════════════════════════════════════
  linha('FIX #3: extractEpisodeFromText cobre SxxExx');
  // ═══════════════════════════════════════════════════════════════
  const casosEpisodio = [
    { texto: 'Episódio 01 ao 03: 1080p', esperado: 1 },
    { texto: 'Episódio 5', esperado: 5 },
    { texto: 'ep 3', esperado: 3 },
    { texto: 'E12', esperado: 12 },
    { texto: 'S02E03', esperado: 3 },
    { texto: 'S04E07', esperado: 7 },
    { texto: 'S1E10', esperado: 10 },
    { texto: 'sem episódio aqui', esperado: undefined },
    { texto: '', esperado: undefined },
  ];
  let acertosEp = 0;
  for (const c of casosEpisodio) {
    const resultado = scraper.extractEpisodeFromText(c.texto);
    const passou = resultado === c.esperado;
    if (passou) acertosEp++;
    console.log(`  ${ok(passou)} "${c.texto}" → esperado: ${c.esperado} | obtido: ${resultado}`);
  }
  console.log(`\n  Acertos: ${acertosEp}/${casosEpisodio.length}`);

  // ═══════════════════════════════════════════════════════════════
  linha('extractInfoBlock()');
  // ═══════════════════════════════════════════════════════════════
  const info = scraper.extractInfoBlock($, html);
  json(info);

  // ═══════════════════════════════════════════════════════════════
  linha('montarFrasesDeBusca() + postRelevante()');
  // ═══════════════════════════════════════════════════════════════
  const { frases, baseTitles } = scraper.montarFrasesDeBusca(
    'reacher 4ª temporada',
    ['reacher', 'reacher 4ª temporada']
  );
  console.log(`  Frases:     ${JSON.stringify([...frases])}`);
  console.log(`  BaseTitles: ${JSON.stringify(baseTitles)}`);

  const relevante = scraper.postRelevante(
    { title: post.title.rendered },
    4,
    frases,
    baseTitles,
    PROVIDER
  );
  console.log(`\n  Relevante? ${ok(relevante)} ${relevante}`);

  // ═══════════════════════════════════════════════════════════════
  linha('estaEntreSecoes() — bateria de casos');
  // ═══════════════════════════════════════════════════════════════
  const casosEntre = [
    { pos: 500, dual: null, leg: null, esperado: true, desc: 'sem seções' },
    { pos: 100, dual: 300, leg: 800, esperado: false, desc: 'antes do dual' },
    { pos: 500, dual: 300, leg: 800, esperado: true, desc: 'entre dual e leg' },
    { pos: 900, dual: 300, leg: 800, esperado: false, desc: 'depois do leg' },
    { pos: 500, dual: 300, leg: null, esperado: true, desc: 'só dual' },
    { pos: 500, dual: null, leg: 800, esperado: false, desc: 'só leg' },
  ];
  for (const c of casosEntre) {
    const r = scraper.estaEntreSecoes(c.pos, c.dual, c.leg);
    console.log(`  ${ok(r === c.esperado)} ${c.desc} → ${r}`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('cleanHtmlTitle()');
  // ═══════════════════════════════════════════════════════════════
  const casosClean = [
    { p: 'Episódio 01 ao 03: 1080p', l: '1080p', e: 'Episódio 01 ao 03: 1080p' },
    { p: 'EPISÓDIO 3 AO 5', l: 'WEB-DL', e: 'EPISÓDIO 3 AO 5: web-dl' },
    { p: 'sem episódio aqui', l: '1080p', e: '' },
    { p: 'S02E03 DUAL', l: '1080p', e: 'S02E03: 1080p' },
  ];
  for (const c of casosClean) {
    const r = scraper.cleanHtmlTitle(c.p, c.l);
    console.log(`  ${ok(r === c.e)} "${c.p}" → "${r}"`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('extractLanguage() / extractSize() / parseSize()');
  // ═══════════════════════════════════════════════════════════════
  for (const t of ['Reacher Dual Áudio', 'Breaking Bad Legendado', 'Nacional', 'Qualquer coisa']) {
    console.log(`  extractLanguage("${t}") → ${scraper.extractLanguage(t)}`);
  }
  console.log('');
  for (const s of ['2.5 GB', '700 MB', '200 KB', 'desconhecido', '–', '']) {
    console.log(`  extractSize("${s}") → "${scraper.extractSize(s)}" | parseSize → ${scraper.parseSize(s)} bytes`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('HTML — magnets e protetores');
  // ═══════════════════════════════════════════════════════════════
  const magnets = $('a[href^="magnet:"]').toArray();
  const protetores = $('a[href*="systemads.net"], a[href*="systemads1.com"]').toArray();
  console.log(`  Magnets diretos: ${magnets.length}`);
  console.log(`  Protetores:      ${protetores.length}`);
  magnets.forEach((el, i) => {
    const m = $(el).attr('href') || '';
    const hash = m.match(/btih:([a-z0-9]+)/i)?.[1];
    console.log(`  #${i + 1} hash=${hash?.substring(0, 12)}... parent="${$(el).parent().text().trim().substring(0, 50)}"`);
  });

  // ═══════════════════════════════════════════════════════════════
  linha('analisarMagnetComCache() — cache hit/miss');
  // ═══════════════════════════════════════════════════════════════
  if (magnets.length >= 2) {
    const m1 = $(magnets[0]).attr('href');
    const m2 = $(magnets[1]).attr('href');

    const t0 = Date.now();
    const r1a = await scraper.analisarMagnetComCache(m1, PROVIDER);
    const tempo1 = Date.now() - t0;

    const t1 = Date.now();
    const r1b = await scraper.analisarMagnetComCache(m1, PROVIDER); // hit
    const tempo2 = Date.now() - t1;

    const r2 = await scraper.analisarMagnetComCache(m2, PROVIDER); // miss (outro magnet)

    console.log(`  1ª análise (miss): ${tempo1}ms → ${r1a?.nome?.substring(0, 60)}`);
    console.log(`  2ª análise (hit):  ${tempo2}ms → ${r1b?.nome?.substring(0, 60)}`);
    console.log(`  3ª análise (miss): ${r2?.nome?.substring(0, 60)}`);
    console.log(`\n  Cache size: ${scraper.magnetCache.getStats().size}`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('SCRAPE COMPLETO — scrapePostApi()');
  // ═══════════════════════════════════════════════════════════════
  const inicio = Date.now();
  const results = await scraper.scrapePostApi(POST_ID, POST_TITLE, PROVIDER, 'series', IMDB);
  const tempo = Date.now() - inicio;

  console.log(`  Total: ${results.length} TorrentResult em ${tempo}ms\n`);
  results.forEach((r, i) => {
    console.log(`  #${i + 1}`);
    console.log(`     title:         ${r.title}`);
    console.log(`     htmlTitle:     ${r.htmlTitle}`);
    console.log(`     quality:       ${r.quality}`);
    console.log(`     size:          ${r.size}`);
    console.log(`     language:      ${r.language}`);
    console.log(`     season:        ${r.season}`);
    console.log(`     episode:       ${r.episode}`);
    console.log(`     imdbConfirmed: ${r.imdbConfirmed}`);
    console.log(`     canonicalName: ${r.canonicalName}`);
    console.log(`     originalTitle: ${r.originalTitle}`);
    console.log(`     seeders:       ${r.seeders}`);
    console.log(`     magnet:        ${r.magnet.substring(0, 80)}...`);
    console.log('');
  });

  // ═══════════════════════════════════════════════════════════════
  linha('ESTADO FINAL DO CACHE');
  // ═══════════════════════════════════════════════════════════════
  console.log(`  magnetCache: ${scraper.magnetCache.getStats().size} entradas`);

  linha('FIM');
})().catch(err => {
  console.error('\n❌ ERRO FATAL:', err);
  process.exit(1);
});
