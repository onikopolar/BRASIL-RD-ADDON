// scripts/debugMagnets.ts
// Executar com: npx tsx scripts/debugMagnets.ts <arquivo.json>

import { analisarMagnet } from '../src/magnet/magnetHelper.js';
import fs from 'fs';

function extractDnFromMagnet(magnet: string): string | null {
  const match = magnet.match(/[&?]dn=([^&]+)/i);
  if (match) {
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch {
      return match[1];
    }
  }
  return null;
}

function normalize(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countOverlap(str1: string, str2: string): number {
  const words1 = new Set(normalize(str1).split(' ').filter(w => w.length > 1));
  const words2 = normalize(str2).split(' ').filter(w => w.length > 1);
  return words2.filter(w => words1.has(w)).length;
}

async function analyzeMagnet(item: { magnet: string; originalTitle?: string; provider?: string }) {
  const { magnet, originalTitle, provider } = item;
  console.log('\n' + '='.repeat(80));
  console.log(`Provider: ${provider || 'desconhecido'}`);
  console.log(`Original Title: ${originalTitle || 'N/A'}`);

  // Extração manual
  const manualDn = extractDnFromMagnet(magnet);
  console.log(`DN (manual): ${manualDn || 'N/A'}`);

  // Extração via parse-torrent
  let parsedName: string | null = null;
  try {
    const parsed = await analisarMagnet(magnet);
    parsedName = parsed?.nome || null;
    console.log(`DN (parser): ${parsedName || 'N/A'}`);
    if (parsed?.infoHash) console.log(`InfoHash: ${parsed.infoHash}`);
  } catch (err: any) {
    console.log(`Erro no parse: ${err.message}`);
  }

  // Parâmetros do magnet
  const params: Record<string, string> = {};
  const urlParams = new URLSearchParams(magnet.replace(/^magnet:\?/, ''));
  for (const [key, value] of urlParams.entries()) {
    params[key] = value.length > 100 ? value.substring(0, 100) + '...' : value;
  }
  console.log('Parâmetros:', JSON.stringify(params, null, 2));

  // Overlap entre originalTitle e os nomes
  if (originalTitle) {
    const overlapManual = manualDn ? countOverlap(originalTitle, manualDn) : 0;
    const overlapParsed = parsedName ? countOverlap(originalTitle, parsedName) : 0;
    console.log(`Overlap (originalTitle vs manualDn): ${overlapManual} palavras`);
    console.log(`Overlap (originalTitle vs parsedName): ${overlapParsed} palavras`);

    if (overlapManual === 0 && overlapParsed === 0) {
      console.warn('⚠️ ALERTA: NENHUMA palavra em comum entre título original e nome do magnet!');
    }
  }

  // Consistência entre manual e parser
  if (manualDn && parsedName && manualDn !== parsedName) {
    console.warn(`⚠️ DISCREPÂNCIA: DN manual ("${manualDn}") ≠ parser ("${parsedName}")`);
  }
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Informe o caminho para um arquivo JSON contendo um array de objetos { magnet, originalTitle?, provider? }');
    process.exit(1);
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  let items;
  try {
    items = JSON.parse(raw);
  } catch {
    console.error('Arquivo JSON inválido.');
    process.exit(1);
  }

  if (!Array.isArray(items)) {
    console.error('O JSON deve ser um array de objetos.');
    process.exit(1);
  }

  console.log(`Analisando ${items.length} magnets...`);
  for (const item of items) {
    await analyzeMagnet(item);
  }
  console.log('\nAnálise concluída.');
}

main().catch(err => console.error(err));