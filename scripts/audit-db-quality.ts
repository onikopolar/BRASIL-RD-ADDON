/**
 * Auditoria do banco: qualidade dos torrents salvos.
 * Verifica resoluções vagas (HD), títulos em inglês sem indicador PT,
 * títulos com espaçamento quebrado, etc.
 */
import { sequelize } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

async function main() {
  await sequelize.authenticate();

  // ─── 1. Estatísticas gerais ───
  console.log('═'.repeat(70));
  console.log('📊 ESTATÍSTICAS GERAIS');
  console.log('═'.repeat(70));

  const [total] = await sequelize.query(`SELECT COUNT(*) as cnt FROM files`, { type: QueryTypes.SELECT }) as any[];
  console.log(`   Total files: ${total.cnt}`);

  const langs = await sequelize.query(
    `SELECT "languages", COUNT(*) as cnt FROM torrents GROUP BY "languages" ORDER BY cnt DESC`,
    { type: QueryTypes.SELECT }) as any[];
  console.log('\n   Idiomas:');
  for (const l of langs) console.log(`     ${l.languages || '(null)'}: ${l.cnt}`);

  const resos = await sequelize.query(
    `SELECT "resolution", COUNT(*) as cnt FROM torrents GROUP BY "resolution" ORDER BY cnt DESC`,
    { type: QueryTypes.SELECT }) as any[];
  console.log('\n   Resoluções:');
  for (const r of resos) console.log(`     ${r.resolution || '(null)'}: ${r.cnt}`);

  // ─── 2. Títulos suspeitos (sem indicador PT-BR) ───
  console.log('\n═'.repeat(70));
  console.log('🔍 TÍTULOS SEM INDICADOR PT-BR (possível inglês puro)');
  console.log('═'.repeat(70));

  const noPt = await sequelize.query(`
    SELECT f.id, f."imdbId",
           substring(t."title", 1, 90) as title,
           t."languages", t."resolution"
    FROM files f
    JOIN torrents t ON f."infoHash" = t."infoHash"
    WHERE t."title" !~* 'dublado|dual|legendado|portugues|nacional|dublagem|pt-br|ptbr|brasileiro'
    ORDER BY f.id
    LIMIT 20
  `, { type: QueryTypes.SELECT }) as any[];

  if (noPt.length === 0) {
    console.log('   ✅ Nenhum título sem PT-BR encontrado');
  } else {
    console.log(`   ${noPt.length} títulos suspeitos:`);
    for (const t of noPt) {
      console.log(`     ID=${t.id} | ${t.imdbId} | ${t.resolution} | ${t.languages}`);
      console.log(`     "${t.title}"`);
    }
  }

  // ─── 3. Resolução "HD" (vaga) ───
  console.log('\n═'.repeat(70));
  console.log('🔍 RESOLUÇÃO "HD" (deveria ser 720p/1080p/etc)');
  console.log('═'.repeat(70));

  const hdOnly = await sequelize.query(`
    SELECT f.id, f."imdbId",
           substring(t."title", 1, 90) as title,
           t."languages", t."seeders"
    FROM files f
    JOIN torrents t ON f."infoHash" = t."infoHash"
    WHERE t."resolution" = 'HD'
    ORDER BY f.id
  `, { type: QueryTypes.SELECT }) as any[];

  console.log(`   ${hdOnly.length} torrents com resolução "HD":`);
  for (const t of hdOnly) {
    console.log(`     ID=${t.id} | ${t.imdbId} | seeds=${t.seeders} | ${t.languages}`);
    console.log(`     "${t.title}"`);
  }

  // ─── 4. Títulos com espaçamento quebrado ───
  console.log('\n═'.repeat(70));
  console.log('🔍 TÍTULOS COM ESPAÇAMENTO QUEBRADO (múltiplos espaços/novas linhas)');
  console.log('═'.repeat(70));

  const broken = await sequelize.query(`
    SELECT f.id,
           substring(t."title", 1, 100) as title,
           length(t."title") - length(replace(t."title", ' ', '')) as spaces
    FROM files f
    JOIN torrents t ON f."infoHash" = t."infoHash"
    WHERE t."title" ~ '\\n|  |^\\s+|\\s+$'
    ORDER BY f.id
  `, { type: QueryTypes.SELECT }) as any[];

  if (broken.length === 0) {
    console.log('   ✅ Nenhum título com espaçamento quebrado');
  } else {
    console.log(`   ${broken.length} títulos quebrados:`);
    for (const t of broken) {
      console.log(`     ID=${t.id} | spaces=${t.spaces}`);
      console.log(`     "${t.title?.replace(/\n/g, '\\n').substring(0, 100)}"`);
    }
  }

  // ─── 5. Top IMDB IDs ───
  console.log('\n═'.repeat(70));
  console.log('📊 TOP IMDB IDs');
  console.log('═'.repeat(70));

  const topImdb = await sequelize.query(`
    SELECT "imdbId", COUNT(*) as cnt
    FROM files
    GROUP BY "imdbId"
    ORDER BY cnt DESC
    LIMIT 15
  `, { type: QueryTypes.SELECT }) as any[];

  for (const t of topImdb) {
    console.log(`     ${t.imdbId}: ${t.cnt} torrents`);
  }

  await sequelize.close();
  console.log('\n✅ Fim');
}

main().catch(e => { console.error(e); process.exit(1); });
