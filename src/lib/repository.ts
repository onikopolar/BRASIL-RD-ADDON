import { Op } from 'sequelize';
import { Torrent, File } from '../database/models.js';

export { Torrent, File };

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
    limit: 50,
    order: [[Torrent, 'seeders', 'DESC']]
  });
}

export async function getImdbIdSeriesEntries(imdbId: string, season: number, episode?: number) {
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

  if (exactMatches.length > 0) return exactMatches;

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

export async function createTorrent(torrentData: any) {
  return Torrent.create(torrentData);
}

export async function createFile(fileData: any) {
  return File.create(fileData);
}

export async function syncDatabase() {
  await Torrent.sync();
  await File.sync();
  console.log('Banco de dados sincronizado!');
}