"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Subtitle = exports.File = exports.Torrent = exports.sequelize = void 0;
const sequelize_1 = require("sequelize");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!DATABASE_URL && process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL não configurada para produção');
}
const sequelize = DATABASE_URL
    ? new sequelize_1.Sequelize(DATABASE_URL, {
        logging: false,
        pool: { max: 30, min: 5, idle: 20 * 60 * 1000 }
    })
    : new sequelize_1.Sequelize('sqlite::memory:', {
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
    provider: { type: sequelize_1.DataTypes.STRING(100) },
    torrentId: { type: sequelize_1.DataTypes.STRING(100) },
    magnetLink: { type: sequelize_1.DataTypes.TEXT },
    title: { type: sequelize_1.DataTypes.TEXT },
    size: { type: sequelize_1.DataTypes.BIGINT },
    type: { type: sequelize_1.DataTypes.STRING(20) },
    uploadDate: { type: sequelize_1.DataTypes.DATE },
    seeders: { type: sequelize_1.DataTypes.INTEGER },
    trackers: { type: sequelize_1.DataTypes.TEXT },
    languages: { type: sequelize_1.DataTypes.STRING(100) },
    resolution: { type: sequelize_1.DataTypes.STRING(20) }
}, {
    sequelize,
    modelName: 'Torrent',
    tableName: 'torrents',
    timestamps: false
});
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
