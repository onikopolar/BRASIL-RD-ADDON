/**
 * Script de teste: POO generico para matching de episodio via TechnicalWords
 * 
 * Conceito: em vez de regex frageis + hacks de path,
 * usa TechnicalWords pra limpar ruido e valida com boolean &&
 * 
 * Fluxo: stripNoise() -> extractNumbers() -> validate(targetS, targetE)
 * Sem depender de split('/'), sem regex SxxExx hardcoded
 */

// Palavras que sao RUIDO - devem ser removidas pra extrair episodio
var NOISE_WORDS = new Set([
  'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv', 'rmvb', 'ts', 'm4v',
  '720p', '1080p', '2160p', '4k', 'hd', 'fullhd', 'uhd', 'sd', 'fhd', 'hdr',
  '480p', '576p', '360p', '240p', '144p', '8k', '2k',
  'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx', 'vp9', 'av1',
  'ac3', 'dts', 'aac', 'dd5.1', 'dolby', 'atmos', 'truehd', 'dts-hd', 'dtshd',
  'mp3', 'ogg', 'opus', 'flac', 'alac', 'wav', 'pcm', 'wma', 'vorbis', 'eac3',
  '2.0', '5.1', '7.1', '5.1ch', '7.1ch', '2ch', 'stereo', 'mono', 'surround', '6ch', '8ch',
  'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv', 'web', 'dl', 'rip',
  'amzn', 'nf', 'hulu', 'dsnp', 'atvp', 'hmax', 'netflix', 'amazon',
  'dual', 'dublado', 'dublada', 'dublagem', 'legendado', 'legendada',
  'audio', 'sub', 'subtitle', 'dub', 'dubbed',
  'bludv', 'comando', 'cmdtv', 'yts', 'yify', 'rarbg', 'ettv', 'eztv',
  'baixar', 'download', 'torrent',
  'repack', 'proper', 'extended', 'complete', 'pack', 'hdr-u',
  'pt-br', 'ptbr', 'eng', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru',
  'url',
]);

function arquivoPertenceAoEpisodio(fullPath, targetSeason, targetEpisode) {
  // Passo 1: Normalizar e tokenizar
  var lower = fullPath.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Tokenizar por espaco E por ponto
  var spaceTokens = lower.split(' ');
  var allTokens = new Set();
  spaceTokens.forEach(function(t) {
    allTokens.add(t);
    t.split('.').forEach(function(sub) { allTokens.add(sub); });
  });

  // Passo 2: Filtrar ruido, mas PRESERVAR tokens com SxxExx e numeros puros 1-2 digitos
  var signalTokens = [];
  allTokens.forEach(function(t) {
    if (/^s\d+e\d+/i.test(t)) { signalTokens.push(t); return; }
    if (/^\d+x\d+$/.test(t)) { signalTokens.push(t); return; }
    if (/^\d{1,2}$/.test(t)) { signalTokens.push(t); return; }
    if (!NOISE_WORDS.has(t)) { signalTokens.push(t); }
  });

  var signal = signalTokens.join(' ');

  // Passo 3: Encontrar o ULTIMO SxxExx no sinal (evita contaminacao do prefixo da pasta)
  var sxeMatches = signal.match(/s(\d+)e(\d+)/gi);
  
  if (!sxeMatches || sxeMatches.length === 0) {
    // Fallback: extrai do sinal formato NxNN
    var nxMatches = signal.match(/(\d+)x(\d+)/gi);
    if (nxMatches && nxMatches.length > 0) {
      sxeMatches = [nxMatches[nxMatches.length - 1]];
    }
  }

  // Extrai season/episode ESTRUTURADO do ultimo match (nao flat set)
  var extractedSeason = 0;
  var extractedEpisode = 0;
  
  if (sxeMatches && sxeMatches.length > 0) {
    var lastMatch = sxeMatches[sxeMatches.length - 1];
    var seMatch = lastMatch.match(/s?(\d+)[xe](\d+)/i);
    if (seMatch) {
      extractedSeason = parseInt(seMatch[1]);
      extractedEpisode = parseInt(seMatch[2]);
    }
  }
  
  // Monta flat set pra log, mas validacao usa o par estruturado
  var numeros = extractedSeason > 0 ? [extractedSeason, extractedEpisode] : [];
  var unique = [];
  numeros.forEach(function(n) { if (unique.indexOf(n) === -1) unique.push(n); });

  // Passo 4: Validar com && (agora com par estruturado!)
  var match = extractedSeason === targetSeason && extractedEpisode === targetEpisode;

  return { match: match, numeros: unique, sinal: signal.substring(0, 120) };
}

// ─── TESTES COM DADOS REAIS DO TORBOX ───

// Dados REAIS da API Torbox (torrent_id=64333884)
var torboxFiles = [
  'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/BAIXAR OUTRAS SERIES.url',
  'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/Comando.LA.url',
  'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01.1080p.WEB-DL.DUAL.5.1.mkv',
  'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E02.1080p.WEB-DL.DUAL.5.1.mkv',
  'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E03.1080p.WEB-DL.DUAL.5.1.mkv',
  'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/TorrentDosFilmes.SE.url',
];

// Verifica se arquivo eh video (extensao conhecida)
function isVideoFile(path) {
  return /\.(mkv|mp4|avi|webm|mov|wmv|flv|ts|m4v)$/i.test(path);
}

console.log('='.repeat(70));
console.log('TESTE: POO Generico com DADOS REAIS do Torbox (S02E01-02-03)');
console.log('='.repeat(70));

var totalTests = 0;
var pass = 0, fail = 0;

torboxFiles.forEach(function(filePath) {
  var isVideo = isVideoFile(filePath);
  var shortName = filePath.split('/').pop();
  
  console.log('\n--- ' + (isVideo ? 'VIDEO' : 'NAO-VIDEO') + ': ' + shortName.substring(0, 70));

  // Testa contra os 3 episodios
  [1, 2, 3].forEach(function(ep) {
    var result = arquivoPertenceAoEpisodio(filePath, 2, ep);
    
    // Esperado: video S02E0X soh match com target ep=X, .url nunca match
    var expected = false;
    if (isVideo) {
      var fileEp = shortName.match(/s02e0(\d)/i);
      expected = fileEp && parseInt(fileEp[1]) === ep;
    }
    
    var ok = result.match === expected;
    var icon = ok ? 'OK' : 'FAIL';
    
    console.log('  ' + icon + ' target S2E' + ep + ' -> ' + (result.match ? 'ACEITO' : 'REJEITADO') +
      ' (esperado: ' + (expected ? 'ACEITAR' : 'REJEITAR') + ')' +
      ' | nums:[' + result.numeros.join(',') + ']');
    
    totalTests++;
    if (ok) pass++; else fail++;
  });
});

console.log('\n' + '='.repeat(70));
console.log('RESULTADO: ' + pass + '/' + totalTests + ' pass (' + fail + ' fail)');
if (fail === 0) console.log('TODOS OS TESTES PASSARAM!');
console.log('='.repeat(70));
