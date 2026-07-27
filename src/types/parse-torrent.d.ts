declare module 'parse-torrent' {
  interface DadosTorrent {
    xt?: string;
    dn?: string;
    infoHash?: string;
    infoHashBuffer?: Buffer;
    name?: string;
    announce?: string[];
    urlList?: string[];
    peerAddresses?: string[];
  }

  function parseTorrent(torrentId: string): Promise<DadosTorrent>;
  function parseTorrent(torrentId: Buffer): DadosTorrent;

  export default parseTorrent;

  export function remote(torrentId: string | Buffer): Promise<DadosTorrent>;
  export function toMagnetURI(obj: DadosTorrent): string;
  export function toTorrentFile(obj: DadosTorrent): Buffer;
}
