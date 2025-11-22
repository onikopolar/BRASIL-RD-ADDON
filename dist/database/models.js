import { Sequelize, DataTypes, Model } from 'sequelize';
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;
let sequelize = null;
if (DATABASE_URL) {
    sequelize = new Sequelize(DATABASE_URL, {
        logging: false,
        pool: { max: 30, min: 5, idle: 20 * 60 * 1000 }
    });
}
else if (process.env.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL não configurada em produção');
}
else {
    console.log('Aviso: DATABASE_URL não configurada - modo desenvolvimento');
}
class Torrent extends Model {
}
class File extends Model {
}
class Subtitle extends Model {
}
if (sequelize) {
    Torrent.init({
        infoHash: { type: DataTypes.STRING(64), primaryKey: true },
        provider: { type: DataTypes.STRING(32), allowNull: false },
        torrentId: { type: DataTypes.STRING(128) },
        title: { type: DataTypes.STRING(256), allowNull: false },
        size: { type: DataTypes.BIGINT },
        type: { type: DataTypes.STRING(16), allowNull: false },
        uploadDate: { type: DataTypes.DATE, allowNull: false },
        seeders: { type: DataTypes.SMALLINT },
        trackers: { type: DataTypes.STRING(4096) },
        languages: { type: DataTypes.STRING(4096) },
        resolution: { type: DataTypes.STRING(16) }
    }, { sequelize, modelName: 'torrent' });
    File.init({
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        infoHash: {
            type: DataTypes.STRING(64),
            allowNull: false,
            references: { model: Torrent, key: 'infoHash' },
            onDelete: 'CASCADE'
        },
        fileIndex: { type: DataTypes.INTEGER },
        title: { type: DataTypes.STRING(256), allowNull: false },
        size: { type: DataTypes.BIGINT },
        imdbId: { type: DataTypes.STRING(32) },
        imdbSeason: { type: DataTypes.INTEGER },
        imdbEpisode: { type: DataTypes.INTEGER },
        kitsuId: { type: DataTypes.INTEGER },
        kitsuEpisode: { type: DataTypes.INTEGER }
    }, { sequelize, modelName: 'file' });
    Subtitle.init({
        infoHash: {
            type: DataTypes.STRING(64),
            allowNull: false,
            references: { model: Torrent, key: 'infoHash' },
            onDelete: 'CASCADE'
        },
        fileIndex: { type: DataTypes.INTEGER, allowNull: false },
        fileId: {
            type: DataTypes.BIGINT,
            allowNull: true,
            references: { model: File, key: 'id' },
            onDelete: 'SET NULL'
        },
        title: { type: DataTypes.STRING(512), allowNull: false },
        size: { type: DataTypes.BIGINT, allowNull: false }
    }, { sequelize, modelName: 'subtitle', timestamps: false });
    Torrent.hasMany(File, { foreignKey: 'infoHash', constraints: false });
    File.belongsTo(Torrent, { foreignKey: 'infoHash', constraints: false });
    File.hasMany(Subtitle, { foreignKey: 'fileId', constraints: false });
    Subtitle.belongsTo(File, { foreignKey: 'fileId', constraints: false });
}
export { sequelize, Torrent, File, Subtitle };
