import 'dotenv/config';
import { sequelize, Torrent, ImdbTitleCache } from '../src/database/models.js';

function formatSize(size?: number): string {
  if (!size) return '?';
  if (size < 1024) return size + ' B';
  if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
  if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
  return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatEpisodeRange(t: any): string {
  const season = t.imdbSeason ? `S${t.imdbSeason}` : '';
  if (!t.imdbEpisodeStart) return season;
  if (!t.imdbEpisodeEnd || t.imdbEpisodeEnd === t.imdbEpisodeStart) {
    return `${season}E${t.imdbEpisodeStart}`;
  }
  return `${season}E${t.imdbEpisodeStart}-E${t.imdbEpisodeEnd}`;
}

async function getPrimaryTitle(imdbId: string, torrentTitles: string[]): Promise<string> {
  try {
    const cacheEntries = await ImdbTitleCache.findAll({
      where: { imdbId },
      raw: true,
      order: [['season', 'ASC']],
    });

    if (cacheEntries.length > 0) {
      const first = cacheEntries[0] as any;
      const ptFirst = first.titlesPt ? first.titlesPt.split(',').map((s: string) => s.trim()).find(Boolean) : undefined;
      const enFirst = first.titlesEn ? first.titlesEn.split(',').map((s: string) => s.trim()).find(Boolean) : undefined;
      return ptFirst || enFirst || torrentTitles[0] || 'Título desconhecido';
    }
  } catch {
    // ignora e usa fallback
  }
  return torrentTitles[0] || 'Título desconhecido';
}

async function main() {
  await sequelize.authenticate();

  const all = await Torrent.findAll({
    raw: true,
    order: [
      ['imdbId', 'ASC'],
      ['imdbSeason', 'ASC'],
      ['imdbEpisodeStart', 'ASC'],
      ['uploadDate', 'DESC'],
    ],
  });

  const groups = new Map<string, any[]>();
  for (const t of all) {
    const id = t.imdbId || '?';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(t);
  }

  console.log(`${all.length} torrents, ${groups.size} IMDBs\n`);

  for (const [id, ts] of groups) {
    const torrentTitles = ts.map(t => t.title).filter(Boolean);
    const primaryTitle = await getPrimaryTitle(id, torrentTitles);
    console.log(`🎬 ${id} (${ts.length}) - ${primaryTitle.substring(0, 70)}`);

    // Exibe informações do ImdbTitleCache
    try {
      const cacheEntries = await ImdbTitleCache.findAll({
        where: { imdbId: id },
        raw: true,
        order: [['season', 'ASC']],
      });

      for (const entry of cacheEntries as any[]) {
        const seasonLabel = entry.season ? ` [S${entry.season}]` : '';
        const pt = entry.titlesPt ? entry.titlesPt.split(',').map((s: string) => s.trim()).filter(Boolean).join(', ') : '';
        const en = entry.titlesEn ? entry.titlesEn.split(',').map((s: string) => s.trim()).filter(Boolean).join(', ') : '';
        const year = entry.year ? ` (${entry.year})` : '';
        console.log(`  🗂 Cache${seasonLabel}${year}: PT=[${pt}] EN=[${en}]`);
      }
    } catch {
      // ignora falhas na consulta de cache
    }

    for (const t of ts) {
      const ep = formatEpisodeRange(t);
      const idioma = t.idioma || '?';
      const seeders = t.seeders ?? '?';
      const size = formatSize(t.size);
      const provider = (t.provider || '?').substring(0, 12);
      const qualidade = t.qualidade || '?';
      const title = (t.title || '').substring(0, 55);
      const uploadDate = t.uploadDate ? new Date(t.uploadDate).toISOString().slice(0, 10) : '?';
      console.log(`  [${provider}] ${qualidade} ${ep} | ${idioma} | S:${seeders} | ${size} | ${uploadDate} | ${title}`);
    }
    console.log('');
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('Erro:', err);
  await sequelize.close();
  process.exit(1);
});