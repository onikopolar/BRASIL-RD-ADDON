#!/usr/bin/env ts-node
/**
 * Curadoria pessoal — cole magnet + IMDb ID, o addon faz TODO o resto.
 * Uso: npx ts-node scripts/add-magnet.ts
 */

import 'dotenv/config';
import { AutoMagnetService } from '../src/debrid/AutoMagnetService.js';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';
import { LanguageDetector } from '../src/titulos/LanguageDetector.js';
import { QualityDetector } from '../src/lib/qualityDetector.js';
import { Logger } from '../src/utils/logger.js';
import { analisarMagnet } from '../src/magnet/magnetHelper.js';
import * as readline from 'readline';

const logger = new Logger('MagnetAdder');
const autoMagnet = new AutoMagnetService();
const imdbScraper = ImdbScraperService.getInstance();
const similarity = SimilarityCalculator.getInstance();
const langDetector = LanguageDetector.getInstance();
const qualityDetector = QualityDetector.getInstance();

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== BRASIL RD -- CURADORIA ===');
  console.log('Cole magnet + IMDb ID. O addon faz o resto.\n');

  // -- Magnet --
  const magnet = await question(rl, 'Magnet: ');
  if (!magnet.startsWith('magnet:') || !magnet.includes('xt=urn:btih:')) {
    console.log('[ERRO] Magnet invalido.'); rl.close(); return;
  }

  // -- Parse --
  const dados = await analisarMagnet(magnet);
  const dn = dados?.nome || 'Desconhecido';
  const infoHash = dados?.infoHash || 'manual-' + Date.now();
  console.log(`\nTitulo (dn): ${dn}`);

  // -- IMDb --
  let imdbId = await question(rl, 'IMDb ID (ex: tt1234567): ');
  if (!imdbId.startsWith('tt')) { console.log('[ERRO] IMDb invalido.'); rl.close(); return; }

  // -- TMDB --
  console.log('\nBuscando TMDB...');
  let titulos;
  try {
    titulos = await imdbScraper.getTitlesFromImdbId(imdbId);
    console.log(`   PT: ${titulos.portugueseTitle || 'N/A'}`);
    console.log(`   EN: ${titulos.originalTitle}`);
    console.log(`   Ano: ${titulos.year || '?'} | Tipo: ${titulos.mediaType || '?'}`);
  } catch {
    console.log('   [AVISO] TMDB falhou. Usando fallback minimo.');
    titulos = { originalTitle: dn, portugueseTitle: null, year: undefined, mediaType: 'movie', allTitles: [dn] };
  }

  // -- Idioma --
  console.log('\nIdioma...');
  const idioma = langDetector.verificarIdioma(dn);
  console.log(`   PT-BR: ${idioma.ehPortugues ? 'SIM' : 'NAO'} | ${idioma.motivo}`);

  // -- Validacao --
  console.log('\nValidacao...');
  const match = await similarity.smartTitleContainsCheck(dn, imdbId);
  console.log(`   Match: ${match.matches ? 'SIM' : 'NAO'} | ${match.reason}`);

  // -- Qualidade --
  const qualidade = qualityDetector.extractBestQuality(dn) || 'HD';
  console.log(`\nQualidade: ${qualidade}`);

  // -- Salvar --
  console.log('\nSalvando...');
  const tipo = titulos.mediaType === 'tv' ? 'series' : 'movie';
  try {
    const result = await autoMagnet.autoAddMagnet(
      magnet, dn, imdbId, tipo as 'movie' | 'series',
      50, qualidade, 'Curadoria', undefined, null,
      infoHash, 'Curadoria'
    );
    console.log(result.success ? `\nSALVO! ${dn.substring(0, 70)}` : '\n[AVISO] Ja existe no banco.');
  } catch (err) {
    console.error('[ERRO]', (err as Error).message);
  }

  rl.close();
}

main().catch(console.error);
