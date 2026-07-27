import { sequelize } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

async function main() {
  await sequelize.authenticate();

  console.log('=== Tabela files ===');
  const files = await sequelize.query(`
    SELECT f.id, f."imdbId", f."title", f."imdbSeason", f."imdbEpisode", f."infoHash"
    FROM files f
    WHERE f."imdbId" IN ('tt0417299', 'tt1695360', 'tt18259538')
       OR f."title" ILIKE '%avatar%' OR f."title" ILIKE '%korra%' OR f."title" ILIKE '%aang%'
    ORDER BY f.id
  `, { type: QueryTypes.SELECT }) as any[];

  console.log('Files:', files.length);
  for (const f of files) {
    console.log(`  ID=${f.id} IMDB=${f.imdbId} S${f.imdbSeason}E${f.imdbEpisode ?? '?'} | ${f.title?.substring(0, 100)}`);
  }

  console.log('\n=== Tabela torrents ===');
  const torrents = await sequelize.query(`
    SELECT t."infoHash", t."title", t."seeders"
    FROM torrents t
    WHERE t."title" ILIKE '%avatar%' OR t."title" ILIKE '%korra%' OR t."title" ILIKE '%aang%'
    ORDER BY t."infoHash"
  `, { type: QueryTypes.SELECT }) as any[];

  console.log('Torrents:', torrents.length);
  for (const t of torrents) {
    console.log(`  ${t.infoHash?.substring(0, 16)}... | ${t.title?.substring(0, 100)}`);
  }

  // Deletar files
  console.log('\n🗑️ Deletando files...');
  const delFiles = await sequelize.query(`
    DELETE FROM files
    WHERE "imdbId" IN ('tt0417299', 'tt1695360', 'tt18259538')
       OR "title" ILIKE '%korra%' OR "title" ILIKE '%aang%' OR "title" ILIKE '%avatar%'
  `, { type: QueryTypes.DELETE });

  // Deletar torrents órfãos
  console.log('🗑️ Deletando torrents órfãos...');
  await sequelize.query(`
    DELETE FROM torrents
    WHERE ("title" ILIKE '%korra%' OR "title" ILIKE '%aang%' OR "title" ILIKE '%avatar%')
      AND "infoHash" NOT IN (SELECT "infoHash" FROM files)
  `, { type: QueryTypes.DELETE });

  // Verificar
  const check = await sequelize.query(`
    SELECT COUNT(*) as cnt FROM files
    WHERE "imdbId" IN ('tt0417299', 'tt1695360', 'tt18259538')
  `, { type: QueryTypes.SELECT }) as any[];

  console.log(`\nRestam: ${check[0].cnt} registros`);
  await sequelize.close();
}

main().catch(e => { console.error(e); process.exit(1); });
