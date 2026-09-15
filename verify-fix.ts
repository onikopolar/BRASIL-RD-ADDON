import { Torrent } from './src/database/models.js';

const TAGS = ['rarbg', 'yify', 'ntb', 'rartv', 'yts', 'galaxyrg', 'flux', 'eztv', 'sparks', 'bone'];
const regex = new RegExp(`\\b(${TAGS.join('|')})\\b`, 'i');

async function main() {
  const todos = await Torrent.findAll({ raw: true });
  const alvos = todos.filter((t: any) => regex.test(t.magnet || ''));

  let comImdb = 0;
  for (const t of alvos) {
    if ((t as any).imdbId) comImdb++;
  }

  console.log(`Total magnets com tag: ${alvos.length}`);
  console.log(`Ainda com imdbId: ${comImdb}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
