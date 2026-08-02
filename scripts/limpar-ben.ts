import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import { Op } from 'sequelize';

async function main() {
  await sequelize.authenticate();
  
  const indicadores = ['-BEN', 'ben.th', 'benth', '-ben.']; 
  let total = 0;
  
  for (const ind of indicadores) {
    const found = await Torrent.findAll({
      where: { title: { [Op.iLike]: `%${ind}%` } },
      raw: true
    });
    if (found.length === 0) continue;
    console.log(`🔍 "${ind}": ${found.length} torrents`);
    for (const t of found) console.log(`   🗑️  ${t.title?.substring(0, 80)}`);
    const r = await Torrent.destroy({ where: { title: { [Op.iLike]: `%${ind}%` } } });
    total += r;
  }
  
  console.log(`\n✅ ${total} deletados`);
  await sequelize.close();
}
main();
