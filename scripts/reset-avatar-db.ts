import { sequelize } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

async function main() {
  await sequelize.authenticate();

  const before = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM files
    WHERE "imdbId" IN ('tt0417299', 'tt1695360', 'tt18259538')
  `, { type: QueryTypes.SELECT }) as any[];

  console.log('Antes:', before[0].cnt, 'registros');

  await sequelize.query(
    `DELETE FROM files WHERE "imdbId" IN ('tt0417299', 'tt1695360', 'tt18259538')`,
    { type: QueryTypes.DELETE }
  );

  const after = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM files
    WHERE "imdbId" IN ('tt0417299', 'tt1695360', 'tt18259538')
  `, { type: QueryTypes.SELECT }) as any[];

  console.log('Depois:', after[0].cnt, 'registros');
  console.log('✅ Limpo!');
  await sequelize.close();
}

main().catch(e => { console.error(e); process.exit(1); });
