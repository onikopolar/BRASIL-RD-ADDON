/**
 * Script de teste para diagnosticar a normalização de títulos
 * e entender por que "Aliens: O Resgate" falhou
 * 
 * Uso: npx ts-node scripts/test-strip-normalize.ts
 */

import { normalizarTituloTorrent, isTechnicalWord, registerStripCandidate } from '../src/titulos/TechnicalWords.js';

// ═══════════════════════════════════════════════════════════════════
// Caso real: Aliens: O Resgate (tt0090605)
// ═══════════════════════════════════════════════════════════════════

const torrentTitles = [
  // ESTE deveria ter passado - é o filme correto!
  'Aliens.O.Resgate.Versão.Estendida.1986.BluRay.1080p.x264.DUAL.2.0-SF',
  // Outros que apareceram nos logs
  'Cowboys & Aliens (2011) BDRip 1080p Dublado ToTTi9 - The Pirate Filmes',
  'Aliens.O.Resgate.Versão.Estendida.1986.BluRay.1080p.x264.DUAL.2.0-SF',
  'Alien - Romulus 2024 WEB-DL 1080p x264 DUAL 5.1',
  'Matadores de Aliens do Espaço Sideral 2025 WEB-DL 1080p x264 NACIONAL',
];

// Simula TMDB titles para tt0090605 (Aliens)
const tmdbTitles = [
  'Aliens',                    // EN original
  'Aliens: O Resgate',         // PT-BR
];

console.log('═'.repeat(70));
console.log('🎬 TESTE: Normalização para "Aliens: O Resgate" (tt0090605)');
console.log('═'.repeat(70));

for (const torrentTitle of torrentTitles) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`📥 TORRENT: "${torrentTitle}"`);

  // Passo 1: Normalização completa
  const normalized = normalizarTituloTorrent(torrentTitle);
  console.log(`   🔧 Normalizado: "${normalized}"`);

  // Passo 2: Palavras após normalização (filtrando números)
  const palavrasTorrent = normalized
    .split(' ')
    .filter(w => w.length > 0 && !/^\d+$/.test(w) && !/^s\d{1,2}e\d{1,3}$/i.test(w));
  console.log(`   📝 Palavras torrent (${palavrasTorrent.length}): [${palavrasTorrent.join(', ')}]`);

  // Passo 3: Mostrar o que foi stripado (diff entre original e normalizado)
  const originalWords = torrentTitle
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  
  const stripped = originalWords.filter(w => !normalized.split(' ').includes(w));
  console.log(`   🗑️  Palavras removidas: [${stripped.join(', ')}]`);

  // Passo 4: Simular match contra TMDB
  for (const tmdbTitle of tmdbTitles) {
    const tmdbWords = normalizarTituloTorrent(tmdbTitle)
      .split(' ')
      .filter(w => w.length > 0 && !/^\d+$/.test(w));
    
    const encontradas = tmdbWords.filter(w => palavrasTorrent.includes(w));
    const faltando = tmdbWords.filter(w => !palavrasTorrent.includes(w));
    
    const status = faltando.length === 0 ? '✅ MATCH' : '❌ NO MATCH';
    console.log(`   🎯 vs TMDB "${tmdbTitle}": ${status} | encontradas=[${encontradas.join(', ')}] | faltando=[${faltando.join(', ')}]`);
  }

  // Passo 5: Verificar condition C (ambiguidade de 1 palavra)
  let minWords = 99;
  let maxWords = 0;
  for (const t of tmdbTitles) {
    const palavras = normalizarTituloTorrent(t)
      .split(' ')
      .filter(w => w.length > 0 && !/^\d+$/.test(w));
    if (palavras.length < minWords) minWords = palavras.length;
    if (palavras.length > maxWords) maxWords = palavras.length;
  }
  console.log(`   📊 TMDB: minWords=${minWords}, maxWords=${maxWords}`);

  const torrWordCount = palavrasTorrent.length;
  // Código ATUAL: só verifica minWords <= 1
  const wouldRejectCurrent = (minWords <= 1 && torrWordCount > minWords + 1);
  // Código CORRIGIDO: verifica minWords <= 1 E maxWords <= 1
  const wouldRejectFixed = (minWords <= 1 && maxWords <= 1 && torrWordCount > minWords + 1);
  
  console.log(`   🔍 Condição C (ambiguidade):`);
  console.log(`      minWords(${minWords}) <= 1? ${minWords <= 1 ? 'SIM' : 'NÃO'}`);
  console.log(`      maxWords(${maxWords}) <= 1? ${maxWords <= 1 ? 'SIM' : 'NÃO'}`);
  console.log(`      torrent(${torrWordCount}) > minWords+1(${minWords + 1})? ${torrWordCount > minWords + 1 ? 'SIM' : 'NÃO'}`);
  console.log(`      ❌ CÓDIGO ATUAL (só minWords):  ${wouldRejectCurrent ? 'REJEITARIA ⚠️' : 'OK ✅'}`);
  console.log(`      ❌ COM FIX (minWords && maxWords): ${wouldRejectFixed ? 'REJEITARIA ⚠️' : 'OK ✅'}`);
  
  if (wouldRejectCurrent && !wouldRejectFixed) {
    console.log(`      💡 FIX resolve! maxWords=${maxWords}>1 legitima o match multi-palavra`);
  }

  // Passo 6: Verificar condition F (comprimento de palavras)
  const allTmdbWords = new Set<string>();
  for (const t of tmdbTitles) {
    for (const w of normalizarTituloTorrent(t).split(' ').filter(w => w.length > 0 && !/^\d+$/.test(w))) {
      allTmdbWords.add(w);
    }
  }
  const tmdbLengths = new Set([...allTmdbWords].map(w => w.length));
  console.log(`   📏 TMDB word lengths: [${[...tmdbLengths].join(', ')}]`);

  const extras = palavrasTorrent.filter(w => !allTmdbWords.has(w) && !isTechnicalWord(w));
  console.log(`   🔤 Palavras extras (não-TMDB, não-técnicas): [${extras.join(', ')}]`);

  const extrasToCheck = extras.filter(w => w.length > 3);
  console.log(`   🔤 Extras com length>3 (avaliadas pelo F): [${extrasToCheck.join(', ')}]`);

  const anomalas: string[] = [];
  for (const w of extrasToCheck) {
    if (!tmdbLengths.has(w.length)) {
      anomalas.push(w + `(len=${w.length})`);
    }
  }
  console.log(`   ⚠️  Anômalas F (length fora do TMDB): [${anomalas.join(', ') || 'nenhuma'}]`);
}

