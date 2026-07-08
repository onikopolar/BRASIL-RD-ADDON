import { Op } from 'sequelize';
import { Torrent, File, Subtitle } from '../database/models';

export { Torrent, File, Subtitle };

export function getTorrent(infoHash: string) {
  return Torrent.findOne({ where: { infoHash } });
}

export function getFiles(infoHashes: string[]) {
  return File.findAll({ where: { infoHash: { [Op.in]: infoHashes } } });
}

export function getImdbIdMovieEntries(imdbId: string) {
  return File.findAll({
    where: { imdbId: { [Op.eq]: imdbId } },
    include: [Torrent],
    limit: 500,
    order: [[Torrent, 'seeders', 'DESC']]
  });
}

// NOVA LÓGICA: busca episódio exato e, se não encontrar, busca packs (episode = null)
export async function getImdbIdSeriesEntries(imdbId: string, season: number, episode?: number) {
  // Se episódio não informado, busca todos os arquivos da temporada (inclui packs)
  if (episode === undefined) {
    return File.findAll({
      where: {
        imdbId: { [Op.eq]: imdbId },
        imdbSeason: { [Op.eq]: season }
      },
      include: [Torrent],
      limit: 500,
      order: [[Torrent, 'seeders', 'DESC']]
    });
  }

  // Busca episódio exato
  const exactMatches = await File.findAll({
    where: {
      imdbId: { [Op.eq]: imdbId },
      imdbSeason: { [Op.eq]: season },
      imdbEpisode: { [Op.eq]: episode }
    },
    include: [Torrent],
    limit: 500,
    order: [[Torrent, 'seeders', 'DESC']]
  });

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  // Fallback: busca packs da temporada (episode = null)
  const packMatches = await File.findAll({
    where: {
      imdbId: { [Op.eq]: imdbId },
      imdbSeason: { [Op.eq]: season },
      imdbEpisode: { [Op.eq]: null }
    },
    include: [Torrent],
    limit: 500,
    order: [[Torrent, 'seeders', 'DESC']]
  });

  return packMatches;
}

export function getKitsuIdMovieEntries(kitsuId: number) {
  return File.findAll({
    where: { kitsuId: { [Op.eq]: kitsuId } },
    include: [Torrent],
    limit: 500,
    order: [[Torrent, 'seeders', 'DESC']]
  });
}

export function getKitsuIdSeriesEntries(kitsuId: number, episode: number) {
  return File.findAll({
    where: {
      kitsuId: { [Op.eq]: kitsuId },
      kitsuEpisode: { [Op.eq]: episode }
    },
    include: [Torrent],
    limit: 500,
    order: [[Torrent, 'seeders', 'DESC']]
  });
}

export async function createTorrent(torrentData: any) {
  return Torrent.create(torrentData);
}

export async function createFile(fileData: any) {
  return File.create(fileData);
}

export async function createSubtitle(subtitleData: any) {
  return Subtitle.create(subtitleData);
}

export async function syncDatabase() {
  await Torrent.sync();
  await File.sync();
  await Subtitle.sync();
  console.log('Banco de dados sincronizado!');
}