import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();

  // Ordena por imdbId e depois por temporada/episódio pra agrupar naturalmente
  const torrents = await Torrent.findAll({
    raw: true,
    order: [['imdbId', 'ASC'], ['imdbSeason', 'ASC'], ['imdbEpisodeStart', 'ASC'], ['provider', 'ASC']],
  });

  if (torrents.length === 0) {
    console.log('Banco vazio');
    await sequelize.close();
    return;
  }

  // Agrupa tudo por imdbId num Map só pra separar os blocos
  const grupos = new Map<string, any[]>();
  for (const t of torrents) {
    const id = t.imdbId || '?';
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id)!.push(t);
  }

  console.log(`\n${grupos.size} IMDb(s) no banco — ${torrents.length} torrent(s)\n`);

  for (const [id, ts] of grupos) {
    // Cabeçalho do bloco, mesmo estilo do apagar-imdb
    console.log(`${id} — ${ts.length} torrent(s)`);
    for (const t of ts) {
      const prov = (t.provider || '?').padEnd(15).slice(0, 15);
      // Monta S01E02 só se tiver os dados
      const temp = t.imdbSeason != null ? `S${String(t.imdbSeason).padStart(2, '0')}` : '     ';
      const ep = t.imdbEpisodeStart != null ? `E${String(t.imdbEpisodeStart).padStart(2, '0')}` : '';
      console.log(`  [${prov}] ${temp}${ep}  ${t.title || ''}`);
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