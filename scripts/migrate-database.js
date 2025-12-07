const { Sequelize, QueryTypes } = require('sequelize');
require('dotenv').config();

// Configuração igual ao models.ts
const DATABASE_URL = 
  process.env.DATABASE_URL || 
  process.env.POSTGRES_URL ||
  process.env.RAILWAY_POSTGRES_URL;

if (!DATABASE_URL && process.env.NODE_ENV === 'production') {
  throw new Error('URL do banco de dados não configurada para produção');
}

// Detectar ambiente Railway
const isRailway = DATABASE_URL?.includes('railway.app') || DATABASE_URL?.includes('railway.internal');
const isRailwayInternal = DATABASE_URL?.includes('railway.internal');
const isRailwayExternal = DATABASE_URL?.includes('railway.app') && !isRailwayInternal;

// Configurações otimizadas
const sequelizeConfig = {
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

// Configurações específicas para PostgreSQL
if (DATABASE_URL?.includes('postgres')) {
  sequelizeConfig.dialect = 'postgres';
  
  // Configurar SSL baseado no ambiente
  sequelizeConfig.dialectOptions = {
    ssl: isRailwayExternal ? {
      require: true,
      rejectUnauthorized: false
    } : false
  };

  // Para Railway interno, adicionar configurações de performance
  if (isRailwayInternal) {
    sequelizeConfig.dialectOptions = {
      ...sequelizeConfig.dialectOptions,
      connectTimeout: 10000,
      statement_timeout: 30000,
      idle_in_transaction_session_timeout: 30000
    };
  }
}

// Criar instância do Sequelize
const sequelize = new Sequelize(DATABASE_URL, sequelizeConfig);

async function createTables() {
  try {
    // Testar conexão
    await sequelize.authenticate();
    console.log('Conexão com PostgreSQL estabelecida');

    // Criar tabela torrents (exatamente como no models.ts)
    console.log('Criando tabela torrents...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS torrents (
        "infoHash" VARCHAR(64) PRIMARY KEY,
        "provider" VARCHAR(100),
        "torrentId" VARCHAR(100),
        "magnetLink" TEXT,
        "title" TEXT NOT NULL,
        "size" BIGINT,
        "type" VARCHAR(20),
        "uploadDate" TIMESTAMP,
        "seeders" INTEGER,
        "trackers" TEXT,
        "languages" VARCHAR(100),
        "resolution" VARCHAR(20)
      );
    `, { type: QueryTypes.RAW });

    // Criar tabela files (exatamente como no models.ts)
    console.log('Criando tabela files...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS files (
        "id" BIGSERIAL PRIMARY KEY,
        "infoHash" VARCHAR(64) NOT NULL,
        "fileIndex" INTEGER,
        "title" VARCHAR(256) NOT NULL,
        "size" BIGINT,
        "imdbId" VARCHAR(32),
        "imdbSeason" INTEGER,
        "imdbEpisode" INTEGER,
        "kitsuId" INTEGER,
        "kitsuEpisode" INTEGER,
        FOREIGN KEY ("infoHash") REFERENCES torrents("infoHash") ON DELETE CASCADE
      );
    `, { type: QueryTypes.RAW });

    // Criar tabela subtitles (exatamente como no models.ts)
    console.log('Criando tabela subtitles...');
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS subtitles (
        "infoHash" VARCHAR(64) NOT NULL,
        "fileIndex" INTEGER NOT NULL,
        "fileId" BIGINT,
        "title" VARCHAR(512) NOT NULL,
        "size" BIGINT NOT NULL,
        FOREIGN KEY ("infoHash") REFERENCES torrents("infoHash") ON DELETE CASCADE,
        FOREIGN KEY ("fileId") REFERENCES files("id") ON DELETE SET NULL
      );
    `, { type: QueryTypes.RAW });

    console.log('Todas as tabelas criadas com sucesso');

    // Verificar contagem de registros
    const [torrentCount] = await sequelize.query(
      'SELECT COUNT(*) as count FROM torrents',
      { type: QueryTypes.SELECT }
    );
    
    const [fileCount] = await sequelize.query(
      'SELECT COUNT(*) as count FROM files',
      { type: QueryTypes.SELECT }
    );
    
    const [subtitleCount] = await sequelize.query(
      'SELECT COUNT(*) as count FROM subtitles',
      { type: QueryTypes.SELECT }
    );

    console.log(`Total de torrents: ${torrentCount.count}`);
    console.log(`Total de files: ${fileCount.count}`);
    console.log(`Total de subtitles: ${subtitleCount.count}`);

  } catch (error) {
    console.error('Erro na migração:', error.message);
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('Conexão fechada');
  }
}

// Executar migração
createTables();