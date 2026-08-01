// Limpeza do banco: manter só Avatar e Bala de Prata
import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();
  console.log('📊 Conectado ao banco\n');

  // 1. Ver estado atual
  const total = await Torrent.count();
  console.log(`Total de torrents no banco: ${total}`);

  // 2. Achar os IMDB IDs dos títulos que queremos manter
  const TMDB_KEY = process.env.TMDB_API_KEY;
  
  // Avatar: A Lenda de Aang
  console.log('\n🔍 Buscando "Avatar: A Lenda de Aang"...');
  const avatarResp = await fetch(
    `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=Avatar+A+Lenda+de+Aang&language=pt-BR`
  );
  const avatarData = await avatarResp.json();
  for (const r of avatarData.results?.slice(0, 3) || []) {
    const extResp = await fetch(
      `https://api.themoviedb.org/3/tv/${r.id}/external_ids?api_key=${TMDB_KEY}`
    );
    const ext = await extResp.json();
    console.log(`   ${ext.imdb_id} | ${r.first_air_date?.substring(0,4)} | ${r.name} (${r.original_name})`);
  }

  // Bala de Prata / Lobisomem
  console.log('\n🔍 Buscando "Bala de Prata Lobisomem"...');
  const balaResp = await fetch(
    `https://api.themoviedb.org/3/search/movie?api_key=${TMDB_KEY}&query=Bala+de+Prata+Lobisomem&language=pt-BR`
  );
  const balaData = await balaResp.json();
  for (const r of balaData.results?.slice(0, 3) || []) {
    const extResp = await fetch(
      `https://api.themoviedb.org/3/movie/${r.id}/external_ids?api_key=${TMDB_KEY}`
    );
    const ext = await extResp.json();
    console.log(`   ${ext.imdb_id} | ${r.release_date?.substring(0,4)} | ${r.title} (${r.original_title})`);
  }

  // 3. Ver quais IMDB IDs já existem no banco
  console.log('\n📦 IMDB IDs no banco:');
  const imdbIds = await Torrent.findAll({
    attributes: ['imdbId'],
    group: ['imdbId'],
    raw: true
  });
  console.log(`   ${imdbIds.length} IMDBs distintos`);
  for (const row of imdbIds.slice(0, 20)) {
    const count = await Torrent.count({ where: { imdbId: row.imdbId } });
    // Pega um título de exemplo
    const example = await Torrent.findOne({ where: { imdbId: row.imdbId }, attributes: ['title'], raw: true });
    console.log(`   ${row.imdbId} | ${count} torrents | ${example?.title?.substring(0, 60) || '?'}`);
  }

  await sequelize.close();
}

main().catch(console.error);
