const path = require('path');
const wp = require(path.join(__dirname, 'dist/services/scraper/wordpressScraper.js'));
const { WordPressScraper, jsonAxiosConfig, WP_SITES } = wp;

const POST_ID = 258088;
const POST_TITLE = 'Reacher 4ª Temporada Torrent (2026) Dual Áudio 5.1 WEB-DL 1080p';
const PROVIDER = WP_SITES[0].name;

function linha(t) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + t);
  console.log('='.repeat(70));
}
function sub(t) { console.log('\n--- ' + t + ' ---'); }
function json(o) { console.log(JSON.stringify(o, null, 2)); }

(async () => {
  const scraper = new WordPressScraper();

  linha('PASSO 1: Baixando o post via API do WP');
  const url = `https://comando1.com/wp-json/wp/v2/posts/${POST_ID}?_fields=id,title,link,content`;
  const axios = require('axios');
  const res = await axios.get(url, jsonAxiosConfig);
  const post = res.data;

  sub('post.title.rendered');
  console.log(post.title.rendered);
  sub('post.link');
  console.log(post.link);
  sub('tamanho do contentHtml');
  console.log(`${post.content.rendered.length} bytes`);

  const $ = require('cheerio').load(post.content.rendered);
  const html = post.content.rendered;

  linha('PASSO 2: extractInfoBlock()');
  const infoBlock = scraper.extractInfoBlock($, html);
  json(infoBlock);

  linha('PASSO 3: montarFrasesDeBusca()');
  const frases = scraper.montarFrasesDeBusca('reacher 4ª temporada', ['reacher', 'reacher 4ª temporada']);
  console.log(`Frases:     ${JSON.stringify([...frases.frases])}`);
  console.log(`BaseTitles: ${JSON.stringify(frases.baseTitles)}`);

  linha('PASSO 4: postRelevante() — testando com o próprio título');
  const relevante = scraper.postRelevante(
    { title: post.title.rendered },
    4, // season
    frases.frases,
    frases.baseTitles,
    PROVIDER
  );
  console.log(`É relevante? ${relevante}`);

  linha('PASSO 5: findSectionBoundaries()');
  const boundaries = scraper.findSectionBoundaries($, html);
  json(boundaries);
  if (boundaries.dualIndex !== null) {
    sub('Texto ao redor do dualIndex (100 chars)');
    console.log(html.substring(boundaries.dualIndex, boundaries.dualIndex + 100));
  }
  if (boundaries.legendadoIndex !== null) {
    sub('Texto ao redor do legendadoIndex (100 chars)');
    console.log(html.substring(boundaries.legendadoIndex, boundaries.legendadoIndex + 100));
  }

  linha('PASSO 6: detectSectionType() em textos de amostra');
  const amostras = [
    'VERSÃO MKV DUAL ÁUDIO',
    'LEGENDADO',
    'Trailer de Reacher 4ª Temporada Torrent (2026) Dual Áudio 5.1 WEB-DL 1080p',
    'Nacional',
  ];
  for (const a of amostras) {
    console.log(`  "${a.substring(0, 60)}" → ${scraper.detectSectionType(a)}`);
  }

  linha('PASSO 7: Links de protetor (systemads) no HTML');
  const protectors = $('a[href*="systemads.net"], a[href*="systemads1.com"]').toArray();
  console.log(`Total de protetores: ${protectors.length}`);
  protectors.slice(0, 5).forEach((el, i) => {
    console.log(`  #${i + 1}: ${$(el).attr('href')?.substring(0, 80)}`);
  });

  linha('PASSO 8: Links de magnet direto no HTML');
  const magnets = $('a[href^="magnet:"]').toArray();
  console.log(`Total de magnets diretos: ${magnets.length}`);
  magnets.slice(0, 5).forEach((el, i) => {
    const m = $(el).attr('href') || '';
    console.log(`  #${i + 1}: ${m.substring(0, 100)}`);
    console.log(`      parentText: ${JSON.stringify($(el).parent().text().trim().substring(0, 80))}`);
    console.log(`      linkText:   ${JSON.stringify($(el).text().trim())}`);
  });

  linha('PASSO 9: estaEntreSecoes() — casos de teste');
  console.log(`  Sem seções:                ${scraper.estaEntreSecoes(500, null, null)}`);
  console.log(`  Antes do dual:             ${scraper.estaEntreSecoes(100, 300, 800)}`);
  console.log(`  Entre dual e legendado:    ${scraper.estaEntreSecoes(500, 300, 800)}`);
  console.log(`  Depois do legendado:       ${scraper.estaEntreSecoes(900, 300, 800)}`);
  console.log(`  Só dual (sem legendado):   ${scraper.estaEntreSecoes(500, 300, null)}`);

  linha('PASSO 10: cleanHtmlTitle()');
  const limpo1 = scraper.cleanHtmlTitle('Episódio 01: 1080p', '1080p');
  const limpo2 = scraper.cleanHtmlTitle('EPISÓDIO 3 AO 5', 'WEB-DL');
  const limpo3 = scraper.cleanHtmlTitle('sem episódio aqui', '1080p');
  console.log(`  "Episódio 01: 1080p" → "${limpo1}"`);
  console.log(`  "EPISÓDIO 3 AO 5"    → "${limpo2}"`);
  console.log(`  "sem episódio aqui"  → "${limpo3}"`);

  linha('PASSO 11: extractEpisodeFromText()');
  const eps = ['Episódio 1', 'ep 5', 'E12', 'S02E03', 'nada'];
  for (const e of eps) {
    console.log(`  "${e}" → ${scraper.extractEpisodeFromText(e)}`);
  }

  linha('PASSO 12: extractLanguage() e extractSize()');
  const langTests = ['Reacher 4ª Temporada Dual Áudio', 'Breaking Bad Legendado', 'Nacional'];
  for (const l of langTests) {
    console.log(`  "${l}" → ${scraper.extractLanguage(l)}`);
  }
  const sizeTests = ['2.5 GB', '700 MB', 'desconhecido'];
  for (const s of sizeTests) {
    console.log(`  "${s}" → "${scraper.extractSize(s)}" (${scraper.parseSize(s)} bytes)`);
  }

  linha('PASSO 13: SCRAPE COMPLETO — scrapePostApi()');
  const imdbReacher = 'tt9288030'; // Reacher
  const results = await scraper.scrapePostApi(POST_ID, POST_TITLE, PROVIDER, 'series', imdbReacher);
  console.log(`Total de TorrentResult: ${results.length}`);
  results.forEach((r, i) => {
    console.log(`\n  #${i + 1}`);
    json({
      title: r.title,
      htmlTitle: r.htmlTitle,
      quality: r.quality,
      size: r.size,
      language: r.language,
      provider: r.provider,
      season: r.season,
      episode: r.episode,
      imdbConfirmed: r.imdbConfirmed,
      canonicalName: r.canonicalName,
      originalTitle: r.originalTitle,
      seeders: r.seeders,
      magnet: r.magnet.substring(0, 100) + '...',
    });
  });

  linha('PASSO 14: Cache de magnet — estado');
  console.log(`Entradas no magnetCache: ${scraper.magnetCache.getStats().size}`);

  linha('FIM');
})().catch(err => {
  console.error('\n❌ ERRO FATAL:', err);
  process.exit(1);
});
