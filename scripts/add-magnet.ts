#!/usr/bin/env ts-node
/**
 * Curadoria pessoal — baixa magnet no Torbox e salva no banco.
 * Sem validação de similaridade: o usuário fornece IMDb ID e título.
 * Uso: npm run addmagnet
 */

import 'dotenv/config';
import { ImdbScraperService } from '../src/catalogo/ImdbScraperService.js';
import { QualityDetector } from '../src/lib/qualityDetector.js';
import { Logger } from '../src/utils/logger.js';
import { analisarMagnet } from '../src/magnet/magnetHelper.js';
import { getTorrent, createTorrent, upsertTorrent } from '../src/lib/repository.js';
import { TorboxService } from '../src/debrid/RealDebridService.js';
import * as readline from 'readline';

const imdbScraper = ImdbScraperService.getInstance();
const qualityDetector = QualityDetector.getInstance();
const torboxService = TorboxService.getInstance();

async function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('=== BRASIL RD -- CURADORIA (SEM VALIDAÇÃO) ===');
  console.log('O título e IMDb ID são fornecidos manualmente.\n');

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
  let tmdbTitles = { portugueseTitle: '', originalTitle: '' };
  try {
    const tmdb = await imdbScraper.getTitlesFromImdbId(imdbId);
    tmdbTitles = { portugueseTitle: tmdb.portugueseTitle || '', originalTitle: tmdb.originalTitle };
    console.log(`   PT: ${tmdb.portugueseTitle || 'N/A'} | EN: ${tmdb.originalTitle}`);
    console.log(`   Ano: ${tmdb.year || '?'} | Tipo: ${tmdb.mediaType || '?'}`);
  } catch { console.log('   [AVISO] TMDB falhou.'); }

  const tipo = (await question(rl, 'Tipo (movie/series) [movie]: ')) === 'series' ? 'series' : 'movie';
  let season: number | null = null;

  if (tipo === 'series') {
    const seasonStr = await question(rl, 'Temporada (1, 2, 3...): ');
    season = seasonStr ? parseInt(seasonStr) : null;
  }

  const qualidade = await question(rl, 'Qualidade [HD]: ') || 'HD';
  const idioma = await question(rl, 'Idioma [pt-BR]: ') || 'pt-BR';

  console.log('\n=== TORBOX: Baixando e ativando AirLock ===');

  const curatorKey = process.env.TORBOX_CURATOR_API_KEY;
  if (!curatorKey || curatorKey.length < 10) {
    console.log('[ERRO] TORBOX_CURATOR_API_KEY nao configurada no .env');
    rl.close();
    return;
  }

  const is4k = qualidade.toLowerCase().includes('2160p') || qualidade.toLowerCase().includes('4k');

  console.log('Adicionando magnet ao Torbox...');
  let torrentId: string;
  try {
    torrentId = await torboxService.addMagnet(magnet, curatorKey);
    console.log(`   Torrent ID: ${torrentId}`);
  } catch (e) {
    console.log('[ERRO] Falha ao adicionar magnet:', (e as Error).message);
    rl.close();
    return;
  }

  console.log('\nAguardando download...');
  let lastProgress = -1;
  let downloadDone = false;
  const startTime = Date.now();
  const MAX_WAIT_MS = 30 * 60 * 1000;

  while (!downloadDone) {
    if (Date.now() - startTime > MAX_WAIT_MS) {
      console.log('\n[ERRO] Timeout — download demorou mais de 30 minutos.');
      rl.close();
      return;
    }

    try {
      const info = await torboxService.getTorrentInfo(torrentId, curatorKey);
      const progress = info.progress || 0;
      const pct = Math.round(progress * 100);
      const state = info.download_state || 'unknown';

      if (pct !== lastProgress) {
        const filled = Math.floor(pct / 5);
        const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
        process.stdout.write(`\r   [${bar}] ${pct}% | ${state}   `);
        lastProgress = pct;
      }

      if (pct >= 100 || state === 'completed' || state === 'uploading' || state === 'cached') {
        downloadDone = true;
      }
    } catch { }

    if (!downloadDone) await new Promise(r => setTimeout(r, 5000));
  }

  console.log('\n   ✅ Download concluído!');

  console.log('\nAtivando AirLock...');
  try {
    await torboxService.airlockTorrent(torrentId, curatorKey, !is4k);
    console.log(`   AirLock: ${is4k ? 'DESATIVADO (4K)' : 'ATIVADO'} ✅`);
  } catch (e) {
    console.log('[ERRO] AirLock falhou:', (e as Error).message);
    console.log('Torrent NAO salvo no banco — corrija o erro e tente novamente.');
    rl.close();
    return;
  }

  console.log('\nSalvando no banco...');

  if (!infoHash) {
    console.log('[ERRO] InfoHash inválido.');
    rl.close();
    return;
  }

  const existente = await getTorrent(infoHash);
  if (existente) {
    // Atualiza o registro existente adicionando o novo imdbId à lista
    const imdbIdsAtuais: string[] = existente.imdbIds || [];
    if (existente.imdbId && !imdbIdsAtuais.includes(existente.imdbId)) {
      imdbIdsAtuais.unshift(existente.imdbId); // mantém o original se não estiver
    }
    if (!imdbIdsAtuais.includes(imdbId)) {
      imdbIdsAtuais.push(imdbId);
    }

    await upsertTorrent(infoHash, {
      imdbIds: imdbIdsAtuais,
      lastSeen: new Date(),
      qualidade,
      idioma,
    });

    console.log(`[ATUALIZADO] IMDb ${imdbId} adicionado ao registro existente.`);
  } else {
    // Cria novo registro com imdbIds inicial
    const novoRegistro: any = {
      infoHash,
      provider: 'Curadoria',
      title: dn,
      size: 0,
      type: tipo,
      imdbId,
      imdbIds: [imdbId],
      imdbSeason: season ?? undefined,
      // imdbEpisodeStart e imdbEpisodeEnd serão omitidos se undefined
      seeders: 50,
      idioma,
      qualidade,
      uploadDate: new Date(),
      lastSeen: new Date(),
    };

    // Remove propriedades com valor undefined para evitar conflitos com o Sequelize
    if (novoRegistro.imdbSeason === undefined) delete novoRegistro.imdbSeason;
    // Não inclui imdbEpisodeStart/End pois não se aplica (curadoria não lida com episódios específicos)

    await createTorrent(novoRegistro);

    console.log(`\nPRONTO! ${dn.substring(0, 70)}`);
  }

  rl.close();
}

main().catch(console.error);