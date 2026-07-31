// Lista todos os filmes/series unicos no banco (agrupado por IMDB)
// Uso: node scripts/db-list.js
require('dotenv/config');
const { Sequelize } = require('sequelize');

const s = new Sequelize(process.env.DATABASE_URL, { dialect: 'postgres', logging: false });

async function main() {
  await s.authenticate();

  const [rows] = await s.query(`
    SELECT 
      "imdbId",
      type,
      COUNT(*) as torrents,
      STRING_AGG(DISTINCT qualidade, ', ' ORDER BY qualidade) as qualidades,
      MAX(title) as sample_title,
      MAX("uploadDate") as last_added
    FROM torrents 
    WHERE "imdbId" IS NOT NULL
    GROUP BY "imdbId", type
    ORDER BY type, "imdbId"
  `);

  let movieCount = 0, seriesCount = 0;

  for (const r of rows) {
    if (r.type === 'movie') movieCount++;
    else seriesCount++;

    const typeIcon = r.type === 'movie' ? 'FILME' : 'SERIE';
    const q = (r.qualidades || '?').substring(0, 30);
    console.log(
      `${typeIcon.padEnd(6)} ${r.imdbId.padEnd(12)} ${String(r.torrents).padStart(3)} torrents  ${q.padEnd(30)} ${(r.sample_title || '').substring(0, 60)}`
    );
  }

  console.log(`\nTotal: ${movieCount} filmes + ${seriesCount} series = ${rows.length} unicos`);
  await s.close();
}

main().catch(err => { console.error(err); process.exit(1); });
