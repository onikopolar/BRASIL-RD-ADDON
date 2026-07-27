/**
 * Script: Auditar e corrigir registros Korra ↔ Aang no banco de dados.
 * 
 * Uso:
 *   npx tsx scripts/audit-korra-db.ts          # Apenas auditar (read-only)
 *   npx tsx scripts/audit-korra-db.ts --fix    # Auditar E corrigir
 *   npx tsx scripts/audit-korra-db.ts --dry    # Mostrar SQL que seria executado
 */

import { sequelize, Torrent, File } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

// IMDB IDs
const AANG_IMDB = 'tt0417299';   // Avatar: The Last Airbender
const KORRA_IMDB = 'tt1695360';  // The Legend of Korra

// Palavras-chave para identificar cada série no título
const KORRA_KEYWORDS = ['korra'];
const AANG_KEYWORDS = ['aang', 'last airbender', 'ultimo mestre', 'último mestre', 'maestro del aire'];

interface BadRecord {
  fileId: number;
  infoHash: string;
  fileTitle: string;
  torrentTitle: string;
  currentImdbId: string;
  currentSeason: number | null;
  currentEpisode: number | null;
  suggestedImdbId: string;
  matchedKeyword: string;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes('--fix');
  const dryRun = args.includes('--dry');

  console.log('='.repeat(80));
  console.log('AUDITORIA: Korra ↔ Aang no banco de dados');
  console.log('='.repeat(80));
  console.log(`Modo: ${shouldFix ? 'CORREÇÃO' : dryRun ? 'DRY-RUN (SQL)' : 'AUDITORIA (read-only)'}`);
  console.log('');

  try {
    await sequelize.authenticate();
    console.log('✅ Conexão com banco estabelecida\n');

    // ============================================================
    // 1. Buscar registros Korra salvos como Aang
    // ============================================================
    console.log('─'.repeat(80));
    console.log('🔍 Buscando: torrents da KORRA salvos com IMDB do AANG...');
    console.log('─'.repeat(80));

    const korraAsAang = await findMislabeled(KORRA_KEYWORDS, AANG_IMDB, KORRA_IMDB);
    console.log(`   Encontrados: ${korraAsAang.length} registros`);

    // ============================================================
    // 2. Buscar registros Aang salvos como Korra
    // ============================================================
    console.log('─'.repeat(80));
    console.log('🔍 Buscando: torrents do AANG salvos com IMDB da KORRA...');
    console.log('─'.repeat(80));

    const aangAsKorra = await findMislabeled(AANG_KEYWORDS, KORRA_IMDB, AANG_IMDB);
    console.log(`   Encontrados: ${aangAsKorra.length} registros`);

    // ============================================================
    // 3. Resumo geral
    // ============================================================
    const allBad = [...korraAsAang, ...aangAsKorra];
    
    console.log('\n' + '='.repeat(80));
    console.log('RESUMO');
    console.log('='.repeat(80));
    console.log(`Total de registros incorretos: ${allBad.length}`);
    console.log(`  Korra → Aang (tt0417299): ${korraAsAang.length}`);
    console.log(`  Aang → Korra (tt1695360): ${aangAsKorra.length}`);

    if (allBad.length === 0) {
      console.log('\n✅ Nenhum registro incorreto encontrado!');
      await sequelize.close();
      return;
    }

    // Mostrar detalhes
    console.log('\n' + '─'.repeat(80));
    console.log('DETALHES');
    console.log('─'.repeat(80));
    
    for (const record of allBad) {
      console.log(`\n📋 File ID: ${record.fileId}`);
      console.log(`   Torrent: ${record.torrentTitle?.substring(0, 100)}`);
      console.log(`   File:    ${record.fileTitle?.substring(0, 100)}`);
      console.log(`   IMDB atual:  ${record.currentImdbId} (S${record.currentSeason}E${record.currentEpisode ?? '?'})`);
      console.log(`   IMDB correto: ${record.suggestedImdbId}`);
      console.log(`   Keyword detectada: "${record.matchedKeyword}"`);
    }

    // ============================================================
    // 4. Correção (se --fix)
    // ============================================================
    if (shouldFix || dryRun) {
      console.log('\n' + '='.repeat(80));
      console.log(shouldFix ? 'APLICANDO CORREÇÕES...' : 'SQL QUE SERIA EXECUTADO (dry-run):');
      console.log('='.repeat(80));

      for (const record of allBad) {
        const sql = `UPDATE files SET "imdbId" = '${record.suggestedImdbId}' WHERE id = ${record.fileId};`;
        console.log(`\n${sql}`);
        console.log(`  -- ${record.fileTitle?.substring(0, 80)}`);

        if (shouldFix) {
          await sequelize.query(
            `UPDATE files SET "imdbId" = :newImdb WHERE id = :fileId`,
            {
              replacements: { newImdb: record.suggestedImdbId, fileId: record.fileId },
              type: QueryTypes.UPDATE
            }
          );
          console.log('  ✅ Corrigido!');
        }
      }

      if (shouldFix && !dryRun) {
        // Verificar pós-correção
        console.log('\n─'.repeat(80));
        console.log('🔍 Verificando pós-correção...');
        const remainingKorra = await findMislabeled(KORRA_KEYWORDS, AANG_IMDB, KORRA_IMDB);
        const remainingAang = await findMislabeled(AANG_KEYWORDS, KORRA_IMDB, AANG_IMDB);
        console.log(`   Korra→Aang restantes: ${remainingKorra.length}`);
        console.log(`   Aang→Korra restantes: ${remainingAang.length}`);
        if (remainingKorra.length === 0 && remainingAang.length === 0) {
          console.log('   ✅ Todos os registros foram corrigidos!');
        }
      }
    } else {
      console.log('\n💡 Para corrigir, execute: npx tsx scripts/audit-korra-db.ts --fix');
      console.log('   Para ver SQL sem executar: npx tsx scripts/audit-korra-db.ts --dry');
    }

  } catch (error) {
    console.error('❌ Erro:', error instanceof Error ? error.message : error);
    process.exit(1);
  } finally {
    await sequelize.close();
    console.log('\nConexão fechada.');
  }
}

