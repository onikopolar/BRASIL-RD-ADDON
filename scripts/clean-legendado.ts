import { sequelize, Torrent } from '../src/database/models.js';
import { Op } from 'sequelize';

async function main() {
  console.log('🔍 Conectando ao banco de dados...');
  await sequelize.authenticate();
  console.log('✅ Conectado.\n');

  // ──── Busca todos os torrents com indicadores de Legendado ────
  // Patterns para o título (case-insensitive via iLike no PostgreSQL):
  // - %legendado% : palavra completa
  // - %legenda%  : variante
  // - % lege%    : "Lege" apos espaco (ex: "CAMRip Lege")
  // - %.lege%    : "Lege" apos ponto (ex: "CAMRip.Lege")
  // - % lege     : "Lege" no final do titulo
  const titlePatterns = [
    '%legendado%', '%legenda%',
    '% lege%', '%.lege%',
  ];

  const titleConditions = titlePatterns.map(p => ({
    title: { [Op.iLike]: p }
  }));

  const where = {
    [Op.or]: [
      ...titleConditions,
      { idioma: { [Op.iLike]: '%legendado%' } },
      { idioma: { [Op.iLike]: '%legenda%' } },
    ]
  };

  // Primeiro conta
  const count = await Torrent.count({ where });
  console.log(`📊 Torrents com indicadores de Legendado: ${count}`);

  if (count === 0) {
    console.log('✅ Nada para limpar.');
    await sequelize.close();
    return;
  }

  // Lista os que serão deletados
  const torrents = await Torrent.findAll({
    where,
    attributes: ['infoHash', 'title', 'idioma', 'provider', 'imdbId'],
    raw: true
  });

  console.log('\n📋 Torrents que serão DELETADOS:');
  for (const t of torrents) {
    const titlePreview = (t.title || '').substring(0, 70);
    console.log(`  • [${t.idioma || '?'}] ${titlePreview}`);
    console.log(`    infoHash: ${t.infoHash?.substring(0, 16)}... | imdb: ${t.imdbId || 'N/A'} | provider: ${t.provider || '?'}`);
  }

  // Confirmação
  console.log(`\n⚠️  ${count} torrent(s) serão deletados permanentemente.`);
  
  // Deleta
  const deleted = await Torrent.destroy({ where });
  console.log(`🗑️  ${deleted} torrent(s) deletados com sucesso.`);

  await sequelize.close();
  console.log('✅ Conexão fechada.');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
