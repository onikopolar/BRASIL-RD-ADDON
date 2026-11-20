#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'fs';

const [nome, acao] = process.argv.slice(2);

if (!nome || !['on', 'off'].includes(acao)) {
  console.error('Uso: node scraper-ligar-desligar.mjs <nome> <on|off>');
  console.error('Nomes válidos: hdr, starck, bludv, wordpress');
  process.exit(1);
}

const VALIDOS = ['hdr', 'starck', 'bludv', 'wordpress'];
const chave = nome.toLowerCase();

if (!VALIDOS.includes(chave)) {
  console.error(`Scraper inválido: "${nome}". Válidos: ${VALIDOS.join(', ')}`);
  process.exit(1);
}

const path = 'scrapers-state.json';
const estado = existsSync(path)
  ? JSON.parse(readFileSync(path, 'utf8'))
  : { hdr: true, starck: true, bludv: true, wordpress: true };

estado[chave] = acao === 'on';
writeFileSync(path, JSON.stringify(estado, null, 2) + '\n');

console.log(`${chave} → ${acao}`);
console.log('scrapers-state.json atualizado:');
console.log(JSON.stringify(estado, null, 2));
