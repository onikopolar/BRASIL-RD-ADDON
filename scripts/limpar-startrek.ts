import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
  await sequelize.authenticate();
  const r = await Torrent.destroy({ where: { imdbId: 'tt0796366' } });
  console.log(r, 'deletados');
  await sequelize.close();
}
main();
