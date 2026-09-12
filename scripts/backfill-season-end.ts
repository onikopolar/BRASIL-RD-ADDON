import { sequelize, Torrent } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

async function main() {
  await sequelize.authenticate();
  console.log('Conectado ao banco.\n');

  const antes = await sequelize.query(
    `SELECT COUNT(*)::int AS total
     FROM torrents
     WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL`,
    { type: QueryTypes.SELECT }
  ) as Array<{ total: number }>;

  const total = antes[0]?.total ?? 0;
  console.log(`Torrents com imdbSeason preenchido e imdbSeasonEnd vazio: ${total}`);

  const amostra = await sequelize.query(
    `SELECT "infoHash", title, "imdbSeason"
     FROM torrents
     WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL
     LIMIT 10`,
    { type: QueryTypes.SELECT }
  );
  console.log('\nAmostra dos 10 primeiros:');
  for (const row of amostra as any[]) {
    console.log(`  S${row.imdbSeason}  ${row.title?.substring(0, 60)}  ${row.infoHash?.substring(0, 12)}`);
  }

  if (total === 0) {
    console.log('\nNada a fazer. Banco já está consistente.');
    await sequelize.close();
    return;
  }

  console.log(`\nRodando UPDATE...`);
  const [, meta] = await sequelize.query(
    `UPDATE torrents
     SET "imdbSeasonEnd" = "imdbSeason"
     WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL`
  ) as any;

  console.log(`Atualizados: ${meta ?? '?'} linhas`);

  const depois = await sequelize.query(
    `SELECT COUNT(*)::int AS total
     FROM torrents
     WHERE "imdbSeason" IS NOT NULL AND "imdbSeasonEnd" IS NULL`,
    { type: QueryTypes.SELECT }
  ) as Array<{ total: number }>;

  console.log(`\nPendentes depois do UPDATE: ${depois[0]?.total ?? 0}`);

  await sequelize.close();
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
