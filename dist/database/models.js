"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImdbTitleCache = exports.Torrent = exports.sequelize = void 0;
const sequelize_1 = require("sequelize");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const DATABASE_URL = process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_PUBLIC_URL;
if (!DATABASE_URL && process.env.NODE_ENV === 'production') {
    throw new Error('URL do banco de dados nao configurada para producao');
}
if (process.env.NODE_ENV !== 'production') {
    console.log('Database URL detectada:', DATABASE_URL ? 'Configurada' : 'Nao configurada');
    if (DATABASE_URL) {
        console.log('Database URL (mascarada):', DATABASE_URL.replace(/:[^:@]+@/, ':****@'));
    }
}
const isRailway = DATABASE_URL?.includes('railway.app') || DATABASE_URL?.includes('railway.internal');
const isRailwayExternal = DATABASE_URL?.includes('railway.app') && !DATABASE_URL?.includes('railway.internal');
const sequelizeConfig = {
    logging: false,
    dialect: 'postgres',
    pool: {
        max: 5,
        min: 1,
        acquire: 30000,
        idle: 10000,
        evict: 10000
    },
    retry: { max: 3, timeout: 10000 }
};
if (DATABASE_URL?.includes('postgres')) {
    sequelizeConfig.dialectOptions = {
        ssl: isRailwayExternal ? { require: true, rejectUnauthorized: false } : false
    };
}
const sequelize = DATABASE_URL
    ? new sequelize_1.Sequelize(DATABASE_URL, sequelizeConfig)
    : new sequelize_1.Sequelize('sqlite::memory:', { logging: false });
exports.sequelize = sequelize;
if (process.env.NODE_ENV === 'production' && DATABASE_URL) {
    sequelize.authenticate()
        .then(() => console.log('Conexao com PostgreSQL estabelecida'))
        .catch(err => console.error('Erro na conexao PostgreSQL:', err.message));
}
class Torrent extends sequelize_1.Model {
}
exports.Torrent = Torrent;
Torrent.init({
    infoHash: { type: sequelize_1.DataTypes.STRING(64), primaryKey: true },
    provider: { type: sequelize_1.DataTypes.STRING(50) },
    title: { type: sequelize_1.DataTypes.TEXT },
    size: { type: sequelize_1.DataTypes.BIGINT },
    type: { type: sequelize_1.DataTypes.STRING(10) },
    imdbId: { type: sequelize_1.DataTypes.STRING(32) },
    imdbSeason: { type: sequelize_1.DataTypes.INTEGER },
    imdbEpisodeStart: { type: sequelize_1.DataTypes.INTEGER },
    imdbEpisodeEnd: { type: sequelize_1.DataTypes.INTEGER },
    seeders: { type: sequelize_1.DataTypes.INTEGER },
    idioma: { type: sequelize_1.DataTypes.STRING(50) },
    qualidade: { type: sequelize_1.DataTypes.STRING(10) },
    magnet: { type: sequelize_1.DataTypes.TEXT },
    uploadDate: { type: sequelize_1.DataTypes.DATE },
    lastSeen: { type: sequelize_1.DataTypes.DATE },
    rescrapeAt: { type: sequelize_1.DataTypes.DATE, allowNull: true, defaultValue: null }
}, {
    sequelize,
    modelName: 'Torrent',
    tableName: 'torrents',
    timestamps: false,
    indexes: [
        { fields: ['seeders'] },
        { fields: ['type'] },
        { fields: ['idioma'] },
        { fields: ['provider'] },
        { fields: ['uploadDate'] },
        { fields: ['imdbId', 'type'] }
    ]
});
class ImdbTitleCache extends sequelize_1.Model {
}
exports.ImdbTitleCache = ImdbTitleCache;
ImdbTitleCache.init({
    id: {
        type: sequelize_1.DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    imdbId: {
        type: sequelize_1.DataTypes.STRING(32),
        allowNull: false
    },
    season: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: true
    },
    titlesPt: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: false
    },
    titlesEn: {
        type: sequelize_1.DataTypes.TEXT,
        allowNull: false
    },
    year: {
        type: sequelize_1.DataTypes.INTEGER,
        allowNull: true
    },
    updatedAt: {
        type: sequelize_1.DataTypes.DATE,
        allowNull: false,
        defaultValue: sequelize_1.DataTypes.NOW
    }
}, {
    sequelize,
    modelName: 'ImdbTitleCache',
    tableName: 'imdb_title_cache',
    timestamps: false,
    indexes: [
        {
            unique: true,
            fields: ['imdbId', 'season']
        },
        {
            fields: ['updatedAt']
        }
    ]
});
