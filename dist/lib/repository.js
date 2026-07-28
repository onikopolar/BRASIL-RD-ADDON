"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Torrent = void 0;
exports.getTorrent = getTorrent;
exports.createTorrent = createTorrent;
exports.upsertTorrent = upsertTorrent;
exports.syncDatabase = syncDatabase;
const models_js_1 = require("../database/models.js");
Object.defineProperty(exports, "Torrent", { enumerable: true, get: function () { return models_js_1.Torrent; } });
function getTorrent(infoHash) {
    return models_js_1.Torrent.findOne({ where: { infoHash } });
}
async function createTorrent(torrentData) {
    return models_js_1.Torrent.create(torrentData);
}
async function upsertTorrent(infoHash, data) {
    const [torrent] = await models_js_1.Torrent.upsert({ infoHash, ...data });
    return torrent;
}
async function syncDatabase() {
    await models_js_1.Torrent.sync();
    console.log('Banco de dados sincronizado!');
}
