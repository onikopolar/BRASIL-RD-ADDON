import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

function formatSize(size?: number): string {
  if (!size) return '?';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatEpisodeRange(t: any): string {
  const season = t.imdbSeason ? `S${t.imdbSeason}` : '';
  if (!t.imdbEpisodeStart) return season;
  if (!t.imdbEpisodeEnd || t.imdbEpisodeEnd === t.imdbEpisodeStart) {
    return `${season}E${t.imdbEpisodeStart}`;
  }
  return `${season}E${t.imdbEpisodeStart}-E${t.imdbEpisodeEnd}`;
}

async function main() {
  await sequelize.authenticate();
  const all = await Torrent.findAll({
    raw: true,
    order: [
      ['imdbId', 'ASC'],
      ['imdbSeason', 'ASC'],
      ['imdbEpisodeStart', 'ASC'],
      ['uploadDate', 'DESC'],
    ],
  });

  const groups = new Map<string, any[]>();
  for (const t of all) {
    const id = t.imdbId || '?';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(t);
  }

  console.log(`${all.length} torrents, ${groups.size} IMDBs\n`);

  for (const [id, ts] of groups) {
    console.log(`🎬 ${id} (${ts.length})`);
    for (const t of ts) {
      const ep = formatEpisodeRange(t);
      const idioma = t.idioma || '?';
      const seeders = t.seeders ?? '?';
      const size = formatSize(t.size);
      const provider = (t.provider || '?').substring(0, 12);
      const qualidade = t.qualidade || '?';
      const title = (t.title || '').substring(0, 55);
      const uploadDate = t.uploadDate ? new Date(t.uploadDate).toISOString().slice(0, 10) : '?';
      console.log(`  [${provider}] ${qualidade} ${ep} | ${idioma} | S:${seeders} | ${size} | ${uploadDate} | ${title}`);
    }
    console.log('');
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('Erro:', err);
  await sequelize.close();
  process.exit(1);
});