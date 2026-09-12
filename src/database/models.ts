import { Sequelize, DataTypes, Model } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL =
  process.env.DATABASE_URL ||
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

const sequelizeConfig: any = {
  logging: false,
  dialect: 'postgres',
  pool: {
    max: 5,
    min: 1,
    acquire: 30000,
    idle: 10000,
    evict: 10000
  }
};

// SSL só quando o banco é Railway externo, que exige conexão segura
if (DATABASE_URL?.includes('postgres')) {
  sequelizeConfig.dialectOptions = {
    ssl: isRailwayExternal ? { require: true, rejectUnauthorized: false } : false
  };
}

const sequelize = DATABASE_URL
  ? new Sequelize(DATABASE_URL, sequelizeConfig)
  : new Sequelize('sqlite::memory:', { logging: false });

if (process.env.NODE_ENV === 'production' && DATABASE_URL) {
  sequelize.authenticate()
    .then(() => console.log('Conexao com PostgreSQL estabelecida'))
    .catch(err => console.error('Erro na conexao Postgres:', err.message));
}

interface TorrentAttributes {
  infoHash: string;
  provider: string;
  title: string;
  size?: number;
  type: string;
  imdbId?: string;
  imdbIds?: string[];
  imdbSeason?: number;
  imdbSeasonEnd?: number;
  imdbEpisodeStart?: number;
  imdbEpisodeEnd?: number;
  seeders?: number;
  idioma?: string;
  qualidade?: string;
  magnet?: string;
  uploadDate: Date;
  lastSeen: Date;
  rescrapeAt?: Date | null;
}

// Representa um torrent já validado e indexado pelo IMDb
class Torrent extends Model<TorrentAttributes> implements TorrentAttributes {
  public infoHash!: string;
  public provider!: string;
  public title!: string;
  public size?: number;
  public type!: string;
  public imdbId?: string;
  public imdbIds?: string[];
  public imdbSeason?: number;
  public imdbSeasonEnd?: number;
  public imdbEpisodeStart?: number;
  public imdbEpisodeEnd?: number;
  public seeders?: number;
  public idioma?: string;
  public qualidade?: string;
  public magnet?: string;
  public uploadDate!: Date;
  public lastSeen!: Date;
  public rescrapeAt?: Date | null;
}

Torrent.init(
  {
    infoHash:   { type: DataTypes.STRING(64), primaryKey: true },
    provider:   { type: DataTypes.STRING(50) },
    title:      { type: DataTypes.TEXT },
    size:       { type: DataTypes.BIGINT },
    type:       { type: DataTypes.STRING(10) },
    imdbId:     { type: DataTypes.STRING(32) },
    imdbIds: { type: DataTypes.JSONB, allowNull: true, defaultValue: [] },
    // imdbSeason guarda o início do intervalo de temporadas
    imdbSeason: { type: DataTypes.INTEGER },
    // imdbSeasonEnd guarda o fim; quando é temporada única, recebe o mesmo valor de imdbSeason
    imdbSeasonEnd: { type: DataTypes.INTEGER },
    imdbEpisodeStart: { type: DataTypes.INTEGER },
    imdbEpisodeEnd:   { type: DataTypes.INTEGER },
    seeders:    { type: DataTypes.INTEGER },
    idioma:     { type: DataTypes.STRING(50) },
    qualidade:  { type: DataTypes.STRING(10) },
    magnet:     { type: DataTypes.TEXT },
    uploadDate: { type: DataTypes.DATE },
    lastSeen:   { type: DataTypes.DATE },
    rescrapeAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null }
  },
  {
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
      { fields: ['imdbId', 'type'] },
      { fields: ['imdbIds'], using: 'gin' }
    ]
  }
);

interface ImdbTitleCacheAttributes {
  id?: number;
  imdbId: string;
  season?: number | null;
  titlesPt: string[];
  titlesEn: string[];
  year?: number | null;
  episodeTitles?: any | null;
  updatedAt: Date;
}

// Cache de títulos do TMDB por imdbId + temporada, evita bater na API toda hora
class ImdbTitleCache extends Model<ImdbTitleCacheAttributes> implements ImdbTitleCacheAttributes {
  public id!: number;
  public imdbId!: string;
  public season?: number | null;
  public titlesPt!: string[];
  public titlesEn!: string[];
  public year?: number | null;
  public episodeTitles?: any | null;
  public updatedAt!: Date;
}

ImdbTitleCache.init(
  {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    imdbId: {
      type: DataTypes.STRING(32),
      allowNull: false
    },
    // season 0 representa filme, sem temporada
    season: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    titlesPt: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    titlesEn: {
      type: DataTypes.JSONB,
      allowNull: false,
      defaultValue: []
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    episodeTitles: {
      type: DataTypes.JSONB,
      allowNull: true
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
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
  }
);

export { sequelize, Torrent, ImdbTitleCache };