#!/usr/bin/env ts-node
/**
 * Curadoria pessoal — adiciona magnet no Torbox e salva no banco imediatamente.
 * Sem validação de similaridade: o usuário fornece IMDb ID e título.
 * Não espera o download concluir — o Torbox gerencia internamente.
 * Uso: npm run add-magnet
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

  console.log('\n=== TORBOX: Adicionando e ativando AirLock ===');

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

  // AirLock é independente do estado do download — pode ativar agora.
  console.log('\nAtivando AirLock...');
  try {
    await torboxService.airlockTorrent(torrentId, curatorKey, !is4k);
    console.log(`   AirLock: ${is4k ? 'DESATIVADO (4K)' : 'ATIVADO'} ✅`);
  } catch (e) {
    console.log('[AVISO] AirLock falhou:', (e as Error).message);
    console.log('   Continuando — o torrent ainda pode ser salvo no banco.');
  }

  // Salva no banco imediatamente. Não espera o Torbox terminar de baixar.
  // O ResolveRoutes já lida com download_state 'metaDL'/'downloading' devolvendo
  // o vídeo de status pro usuário. Quando o Torbox completar, o stream funciona.
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
      seeders: 50,
      idioma,
      qualidade,
      uploadDate: new Date(),
      lastSeen: new Date(),
    };

    if (novoRegistro.imdbSeason === undefined) delete novoRegistro.imdbSeason;

    await createTorrent(novoRegistro);

    console.log(`\n✅ PRONTO! ${dn.substring(0, 70)}`);
    console.log(`   Torrent salvo. O Torbox vai baixar em background.`);
  }

  rl.close();
}

main().catch(console.error);