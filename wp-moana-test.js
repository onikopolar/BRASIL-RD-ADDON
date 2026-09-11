// wp-moana-test.js
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

// Importa o módulo compilado
const wp = require(path.join(__dirname, 'dist/services/scraper/wordpressScraper.js'));
const { WordPressScraper, jsonAxiosConfig, WP_SITES } = wp;

const POST_ID = 257424;
const POST_URL_API = `https://comando1.com/wp-json/wp/v2/posts/${POST_ID}?_fields=id,title,link,content`;
const PROVIDER = WP_SITES[0].name;

function linha(titulo) {
  console.log('\n' + '='.repeat(78));
  console.log('  ' + titulo);
  console.log('='.repeat(78));
}
function sub(titulo) {
  console.log('\n  ── ' + titulo + ' ──');
}
function json(obj) {
  console.log(JSON.stringify(obj, null, 2));
}
function ok(cond) {
  return cond ? '✅' : '❌';
}

(async () => {
  const scraper = new WordPressScraper();

  // ═══════════════════════════════════════════════════════════════
  linha('SETUP: baixando post via API do WP');
  // ═══════════════════════════════════════════════════════════════
  const res = await axios.get(POST_URL_API, jsonAxiosConfig);
  const post = res.data;
  const titleRendered = post.title.rendered;
  const html = post.content.rendered;
  const $ = cheerio.load(html);

  console.log(`  ID:     ${post.id}`);
  console.log(`  Título: ${titleRendered}`);
  console.log(`  Link:   ${post.link}`);
  console.log(`  HTML:   ${html.length} bytes`);

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 1: extractInfoBlock()');
  // ═══════════════════════════════════════════════════════════════
  const info = scraper.extractInfoBlock($, html);
  json(info);

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 2: findSectionBoundaries() + detectSectionType()');
  // ═══════════════════════════════════════════════════════════════
  const boundaries = scraper.findSectionBoundaries($, html);
  json(boundaries);

  sub('Contexto ao redor de dualIndex');
  if (boundaries.dualIndex !== null) {
    const inicio = Math.max(0, boundaries.dualIndex - 80);
    const fim = Math.min(html.length, boundaries.dualIndex + 120);
    console.log('  ' + html.substring(inicio, fim).replace(/\n/g, ' '));
  } else {
    console.log('  dualIndex é null');
  }

  sub('Contexto ao redor de legendadoIndex');
  if (boundaries.legendadoIndex !== null) {
    const inicio = Math.max(0, boundaries.legendadoIndex - 80);
    const fim = Math.min(html.length, boundaries.legendadoIndex + 120);
    console.log('  ' + html.substring(inicio, fim).replace(/\n/g, ' '));
  } else {
    console.log('  legendadoIndex é null');
  }

  sub('Todos os <strong>/<b> classificados');
  const strongEls = $('strong, b').toArray();
  strongEls.forEach((el, i) => {
    const texto = $(el).text().trim();
    if (!texto || texto.length > 80) return;
    const tipo = scraper.detectSectionType(texto);
    if (tipo !== 'OUTRO') {
      console.log(`  [${i}] ${ok(tipo !== 'OUTRO')} "${texto}" → ${tipo}`);
    }
  });

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 3: classificarTextoIdioma()');
  // ═══════════════════════════════════════════════════════════════
  const flags = scraper.classificarTextoIdioma(titleRendered);
  json(flags);

  const flagsDublado = scraper.classificarTextoIdioma('DUBLADO OFICIAL');
  const flagsLegendado = scraper.classificarTextoIdioma('LEGENDADO');
  const flagsAssistir = scraper.classificarTextoIdioma('ASSISTIR ONLINE DUBLADO');
  console.log(`  "DUBLADO OFICIAL"        → ${JSON.stringify(flagsDublado)}`);
  console.log(`  "LEGENDADO"              → ${JSON.stringify(flagsLegendado)}`);
  console.log(`  "ASSISTIR ONLINE DUBLADO"→ ${JSON.stringify(flagsAssistir)}`);

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 4: extractLanguage() + extractEpisodeFromText()');
  // ═══════════════════════════════════════════════════════════════
  console.log(`  extractLanguage("${titleRendered.substring(0, 50)}...") → ${scraper.extractLanguage(titleRendered)}`);
  console.log(`  extractLanguage("Dublado") → ${scraper.extractLanguage('Dublado')}`);
  console.log(`  extractLanguage("Legendado") → ${scraper.extractLanguage('Legendado')}`);

  const eps = ['Episódio 1', 'ep 5', 'E12', 'S02E03', 'S04E07', 'sem episódio'];
  for (const e of eps) {
    console.log(`  extractEpisodeFromText("${e}") → ${scraper.extractEpisodeFromText(e)}`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 5: extrairTamanhoNumerico() + extractSize() + parseSize()');
  // ═══════════════════════════════════════════════════════════════
  const tamanhos = ['3.12 GB', '700 MB', '200 KB', 'desconhecido', '–'];
  for (const t of tamanhos) {
    const num = scraper.extrairTamanhoNumerico(t);
    const fmt = scraper.extractSize(t);
    const bytes = scraper.parseSize(t);
    console.log(`  "${t}" → num=${JSON.stringify(num)} | extractSize="${fmt}" | parseSize=${bytes}`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 6: extractQualityFromText() + detectQuality()');
  // ═══════════════════════════════════════════════════════════════
  const qualidades = ['1080p', '720p', '4K', 'HD', 'WEB-DL'];
  for (const q of qualidades) {
    console.log(`  extractQualityFromText("${q}") → ${scraper.extractQualityFromText(q)}`);
  }
  console.log(`  detectQuality("1080p", "", "") → ${scraper.detectQuality('1080p', '', '')}`);

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 7: estaEntreSecoes()');
  // ═══════════════════════════════════════════════════════════════
  const casos = [
    { pos: 500, dual: null, leg: null, esperado: true, desc: 'sem seções' },
    { pos: 100, dual: 300, leg: 800, esperado: false, desc: 'antes do dual' },
    { pos: 500, dual: 300, leg: 800, esperado: true, desc: 'entre dual e leg' },
    { pos: 900, dual: 300, leg: 800, esperado: false, desc: 'depois do leg' },
    { pos: 500, dual: 300, leg: null, esperado: true, desc: 'só dual' },
    { pos: 500, dual: null, leg: 800, esperado: false, desc: 'só leg (deve ser false)' },
  ];
  for (const c of casos) {
    const r = scraper.estaEntreSecoes(c.pos, c.dual, c.leg);
    console.log(`  ${ok(r === c.esperado)} ${c.desc} → ${r}`);
  }

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 8: extractTitleFromPostTitle()');
  // ═══════════════════════════════════════════════════════════════
  console.log(`  "${titleRendered}" → "${scraper.extractTitleFromPostTitle(titleRendered)}"`);

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 9: magnets diretos no HTML');
  // ═══════════════════════════════════════════════════════════════
  const magnets = $('a[href^="magnet:"]').toArray();
  console.log(`  Total de magnets diretos: ${magnets.length}`);
  magnets.forEach((el, i) => {
    const m = $(el).attr('href') || '';
    const hash = m.match(/btih:([a-z0-9]+)/i)?.[1];
    console.log(`  #${i + 1} hash=${hash?.substring(0, 12)}... parent="${$(el).parent().text().trim().substring(0, 60)}"`);
  });

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 10: processDirectMagnets() — filtrado por seção');
  // ═══════════════════════════════════════════════════════════════
  const diretos = await scraper.processDirectMagnets(
    $, html, boundaries.dualIndex, boundaries.legendadoIndex,
    titleRendered, html, PROVIDER, 'movie',
    info.originalTitle, info.year, info.years
  );
  console.log(`  Magnets diretos aceitos: ${diretos.length}`);
  diretos.forEach((r, i) => {
    console.log(`\n  #${i + 1}`);
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
    console.log(`     magnet:        ${r.magnet.substring(0, 80)}...`);
  });

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 11: processProtectorLinks() — filtrado por seção');
  // ═══════════════════════════════════════════════════════════════
  const protectorLinks = $('a[href*="systemads.net"], a[href*="systemads1.com"]').toArray();
  console.log(`  Links de protetor no HTML: ${protectorLinks.length}`);
  const protetores = await scraper.processProtectorLinks(
    $, html, boundaries.dualIndex, boundaries.legendadoIndex,
    titleRendered, html, PROVIDER, 'movie',
    info.originalTitle, info.year, info,
    protectorLinks, info.years
  );
  console.log(`  Magnets de protetor aceitos: ${protetores.length}`);
  protetores.forEach((r, i) => {
    console.log(`  #${i + 1} title="${r.title}" quality=${r.quality} magnet=${r.magnet.substring(0, 60)}...`);
  });

  // ═══════════════════════════════════════════════════════════════
  linha('TESTE 12: scrapePostApi() — fluxo completo');
  // ═══════════════════════════════════════════════════════════════
  const imdbMoana = 'tt27419466'; // IMDb do filme
  const inicio = Date.now();
  const results = await scraper.scrapePostApi(POST_ID, titleRendered, PROVIDER, 'movie', imdbMoana);
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