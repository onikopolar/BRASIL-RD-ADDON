// scripts/test-absolute-episode.mjs
// Uso: node scripts/test-absolute-episode.mjs tt0214341 7 6
//   ou: node scripts/test-absolute-episode.mjs tt0214341   (só mostra seasons)

import 'dotenv/config';
import axios from 'axios';
import * as cheerio from 'cheerio';

const IMDB_ID = process.argv[2] || 'tt0214341';
const TARGET_S = parseInt(process.argv[3] || '0', 10);
const TARGET_E = parseInt(process.argv[4] || '0', 10);

const API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
};

function section(t) { console.log(`\n${c.bold}${c.cyan}══ ${t} ══${c.reset}`); }
function ok(t)      { console.log(`${c.green}✅ ${t}${c.reset}`); }
function fail(t)    { console.log(`${c.red}❌ ${t}${c.reset}`); }
function warn(t)    { console.log(`${c.yellow}⚠️  ${t}${c.reset}`); }
function info(k, v) { console.log(`   ${c.dim}${k}:${c.reset} ${v}`); }

// ─────────────────────────────────────────────────────────────
// 1. TMDB API
// ─────────────────────────────────────────────────────────────
async function viaApi() {
  section('1) TMDB API — find + details');

  if (!API_KEY) {
    fail('TMDB_API_KEY ausente no .env');
    return null;
  }
  info('API key', `${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)} (len ${API_KEY.length})`);

  let findResp;
  try {
    findResp = await axios.get(`${BASE}/find/${IMDB_ID}`, {
      params: { api_key: API_KEY, external_source: 'imdb_id', language: 'pt-BR' },
      timeout: 10000,
    });
  } catch (e) {
    fail(`/find falhou: ${e.response?.status || ''} ${e.message}`);
    return null;
  }

  const tv = findResp.data?.tv_results?.[0];
  const movie = findResp.data?.movie_results?.[0];
  const item = tv || movie;
  if (!item) { fail('Nenhum resultado (nem tv nem movie)'); return null; }

  const mediaType = tv ? 'tv' : 'movie';
  ok(`Encontrado: "${item.name || item.title}" (${mediaType}, tmdbId=${item.id})`);
  info('Ano', item.first_air_date || item.release_date);

  if (mediaType !== 'tv') { warn('Não é série — sem seasons'); return { mediaType, tmdbId: item.id }; }

  let details;
  try {
    details = await axios.get(`${BASE}/tv/${item.id}`, {
      params: { api_key: API_KEY, language: 'pt-BR' },
      timeout: 10000,
    });
  } catch (e) {
    fail(`/tv/${item.id} falhou: ${e.message}`);
    return null;
  }

  const seasons = (details.data?.seasons || [])
    .filter(s => s.season_number > 0)   // ignora "specials" (season 0)
    .sort((a, b) => a.season_number - b.season_number);

  section('Temporadas e episode_count');
  let acumulado = 0;
  const offsets = {};
  for (const s of seasons) {
    offsets[s.season_number] = acumulado;
    console.log(
      `   S${String(s.season_number).padStart(2, '0')} ` +
      `${c.dim}${(s.name || '').padEnd(20).slice(0, 20)}${c.reset} ` +
      `${String(s.episode_count).padStart(3)} eps  ` +
      `${c.dim}(offset absoluto: ${acumulado})${c.reset}`
    );
    acumulado += s.episode_count;
  }
  console.log(`   ${c.bold}Total: ${acumulado} episódios em ${seasons.length} temporadas${c.reset}`);

  return {
    mediaType,
    tmdbId: item.id,
    seasons: seasons.map(s => ({ season: s.season_number, episode_count: s.episode_count })),
    offsets,
    total: acumulado,
  };
}

