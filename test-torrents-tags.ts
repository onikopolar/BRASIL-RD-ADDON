import { Torrent } from './src/database/models.js';

const TAGS_PADRAO = [
  'rartv', 'ntb', 'yify', 'yts', 'galaxyrg', 'flux', 'cmrg', 'framestor',
  'ctrlhd', 'tayto', 'sparks', 'geckos', 'eztv', 'ettv', 'rarbg',
  'bone', 'ion10', 'dcprip', 'rdnyb',
];

async function main() {
  const tags = process.argv.slice(2);
  const tagsBusca = tags.length > 0 ? tags : TAGS_PADRAO;

  console.log(`\nAnalisando torrents salvos\n`);
  console.log(`Tags buscadas: [${tagsBusca.join(', ')}]\n`);

  // Lê todos os torrents do banco
  const todos = await Torrent.findAll({ raw: true });

  console.log(`Total de torrents no banco: ${todos.length}\n`);

  if (todos.length === 0) {
    console.log('Nenhum torrent salvo.');
    return;
  }

  // Amostra da primeira linha pra descobrir os campos
  console.log('Campos disponíveis:');
  for (const k of Object.keys(todos[0])) {
    const v = (todos[0] as any)[k];
    const preview = typeof v === 'string' ? v.substring(0, 60) : String(v);
    console.log(`  ${k}: ${preview}`);
  }
  console.log('');

  // Regex única com todas as tags (case-insensitive, word boundary)
  const tagsEscapadas = tagsBusca.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`\\b(${tagsEscapadas.join('|')})\\b`, 'i');

  // Para cada torrent, checa se bate em algum campo textual
  const matches: Array<{ row: any; tag: string; campo: string }> = [];

  for (const row of todos) {
    for (const [campo, valor] of Object.entries(row)) {
      if (typeof valor !== 'string') continue;
      const m = valor.match(regex);
      if (m) {
        matches.push({ row, tag: m[1].toLowerCase(), campo });
        break; // não duplica a mesma linha se bater em vários campos
      }
    }
  }

  console.log(`Matches: ${matches.length} de ${todos.length}\n`);

  if (matches.length === 0) return;

  // Agrupa por tag
  const porTag: Record<string, typeof matches> = {};
  for (const m of matches) {
    if (!porTag[m.tag]) porTag[m.tag] = [];
    porTag[m.tag].push(m);
  }

  console.log('── Contagem por tag ──');
  for (const [tag, lista] of Object.entries(porTag).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${tag}: ${lista.length}`);
  }
  console.log('');

  // Detalhes
  console.log('── Detalhes ──\n');
  for (const m of matches.slice(0, 30)) {
    const row = m.row;
    const infoHash = row.infoHash || row.info_hash || '?';
    const titulo = row.title || row.canonicalName || row.name || row.originalTitle || '?';
    const provider = row.provider || '?';
    const imdbId = row.imdbId || row.imdb_id || '?';
    const temporada = row.imdbSeason ?? row.season ?? '?';
    const ano = row.year ?? '?';

    console.log(`[${m.tag}] (${m.campo})`);
    console.log(`  hash: ${String(infoHash).substring(0, 16)}`);
    console.log(`  title: ${String(titulo).substring(0, 80)}`);
    console.log(`  provider: ${provider}`);
    console.log(`  imdbId: ${imdbId} | year: ${ano} | season: ${temporada}`);
    console.log('');
  }

  if (matches.length > 30) {
    console.log(`... (${matches.length - 30} adicionais)\n`);
  }

  // Sumário dos campos onde bateram
  const porCampo: Record<string, number> = {};
  for (const m of matches) {
    porCampo[m.campo] = (porCampo[m.campo] || 0) + 1;
  }
  console.log('── Campos onde bateram ──');
  for (const [campo, n] of Object.entries(porCampo).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${campo}: ${n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Erro:', err.message);
    process.exit(1);
  });
