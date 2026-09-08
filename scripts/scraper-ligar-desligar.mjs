import { readFileSync, writeFileSync, existsSync } from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'scrapers-state.json');

function carregarEstado() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function salvarEstado(estado) {
  writeFileSync(STATE_FILE, JSON.stringify(estado, null, 2));
}

const [nomeScraper, acao] = process.argv.slice(2);

if (!nomeScraper || !acao) {
  console.log('Uso: node scraper-ligar-desligar.mjs <nome-do-scraper> <on|off>');
  console.log('Exemplo: node scraper-ligar-desligar.mjs hdr off');
  process.exit(1);
}

const estado = carregarEstado();
const ativo = ['on', 'ligar'].includes(acao.toLowerCase());

estado[nomeScraper.toLowerCase()] = ativo;
salvarEstado(estado);

console.log(`Scraper "${nomeScraper}" ${ativo ? 'LIGADO' : 'DESLIGADO'} com sucesso.`);