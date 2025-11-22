import { Op } from 'sequelize';
import { sequelize, Torrent, File, Subtitle } from './models.js';

// Funções de query baseadas no Torrentio
export function getTorrent(infoHash: string) {
  return Torrent.findOne({ where: { infoHash } });
}

export function getFiles(infoHashes: string[]) {
  return File.findAll({ where: { infoHash: { [Op.in]: infoHashes } } });
}

export function getImdbIdMovieEntries(imdbId: string) {
  return File.findAll({
    where: {
      imdbId: { [Op.eq]: imdbId }
    },
    include: [Torrent],
    limit: 500,
    order: [
      [Torrent, 'seeders', 'DESC']
    ]
  });
}

export function getImdbIdSeriesEntries(imdbId: string, season: number, episode: number) {
  return File.findAll({
    where: {
      imdbId: { [Op.eq]: imdbId },
      imdbSeason: { [Op.eq]: season },
      imdbEpisode: { [Op.eq]: episode }
    },
    include: [Torrent],
    limit: 500,
    order: [
      [Torrent, 'seeders', 'DESC']
    ]
  });
}

export function getKitsuIdMovieEntries(kitsuId: number) {
  return File.findAll({
    where: {
      kitsuId: { [Op.eq]: kitsuId }
    },
    include: [Torrent],
    limit: 500,
    order: [
      [Torrent, 'seeders', 'DESC']
    ]
  });
}

export function getKitsuIdSeriesEntries(kitsuId: number, episode: number) {
  return File.findAll({
    where: {
      kitsuId: { [Op.eq]: kitsuId },
      kitsuEpisode: { [Op.eq]: episode }
    },
    include: [Torrent],
    limit: 500,
    order: [
      [Torrent, 'seeders', 'DESC']
    ]
  });
}

// Funções para inserir dados
export async function createTorrent(torrentData: any) {
  return Torrent.create(torrentData);
}

export async function createFile(fileData: any) {
  return File.create(fileData);
}

export async function createSubtitle(subtitleData: any) {
  return Subtitle.create(subtitleData);
}

// Função para sincronizar o banco (cria as tabelas)
export async function syncDatabase() {
  if (!sequelize) {
    console.log('Banco de dados não configurado - pulando sincronização');
    return;
  }
  
  await Torrent.sync();
  await File.sync(); 
  await Subtitle.sync();
  console.log('Banco de dados sincronizado!');
}
