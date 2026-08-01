import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();
  
  const keep = ['tt0417299', 'tt0090021'];
  console.log('Torrents a manter:');
  let keepTotal = 0;
  for (const id of keep) {
    const count = await Torrent.count({ where: { imdbId: id } });
    keepTotal += count;
    const ex = await Torrent.findOne({ where: { imdbId: id }, attributes: ['title'], raw: true });
    console.log(`  ${id} | ${count} torrents | ${ex?.title?.substring(0, 70) || 'NENHUM!'}`);
  }
  
  const total = await Torrent.count();
  console.log(`\n📊 Total: ${total} | Manter: ${keepTotal} | Deletar: ${total - keepTotal}`);
  
  await sequelize.close();
}

main().catch(console.error);
