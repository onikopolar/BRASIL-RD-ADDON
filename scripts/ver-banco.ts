import 'dotenv/config';
import { sequelize, Torrent, ImdbTitleCache } from '../src/database/models.js';

// ═══════════════════════════════════════════════════════════════════
//  HELPERS DE FORMATAÇÃO
// ═══════════════════════════════════════════════════════════════════

function formatSize(size?: number): string {
  if (!size) return '?';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatEpisodeRange(t: any): string {
  const season = t.imdbSeason ? `S${t.imdbSeason}` : '';
  if (!t.imdbEpisodeStart) return season || '—';
  if (!t.imdbEpisodeEnd || t.imdbEpisodeEnd === t.imdbEpisodeStart) {
    return `${season}E${t.imdbEpisodeStart}`;
  }
  return `${season}E${t.imdbEpisodeStart}-E${t.imdbEpisodeEnd}`;
}

function formatDate(date?: Date): string {
  return date ? new Date(date).toISOString().slice(0, 10) : '—';
}

function pad(text: string, width: number): string {
  return text.length > width ? text.substring(0, width - 1) + '…' : text.padEnd(width);
}

function line(char = '─', length = 80): string {
  return char.repeat(length);
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
      const pt = Array.isArray(first.titlesPt) ? first.titlesPt.find(Boolean) : undefined;
      const en = Array.isArray(first.titlesEn) ? first.titlesEn.find(Boolean) : undefined;
      return pt || en || torrentTitles[0] || 'Título desconhecido';
    }
  } catch {
    // fallback silencioso
  }
  return torrentTitles[0] || 'Título desconhecido';
}

// ═══════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════

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

  // Agrupa por imdbId
  const groups = new Map<string, any[]>();
  for (const t of all) {
    const id = t.imdbId || '?';
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(t);
  }

  console.log(line('═'));
  console.log(`📊 TOTAL: ${all.length} torrents | ${groups.size} IMDBs`);
  console.log(line('═'));

  for (const [id, ts] of groups) {
    const torrentTitles = ts.map(t => t.title).filter(Boolean);
    const primaryTitle = await getPrimaryTitle(id, torrentTitles);

    console.log('');
    console.log(line('─'));
    console.log(`🎬 ${id}  (${ts.length} torrents)`);
    console.log(`   Título: ${primaryTitle.substring(0, 70)}`);
    console.log(line('─'));

    // Exibe cache do TMDB para esse imdbId
    try {
      const cacheEntries = await ImdbTitleCache.findAll({
        where: { imdbId: id },
        raw: true,
        order: [['season', 'ASC']],
      });

      for (const entry of cacheEntries as any[]) {
        const seasonLabel = entry.season > 0 ? `S${entry.season}` : 'Filme';
        const pt = Array.isArray(entry.titlesPt) ? entry.titlesPt.filter(Boolean).join(', ') : '';
        const en = Array.isArray(entry.titlesEn) ? entry.titlesEn.filter(Boolean).join(', ') : '';
        const year = entry.year ? ` (${entry.year})` : '';
        console.log(`   🗂️  Cache ${seasonLabel}${year}: PT=[${pt}] EN=[${en}]`);
      }
    } catch {
      // silencioso
    }

    // Cabeçalho da tabela de torrents
    console.log('');
    console.log('   ' + pad('Provider', 14) + pad('Qual.', 8) + pad('Episódio', 12) + pad('Idioma', 12) + pad('Seeds', 6) + pad('Tamanho', 10) + pad('Data', 12) + 'Título');
    console.log('   ' + line('─', 74));

    // Lista os torrents do grupo
    for (const t of ts) {
      const provider = pad(t.provider || '?', 14);
      const qualidade = pad(t.qualidade || '?', 8);
      const ep = pad(formatEpisodeRange(t), 12);
      const idioma = pad(t.idioma || '?', 12);
      const seeds = pad(String(t.seeders ?? '?'), 6);
      const size = pad(formatSize(t.size), 10);
      const date = pad(formatDate(t.uploadDate), 12);
      const title = (t.title || '').substring(0, 55);
      console.log(`   ${provider}${qualidade}${ep}${idioma}${seeds}${size}${date}${title}`);
    }

    console.log(line('─'));
  }

  await sequelize.close();
}

main().catch(async (err) => {
  console.error('Erro:', err);
  await sequelize.close();
  process.exit(1);
});