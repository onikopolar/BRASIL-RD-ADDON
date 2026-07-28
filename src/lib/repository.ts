import { Torrent } from '../database/models.js';

export { Torrent };

export function getTorrent(infoHash: string) {
  return Torrent.findOne({ where: { infoHash } });
}

export async function createTorrent(torrentData: any) {
  return Torrent.create(torrentData);
}

export async function upsertTorrent(infoHash: string, data: any) {
  const [torrent] = await Torrent.upsert({ infoHash, ...data });
  return torrent;
}

export async function syncDatabase() {
  await Torrent.sync();
  console.log('Banco de dados sincronizado!');
}