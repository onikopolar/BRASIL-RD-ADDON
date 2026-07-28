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
  },
  retry: { max: 3, timeout: 10000 }
};

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
    .catch(err => console.error('Erro na conexao PostgreSQL:', err.message));
}

// ═══════════════════════════════════════
// MODELO: Torrent
// ═══════════════════════════════════════

interface TorrentAttributes {
  infoHash: string;
  provider: string;
  title: string;
  size?: number;
  type: string;
  imdbId?: string;
  imdbSeason?: number;
  seeders?: number;
  idioma?: string;
  qualidade?: string;
  uploadDate: Date;
  lastSeen: Date;
}

class Torrent extends Model<TorrentAttributes> implements TorrentAttributes {
  public infoHash!: string;
  public provider!: string;
  public title!: string;
  public size?: number;
  public type!: string;
  public imdbId?: string;
  public imdbSeason?: number;
  public seeders?: number;
  public idioma?: string;
  public qualidade?: string;
  public uploadDate!: Date;
  public lastSeen!: Date;
}

Torrent.init(
  {
    infoHash:   { type: DataTypes.STRING(64), primaryKey: true },
    provider:   { type: DataTypes.STRING(50) },
    title:      { type: DataTypes.TEXT },
    size:       { type: DataTypes.BIGINT },
    type:       { type: DataTypes.STRING(10) },
    imdbId:     { type: DataTypes.STRING(32) },
    imdbSeason: { type: DataTypes.INTEGER },
    seeders:    { type: DataTypes.INTEGER },
    idioma:     { type: DataTypes.STRING(50) },
    qualidade:  { type: DataTypes.STRING(10) },
    uploadDate: { type: DataTypes.DATE },
    lastSeen:   { type: DataTypes.DATE }
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
      { fields: ['imdbId', 'type'] }
    ]
  }
);

export { sequelize, Torrent };