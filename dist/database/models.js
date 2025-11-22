"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Subtitle = exports.File = exports.Torrent = exports.sequelize = void 0;
const sequelize_1 = require("sequelize");
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL) {
    throw new Error('DATABASE_URL não configurada');
}
const sequelize = new sequelize_1.Sequelize(DATABASE_URL, {
    logging: false,
    pool: { max: 30, min: 5, idle: 20 * 60 * 1000 }
});
exports.sequelize = sequelize;
class Torrent extends sequelize_1.Model {
}
exports.Torrent = Torrent;
class File extends sequelize_1.Model {
}
exports.File = File;
class Subtitle extends sequelize_1.Model {
}
exports.Subtitle = Subtitle;
Torrent.init({
    infoHash: { type: sequelize_1.DataTypes.STRING(64), primaryKey: true },
    provider: { type: sequelize_1.DataTypes.STRING(32), allowNull: false },
    torrentId: { type: sequelize_1.DataTypes.STRING(128) },
    title: { type: sequelize_1.DataTypes.STRING(256), allowNull: false },
    size: { type: sequelize_1.DataTypes.BIGINT },
    type: { type: sequelize_1.DataTypes.STRING(16), allowNull: false },
    uploadDate: { type: sequelize_1.DataTypes.DATE, allowNull: false },
    seeders: { type: sequelize_1.DataTypes.SMALLINT },
    trackers: { type: sequelize_1.DataTypes.STRING(4096) },
    languages: { type: sequelize_1.DataTypes.STRING(4096) },
    resolution: { type: sequelize_1.DataTypes.STRING(16) }
}, { sequelize, modelName: 'torrent' });
File.init({
    id: { type: sequelize_1.DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    infoHash: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: false,
        references: { model: Torrent, key: 'infoHash' },
        onDelete: 'CASCADE'
    },
    fileIndex: { type: sequelize_1.DataTypes.INTEGER },
    title: { type: sequelize_1.DataTypes.STRING(256), allowNull: false },
    size: { type: sequelize_1.DataTypes.BIGINT },
    imdbId: { type: sequelize_1.DataTypes.STRING(32) },
    imdbSeason: { type: sequelize_1.DataTypes.INTEGER },
    imdbEpisode: { type: sequelize_1.DataTypes.INTEGER },
    kitsuId: { type: sequelize_1.DataTypes.INTEGER },
    kitsuEpisode: { type: sequelize_1.DataTypes.INTEGER }
}, { sequelize, modelName: 'file' });
Subtitle.init({
    infoHash: {
        type: sequelize_1.DataTypes.STRING(64),
        allowNull: false,
        references: { model: Torrent, key: 'infoHash' },
        onDelete: 'CASCADE'
    },
    fileIndex: { type: sequelize_1.DataTypes.INTEGER, allowNull: false },
    fileId: {
        type: sequelize_1.DataTypes.BIGINT,
        allowNull: true,
        references: { model: File, key: 'id' },
        onDelete: 'SET NULL'
    },
    title: { type: sequelize_1.DataTypes.STRING(512), allowNull: false },
    size: { type: sequelize_1.DataTypes.BIGINT, allowNull: false }
}, { sequelize, modelName: 'subtitle', timestamps: false });
Torrent.hasMany(File, { foreignKey: 'infoHash', constraints: false });
File.belongsTo(Torrent, { foreignKey: 'infoHash', constraints: false });
File.hasMany(Subtitle, { foreignKey: 'fileId', constraints: false });
Subtitle.belongsTo(File, { foreignKey: 'fileId', constraints: false });