/**
 * Busca registros na tabela files onde:
 * - imdbId = currentImdb (o IMDB errado)
 * - file.title OU torrent.title contém alguma das keywords
 */
async function findMislabeled(
  keywords: string[],
  currentImdb: string,
  suggestedImdb: string
): Promise<BadRecord[]> {
  // Constroi condições ILIKE para cada keyword
  const fileConditions = keywords.map(kw => `f."title" ILIKE '%${kw}%'`).join(' OR ');
  const torrentConditions = keywords.map(kw => `t."title" ILIKE '%${kw}%'`).join(' OR ');

  const query = `
    SELECT 
      f.id as "fileId",
      f."infoHash",
      f."title" as "fileTitle",
      t."title" as "torrentTitle",
      f."imdbId" as "currentImdbId",
      f."imdbSeason" as "currentSeason",
      f."imdbEpisode" as "currentEpisode"
    FROM files f
    JOIN torrents t ON f."infoHash" = t."infoHash"
    WHERE f."imdbId" = :currentImdb
      AND (${fileConditions} OR ${torrentConditions})
    ORDER BY f.id
  `;

  const rows = await sequelize.query(query, {
    replacements: { currentImdb },
    type: QueryTypes.SELECT
  }) as any[];

  return rows.map(row => {
    // Descobre qual keyword deu match
    const combinedTitle = `${row.fileTitle || ''} ${row.torrentTitle || ''}`.toLowerCase();
    const matchedKeyword = keywords.find(kw => combinedTitle.includes(kw)) || keywords[0];

    return {
      fileId: row.fileId,
      infoHash: row.infoHash,
      fileTitle: row.fileTitle,
      torrentTitle: row.torrentTitle,
      currentImdbId: row.currentImdbId,
      currentSeason: row.currentSeason,
      currentEpisode: row.currentEpisode,
      suggestedImdbId: suggestedImdb,
      matchedKeyword
    };
  });
}

main();
