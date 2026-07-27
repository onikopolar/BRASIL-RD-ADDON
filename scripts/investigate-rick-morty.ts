/**
 * Investigação: por que Rick e Morty (tt2861424) tem 38 torrents?
 * Analisa duplicatas, títulos, e padrões suspeitos.
 */
import { sequelize } from '../src/database/models.js';
import { QueryTypes } from 'sequelize';

async function main() {
  await sequelize.authenticate();

  console.log('═'.repeat(70));
  console.log('🔍 INVESTIGAÇÃO: Rick e Morty (tt2861424) — 38 torrents');
  console.log('═'.repeat(70));

  // ─── 1. Todos os registros ───
  const all = await sequelize.query(`
    SELECT f.id, f."imdbSeason", f."imdbEpisode",
           substring(t."title", 1, 120) as title,
           t."resolution", t."languages", t."seeders", t."provider",
           t."infoHash"
    FROM files f
    JOIN torrents t ON f."infoHash" = t."infoHash"
    WHERE f."imdbId" = 'tt2861424'
    ORDER BY f.id
  `, { type: QueryTypes.SELECT }) as any[];

  console.log(`\nTotal: ${all.length} registros\n`);

  for (const r of all) {
    const ep = r.imdbEpisode !== null ? `E${r.imdbEpisode}` : 'PACK';
    console.log(`ID=${r.id.toString().padStart(3)} | S${r.imdbSeason ?? '?'}${ep.padEnd(5)} | ${r.resolution?.padEnd(5)} | seeds=${r.seeders?.toString().padStart(3)} | lang=${r.languages}`);
    console.log(`       "${r.title}"`);
    console.log(`       hash: ${r.infoHash?.substring(0, 16)}...`);
  }

  // ─── 2. Análise de duplicatas ───
  console.log('\n═'.repeat(70));
  console.log('📊 ANÁLISE DE DUPLICATAS');
  console.log('═'.repeat(70));

  // Por infoHash
  const hashCounts = new Map<string, number>();
  for (const r of all) hashCounts.set(r.infoHash, (hashCounts.get(r.infoHash) || 0) + 1);
  const dups = [...hashCounts.entries()].filter(([, c]) => c > 1);
  console.log(`\n   Duplicatas por infoHash: ${dups.length} hashes com >1 file`);
  for (const [h, c] of dups) {
    const titles = all.filter(r => r.infoHash === h).map(r => `ID=${r.id}`);
    console.log(`     ${h.substring(0, 16)}... → ${c}x (${titles.join(', ')})`);
  }

  // Por título similar
  const titleCounts = new Map<string, number>();
  for (const r of all) {
    const clean = r.title.trim().toLowerCase().replace(/\s+/g, ' ');
    titleCounts.set(clean, (titleCounts.get(clean) || 0) + 1);
  }
  const titleDups = [...titleCounts.entries()].filter(([, c]) => c > 1);
  console.log(`\n   Duplicatas por título: ${titleDups.length}`);
  for (const [t, c] of titleDups) {
    console.log(`     "${t.substring(0, 80)}" → ${c}x`);
  }

  // ─── 3. Distribuição por temporada ───
  console.log('\n═'.repeat(70));
  console.log('📊 DISTRIBUIÇÃO POR TEMPORADA');
  console.log('═'.repeat(70));

  const seasons = await sequelize.query(`
    SELECT "imdbSeason", "imdbEpisode", COUNT(*) as cnt
    FROM files
    WHERE "imdbId" = 'tt2861424'
    GROUP BY "imdbSeason", "imdbEpisode"
    ORDER BY "imdbSeason", "imdbEpisode"
  `, { type: QueryTypes.SELECT }) as any[];

  for (const s of seasons) {
    const ep = s.imdbEpisode !== null ? `E${s.imdbEpisode}` : 'PACK completo';
    console.log(`   S${s.imdbSeason} ${ep}: ${s.cnt} torrents`);
  }

  // ─── 4. Qualidade dos títulos ───
  console.log('\n═'.repeat(70));
  console.log('📊 QUALIDADE DOS TÍTULOS');
  console.log('═'.repeat(70));

  const semDublado = all.filter(r => !/dublado|dual|legendado/i.test(r.title));
  console.log(`   Sem "dublado/dual/legendado": ${semDublado.length}`);
  const comSite = all.filter(r => /\.com|\.xyz|\.net|\.org|hidratorrent|torrentdosfilmes/i.test(r.title));
  console.log(`   Com domínio no título: ${comSite.length}`);
  const comSujeira = all.filter(r => /^\{|^\s*-|Acesse o ORIGINAL|LAPUMiA/i.test(r.title));
  console.log(`   Com prefixo/sujeira: ${comSujeira.length}`);

  if (comSite.length > 0) {
    console.log('\n   Títulos com domínio:');
    for (const r of comSite) {
      console.log(`     ID=${r.id}: "${r.title.substring(0, 100)}"`);
    }
  }

  await sequelize.close();
  console.log('\n✅ Fim');
}

main().catch(e => { console.error(e); process.exit(1); });
