import { Torrent } from './src/database/models.js';

const TAGS = [
  'rartv', 'ntb', 'yify', 'yts', 'galaxyrg', 'flux', 'cmrg', 'framestor',
  'ctrlhd', 'tayto', 'sparks', 'geckos', 'eztv', 'ettv', 'rarbg',
  'bone', 'ion10', 'dcprip', 'rdnyb',
];

const DRY_RUN = process.argv[2] !== '--execute';
const regex = new RegExp(`\\b(${TAGS.join('|')})\\b`, 'i');

async function main() {
  const todos = await Torrent.findAll({ raw: true });
  console.log(`Total no banco: ${todos.length}`);

  const alvos = todos.filter((t: any) => regex.test(t.magnet || ''));
  console.log(`Para deletar: ${alvos.length}`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'EXECUTE'}\n`);

  if (alvos.length === 0) {
    console.log('Nada a fazer.');
    return;
  }

  console.log('Amostra:');
  for (const t of alvos.slice(0, 10)) {
    console.log(`  hash=${String(t.infoHash).substring(0, 16)} | title="${String(t.title).substring(0, 50)}" | provider=${t.provider}`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('Para executar: npx tsx fix-delete-torrents.ts --execute');
    return;
  }

  const hashes = alvos.map((t: any) => t.infoHash);
  const deletados = await Torrent.destroy({ where: { infoHash: hashes } });
  console.log(`Linhas deletadas: ${deletados}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
