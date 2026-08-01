// Diagnóstico: por que Doctor Who S04E01 não passa no CatalogProvider?
import 'dotenv/config';
import { searchHdr } from '../src/services/scraper/hdrScraper.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';
import { TitleFilter } from '../src/titulos/titleFilter.js';

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 DIAGNÓSTICO: Doctor Who S04E01');
  console.log('═══════════════════════════════════════════\n');

  // ═══ 1. Pega os magnets do HDR ═══
  console.log('📡 Buscando HDR "doctor who"...');
  const hdrResults = await searchHdr('doctor who');
  console.log(`   Total HDR: ${hdrResults.length} magnets\n`);

  // Filtra os que parecem ser do post "todas as temporadas"
  const todasPost = hdrResults.filter(r => {
    const t = (r.magnet + r.title).toLowerCase();
    return /temporada|s\d{1,2}|doctor\.who\.\d/i.test(t) &&
           !/joy|igreja|risadinha|imensidão|14ª|inside|2023|2024/i.test(t);
  });

  console.log(`📦 Magnets do post "todas as temporadas": ${todasPost.length}\n`);

  // ═══ 2. Para cada magnet, extrai o dn e testa no PT-BR filter ═══
  console.log('🧪 PASSO 1: Filtro PT-BR (titleFilter.verificarIdiomaDetalhado)');
  console.log('═'.repeat(60));

  const titleFilter = TitleFilter.getInstance();
  const ptPass: typeof todasPost = [];
  const ptFail: typeof todasPost = [];

  for (const m of todasPost) {
    const dnMatch = m.magnet.match(/dn=([^&]+)/i);
    const canonicalName = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : m.title;
    const resultado = titleFilter.verificarIdiomaDetalhado(canonicalName);
    
    // Simula o que o CatalogProvider faz
    const isLegendado = m.language && /legendado/i.test(m.language);
    const hasPtLang = m.language && /portugu[eê]s|dual|dublado/i.test(m.language);
    const hasIntlWords = resultado.palavrasEn && resultado.palavrasEn.length > 0;

    let passaPt = false;
    let motivo = '';

    if (isLegendado) {
      motivo = 'LEGENDADO rejeitado';
    } else if (hasPtLang && !hasIntlWords) {
      passaPt = true;
      motivo = 'HTML PT-BR, sem palavras internacionais';
    } else if (hasPtLang && hasIntlWords) {
      motivo = `HTML PT-BR mas magnet tem palavras EN: [${resultado.palavrasEn?.join(', ')}]`;
    } else if (resultado.ehPortugues) {
      passaPt = true;
      motivo = 'Magnet tem indicadores PT-BR';
    } else {
      motivo = 'Sem indicadores PT-BR';
    }

    const status = passaPt ? '✅' : '❌';
    const seasonMatch = canonicalName.match(/s(\d{1,2})|(\d+)temporada|doctor\.who\.(\d)/i);
    const season = seasonMatch ? (seasonMatch[1] || seasonMatch[2] || seasonMatch[3]) : '?';
    
    console.log(`${status} [S${season}] Lang:${m.language || '?'} | ${canonicalName.substring(0, 70)}`);
    if (!passaPt) console.log(`   ↳ ${motivo}`);

    if (passaPt) ptPass.push(m);
    else ptFail.push(m);
  }

  console.log(`\n   Passaram PT-BR: ${ptPass.length} | Rejeitados: ${ptFail.length}`);

  // ═══ 3. Testa similaridade nos que passaram ═══
  console.log('\n🧪 PASSO 2: SimilarityCalculator (titulosCombinam)');
  console.log('═'.repeat(60));

  const similarity = SimilarityCalculator.getInstance();
  const simPass: typeof ptPass = [];
  const simFail: typeof ptPass = [];

  for (const m of ptPass) {
    const dnMatch = m.magnet.match(/dn=([^&]+)/i);
    const canonicalName = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : m.title;
    
    // Simula o que o CatalogProvider faz: canonicalName || title
    const tituloParaValidar = canonicalName || m.title;
    
    const resultado = await similarity.smartTitleContainsCheck(
      tituloParaValidar, 'tt0436992', { season: 4 }
    );

    const seasonMatch = tituloParaValidar.match(/s(\d{1,2})|(\d+)temporada|doctor\.who\.(\d)/i);
    const season = seasonMatch ? (seasonMatch[1] || seasonMatch[2] || seasonMatch[3]) : '?';
    
    const status = resultado.matches ? '✅' : '❌';
    console.log(`${status} [S${season}] "${tituloParaValidar.substring(0, 65)}"`);
    console.log(`   ↳ ${resultado.reason}`);
    console.log(`   mediaType: ${resultado.mediaType || '?'}`);

    if (resultado.matches) simPass.push(m);
    else simFail.push(m);
  }

  // ═══ 4. Testa com o scraper TITLE em vez do canonicalName ═══
  console.log('\n🧪 PASSO 3: Similarity com scraper TITLE (não canonicalName)');
  console.log('═'.repeat(60));

  for (const m of ptPass.slice(0, 5)) {
    const resultado = await similarity.smartTitleContainsCheck(
      m.title, 'tt0436992', { season: 4 }
    );
    const status = resultado.matches ? '✅' : '❌';
    console.log(`${status} "${m.title.substring(0, 65)}"`);
    console.log(`   ↳ ${resultado.reason}`);
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('📊 RESUMO');
  console.log(`   Total HDR: ${hdrResults.length}`);
  console.log(`   Post "todas as temporadas": ${todasPost.length}`);
  console.log(`   Passam PT-BR: ${ptPass.length}`);
  console.log(`   Passam Similarity (canonicalName): ${simPass.length}`);
  console.log(`   Falham Similarity: ${simFail.length}`);
  console.log('\n💡 CONCLUSÃO:');
  if (simFail.length > 0 && simPass.length === 0) {
    console.log('   canonicalName (dn do magnet) quebra o similarity.');
    console.log('   O title do scraper é melhor mas não está sendo usado.');
    console.log('   Solução: no CatalogProvider, usar title quando canonicalName falhar.');
  }
}

main().catch(console.error);
