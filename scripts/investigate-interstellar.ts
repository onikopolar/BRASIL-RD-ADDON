/**
 * Investigação: Interestelar (tt0816692) — por que resolução "HD"?
 * Analisa cada torrent, qualidade, idioma.
 */
import { sequelize } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

async function main() {
  await sequelize.authenticate();

  console.log('═'.repeat(70));
  console.log('🔍 INVESTIGAÇÃO: Interestelar (tt0816692) — 8 torrents');
  console.log('═'.repeat(70));

  const all = await sequelize.query(`
    SELECT f.id, f."imdbSeason", f."imdbEpisode",
           t."title" as full_title,
           t."resolution", t."languages", t."seeders", t."size",
           t."infoHash", t."provider"
    FROM files f
    JOIN torrents t ON f."infoHash" = t."infoHash"
    WHERE f."imdbId" = 'tt0816692'
    ORDER BY f.id
  `, { type: QueryTypes.SELECT }) as any[];

  console.log(`\nTotal: ${all.length} registros\n`);

  // Analisa cada título
  for (const r of all) {
    const t = r.full_title || '';
    const hasPt = /dublado|dual|legendado|pt-br|ptbr|nacional|portugues/i.test(t);
    const hasEn = /english|ingl[eê]s|eng(?!ine)/i.test(t);
    const titleLang = t.match(/dublado|dual|legendado|english|ingl[eê]s|espanhol|latino/i)?.[0] || '???';
    
    // Extrai resolução do título
    const titleRes = t.match(/\b(2160p|1080p|720p|480p|4[kK])\b/)?.[1] || 'não encontrada';
    const sizeMB = r.size ? `${(Number(r.size) / 1024 / 1024).toFixed(0)} MB` : '?';

    console.log(`ID=${String(r.id).padStart(3)} | DB res=${(r.resolution||'?').padEnd(5)} | título res=${titleRes.padEnd(6)} | ${sizeMB.padEnd(8)} | seeds=${String(r.seeders||0).padStart(3)} | lang=${r.languages} (título: ${titleLang})`);
    console.log(`  "${t}"`);
    
    const issues: string[] = [];
    if (r.resolution === 'HD') issues.push('⚠️ DB diz "HD"');
    if (titleRes !== 'não encontrada' && r.resolution !== titleRes) issues.push(`⚠️ DB:${r.resolution} vs título:${titleRes}`);
    if (!hasPt) issues.push('🔴 SEM indicador PT-BR no título');
    if (hasEn && !hasPt) issues.push('🔴 título em inglês puro');
    if (issues.length) console.log(`  → ${issues.join(' | ')}`);
  }

  // Resumo
  console.log('\n═'.repeat(70));
  console.log('📊 RESUMO');
  console.log('═'.repeat(70));

  const hdOnly = all.filter(r => r.resolution === 'HD');
  const semPt = all.filter(r => !/dublado|dual|legendado|pt-br|ptbr|nacional|portugues/i.test(r.full_title || ''));
  const emIngles = all.filter(r => /interestelar/i.test(r.full_title || ''));
  
  console.log(`   Resolução "HD" no DB: ${hdOnly.length}/${all.length}`);
  console.log(`   Título contém "Interestelar" (PT): ${emIngles.length}/${all.length}`);
  console.log(`   Sem indicador PT-BR no título: ${semPt.length}/${all.length}`);

  await sequelize.close();
  console.log('\n✅ Fim');
}

main().catch(e => { console.error(e); process.exit(1); });
