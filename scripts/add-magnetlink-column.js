const { sequelize } = require('../dist/database/models');
const { QueryTypes } = require('sequelize');

async function addMagnetLinkColumn() {
  try {
    console.log('Verificando se a coluna magnetLink existe...');
    
    // Verificar se a coluna já existe
    const [results] = await sequelize.query(
      `SELECT column_name 
       FROM information_schema.columns 
       WHERE table_name = 'torrents' 
       AND column_name = 'magnetLink'`,
      { type: QueryTypes.SELECT }
    );

    if (results) {
      console.log('✅ Coluna magnetLink já existe na tabela torrents');
      return;
    }

    // Adicionar a coluna se não existir
    console.log('Adicionando coluna magnetLink à tabela torrents...');
    await sequelize.query(
      `ALTER TABLE torrents 
       ADD COLUMN magnetLink TEXT`,
      { type: QueryTypes.RAW }
    );

    console.log('✅ Coluna magnetLink adicionada com sucesso!');
    
  } catch (error) {
    console.error('❌ Erro ao adicionar coluna:', error.message);
  } finally {
    await sequelize.close();
  }
}

addMagnetLinkColumn();
