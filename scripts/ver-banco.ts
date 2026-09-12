import 'dotenv/config';
import { sequelize, Torrent, ImdbTitleCache } from '../src/database/models.js';

function formatSize(size?: number): string {
  if (!size) return '?';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(date?: Date): string {
  return date ? new Date(date).toISOString().slice(0, 10) : '—';
}

function normalizar(t: string): string {
  return (t || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function chaveTitulo(t: string): string {
  const norm = normalizar(t);
  const palavras = norm.split(' ').filter(w => w.length > 2);
  return palavras.slice(0, 3).join(' ') || norm;
}

function rangeTemporadas(ts: any[]): string {
  const seasons = ts.map(t => t.imdbSeason).filter((s): s is number => s != null);
  if (seasons.length === 0) return '—';
  const min = Math.min(...seasons);
  const max = Math.max(...seasons);
  return min === max ? `S${min}` : `S${min}-S${max}`;
}

function listaProviders(ts: any[]): string {
  return [...new Set(ts.map(t => t.provider).filter(Boolean))].join(',');
}

function ehSuspeito(ts: any[]): { suspeito: boolean; chaves: string[] } {
  const chaves = [...new Set(ts.map(t => chaveTitulo(t.title)))].filter(Boolean);
  return { suspeito: chaves.length > 3 && ts.length > 5, chaves };
}

async function tituloPrimario(imdbId: string, torrentTitles: string[]): Promise<string> {
  try {
    const cache = await ImdbTitleCache.findOne({
      where: { imdbId },
      raw: true,
      order: [['season', 'ASC']],
    }) as any;
    if (cache) {
      const pt = Array.isArray(cache.titlesPt) ? cache.titlesPt.find(Boolean) : undefined;
      const en = Array.isArray(cache.titlesEn) ? cache.titlesEn.find(Boolean) : undefined;
      if (pt || en) return pt || en;
    }
  } catch { }
  return torrentTitles[0] || 'Título desconhecido';
}

function pad(text: string, width: number): string {
  return text.length > width ? text.substring(0, width - 1) + '…' : text.padEnd(width);
}

async function mostrarDetalhe(imdbId: string) {
  const torrents = await Torrent.findAll({
    where: { imdbId },
    raw: true,
    order: [['imdbSeason', 'ASC'], ['imdbEpisodeStart', 'ASC'], ['uploadDate', 'DESC']],
  });

  if (torrents.length === 0) {
    console.log(`Nenhum torrent encontrado para ${imdbId}`);
    return;
  }

  const titulo = await tituloPrimario(imdbId, torrents.map(t => t.title).filter(Boolean) as string[]);
  const { suspeito, chaves } = ehSuspeito(torrents);

  console.log('');
  console.log(`IMDb: ${imdbId}`);
  console.log(`Título: ${titulo}`);
  console.log(`Total: ${torrents.length} | Temporadas: ${rangeTemporadas(torrents)} | Providers: ${listaProviders(torrents)}`);
  if (suspeito) {
    console.log(`⚠️  SUSPEITO — ${chaves.length} chaves de título diferentes:`);
    for (const c of chaves) console.log(`     • ${c}`);
  }
  console.log('');
  console.log(pad('Provider', 14) + pad('Qual.', 8) + pad('Temporada', 10) + pad('Episódio', 12) + pad('Idioma', 12) + pad('Seeds', 7) + pad('Tamanho', 10) + pad('Data', 12) + 'Título');
  console.log('─'.repeat(120));

  for (const t of torrents) {
    const prov = pad(t.provider || '?', 14);
    const qual = pad(t.qualidade || '?', 8);
    const temp = pad(t.imdbSeason ? `S${t.imdbSeason}${t.imdbSeasonEnd && t.imdbSeasonEnd !== t.imdbSeason ? `-S${t.imdbSeasonEnd}` : ''}` : '—', 10);
    const ep = pad(
      t.imdbEpisodeStart
        ? (t.imdbEpisodeEnd && t.imdbEpisodeEnd !== t.imdbEpisodeStart
            ? `E${t.imdbEpisodeStart}-E${t.imdbEpisodeEnd}`
            : `E${t.imdbEpisodeStart}`)
        : '—',
      12
    );
    const idi = pad(t.idioma || '?', 12);
    const sd = pad(String(t.seeders ?? '?'), 7);
    const sz = pad(formatSize(t.size), 10);
    const dt = pad(formatDate(t.uploadDate), 12);
    const ti = (t.title || '').substring(0, 70);
    console.log(`${prov}${qual}${temp}${ep}${idi}${sd}${sz}${dt}${ti}`);
  }
  console.log('');
}

async function mostrarResumo(filtroSuspeitos: boolean, filtroTipo: 'series' | 'movie' | null) {
  const all = await Torrent.findAll({
    raw: true,
    order: [['imdbId', 'ASC'], ['imdbSeason', 'ASC']],
  });

  const groups = new Map<string, any[]>();
  for (const t of all) {
    const id = t.imdbId || '?';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(t);
  }

  let mostrados = 0;
  let totalSuspeitos = 0;

  console.log(pad('IMDb', 13) + pad('Título', 40) + pad('Qtd', 6) + pad('Temps', 10) + pad('Tipo', 8) + 'Providers');
  console.log('─'.repeat(110));

  for (const [id, ts] of groups) {
    if (!id.startsWith('tt')) continue;

    const tipo = ts[0]?.type === 'series' ? 'series' : 'movie';
    if (filtroTipo && tipo !== filtroTipo) continue;

    const { suspeito, chaves } = ehSuspeito(ts);
    if (suspeito) totalSuspeitos++;
    if (filtroSuspeitos && !suspeito) continue;

    const titulo = await tituloPrimario(id, ts.map(t => t.title).filter(Boolean) as string[]);
    const marca = suspeito ? '⚠️ ' : '   ';
    const linha = marca + pad(id, 10) + pad(titulo.substring(0, 38), 40) + pad(String(ts.length), 6) + pad(rangeTemporadas(ts), 10) + pad(tipo, 8) + listaProviders(ts);
    console.log(linha);
    mostrados++;
  }

  console.log('');
  console.log(`Total: ${mostrados} IMDBs mostrados | ${totalSuspeitos} suspeitos no banco`);
}

async function main() {
  await sequelize.authenticate();

  const args = process.argv.slice(2);
  const filtroSuspeitos = args.includes('--suspeitos');
  const filtroTipo: 'series' | 'movie' | null = args.includes('--series') ? 'series' : args.includes('--filmes') ? 'movie' : null;
  const imdbIdArg = args.find(a => /^tt\d+$/.test(a));

  if (imdbIdArg) {
    await mostrarDetalhe(imdbIdArg);
  } else {
    await mostrarResumo(filtroSuspeitos, filtroTipo);
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('Erro:', err);
  await sequelize.close();
  process.exit(1);
});