"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.File = exports.Torrent = void 0;
exports.getTorrent = getTorrent;
exports.getFiles = getFiles;
exports.getImdbIdMovieEntries = getImdbIdMovieEntries;
exports.getImdbIdSeriesEntries = getImdbIdSeriesEntries;
exports.createTorrent = createTorrent;
exports.createFile = createFile;
exports.syncDatabase = syncDatabase;
const sequelize_1 = require("sequelize");
const models_js_1 = require("../database/models.js");
Object.defineProperty(exports, "Torrent", { enumerable: true, get: function () { return models_js_1.Torrent; } });
Object.defineProperty(exports, "File", { enumerable: true, get: function () { return models_js_1.File; } });
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
        limit: 50,
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
    if (exactMatches.length > 0)
        return exactMatches;
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
async function createTorrent(torrentData) {
    return models_js_1.Torrent.create(torrentData);
}
async function createFile(fileData) {
    return models_js_1.File.create(fileData);
}
async function syncDatabase() {
    await models_js_1.Torrent.sync();
    await models_js_1.File.sync();
    console.log('Banco de dados sincronizado!');
}
