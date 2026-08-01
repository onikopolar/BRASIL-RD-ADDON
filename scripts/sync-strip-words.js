// Sincroniza data/strip-words.txt → TECHNICAL_STRIP_WORDS no TypeScript
// Uso: node scripts/sync-strip-words.js

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TXT_FILE = path.join(ROOT, 'data', 'strip-words.txt');
const TS_FILE = path.join(ROOT, 'src', 'titulos', 'TechnicalWords.ts');

// 1. Lê palavras aprendidas
if (!fs.existsSync(TXT_FILE)) {
  console.log('Nada a sincronizar — data/strip-words.txt não existe.');
  process.exit(0);
}

const learned = fs.readFileSync(TXT_FILE, 'utf-8')
  .split('\n')
  .map(l => l.trim())
  .filter(Boolean);

console.log(`📖 ${learned.length} palavras em data/strip-words.txt`);

// 2. Lê o TS source
let source = fs.readFileSync(TS_FILE, 'utf-8');

// 3. Encontra palavras já no TECHNICAL_STRIP_WORDS
const existingMatch = source.match(/const TECHNICAL_STRIP_WORDS = new Set\(\[([\s\S]*?)\]\)/);
const existingWords = existingMatch
  ? existingMatch[1].match(/'([^']+)'/g)?.map(s => s.replace(/'/g, '')) || []
  : [];

// 4. Filtra só as novas
const newWords = learned.filter(w => !existingWords.includes(w));

if (newWords.length === 0) {
  console.log('✅ Tudo já está sincronizado.');
  process.exit(0);
}

console.log(`🆕 ${newWords.length} palavras novas para adicionar: ${newWords.join(', ')}`);

// 5. Adiciona ao Set no TS source (6 palavras por linha)
const allWords = [...existingWords, ...newWords].sort();
const PER_LINE = 6;
const lines = [];
for (let i = 0; i < allWords.length; i += PER_LINE) {
  lines.push('  ' + allWords.slice(i, i + PER_LINE).map(w => `'${w}'`).join(', '));
}
const newSetContent = lines.join(',\n');

source = source.replace(
  /const TECHNICAL_STRIP_WORDS = new Set\(\[([\s\S]*?)\]\)/,
  `const TECHNICAL_STRIP_WORDS = new Set([\n${newSetContent}\n])`
);

fs.writeFileSync(TS_FILE, source);
console.log(`✅ ${newWords.length} palavras adicionadas ao ${TS_FILE}`);

// 6. Limpa o txt (já foram pro TS)
fs.writeFileSync(TXT_FILE, '');
console.log('🧹 data/strip-words.txt limpo. Rode npm run build para aplicar.');
