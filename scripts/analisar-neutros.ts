import 'dotenv/config';
import { sequelize, Torrent } from '../src/database/models.js';
import { containsBrazilianIndicators } from '../src/titulos/TechnicalWords.js';

async function main() {
  const all = await Torrent.findAll({
    attributes: ['title', 'provider', 'idioma', 'imdbId', 'uploadDate'],
    order: [['uploadDate', 'DESC']]
  });

  const neutros = all.filter(t => !containsBrazilianIndicators(t.title || '').isBrazilian);

  console.log('📋 NEUTROS (sem indicadores BR):', neutros.length, '/', all.length);

  console.log('\n📊 Por provider:');
  const porProv = new Map<string, number>();
  neutros.forEach(t => porProv.set(t.provider, (porProv.get(t.provider) || 0) + 1));
  [...porProv.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\n📊 Por idioma:');
  const porIdioma = new Map<string, number>();
  neutros.forEach(t => porIdioma.set(t.idioma || 'null', (porIdioma.get(t.idioma || 'null') || 0) + 1));
  [...porIdioma.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  console.log('\n📋 Amostra (30):');
  neutros.slice(0, 30).forEach(t => {
    console.log(`  [${t.idioma || '?'}] [${t.provider}] ${(t.title || '').substring(0, 90)}`);
  });

  // Palavras mais comuns nos títulos neutros
  console.log('\n🔤 Palavras mais frequentes nos neutros:');
  const wordCount = new Map<string, number>();
  neutros.forEach(t => {
    (t.title || '').toLowerCase().split(/[\s\.\-_\[\]\(\)]+/).filter(w => w.length >= 3 && !/^\d+$/.test(w)).forEach(w => {
      wordCount.set(w, (wordCount.get(w) || 0) + 1);
    });
  });
  [...wordCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  await sequelize.close();
}

main().catch(console.error);
