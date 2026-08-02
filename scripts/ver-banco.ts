import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();
  const all = await Torrent.findAll({ raw: true, order: [['imdbId','ASC']] });
  const groups = new Map<string, any[]>();
  for (const t of all) {
    const id = t.imdbId || '?';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(t);
  }
  console.log(all.length + ' torrents, ' + groups.size + ' IMDBs\n');
  for (const [id, ts] of groups) {
    console.log('🎬 ' + id + ' (' + ts.length + ')');
    for (const t of ts) {
      const se = (t.imdbSeason ? 'S'+t.imdbSeason : '') + (t.imdbEpisodeStart ? 'E'+t.imdbEpisodeStart : '');
      console.log('  [' + (t.provider||'?').substring(0,12) + '] ' + (t.qualidade||'?') + ' ' + se + ' | ' + (t.title||'').substring(0,55));
    }
    console.log('');
  }
  await sequelize.close();
}
main();
