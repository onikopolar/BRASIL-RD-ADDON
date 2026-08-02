import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';

async function main() {
const r = await Torrent.destroy({ where: { imdbId: 'tt0773262' } });
console.log(r, 'torrents deletados de Dexter');
await sequelize.close();
}
main();