// ═══════════════════════════════════════════════════════════════════
// Teste do AUTO-LEARNER
// ═══════════════════════════════════════════════════════════════════

console.log(`\n${'═'.repeat(70)}`);
console.log('🧠 TESTE: Auto-Learner (registerStripCandidate)');
console.log('═'.repeat(70));

// Simula palavras que o F detectaria como anômalas
const palavrasTeste = [
  'cowboys', 'totti9', 'pirate', 'matadores', 'comandotorrents', 
  'guerra', 'sideral', 'nacional', 'romulus', 'obsessao',
  'passageiro', 'casamento', 'sangrento', 'viuva',
];

console.log('\n📋 Registrando palavras de teste (precisa ≥3 IMDBs diferentes)...');
console.log('   AUTO_LEARN_THRESHOLD = 3 IMDBs diferentes\n');

for (const word of palavrasTeste) {
  // Simula 3 IMDBs diferentes
  const imdbIds = ['tt0090605', 'tt1234567', 'tt7654321'];
  for (const imdbId of imdbIds) {
    const result = registerStripCandidate(word, imdbId);
    if (result) {
      console.log(`   🚀 "${word}" atingiu threshold! TMDB reverse lookup disparado...`);
    }
  }
}

console.log('\n⚠️  Nota: O auto-learner é ASSÍNCRONO (fire-and-forget).');
console.log('   Se o TMDB_API_KEY não estiver configurado, usa HTML scraping.');
console.log('   Verifique data/strip-words.txt após execução.');
console.log('   As palavras só são salvas após o TMDB reverse lookup confirmar');
console.log('   que a palavra NÃO existe em nenhum título do TMDB.');
