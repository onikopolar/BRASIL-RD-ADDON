"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTorrent = getTorrent;
exports.getFiles = getFiles;
exports.getImdbIdMovieEntries = getImdbIdMovieEntries;
exports.getImdbIdSeriesEntries = getImdbIdSeriesEntries;
exports.getKitsuIdMovieEntries = getKitsuIdMovieEntries;
exports.getKitsuIdSeriesEntries = getKitsuIdSeriesEntries;
exports.createTorrent = createTorrent;
exports.createFile = createFile;
exports.createSubtitle = createSubtitle;
exports.syncDatabase = syncDatabase;
const sequelize_1 = require("sequelize");
const models_1 = require("./models");
function getTorrent(infoHash) {
    return models_1.Torrent.findOne({ where: { infoHash } });
}
function getFiles(infoHashes) {
    return models_1.File.findAll({ where: { infoHash: { [sequelize_1.Op.in]: infoHashes } } });
}
function getImdbIdMovieEntries(imdbId) {
    return models_1.File.findAll({
        where: {
            imdbId: { [sequelize_1.Op.eq]: imdbId }
        },
        include: [models_1.Torrent],
        limit: 500,
        order: [
            [models_1.Torrent, 'seeders', 'DESC']
        ]
    });
}
function getImdbIdSeriesEntries(imdbId, season, episode) {
    return models_1.File.findAll({
        where: {
            imdbId: { [sequelize_1.Op.eq]: imdbId },
            imdbSeason: { [sequelize_1.Op.eq]: season },
            imdbEpisode: { [sequelize_1.Op.eq]: episode }
        },
        include: [models_1.Torrent],
        limit: 500,
        order: [
            [models_1.Torrent, 'seeders', 'DESC']
        ]
    });
}
function getKitsuIdMovieEntries(kitsuId) {
    return models_1.File.findAll({
        where: {
            kitsuId: { [sequelize_1.Op.eq]: kitsuId }
        },
        include: [models_1.Torrent],
        limit: 500,
        order: [
            [models_1.Torrent, 'seeders', 'DESC']
        ]
    });
}
function getKitsuIdSeriesEntries(kitsuId, episode) {
    return models_1.File.findAll({
        where: {
            kitsuId: { [sequelize_1.Op.eq]: kitsuId },
            kitsuEpisode: { [sequelize_1.Op.eq]: episode }
        },
        include: [models_1.Torrent],
        limit: 500,
        order: [
            [models_1.Torrent, 'seeders', 'DESC']
        ]
    });
}
async function createTorrent(torrentData) {
    return models_1.Torrent.create(torrentData);
}
async function createFile(fileData) {
    return models_1.File.create(fileData);
}
async function createSubtitle(subtitleData) {
    return models_1.Subtitle.create(subtitleData);
}
async function syncDatabase() {
    await models_1.Torrent.sync();
    await models_1.File.sync();
    await models_1.Subtitle.sync();
    console.log('Banco de dados sincronizado!');
}
