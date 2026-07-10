"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Subtitle = exports.File = exports.Torrent = void 0;
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
const models_js_1 = require("../database/models.js");
Object.defineProperty(exports, "Torrent", { enumerable: true, get: function () { return models_js_1.Torrent; } });
Object.defineProperty(exports, "File", { enumerable: true, get: function () { return models_js_1.File; } });
Object.defineProperty(exports, "Subtitle", { enumerable: true, get: function () { return models_js_1.Subtitle; } });
function getTorrent(infoHash) {
    return models_js_1.Torrent.findOne({ where: { infoHash } });
}
function getFiles(infoHashes) {
    return models_js_1.File.findAll({ where: { infoHash: { [sequelize_1.Op.in]: infoHashes } } });
}
function getImdbIdMovieEntries(imdbId) {
    return models_js_1.File.findAll({
        where: { imdbId: { [sequelize_1.Op.eq]: imdbId } },
        include: [models_js_1.Torrent],
        limit: 500,
        order: [[models_js_1.Torrent, 'seeders', 'DESC']]
    });
}
async function getImdbIdSeriesEntries(imdbId, season, episode) {
    if (episode === undefined) {
        return models_js_1.File.findAll({
            where: {
                imdbId: { [sequelize_1.Op.eq]: imdbId },
                imdbSeason: { [sequelize_1.Op.eq]: season }
            },
            include: [models_js_1.Torrent],
            limit: 500,
            order: [[models_js_1.Torrent, 'seeders', 'DESC']]
        });
    }
    const exactMatches = await models_js_1.File.findAll({
        where: {
            imdbId: { [sequelize_1.Op.eq]: imdbId },
            imdbSeason: { [sequelize_1.Op.eq]: season },
            imdbEpisode: { [sequelize_1.Op.eq]: episode }
        },
        include: [models_js_1.Torrent],
        limit: 500,
        order: [[models_js_1.Torrent, 'seeders', 'DESC']]
    });
    if (exactMatches.length > 0) {
        return exactMatches;
    }
    const packMatches = await models_js_1.File.findAll({
        where: {
            imdbId: { [sequelize_1.Op.eq]: imdbId },
            imdbSeason: { [sequelize_1.Op.eq]: season },
            imdbEpisode: { [sequelize_1.Op.eq]: null }
        },
        include: [models_js_1.Torrent],
        limit: 500,
        order: [[models_js_1.Torrent, 'seeders', 'DESC']]
    });
    return packMatches;
}
function getKitsuIdMovieEntries(kitsuId) {
    return models_js_1.File.findAll({
        where: { kitsuId: { [sequelize_1.Op.eq]: kitsuId } },
        include: [models_js_1.Torrent],
        limit: 500,
        order: [[models_js_1.Torrent, 'seeders', 'DESC']]
    });
}
function getKitsuIdSeriesEntries(kitsuId, episode) {
    return models_js_1.File.findAll({
        where: {
            kitsuId: { [sequelize_1.Op.eq]: kitsuId },
            kitsuEpisode: { [sequelize_1.Op.eq]: episode }
        },
        include: [models_js_1.Torrent],
        limit: 500,
        order: [[models_js_1.Torrent, 'seeders', 'DESC']]
    });
}
async function createTorrent(torrentData) {
    return models_js_1.Torrent.create(torrentData);
}
async function createFile(fileData) {
    return models_js_1.File.create(fileData);
}
async function createSubtitle(subtitleData) {
    return models_js_1.Subtitle.create(subtitleData);
}
async function syncDatabase() {
    await models_js_1.Torrent.sync();
    await models_js_1.File.sync();
    await models_js_1.Subtitle.sync();
    console.log('Banco de dados sincronizado!');
}
