#!/usr/bin/env ts-node
/**
 * Limpa o banco de dados, MANTENDO apenas torrents de curadoria (provider = 'Curadoria').
 * Uso: npx ts-node scripts/clean-database.ts
 */

import 'dotenv/config';
import { Op } from 'sequelize';
import { Torrent, sequelize } from '../src/database/models.js';

async function main() {
  console.log('=== LIMPEZA DO BANCO DE DADOS ===');
  console.log('Mantendo apenas torrents com provider = "Curadoria"\n');

  // Conecta ao banco
  try {
    await sequelize.authenticate();
    console.log('✅ Conectado ao banco de dados');
  } catch (err) {
    console.error('❌ Falha ao conectar:', (err as Error).message);
    process.exit(1);
  }

  // Conta antes
  const totalAntes = await Torrent.count();
  const curadoriaAntes = await Torrent.count({ where: { provider: 'Curadoria' } });
  const naoCuradoriaAntes = totalAntes - curadoriaAntes;

  console.log(`\n📊 ANTES:`);
  console.log(`   Total: ${totalAntes} torrents`);
  console.log(`   Curadoria: ${curadoriaAntes} torrents`);
  console.log(`   A serem removidos: ${naoCuradoriaAntes} torrents\n`);

  if (naoCuradoriaAntes === 0) {
    console.log('✅ Nada a remover — banco já está limpo.');
    await sequelize.close();
    process.exit(0);
  }

  // Confirmação
  console.log(`⚠️  Isso vai REMOVER ${naoCuradoriaAntes} torrents do banco.`);
  console.log('Torrents de curadoria (provider="Curadoria") serão MANTIDOS.\n');

  // Aguarda confirmação
  const resposta = await new Promise<string>(resolve => {
    process.stdout.write('Digite "LIMPAR" para confirmar: ');
    const onData = (data: Buffer) => {
      process.stdin.removeListener('data', onData);
      resolve(data.toString().trim());
    };
    process.stdin.on('data', onData);
  });

  if (resposta !== 'LIMPAR') {
    console.log('❌ Cancelado pelo usuário.');
    await sequelize.close();
    process.exit(0);
  }

  // Executa a limpeza
  console.log('\n🧹 Removendo torrents não-curados...');
  const startTime = Date.now();

  const deleted = await Torrent.destroy({
    where: { provider: { [Op.ne]: 'Curadoria' } }
  });

  // Conta depois
  const totalDepois = await Torrent.count();
  const curadoriaDepois = await Torrent.count({ where: { provider: 'Curadoria' } });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n✅ LIMPEZA CONCLUÍDA em ${elapsed}s`);
  console.log(`\n📊 DEPOIS:`);
  console.log(`   Total: ${totalDepois} torrents`);
  console.log(`   Curadoria: ${curadoriaDepois} torrents`);
  console.log(`   Removidos: ${deleted} torrents\n`);

  await sequelize.close();
}

main().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
