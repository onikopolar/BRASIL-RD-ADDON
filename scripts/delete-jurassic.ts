/**
 * Encontra e deleta torrents com "jurassic" no título
 * Uso: npx tsx scripts/delete-jurassic.ts
 */

import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  // 1. Encontra todos os torrents com "jurassic" (case insensitive)
  const { Op } = require('sequelize');
  const found = await Torrent.findAll({
    where: {
      title: { [Op.iLike]: '%jurassic%' }
    }
  });

  console.log(`🔍 Encontrados ${found.length} torrents com "jurassic":`);
  for (const t of found) {
    console.log(`   [${t.imdbId}] ${t.type} S${t.imdbSeason}E${t.imdbEpisodeStart} | ${t.title.substring(0, 70)}`);
  }

  if (found.length === 0) {
    console.log('   Nenhum encontrado.');
    await sequelize.close();
    return;
  }

  // 2. Confirmação
  console.log(`\n🗑️  Deletando ${found.length} registros...`);
  const deleted = await Torrent.destroy({
    where: {
      title: { [Op.iLike]: '%jurassic%' }
    }
  });

  console.log(`✅ ${deleted} registros deletados.`);
  await sequelize.close();
}

main().catch(err => { console.error(err); sequelize.close(); });
