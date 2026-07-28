import { Sequelize, DataTypes, Model, Optional } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Tenta multiplas fontes para a URL do banco
const DATABASE_URL = 
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_PUBLIC_URL;

if (!DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('URL do banco de dados nao configurada para producao');
}

// Log para debug (apenas em desenvolvimento)
if (process.env.NODE_ENV !== 'production') {
  console.log('Database URL detectada:', DATABASE_URL ? 'Configurada' : 'Nao configurada');
  if (DATABASE_URL) {
    const maskedUrl = DATABASE_URL.replace(/:[^:@]+@/, ':****@');
    console.log('Database URL (mascarada):', maskedUrl);
  }
}

// Detectar ambiente Railway
const isRailway = DATABASE_URL?.includes('railway.app') || DATABASE_URL?.includes('railway.internal');
const isRailwayInternal = DATABASE_URL?.includes('railway.internal');
const isRailwayExternal = DATABASE_URL?.includes('railway.app') && !isRailwayInternal;

// Configuracoes otimizadas
const sequelizeConfig: any = {
  logging: false,
  dialect: 'postgres',
  pool: { 
    max: 15,
    min: 2,
    acquire: 30000,
    idle: 10000,
    evict: 10000
  },
  retry: {
    max: 3,
    timeout: 10000
  }
};

// Configuracoes especificas para PostgreSQL
if (DATABASE_URL?.includes('postgres')) {
  sequelizeConfig.dialect = 'postgres';
  
  // Configurar SSL baseado no ambiente
  sequelizeConfig.dialectOptions = {
    ssl: isRailwayExternal ? {
      require: true,
      rejectUnauthorized: false
    } : false
  };

  // Para Railway interno, adicionar configuracoes de performance
  if (isRailwayInternal) {
    sequelizeConfig.dialectOptions = {
      ...sequelizeConfig.dialectOptions,
      connectTimeout: 10000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000
    };
  }
}

// Criar instancia do Sequelize
const sequelize = DATABASE_URL
  ? new Sequelize(DATABASE_URL, sequelizeConfig)
  : new Sequelize('sqlite::memory:', {
      logging: false,
      pool: { max: 30, min: 5, idle: 20 * 60 * 1000 }
    });

// Verificar conexao (apenas em producao/inicializacao)
if (process.env.NODE_ENV === 'production' && DATABASE_URL) {
  sequelize.authenticate()
    .then(() => console.log('Conexao com PostgreSQL estabelecida'))
    .catch(err => console.error('Erro na conexao PostgreSQL:', err.message));
}

// Interface para Torrent
interface TorrentAttributes {
  infoHash: string;
  provider: string;
  title: string;
  size?: number;
  type: string;
  uploadDate: Date;
  seeders?: number;
  idioma?: string;
  qualidade?: string;
}

class Torrent extends Model<TorrentAttributes> implements TorrentAttributes {
  public infoHash!: string;
  public provider!: string;
  public title!: string;
  public size?: number;
  public type!: string;
  public uploadDate!: Date;
  public seeders?: number;
  public idioma?: string;
  public qualidade?: string;
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
  imdbEpisode?: number | null;
}

class File extends Model<FileAttributes> implements FileAttributes {
  public id?: number;
  public infoHash!: string;
  public fileIndex?: number;
  public title!: string;
  public size?: number;
  public imdbId?: string;
  public imdbSeason?: number;
  public imdbEpisode?: number | null;
}

// Definindo os modelos
Torrent.init(
  {
    infoHash: { type: DataTypes.STRING(64), primaryKey: true },
    provider: { type: DataTypes.STRING(100) },
    title: { type: DataTypes.TEXT },
    size: { type: DataTypes.BIGINT },
    type: { type: DataTypes.STRING(20) },
    uploadDate: { type: DataTypes.DATE },
    seeders: { type: DataTypes.INTEGER },
    idioma: { type: DataTypes.STRING(50) },
    qualidade: { type: DataTypes.STRING(20) }
  },
  {
    sequelize,
    modelName: 'Torrent',
    tableName: 'torrents',
    timestamps: false,
    indexes: [
      { fields: ['seeders'] },
      { fields: ['type'] },
      { fields: ['idioma'] }
    ]
  }
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
    imdbEpisode: { type: DataTypes.INTEGER, allowNull: true }
  },
  {
    sequelize,
    modelName: 'File',
    tableName: 'files',
    timestamps: false,
    indexes: [
      { fields: ['infoHash'] },
      { fields: ['imdbId', 'imdbSeason', 'imdbEpisode'] }
    ]
  }
);

// Definindo relacoes
Torrent.hasMany(File, { foreignKey: 'infoHash', constraints: false });
File.belongsTo(Torrent, { foreignKey: 'infoHash', constraints: false });

export { sequelize, Torrent, File };