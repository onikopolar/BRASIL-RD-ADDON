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
    console.log('Conectado ao banco de dados\n');

    // Buscar torrent com seu magnet link
    const [torrent] = await sequelize.query(
      `SELECT "title", "infoHash", "magnetLink" FROM torrents LIMIT 1`,
      { type: QueryTypes.SELECT }
    );

    if (!torrent) {
      console.log('Nenhum torrent encontrado no banco');
      return;
    }

    console.log('TORRENT ENCONTRADO NO BANCO:');
    console.log(`   Titulo: ${torrent.title}`);
    console.log(`   Hash: ${torrent.infoHash}`);
    
    if (torrent.magnetLink) {
      console.log(`   Magnet Link: ${torrent.magnetLink.substring(0, 100)}...`);
      
      // Extrair nome do arquivo do magnet
      const match = torrent.magnetLink.match(/dn=([^&]+)/);
      if (match) {
        console.log(`   Nome do arquivo no magnet: ${decodeURIComponent(match[1])}`);
      }
    }

    console.log('\nANALISE DO PROBLEMA:');
    console.log('   1. O torrent e um pacote da temporada completa');
    console.log('   2. Contem multiplos episodios (S02E01, S02E02, etc)');
    console.log('   3. Quando o usuario pede S02E03, o sistema precisa:');
    console.log('      a) Listar todos os arquivos do torrent no Real-Debrid');
    console.log('      b) Encontrar o arquivo S02E03 especifico');
    console.log('      c) Gerar link para esse arquivo especifico');
    console.log('\nSOLUCAO NECESSARIA:');
    console.log('   - Atualizar RealDebridService para selecao de episodio');
    console.log('   - Filtrar arquivos pelo numero do episodio solicitado');
    console.log('   - Implementar logica de match de episodios nos arquivos');

    // Verificar se ha registros de episodios
    const [episodeCount] = await sequelize.query(
      `SELECT COUNT(*) as total FROM files WHERE "imdbEpisode" IS NOT NULL`,
      { type: QueryTypes.SELECT }
    );
    
    console.log(`\nESTATISTICAS DO BANCO:`);
    console.log(`   Total de arquivos com episodio: ${episodeCount.total}`);

    // Mostrar alguns exemplos
    const exampleEpisodes = await sequelize.query(
      `SELECT "title", "imdbSeason", "imdbEpisode" FROM files WHERE "imdbEpisode" IS NOT NULL LIMIT 5`,
      { type: QueryTypes.SELECT }
    );

    if (exampleEpisodes.length > 0) {
      console.log(`\nEXEMPLOS DE EPISODIOS NO BANCO:`);
      exampleEpisodes.forEach(ep => {
        console.log(`   S${ep.imdbSeason}E${ep.imdbEpisode} - ${ep.title.substring(0, 60)}`);
      });
    }

  } catch (error) {
    console.error('Erro ao verificar arquivos:', error.message);
  } finally {
    await sequelize.close();
  }
}

// Versionamento Semantico v1.0.0 - Script de diagnostico do banco
const VERSION = '1.0.0';

console.log(`\n=== CHECK TORRENT FILES v${VERSION} ===`);
console.log('Script de diagnostico do banco de dados torrents');
console.log('Objetivo: Verificar integridade dos dados e identificar problemas\n');

checkTorrentFiles()
  .then(() => {
    console.log('\nDiagnostico concluido');
    process.exit(0);
  })
  .catch(error => {
    console.error('Falha no diagnostico:', error);
    process.exit(1);
  });