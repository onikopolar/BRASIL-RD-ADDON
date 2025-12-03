const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/lib/episodeMatcher.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Corrigir a lógica de verificação dos padrões
const oldLogic = `        if (pattern.source.includes('x') || pattern.source.includes('s\\\\d+e')) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          episode = parseInt(match[1]);
        } else if (pattern.source === '^(\\\\d+)$') {
          episode = parseInt(match[1]);
        } else if (match.length >= 3) {
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }`;

const newLogic = `        // Determinar qual padrão foi encontrado baseado nos grupos
        if (pattern.source === '(\\\\d+)x(\\\\d+)') {
          // Formato 1x01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source === 's(\\\\d+)e(\\\\d+)') {
          // Formato S01E01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('season') && pattern.source.includes('episode')) {
          // Formato Season X Episode Y
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          // Formato Ep XX
          episode = parseInt(match[1]);
        } else if (pattern.source === '^(\\\\d+)$') {
          // Apenas número
          episode = parseInt(match[1]);
        } else if (match.length >= 3) {
          // Outros padrões com dois grupos
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        }`;

content = content.replace(oldLogic, newLogic);

fs.writeFileSync(filePath, content, 'utf8');
console.log('episodeMatcher.ts corrigido!');
