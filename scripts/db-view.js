// Script: Visualizar torrents do banco de dados
// Uso: node scripts/db-view.js [filtro] [limite]
//   node scripts/db-view.js                  → últimos 20
//   node scripts/db-view.js mortal           → filtra por "mortal"
//   node scripts/db-view.js tt17490712       → filtra por imdbId
//   node scripts/db-view.js "" 50            → últimos 50
//   node scripts/db-view.js errados          → só títulos suspeitos (1 palavra TMDB)

require('dotenv/config');
const { Sequelize } = require('sequelize');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL nao configurada');
  process.exit(1);
}

const s = new Sequelize(DATABASE_URL, { dialect: 'postgres', logging: false });

const filter = process.argv[2] || '';
const limit = parseInt(process.argv[3]) || 20;

async function main() {
  await s.authenticate();

  let query, replacements;
  if (filter === 'errados') {
    // Torrents com IMDB de 1 palavra (suspeitos)
    query = `SELECT t.* FROM torrents t
      WHERE t."imdbId" IN (
        SELECT "imdbId" FROM torrents GROUP BY "imdbId" HAVING COUNT(DISTINCT title) > 3
      )
      ORDER BY t."imdbId", t."uploadDate" DESC
      LIMIT :limit`;
    replacements = { limit };
  } else if (filter.startsWith('tt')) {
    query = `SELECT * FROM torrents WHERE "imdbId" = :imdb ORDER BY "uploadDate" DESC LIMIT :limit`;
    replacements = { imdb: filter, limit };
  } else if (filter) {
    query = `SELECT * FROM torrents WHERE LOWER(title) LIKE :q ORDER BY "uploadDate" DESC LIMIT :limit`;
    replacements = { q: `%${filter.toLowerCase()}%`, limit };
  } else {
    query = `SELECT * FROM torrents ORDER BY "uploadDate" DESC LIMIT :limit`;
    replacements = { limit };
  }

  const [rows] = await s.query(query, { replacements });

  // Agrupa por imdbId pra mostrar duplicados
  const grouped = {};
  for (const r of rows) {
    const key = r.imdbId || 'sem-imdb';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(r);
  }

  console.log(`Total: ${rows.length} torrents (limite ${limit})\n`);

  for (const [imdbId, torrents] of Object.entries(grouped)) {
    // Busca titulo TMDB pra contexto
    let tmdbInfo = '';
    if (imdbId !== 'sem-imdb' && torrents.length > 0) {
      tmdbInfo = ` | "${torrents[0].title?.substring(0, 50)}"`;
    }

    console.log(`\n${'═'.repeat(60)}`);
    console.log(`IMDB: ${imdbId} | ${torrents.length} torrents | type: ${torrents[0].type}`);
    console.log(`${'─'.repeat(60)}`);

    for (const t of torrents) {
      const parts = [];
      parts.push(t.qualidade?.padEnd(6) || '?'.padEnd(6));
      parts.push((t.provider || '?').padEnd(15));
      if (t.type === 'series') parts.push(`S${t.imdbSeason || '?'}`.padEnd(5));
      parts.push(t.title?.substring(0, 80) || '');
      console.log('  ' + parts.join(' '));
    }
  }

  console.log(`\n${'═'.repeat(60)}`);

  // Stats rapidas
  const [stats] = await s.query(`SELECT type, COUNT(*) FROM torrents GROUP BY type`);
  console.log('\nPor tipo:', stats.map(r => `${r.type}: ${r.count}`).join(' | '));

  const [qual] = await s.query(`SELECT qualidade, COUNT(*) FROM torrents GROUP BY qualidade ORDER BY count DESC`);
  console.log('Por qualidade:', qual.map(r => `${r.qualidade}: ${r.count}`).join(' | '));

  await s.close();
}

main().catch(err => { console.error(err); process.exit(1); });
