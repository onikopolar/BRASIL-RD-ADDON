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
  console.log(`Total: ${todos.length}`);

  const alvos = todos.filter((t: any) => regex.test(t.magnet || ''));

  console.log(`Matches: ${alvos.length}`);
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (nada será alterado)' : 'EXECUTE'}\n`);

  if (alvos.length === 0) {
    console.log('Nada a fazer.');
    process.exit(0);
  }

  // Amostra
  console.log('Amostra (10 primeiros):');
  for (const t of alvos.slice(0, 10)) {
    console.log(`  hash=${String(t.infoHash).substring(0, 16)} | imdbId=${t.imdbId} | title="${String(t.title).substring(0, 50)}"`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('Para executar: npx tsx fix-torrents-internacionais.ts --execute');
    process.exit(0);
  }

  // Update em lote
  const hashes = alvos.map((t: any) => t.infoHash);
  const [afetados] = await Torrent.update(
    { imdbId: null, imdbIds: null },
    { where: { infoHash: hashes } }
  );

  console.log(`Linhas afetadas: ${afetados}`);
  process.exit(0);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
