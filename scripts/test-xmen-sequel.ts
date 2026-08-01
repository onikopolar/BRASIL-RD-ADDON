/**
 * Testa getPotentialSequelNumbers e validarSequencia para X-Men '97
 * Uso: npx tsx scripts/test-xmen-sequel.ts
 */

import { getPotentialSequelNumbers, extrairRangeEpisodios, normalizarTituloTorrent } from '../src/titulos/TechnicalWords.js';

const tmdbTitles = [
  "X-Men '97",           // TMDB oficial
];

const torrents = [
  "X-Men '97 S01E07 2024 WEB-DL 1080p x264 DUAL 5.1",
  "X-Men.97.S01E07.1080p.WEB-DL.DUAL.5.1",
  "The.Gifted.S01E07.REPACK.720p.WEB.DUAL.comando1.com",
];

console.log('═'.repeat(70));
console.log('🔬 TESTE: getPotentialSequelNumbers — X-Men \'97');
console.log('═'.repeat(70));

// 1. O que o TMDB retorna como números de sequência?
console.log('\n📋 TMDB titles:');
for (const t of tmdbTitles) {
  const nums = getPotentialSequelNumbers(t);
  const normalized = normalizarTituloTorrent(t);
  console.log(`   "${t}"`);
  console.log(`      → normalized: "${normalized}"`);
  console.log(`      → sequel numbers: [${nums.join(', ')}]`);
}

// 2. O que cada torrent extrai?
console.log('\n📥 TORRENTS:');
for (const torrent of torrents) {
  console.log(`\n   "${torrent}"`);
  
  const nums = getPotentialSequelNumbers(torrent);
  const epRange = extrairRangeEpisodios(torrent);
  const yearMatch = torrent.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  
  console.log(`      → sequel numbers (brutos): [${nums.join(', ')}]`);
  console.log(`      → episode range: ${epRange ? `S${epRange.season}E${epRange.episodeStart}-${epRange.episodeEnd}` : 'nenhum'}`);
  console.log(`      → year detected: ${year}`);
  
  // Filtra ano (igual ao validarSequencia)
  const suspeitos = nums.filter(n => n !== year);
  console.log(`      → após filtrar ano(${year}): [${suspeitos.join(', ')}]`);
  
  // Filtra range de episódios
  const numsForaRange = suspeitos.filter(n => {
    if (epRange === null) return true;
    return n < epRange.episodeStart || n > epRange.episodeEnd;
  });
  console.log(`      → fora do range S01E07: [${numsForaRange.join(', ')}]`);
  
  // Verifica se estão nos títulos TMDB
  for (const num of numsForaRange) {
    let encontrado = false;
    for (const tv of tmdbTitles) {
      const tokens = normalizarTituloTorrent(tv).split(' ');
      for (const tk of tokens) {
        if (tk === String(num)) { encontrado = true; break; }
      }
      if (encontrado) break;
    }
    console.log(`      → num ${num} está no TMDB? ${encontrado ? 'SIM ✅' : 'NÃO ❌ (REJEITADO!)'}`);
  }

  // Mostra TODOS os tokens extraídos (pra debug)
  const lower = torrent.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const spaceTokens = lower
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const allTokens = new Set<string>();
  for (const t of spaceTokens) {
    allTokens.add(t);
    t.split('.').forEach((sub: string) => allTokens.add(sub));
  }
  
  const pureNumbers: string[] = [];
  for (const token of allTokens) {
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 2 && n <= 19) pureNumbers.push(token);
    }
  }
  console.log(`      → números puros (2-19): [${pureNumbers.join(', ')}]`);
  
  // Mostra matches de numeral romano
  const romanMatches = torrent.match(/\b(I{1,3}|IV|VI{0,3}|IX|XI{0,3})\b/gi);
  console.log(`      → matches romanos: ${romanMatches ? '[' + romanMatches.join(', ') + ']' : 'nenhum'}`);
}

