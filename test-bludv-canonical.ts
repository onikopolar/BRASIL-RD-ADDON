import { analisarMagnet } from './src/magnet/magnetHelper';
import { extrairRangeEpisodios } from './src/titulos/TechnicalWords';

const magnets = [
  'magnet:?xt=urn:btih:KC5F47IN7UNLOICS7K2LRFA3CIG62YDG&dn=See%202019%20-%20S01E01-02%20(720p)%20LAPUMiA',
  'magnet:?xt=urn:btih:QI3DEUK7PN4SFRNA4F4FEHMEPX36ICN3&dn=See%202019%20-%20S01E3%20REPACK%20V2%20(720p)%20LAPUMiA',
  'magnet:?xt=urn:btih:CHSQBYGGGN26C667XF27BN32O7NIXACJ&dn=See.S01E07.720p.WEB-DL.DUAL.mkv'
];

(async () => {
  for (const magnet of magnets) {
    const dados = await analisarMagnet(magnet);
    console.log('Nome canônico:', dados?.nome);
    console.log('Range extraído:', extrairRangeEpisodios(dados?.nome || ''));
    console.log('---');
  }
})();
