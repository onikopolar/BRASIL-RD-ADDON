import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();
  
  const result = await Torrent.destroy({
    where: { imdbId: 'tt0436992', imdbSeason: 4 }
  });
  
  console.log(`✅ ${result} torrents da S04 deletados!`);
  
  const remaining = await Torrent.count();
  console.log(`📦 Total no banco: ${remaining}`);
  
  await sequelize.close();
}

main().catch(console.error);
