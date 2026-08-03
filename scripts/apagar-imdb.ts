import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import * as readline from 'readline';

async function main() {
  await sequelize.authenticate();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (q: string) => new Promise<string>(r => rl.question(q, r));

  const imdbId = (await ask('IMDb ID (ex: tt1234567): ')).trim();
  if (!imdbId) { console.log('ID inválido'); rl.close(); await sequelize.close(); return; }

  const torrents = await Torrent.findAll({ where: { imdbId }, raw: true });
  if (torrents.length === 0) {
    console.log(`Nenhum torrent encontrado para ${imdbId}`);
    rl.close();
    await sequelize.close();
    return;
  }

  console.log(`\n${torrents.length} torrent(s) encontrados:`);
  for (const t of torrents) {
    console.log(`  [${(t.provider || '?').substring(0, 15)}] ${(t.title || '').substring(0, 70)}`);
  }

  const confirm = (await ask(`\nDeletar TODOS? (s/N): `)).trim().toLowerCase();
  if (confirm !== 's') { console.log('Cancelado'); rl.close(); await sequelize.close(); return; }

  const destroyed = await Torrent.destroy({ where: { imdbId } });
  console.log(`\nDeletados: ${destroyed}`);
  rl.close();
  await sequelize.close();
}

main();