// 3. Simula o validarSequencia completo
console.log(`\n${'═'.repeat(70)}`);
console.log('🔍 SIMULAÇÃO: validarSequencia');
console.log('═'.repeat(70));

for (const torrent of torrents) {
  const anoTorrent = (() => {
    const m = torrent.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : null;
  })();
  
  const suspeitos = getPotentialSequelNumbers(torrent).filter(n => n !== anoTorrent);
  const epRange = extrairRangeEpisodios(torrent);
  const numsForaRange = suspeitos.filter(n => {
    if (epRange === null) return true;
    return n < epRange.episodeStart || n > epRange.episodeEnd;
  });
  
  console.log(`\n   "${torrent.substring(0, 60)}..."`);
  console.log(`      numsForaRange: [${numsForaRange.join(', ')}]`);
  
  let rejeitado = false;
  for (const num of numsForaRange) {
    let encontrado = false;
    for (const tv of tmdbTitles) {
      const tokens = normalizarTituloTorrent(tv).split(' ').filter(w => w.length > 0);
      for (const tk of tokens) {
        if (tk === String(num)) { encontrado = true; break; }
      }
      if (encontrado) break;
    }
    if (!encontrado) {
      console.log(`      ❌ REJEITADO: num ${num} não está nos títulos TMDB`);
      rejeitado = true;
    }
  }
  if (!rejeitado) {
    console.log(`      ✅ APROVADO pela condição D`);
  }
}

// 4. Edge cases: numerais romanos REAIS devem continuar funcionando
console.log(`\n${'═'.repeat(70)}`);
console.log('🧪 EDGE CASES: Numerais romanos reais');
console.log('═'.repeat(70));

const romanEdgeCases = [
  'Rocky II 1979 1080p',
  'Star Wars Episode V 1980',
  'Rambo III 1988 720p',
  'Star Wars Episode VI Return of the Jedi',
  'Rocky IV 1985',
  'X-Men 97 S01E07',           // NÃO deve extrair 10
  'X-Men Origins Wolverine',   // NÃO deve extrair 10
  'Fast X 2023',               // "X" standalone → 10
  'Saw X 2023',                // "X" standalone → 10
];

for (const t of romanEdgeCases) {
  const nums = getPotentialSequelNumbers(t);
  const emoji = t.includes('X-Men') ? (nums.includes(10) ? '❌' : '✅') : (nums.length > 0 ? '✅' : '⚠️');
  console.log(`   ${emoji} "${t}"`.padEnd(60) + ` → [${nums.join(', ') || 'vazio'}]`);
}

// 5. Verifica Romulus vs Aliens: DEVE continuar rejeitando
console.log(`\n${'═'.repeat(70)}`);
console.log('👽 ROMULUS vs ALIENS: Deve continuar REJEITANDO (filme diferente)');
console.log('═'.repeat(70));

const aliensTmdb = ["Aliens", "Aliens: O Resgate"];
const romulusTorrents = [
  'Alien - Romulus 2024 WEB-DL 1080p x264 DUAL 5.1',
  'Alien.Romulus.2024.2160p.WEB-DL.DV.HDR10.PLUS.ENG.LATINO.DDP5.1.Atmos.H265',
];

for (const torrent of romulusTorrents) {
  const norm = normalizarTituloTorrent(torrent);
  const palavrasTorrent = norm.split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));
  
  console.log(`\n   "${torrent.substring(0, 70)}..."`);
  console.log(`      normalizado: "${norm}"`);
  
  for (const tmdb of aliensTmdb) {
    const tmdbWords = normalizarTituloTorrent(tmdb).split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w));
    const encontradas = tmdbWords.filter(w => palavrasTorrent.includes(w));
    const faltando = tmdbWords.filter(w => !palavrasTorrent.includes(w));
    const status = faltando.length === 0 ? '⚠️  MATCH (falso positivo!)' : '✅ NO MATCH (correto)';
    console.log(`      vs "${tmdb}": ${status} | enc=[${encontradas.join(',')}] falt=[${faltando.join(',')}]`);
  }
}
