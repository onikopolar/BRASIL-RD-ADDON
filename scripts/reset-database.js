const { Sequelize, QueryTypes } = require('sequelize');
require('dotenv').config();

// Configura√ß√£o igual ao migrate-database.js
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('DATABASE_URL n√£o configurada no .env');
}

// Configura√ß√µes do Sequelize
const sequelize = new Sequelize(DATABASE_URL, {
  logging: false,
  dialect: 'postgres',
  dialectOptions: {
    ssl: DATABASE_URL.includes('railway.app') ? {
      require: true,
      rejectUnauthorized: false
    } : false
  }
});

async function resetDatabase() {
  try {
    // Testar conex√£o
    await sequelize.authenticate();
    console.log('‚úÖ Conex√£o com PostgreSQL estabelecida');

    // Desabilitar triggers temporariamente
    console.log('Ì¥Ñ Desabilitando constraints...');
    await sequelize.query('SET session_replication_role = "replica"', { type: QueryTypes.RAW });

    // Limpar tabelas na ordem correta (por causa das foreign keys)
    console.log('Ì∑ëÔ∏è  Limpando tabela subtitles...');
    await sequelize.query('TRUNCATE TABLE subtitles CASCADE', { type: QueryTypes.RAW });

    console.log('Ì∑ëÔ∏è  Limpando tabela files...');
    await sequelize.query('TRUNCATE TABLE files CASCADE', { type: QueryTypes.RAW });

    console.log('Ì∑ëÔ∏è  Limpando tabela torrents...');
    await sequelize.query('TRUNCATE TABLE torrents CASCADE', { type: QueryTypes.RAW });

    // Resetar sequences
    console.log('Ì¥Ñ Resetando sequences...');
    await sequelize.query('ALTER SEQUENCE IF EXISTS files_id_seq RESTART WITH 1', { type: QueryTypes.RAW });
    await sequelize.query('ALTER SEQUENCE IF EXISTS subtitles_id_seq RESTART WITH 1', { type: QueryTypes.RAW });

    // Reabilitar constraints
    console.log('Ì¥Ñ Reabilitando constraints...');
    await sequelize.query('SET session_replication_role = "origin"', { type: QueryTypes.RAW });

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

    console.log('\n‚úÖ Banco de dados resetado com sucesso!');
    console.log('Ì≥ä Estat√≠sticas ap√≥s reset:');
    console.log(`   ‚Ä¢ Torrents: ${torrentCount.count}`);
    console.log(`   ‚Ä¢ Files: ${fileCount.count}`);
    console.log(`   ‚Ä¢ Subtitles: ${subtitleCount.count}`);

  } catch (error) {
    console.error('‚ùå Erro ao resetar banco:', error.message);
    if (error.original) {
      console.error('Detalhes:', error.original.message);
    }
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('\nÌ¥í Conex√£o com banco fechada');
  }
}

// Executar reset
resetDatabase();
