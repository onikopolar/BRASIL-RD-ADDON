const { Sequelize, QueryTypes } = require('sequelize');
require('dotenv').config();

const DATABASE_URL = process.env.DATABASE_URL;
const sequelize = new Sequelize(DATABASE_URL, {
  logging: false,
  dialect: 'postgres'
});

async function checkTorrentFiles() {
  try {
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco\n');

    // Buscar torrent com seu magnet link
    const [torrent] = await sequelize.query(
      `SELECT "title", "infoHash", "magnetLink" FROM torrents LIMIT 1`,
      { type: QueryTypes.SELECT }
    );

    if (!torrent) {
      console.log('❌ Nenhum torrent encontrado');
      return;
    }

    console.log('��� TORRENT ENCONTRADO:');
    console.log(`   Título: ${torrent.title}`);
    console.log(`   Hash: ${torrent.infoHash}`);
    
    if (torrent.magnetLink) {
      console.log(`   Magnet Link: ${torrent.magnetLink.substring(0, 100)}...`);
      
      // Extrair nome do arquivo do magnet
      const match = torrent.magnetLink.match(/dn=([^&]+)/);
      if (match) {
        console.log(`   Nome do arquivo no magnet: ${decodeURIComponent(match[1])}`);
      }
    }

    console.log('\n�� ANALISANDO O PROBLEMA:');
    console.log('   1. O torrent é um PACOTE da temporada completa');
    console.log('   2. Contém múltiplos episódios (S02E01, S02E02, etc)');
    console.log('   3. Quando o usuário pede S02E03, o sistema precisa:');
    console.log('      a) Listar todos os arquivos do torrent no Real-Debrid');
    console.log('      b) Encontrar o arquivo S02E03 específico');
    console.log('      c) Gerar link para esse arquivo específico');
    console.log('\n���️  O RealDebridService precisa ser atualizado para:');
    console.log('   - Implementar lógica de seleção de episódio específico');
    console.log('   - Filtrar arquivos pelo número do episódio solicitado');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  } finally {
    await sequelize.close();
  }
}

checkTorrentFiles();
