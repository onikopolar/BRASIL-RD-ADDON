import 'dotenv/config';
import { Op } from 'sequelize';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();
  
  const keep = ['tt0417299', 'tt0090021'];
  const total = await Torrent.count();
  
  console.log(`🗑️  Deletando ${total - await Torrent.count({ where: { imdbId: keep } })} torrents...`);
  
  const result = await Torrent.destroy({
    where: {
      imdbId: { [Op.notIn]: keep }
    }
  });
  
  console.log(`✅ ${result} torrents deletados!`);
  
  const remaining = await Torrent.count();
  console.log(`📦 Restam ${remaining} torrents no banco:`);
  
  const all = await Torrent.findAll({ attributes: ['imdbId', 'title'], raw: true });
  for (const t of all) {
    console.log(`   ${t.imdbId} | ${t.title?.substring(0, 70)}`);
  }
  
  await sequelize.close();
  console.log('\n✅ Banco limpo!');
}

main().catch(console.error);
