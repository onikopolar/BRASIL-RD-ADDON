// Script: lista/apaga torrents do banco com indicadores internacionais
// Uso: npx tsx scripts/limpar-falsos-ptbr.ts [--apagar]
import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import { containsInternationalIndicators, containsBrazilianIndicators, INDICADORES_INTERNACIONAL_TORRENTS, INTERNATIONAL_RELEASE_GROUPS, INTERNATIONAL_TRACKERS } from '../src/titulos/TechnicalWords.js';
import { Op } from 'sequelize';

// Junta TUDO que indica internacional
const TODOS_INDICADORES_INTERNACIONAIS = [
  ...INTERNATIONAL_RELEASE_GROUPS,
  ...INTERNATIONAL_TRACKERS,
  ...INDICADORES_INTERNACIONAL_TORRENTS,
];

function temIndicadorInternacional(title: string): string[] {
  const lower = title.toLowerCase();
  const found: string[] = [];
  for (const indicador of TODOS_INDICADORES_INTERNACIONAIS) {
    // Usa word boundary pra não dar match parcial (ex: 'vo' em 'novo')
    const regex = new RegExp('\\b' + indicador.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    if (regex.test(lower)) {
      found.push(indicador);
    }
  }
  return found;
}

async function main() {
  const apagar = process.argv.includes('--apagar');

  console.log('═══════════════════════════════════════════');
  console.log(apagar ? '🗑️  MODO: APAGAR' : '📋 MODO: LISTAR (use --apagar para deletar)');
  console.log('═══════════════════════════════════════════\n');

  // Pega todos os torrents
  const all = await Torrent.findAll({
    attributes: ['infoHash', 'title', 'provider', 'idioma', 'imdbId', 'uploadDate'],
    order: [['uploadDate', 'DESC']]
  });

  console.log(`📦 Total no banco: ${all.length}\n`);

  const internacionais: typeof all = [];
  const brasileiros: typeof all = [];
  const neutros: typeof all = [];

  for (const t of all) {
    const nome = t.title || '';
    const intlIndicators = temIndicadorInternacional(nome);
    const br = containsBrazilianIndicators(nome);

    if (br.isBrazilian) {
      brasileiros.push(t);
    } else if (intlIndicators.length > 0) {
      internacionais.push(t);
    } else {
      neutros.push(t);
    }
  }

  // Mostra stats por indicador internacional
  console.log('📊 DISTRIBUIÇÃO:');
  console.log(`   BR (grupos/trackers BR):       ${brasileiros.length}`);
  console.log(`   INTERNACIONAL (grupos gringos): ${internacionais.length}`);
  console.log(`   NEUTRO (sem indicadores):       ${neutros.length}`);
  console.log('');

  if (internacionais.length > 0) {
    // Agrupa por indicador internacional
    const porGrupo = new Map<string, typeof all>();
    for (const t of internacionais) {
      const indicadores = temIndicadorInternacional(t.title);
      const grupo = indicadores[0] || '?';
      if (!porGrupo.has(grupo)) porGrupo.set(grupo, []);
      porGrupo.get(grupo)!.push(t);
    }

    console.log('🌍 Indicadores internacionais encontrados:');
    for (const [grupo, torrents] of [...porGrupo.entries()].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`   ${grupo}: ${torrents.length} torrents`);
    }

    // Amostra
    console.log('\n📋 Amostra (primeiros 15):');
    for (const t of internacionais.slice(0, 15)) {
      const indicadores = temIndicadorInternacional(t.title);
      console.log(`   [${indicadores.join(', ')}] ${t.title.substring(0, 80)}`);
      console.log(`   Provider: ${t.provider} | IMDB: ${t.imdbId || 'N/A'} | Data: ${t.uploadDate?.toISOString().substring(0, 10)}`);
    }

    if (apagar) {
      console.log(`\n🗑️  Apagando ${internacionais.length} torrents internacionais...`);
      const infos = internacionais.map(t => t.infoHash);
      
      let apagados = 0;
      for (let i = 0; i < infos.length; i += 100) {
        const batch = infos.slice(i, i + 100);
        const deleted = await Torrent.destroy({ where: { infoHash: { [Op.in]: batch } } });
        apagados += deleted;
      }
      
      console.log(`✅ ${apagados} torrents removidos do banco!`);
    } else {
      console.log(`\n💡 Rode com --apagar para remover ${internacionais.length} torrents internacionais.`);
    }
  } else {
    console.log('✅ Nenhum torrent internacional no banco!');
  }

  await sequelize.close();
}

main().catch(console.error);
