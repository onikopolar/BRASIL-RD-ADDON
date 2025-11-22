import { Sequelize, DataTypes, Model, Optional } from 'sequelize';

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL não configurada');
}

const sequelize = new Sequelize(DATABASE_URL, { 
  logging: false, 
  pool: { max: 30, min: 5, idle: 20 * 60 * 1000 } 
});

// Interface para Torrent
interface TorrentAttributes {
  infoHash: string;
  provider: string;
  torrentId?: string;
  title: string;
  size?: number;
  type: string;
  uploadDate: Date;
  seeders?: number;
  trackers?: string;
  languages?: string;
  resolution?: string;
}

class Torrent extends Model<TorrentAttributes> implements TorrentAttributes {
  public infoHash!: string;
  public provider!: string;
  public torrentId?: string;
  public title!: string;
  public size?: number;
  public type!: string;
  public uploadDate!: Date;
  public seeders?: number;
  public trackers?: string;
  public languages?: string;
  public resolution?: string;
}

// Interface para File
interface FileAttributes {
  id?: number;
  infoHash: string;
  fileIndex?: number;
  title: string;
  size?: number;
  imdbId?: string;
  imdbSeason?: number;
  imdbEpisode?: number;
  kitsuId?: number;
  kitsuEpisode?: number;
}

class File extends Model<FileAttributes> implements FileAttributes {
  public id?: number;
  public infoHash!: string;
  public fileIndex?: number;
  public title!: string;
  public size?: number;
  public imdbId?: string;
  public imdbSeason?: number;
  public imdbEpisode?: number;
  public kitsuId?: number;
  public kitsuEpisode?: number;
}

// Interface para Subtitle
interface SubtitleAttributes {
  infoHash: string;
  fileIndex: number;
  fileId?: number;
  title: string;
  size: number;
}

class Subtitle extends Model<SubtitleAttributes> implements SubtitleAttributes {
  public infoHash!: string;
  public fileIndex!: number;
  public fileId?: number;
  public title!: string;
  public size!: number;
}

// Definindo os modelos
Torrent.init(
  {
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
  },
  { sequelize, modelName: 'torrent' }
);

File.init(
  {
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
  },
  { sequelize, modelName: 'file' }
);

Subtitle.init(
  {
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
  },
  { sequelize, modelName: 'subtitle', timestamps: false }
);

// Definindo relações
Torrent.hasMany(File, { foreignKey: 'infoHash', constraints: false });
File.belongsTo(Torrent, { foreignKey: 'infoHash', constraints: false });
File.hasMany(Subtitle, { foreignKey: 'fileId', constraints: false });
Subtitle.belongsTo(File, { foreignKey: 'fileId', constraints: false });

export { sequelize, Torrent, File, Subtitle };
