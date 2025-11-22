import { Op } from 'sequelize';
import { Torrent, File, Subtitle } from './models';
export function getTorrent(infoHash) {
    return Torrent.findOne({ where: { infoHash } });
}
export function getFiles(infoHashes) {
    return File.findAll({ where: { infoHash: { [Op.in]: infoHashes } } });
}
export function getImdbIdMovieEntries(imdbId) {
    return File.findAll({
        where: {
            imdbId: { [Op.eq]: imdbId }
        },
        include: [Torrent],
        limit: 500,
        order: [
            [Torrent, 'seeders', 'DESC']
        ]
    });
}
export function getImdbIdSeriesEntries(imdbId, season, episode) {
    return File.findAll({
        where: {
            imdbId: { [Op.eq]: imdbId },
            imdbSeason: { [Op.eq]: season },
            imdbEpisode: { [Op.eq]: episode }
        },
        include: [Torrent],
        limit: 500,
        order: [
            [Torrent, 'seeders', 'DESC']
        ]
    });
}
export function getKitsuIdMovieEntries(kitsuId) {
    return File.findAll({
        where: {
            kitsuId: { [Op.eq]: kitsuId }
        },
        include: [Torrent],
        limit: 500,
        order: [
            [Torrent, 'seeders', 'DESC']
        ]
    });
}
export function getKitsuIdSeriesEntries(kitsuId, episode) {
    return File.findAll({
        where: {
            kitsuId: { [Op.eq]: kitsuId },
            kitsuEpisode: { [Op.eq]: episode }
        },
        include: [Torrent],
        limit: 500,
        order: [
            [Torrent, 'seeders', 'DESC']
        ]
    });
}
export async function createTorrent(torrentData) {
    return Torrent.create(torrentData);
}
export async function createFile(fileData) {
    return File.create(fileData);
}
export async function createSubtitle(subtitleData) {
    return Subtitle.create(subtitleData);
}
export async function syncDatabase() {
    await Torrent.sync();
    await File.sync();
    await Subtitle.sync();
    console.log('Banco de dados sincronizado!');
}
