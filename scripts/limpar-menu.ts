import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import { Op } from 'sequelize';

async function main() {
  await sequelize.authenticate();
  
  // Acha todos de The Menu
  const all = await Torrent.findAll({ raw: true, where: { title: { [Op.iLike]: '%menu%' } } });
  console.log('The Menu no banco:');
  for (const t of all) {
    console.log(`  ${t.imdbId} | ${t.infoHash?.substring(0,16)} | ${t.title?.substring(0,80)}`);
  }
  
  // Deleta todos EXCETO o que tem "Menu.2022" no título
  const keep = all.find(t => t.title?.toLowerCase().includes('menu.2022'));
  
  if (keep) {
    const r = await Torrent.destroy({
      where: {
        imdbId: keep.imdbId,
        infoHash: { [Op.ne]: keep.infoHash }
      }
    });
    console.log(`\n✅ ${r} deletados. Mantido: ${keep.title?.substring(0, 60)}`);
  }
  
  await sequelize.close();
}
main();
