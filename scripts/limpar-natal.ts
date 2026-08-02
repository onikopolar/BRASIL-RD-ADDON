import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import { Op } from 'sequelize';

async function main() {
  await sequelize.authenticate();
  const r = await Torrent.destroy({ where: { imdbId: 'tt0441773', title: { [Op.iLike]: '%natal%' } } });
  console.log(r, 'deletado (Especial de Natal)');
  await sequelize.close();
}
main();
