#!/usr/bin/env node
/**
 * sync-strip-words.js
 * Sincroniza data/strip-words.txt → direto no Set TECHNICAL_STRIP_WORDS do código fonte.
 * Uso: node scripts/sync-strip-words.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const STRIP_FILE = path.join(ROOT, 'data', 'strip-words.txt');
const TARGET_FILE = path.join(ROOT, 'src', 'titulos', 'TechnicalWords.ts');

// 1. Lê palavras do strip-words.txt
let stripWords = [];
if (fs.existsSync(STRIP_FILE)) {
  stripWords = fs.readFileSync(STRIP_FILE, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => !l.startsWith('#')); // ignora comentários
}

// 2. Lê o arquivo fonte
let source = fs.readFileSync(TARGET_FILE, 'utf-8');

// 3. Encontra o bloco TECHNICAL_STRIP_WORDS
const startMarker = 'export const TECHNICAL_STRIP_WORDS: Set<string> = new Set([';
const endMarker = ']);';

const startIdx = source.indexOf(startMarker);
if (startIdx === -1) {
  console.error('❌ Não encontrou TECHNICAL_STRIP_WORDS no arquivo fonte');
  process.exit(1);
}

const afterStart = source.indexOf('\n', startIdx) + 1;
const endIdx = source.indexOf(endMarker, startIdx);

if (endIdx === -1) {
  console.error('❌ Não encontrou fechamento ]); do TECHNICAL_STRIP_WORDS');
  process.exit(1);
}

// 4. Extrai palavras hardcoded existentes
const blockContent = source.substring(afterStart, endIdx);
const existingWords = new Set(
  blockContent
    .replace(/\/\/.*/g, '')  // remove comentários inline
    .match(/'([^']+)'/g)
    ?.map(m => m.slice(1, -1)) || []
);

// 5. Adiciona palavras do strip-words.txt (novas)
const newWords = [];
for (const w of stripWords) {
  if (!existingWords.has(w)) {
    existingWords.add(w);
    newWords.push(w);
  }
}

// 6. Formata o bloco com 6 palavras por linha
const sorted = [...existingWords].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
const lines = [];
let currentLine = [];
for (const w of sorted) {
  const escaped = w.includes("'") ? `"${w}"` : `'${w}'`;
  currentLine.push(escaped);
  if (currentLine.length >= 6) {
    lines.push('  ' + currentLine.join(', ') + ',');
    currentLine = [];
  }
}
if (currentLine.length > 0) {
  lines.push('  ' + currentLine.join(', ') + ',');
}

const newBlock = `${startMarker}\n${lines.join('\n')}\n]);`;

// 7. Substitui no arquivo fonte
const before = source.substring(0, startIdx);
const after = source.substring(endIdx + endMarker.length);
source = before + newBlock + after;

// 8. Escreve
fs.writeFileSync(TARGET_FILE, source, 'utf-8');

console.log(`✅ Sincronizado!`);
console.log(`   Hardcoded: ${existingWords.size - newWords.length} palavras originais`);
console.log(`   Strip.txt: ${stripWords.length} palavras no arquivo`);
console.log(`   Novas injetadas: ${newWords.length} palavras`);
console.log(`   Total no Set: ${existingWords.size} palavras`);
if (newWords.length > 0) {
  console.log(`   Novas: ${newWords.join(', ')}`);
}

// 9. Limpa o strip-words.txt — palavras já estão no código
fs.writeFileSync(STRIP_FILE, '# Strip Words auto-aprendidas — 1 palavra por linha\n', 'utf-8');
console.log(`   🧹 strip-words.txt limpo — pronto para novas palavras do auto-learner`);
