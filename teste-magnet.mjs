import parseTorrent from 'parse-torrent';

const pelado   = await parseTorrent('magnet:?xt=urn:btih:TFSDGDFKBDRAJ7ZEWMPJYSIWZHXQCZ4Y');
const completo = await parseTorrent('magnet:?xt=urn:btih:46d688af0b00430c83c1c453bece063224705c8a&dn=Superman.2025.1080p.WEB-DL.DUAL.5.1');

console.log('PELADO  :', JSON.stringify(pelado, null, 2));
console.log('COMPLETO:', JSON.stringify(completo, null, 2));