// ─────────────────────────────────────────────────────────────
// 2. Fallback HTML (scrape da página principal + seasons)
// ─────────────────────────────────────────────────────────────
async function viaHtml() {
  section('2) Fallback HTML — scrape themoviedb.org');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  };

  // PASSO 1: Cinemeta pra descobrir título
  let title = null, year = null;
  try {
    const r = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${IMDB_ID}.json`, { timeout: 10000 });
    title = r.data?.meta?.name || null;
    year = r.data?.meta?.year || null;
    if (title) ok(`Cinemeta: "${title}" (${year || '?'})`);
  } catch (e) { warn(`Cinemeta falhou: ${e.message}`); }
  if (!title) { fail('Sem título — abortando HTML'); return null; }

  // PASSO 2: search
  let searchHtml;
  try {
    const r = await axios.get(
      `https://www.themoviedb.org/search?query=${encodeURIComponent(title)}`,
      { headers, timeout: 15000 }
    );
    searchHtml = r.data;
  } catch (e) { fail(`search falhou: ${e.message}`); return null; }

  const $ = cheerio.load(searchHtml);
  let firstTvHref = null;
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    if (/^\/tv\/\d+/.test(href) && !firstTvHref) firstTvHref = href;
  });
  if (!firstTvHref) { fail('Nenhum /tv/{id} no search HTML'); return null; }
  ok(`search → ${firstTvHref}`);

  // PASSO 3: página principal pra pegar lista de temporadas
  const tvUrl = `https://www.themoviedb.org${firstTvHref}?language=pt-BR`;
  let tvHtml;
  try {
    const r = await axios.get(tvUrl, { headers, timeout: 15000 });
    tvHtml = r.data;
  } catch (e) { fail(`page falhou: ${e.message}`); return null; }

  const $tv = cheerio.load(tvHtml);

  // No HTML do TMDB, a lista de seasons costuma estar em links /tv/{id}/season/{n}
  const tmdbIdMatch = firstTvHref.match(/^\/tv\/(\d+)/);
  const tmdbId = tmdbIdMatch ? tmdbIdMatch[1] : null;
  info('tmdbId', tmdbId);

  const seasonLinks = new Set();
  $tv('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    const m = href.match(/^\/tv\/\d+\/season\/(\d+)/);
    if (m && parseInt(m[1]) > 0) seasonLinks.add(parseInt(m[1]));
  });

  if (seasonLinks.size === 0) {
    warn('Nenhum link /season/N na página principal — o HTML não expõe contagem por season de forma trivial.');
    warn('(No TMDB o episode_count real vem da API. HTML só dá pra raspar se a página listar cada season.)');
    return { title, year, tmdbId, seasonLinks: [] };
  }

  ok(`${seasonLinks.size} temporadas encontradas via HTML`);

  // Pra cada season, abre a página e conta episódios
  section('Contagem via HTML (uma request por season)');
  const counts = {};
  for (const sNum of [...seasonLinks].sort((a, b) => a - b)) {
    const sUrl = `https://www.themoviedb.org/tv/${tmdbId}/season/${sNum}?language=pt-BR`;
    try {
      const r = await axios.get(sUrl, { headers, timeout: 15000 });
      const $s = cheerio.load(r.data);
      // Cada episódio costuma ter um link /tv/{id}/season/{n}/episode/{m}
      const eps = new Set();
      $s('a[href]').each((_i, el) => {
        const h = $(el).attr('href') || '';
        const m = h.match(/^\/tv\/\d+\/season\/\d+\/episode\/(\d+)/);
        if (m) eps.add(parseInt(m[1]));
      });
      counts[sNum] = eps.size;
      console.log(`   S${String(sNum).padStart(2, '0')} → ${eps.size} episódios`);
    } catch (e) {
      console.log(`   S${String(sNum).padStart(2, '0')} → ${c.red}falhou (${e.message})${c.reset}`);
      counts[sNum] = 0;
    }
  }

  return { title, year, tmdbId, counts };
}

// ─────────────────────────────────────────────────────────────
// 3. Cálculo do absoluto
// ─────────────────────────────────────────────────────────────
function calcularAbsoluto(apiResult, targetS, targetE) {
  if (!apiResult?.offsets) return null;
  if (targetS <= 0 || targetE <= 0) return null;

  const offset = apiResult.offsets[targetS];
  if (offset === undefined) return null;

  const season = apiResult.seasons.find(s => s.season === targetS);
  if (!season) return null;
  if (targetE > season.episode_count) return null;

  return offset + targetE;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
(async () => {
  console.log(`${c.bold}${c.magenta}🧪 Teste de episódio absoluto — ${IMDB_ID}${c.reset}`);

  const api = await viaApi();

  const html = await viaHtml();

  if (api && TARGET_S > 0 && TARGET_E > 0) {
    section(`3) Cálculo do absoluto — S${TARGET_S}E${TARGET_E}`);
    const abs = calcularAbsoluto(api, TARGET_S, TARGET_E);
    if (abs === null) {
      fail(`Não deu pra calcular (season ${TARGET_S} fora do range ou episódio > count)`);
    } else {
      const offset = api.offsets[TARGET_S];
      info('offset da season', offset);
      info('episódio alvo', TARGET_E);
      ok(`${c.bold}S${String(TARGET_S).padStart(2, '0')}E${String(TARGET_E).padStart(2, '0')} → episódio absoluto ${abs}${c.reset}`);
      console.log(`\n${c.dim}Esperado no torrent: arquivo com "Episodio ${String(abs).padStart(3, '0')}" ou similar${c.reset}`);
    }
  } else if (api) {
    section('3) Cálculo do absoluto');
    warn('Sem S/E nos argumentos. Uso: node script.mjs tt0214341 7 6');
  }

  console.log(`\n${c.bold}${c.magenta}🏁 Fim${c.reset}\n`);
})();