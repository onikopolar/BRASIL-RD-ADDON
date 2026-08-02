// Expurga torrents com indicadores internacionais do banco (NOGRP, rartv, etc)
import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import { INTERNATIONAL_RELEASE_GROUPS, INTERNATIONAL_TRACKERS } from '../src/titulos/TechnicalWords.js';

async function main() {
  await sequelize.authenticate();
  
  const total = await Torrent.count();
  console.log(`📦 Total no banco: ${total}`);

  // Todas as palavras que indicam torrent gringo
  const indicadores = [...INTERNATIONAL_RELEASE_GROUPS, ...INTERNATIONAL_TRACKERS];
  
  let deletados = 0;
  
  for (const indicador of indicadores) {
    // Busca case-insensitive
    const { Op } = await import('sequelize');
    const encontrados = await Torrent.findAll({
      where: { title: { [Op.iLike]: `%${indicador}%` } },
      attributes: ['infoHash', 'title'],
      raw: true
    });
    
    if (encontrados.length === 0) continue;
    
    console.log(`\n🔍 "${indicador}": ${encontrados.length} torrents`);
    for (const t of encontrados) {
      console.log(`   🗑️  ${t.title?.substring(0, 70)}`);
    }
    
    const destroyed = await Torrent.destroy({
      where: { title: { [Op.iLike]: `%${indicador}%` } }
    });
    deletados += destroyed;
  }
  
  const restante = await Torrent.count();
  console.log(`\n✅ ${deletados} torrents expurgados!`);
  console.log(`📦 Restam ${restante} no banco.`);
  
  await sequelize.close();
}

main().catch(console.error);
