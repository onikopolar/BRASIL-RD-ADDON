import 'dotenv/config';
import axios from 'axios';

const IMDB_ID = process.argv[2] || 'tt0214341';
const TARGET_S = parseInt(process.argv[3] || '0', 10);
const TARGET_E = parseInt(process.argv[4] || '0', 10);
const API_KEY = process.env.TMDB_API_KEY;
const BASE = 'https://api.themoviedb.org/3';

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const section = t => console.log(`\n${c.bold}${c.cyan}══ ${t} ══${c.reset}`);
const ok = t => console.log(`${c.green}✅ ${t}${c.reset}`);
const fail = t => console.log(`${c.red}❌ ${t}${c.reset}`);
const warn = t => console.log(`${c.yellow}⚠️  ${t}${c.reset}`);
const info = (k, v) => console.log(`   ${c.dim}${k}:${c.reset} ${v}`);

async function findTmdbId() {
  section('1) Descobrir tmdbId');
  try {
    const r = await axios.get(`${BASE}/find/${IMDB_ID}`, {
      params: { api_key: API_KEY, external_source: 'imdb_id' },
      timeout: 10000,
    });
    const tv = r.data?.tv_results?.[0];
    if (tv) { ok(`/find → tmdbId=${tv.id} "${tv.name}"`); return tv.id; }
    warn('/find vazio (bug do DBZ)');
  } catch (e) { fail(`/find falhou: ${e.message}`); }

  // Fallback: Cinemeta → título → search TMDB
  try {
    const r = await axios.get(`https://v3-cinemeta.strem.io/meta/series/${IMDB_ID}.json`, { timeout: 10000 });
    const title = r.data?.meta?.name;
    if (title) {
      ok(`Cinemeta → "${title}"`);
      const s = await axios.get(`https://www.themoviedb.org/search?query=${encodeURIComponent(title)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });
      const m = s.data.match(/\/tv\/(\d+)/);
      if (m) { ok(`search → tmdbId=${m[1]}`); return parseInt(m[1]); }
    }
  } catch (e) { warn(`fallback falhou: ${e.message}`); }
  return null;
}

async function dumpSeasons(tmdbId) {
  section('2) /tv/{id} → seasons');
  const r = await axios.get(`${BASE}/tv/${tmdbId}`, {
    params: { api_key: API_KEY, language: 'pt-BR' },
    timeout: 10000,
  });
  const seasons = (r.data.seasons || [])
    .filter(s => s.season_number > 0)
    .sort((a, b) => a.season_number - b.season_number);
  ok(`"${r.data.name}" — ${seasons.length} seasons`);

  let offset = 0;
  const offsets = {};
  for (const s of seasons) {
    offsets[s.season_number] = offset;
    console.log(`   S${String(s.season_number).padStart(2, '0')} ${String(s.episode_count).padStart(3)} eps  (offset=${offset})`);
    offset += s.episode_count;
  }
  ok(`Total: ${offset} episódios`);
  return { seasons, offsets, total: offset };
}

(async () => {
  console.log(`${c.bold}${c.magenta}🧪 ${IMDB_ID} (alvo S${TARGET_S}E${TARGET_E})${c.reset}`);
  const tmdbId = await findTmdbId();
  if (!tmdbId) { fail('Sem tmdbId — abortando'); process.exit(1); }
  const { seasons, offsets } = await dumpSeasons(tmdbId);

  if (TARGET_S > 0 && TARGET_E > 0) {
    section(`3) Absoluto — S${TARGET_S}E${TARGET_E}`);
    const off = offsets[TARGET_S];
    const season = seasons.find(s => s.season_number === TARGET_S);
    if (off === undefined || !season) { fail('season fora do range'); return; }
    if (TARGET_E > season.episode_count) { fail(`episódio > ${season.episode_count}`); return; }
    const abs = off + TARGET_E;
    ok(`${c.bold}S${String(TARGET_S).padStart(2,'0')}E${String(TARGET_E).padStart(2,'0')} → absoluto ${abs}${c.reset}`);
  }
  console.log(`\n${c.bold}${c.magenta}🏁${c.reset}\n`);
})();
