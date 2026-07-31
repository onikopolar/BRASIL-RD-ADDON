#!/usr/bin/env ts-node
/**
 * Curadoria pessoal — salva DIRETO no banco, sem validacao.
 * Uso: npm run addmagnet
 */

import 'dotenv/config';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';
import { QualityDetector } from '../src/lib/qualityDetector.js';
import { Logger } from '../src/utils/logger.js';
import { analisarMagnet } from '../src/magnet/magnetHelper.js';
import { getTorrent, createTorrent } from '../src/lib/repository.js';
import { extrairRangeEpisodios } from '../src/titulos/TechnicalWords.js';
import { TorboxService } from '../src/debrid/RealDebridService.js';
import * as readline from 'readline';

const imdbScraper = ImdbScraperService.getInstance();
const qualityDetector = QualityDetector.getInstance();
const torboxService = new TorboxService();

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== BRASIL RD -- CURADORIA (MODO DIRETO) ===');
  console.log('Validacao e idioma IGNORADOS — confia no curador.\n');

  const magnet = await question(rl, 'Magnet: ');
  if (!magnet.startsWith('magnet:') || !magnet.includes('xt=urn:btih:')) {
    console.log('[ERRO] Magnet invalido.'); rl.close(); return;
  }

  const dados = await analisarMagnet(magnet);
  const dn = dados?.nome || 'Desconhecido';
  const infoHash = dados?.infoHash;
  console.log(`\nTitulo (dn): ${dn}`);

  const imdbId = await question(rl, 'IMDb ID (ex: tt1234567): ');
  if (!imdbId.startsWith('tt')) { console.log('[ERRO] IMDb invalido.'); rl.close(); return; }

  console.log('\nBuscando TMDB...');
  try {
    const tmdb = await imdbScraper.getTitlesFromImdbId(imdbId);
    console.log(`   PT: ${tmdb.portugueseTitle || 'N/A'} | EN: ${tmdb.originalTitle}`);
    console.log(`   Ano: ${tmdb.year || '?'} | Tipo: ${tmdb.mediaType || '?'}`);
  } catch { console.log('   [AVISO] TMDB falhou.'); }

  const tipo = (await question(rl, 'Tipo (movie/series) [movie]: ')) === 'series' ? 'series' : 'movie';
  const seasonStr = tipo === 'series' ? await question(rl, 'Temporada [Enter=pular]: ') : '';
  const season = seasonStr ? parseInt(seasonStr) : null;
  const qualidade = qualityDetector.extractBestQuality(dn) || await question(rl, 'Qualidade [HD]: ') || 'HD';
  const idioma = await question(rl, 'Idioma [pt-BR]: ') || 'pt-BR';

  console.log('\nSalvando direto no banco...');

  if (infoHash) {
    const existe = await getTorrent(infoHash);
    if (existe) { console.log('[AVISO] Ja existe no banco.'); rl.close(); return; }
  }

  const epRange = extrairRangeEpisodios(dn);
  await createTorrent({
    infoHash: infoHash || 'manual-' + Date.now(),
    provider: 'Curadoria', title: dn, size: 0, type: tipo,
    imdbId, imdbSeason: season,
    imdbEpisodeStart: epRange?.episodeStart ?? null,
    imdbEpisodeEnd: epRange?.episodeEnd ?? null,
    seeders: 50, idioma, qualidade,
    uploadDate: new Date(), lastSeen: new Date(),
  });

  console.log(`DB SALVO! ${dn.substring(0, 70)}`);

  // AirLock: adiciona na conta do curador e marca como permanente
  const curatorKey = process.env.TORBOX_CURATOR_API_KEY;
  if (curatorKey && curatorKey.length > 10) {
    try {
      console.log('\nAtivando AirLock na conta do curador...');
      const is4k = qualidade.toLowerCase().includes('2160p') || qualidade.toLowerCase().includes('4k');
      const torrentId = await torboxService.addMagnet(magnet, curatorKey);
      await torboxService.airlockTorrent(torrentId, curatorKey, !is4k);
      console.log(`AirLock: ${is4k ? 'DESATIVADO (4K)' : 'ATIVADO'} | Torrent ID: ${torrentId}`);
    } catch (e) {
      console.log('[AVISO] AirLock falhou:', (e as Error).message);
    }
  }

  console.log(`\nPRONTO! ${dn.substring(0, 70)}`);
  rl.close();
}

main().catch(console.error);
