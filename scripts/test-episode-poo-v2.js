/**
 * V2: POO generico - deteccao de episodio SEM hacks de path
 * 
 * Estrategia:
 *   Primario: regex SxxExx / NxNN direto no path cru -> ultimo match
 *   Fallback: strip ruido -> procura SxxExx no sinal limpo
 *   Validacao: season === target && episode === target (&&)
 */

// ─── RUÍDO: palavras tecnicas que NAO indicam episodio ───
var NOISE = new Set([
  'mkv','mp4','avi','webm','mpg','mpeg','mov','wmv','flv','rmvb','ts','m4v','vob','ogv','3gp',
  '720p','1080p','2160p','4k','hd','fullhd','uhd','sd','fhd','hdr','dv','480p','576p','360p','240p','144p','8k','2k',
  'x264','x265','h264','h265','avc','hevc','xvid','divx','vp9','av1',
  'ac3','dts','aac','dolby','atmos','truehd','mp3','ogg','opus','flac','alac','wav','pcm','wma','vorbis','eac3',
  'web-dl','webrip','bluray','brrip','bdrip','dvdrip','hdtv','blu-ray','web','dl','rip',
  'dual','dublado','dublada','dublagem','legendado','legendada','audio','sub','subtitle','dub','dubbed',
  'bludv','comando','cmdtv','yts','yify','rarbg','ettv','eztv','rartv','skgtv',
  'repack','proper','extended','complete','pack','remux','directors','cut','remastered','uncensored','uncut','limited','special','edition',
  'amzn','nf','hulu','netflix','amazon','prime','disney','hbo','max',
  'pt-br','ptbr','eng','english','portugues','nacional','multi',
  'baixar','download','torrent','filme','serie','series','movie','show',
  'the','of','and','in','to','a','an','for','with','on','at','by','from','as','is','it','that','this',
  'or','but','not','be','are','was','were','have','has','had','do','does','did',
  'es','fr','de','it','ja','ko','zh','ru','pt','en','br',
  'url','nfo','txt','jpg','png','srt','sub','idx',
]);

// Extensoes de video
var VIDEO_EXT = /\.(mkv|mp4|avi|webm|mov|wmv|flv|ts|m4v)$/i;

// ─── FUNCAO PRINCIPAL ───

function arquivoPertenceAoEpisodio(fullPath, targetSeason, targetEpisode) {
  // So processa arquivos de video
  if (!VIDEO_EXT.test(fullPath)) {
    return { match: false, season: 0, episode: 0, metodo: 'nao-video' };
  }

  var lower = fullPath.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // ─── METODO 1: SxxExx / NxNN direto no path cru ───
  var rawMatches = lower.match(/s(\d+)[e\x](\d+)/gi);
  if (rawMatches && rawMatches.length > 0) {
    var last = rawMatches[rawMatches.length - 1];
    var p = last.match(/s?(\d+)[e\x](\d+)/i);
    var s = parseInt(p[1]), e = parseInt(p[2]);
    return {
      match: s === targetSeason && e === targetEpisode,
      season: s, episode: e,
      metodo: 'SxxExx-direto'
    };
  }

  // ─── METODO 2: NxNN (ex: 5x12) ───
  var nxMatches = lower.match(/(\d+)x(\d+)/gi);
  if (nxMatches && nxMatches.length > 0) {
    var lastNx = nxMatches[nxMatches.length - 1];
    var p2 = lastNx.match(/(\d+)x(\d+)/i);
    var s2 = parseInt(p2[1]), e2 = parseInt(p2[2]);
    return {
      match: s2 === targetSeason && e2 === targetEpisode,
      season: s2, episode: e2,
      metodo: 'NxNN-direto'
    };
  }

  // ─── METODO 3: Strip ruido e procura no sinal limpo ───
  // Normaliza e tokeniza
  var clean = lower
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  var spaceTokens = clean.split(' ');
  var allTokens = new Set();
  spaceTokens.forEach(function(t) {
    allTokens.add(t);
    t.split('.').forEach(function(sub) { allTokens.add(sub); });
  });

  // Remove ruido
  var signal = [];
  allTokens.forEach(function(t) {
    if (!NOISE.has(t)) signal.push(t);
  });

  var signalStr = signal.join(' ');

  // Procura SxxExx no sinal
  var sxeInSignal = signalStr.match(/s(\d+)[e\x](\d+)/i);
  if (sxeInSignal) {
    var s3 = parseInt(sxeInSignal[1]), e3 = parseInt(sxeInSignal[2]);
    return {
      match: s3 === targetSeason && e3 === targetEpisode,
      season: s3, episode: e3,
      metodo: 'SxxExx-via-ruido-strip'
    };
  }

  // Fallback total: extrai todos os numeros e tenta
  var allNums = signalStr.match(/\d+/g);
  if (allNums && allNums.length >= 2) {
    var nums = allNums.map(Number);
    // Assume que os 2 primeiros numeros sao season, episode
    return {
      match: nums[0] === targetSeason && nums[1] === targetEpisode,
      season: nums[0], episode: nums[1],
      metodo: 'fallback-numerico'
    };
  }

  return { match: false, season: 0, episode: 0, metodo: 'sem-numeros' };
}

// ─── TESTES ───

var testCases = [
  // === DADOS REAIS DO TORBOX (S02E01-02-03) ===
  ['BAIXAR OUTRAS SERIES.url', 2, 1, false, '.url nao-video S2E1'],
  ['Comando.LA.url', 2, 1, false, '.url nao-video S2E1'],
  ['TorrentDosFilmes.SE.url', 2, 1, false, '.url nao-video S2E1'],
  ['O.Senhor.dos.Aneis...S02E01-02-03.../S02E01.1080p.WEB-DL.DUAL.5.1.mkv', 2, 1, true, 'S02E1 video c/ path poluido'],
  ['O.Senhor.dos.Aneis...S02E01-02-03.../S02E02.1080p.WEB-DL.DUAL.5.1.mkv', 2, 2, true, 'S02E2 video c/ path poluido'],
  ['O.Senhor.dos.Aneis...S02E01-02-03.../S02E03.1080p.WEB-DL.DUAL.5.1.mkv', 2, 3, true, 'S02E3 video c/ path poluido'],
  // Cross-check: arquivo errado pro episodio errado
  ['O.Senhor.dos.Aneis...S02E01-02-03.../S02E03.1080p.WEB-DL.DUAL.5.1.mkv', 2, 1, false, 'S02E3 video, target S2E1'],
  ['O.Senhor.dos.Aneis...S02E01-02-03.../S02E01.1080p.WEB-DL.DUAL.5.1.mkv', 2, 3, false, 'S02E1 video, target S2E3'],

  // === FORMATOS ALTERNATIVOS ===
  ['Breaking.Bad.S05E12.720p.HDTV.x264.mkv', 5, 12, true, 'S05E12'],
  ['Breaking.Bad.5x12.720p.HDTV.x264.mkv', 5, 12, true, '5x12'],
  ['The.Walking.Dead.S03E01.1080p.BluRay.mkv', 3, 1, true, 'S03E01'],
  ['The.Walking.Dead.S03E01.1080p.BluRay.mkv', 3, 5, false, 'S03E01 file, target S3E5'],

  // === SEASON X EPISODE Y ===
  ['Game.of.Thrones.Season.8.Episode.6.1080p.mkv', 8, 6, true, 'Season 8 Episode 6'],
  ['Game.of.Thrones.Season.8.Episode.6.1080p.mkv', 8, 1, false, 'S8E6 file, target S8E1'],

  // === CASOS DIFICEIS ===
  ['Sample.mkv', 2, 3, false, 'sample sem episodio'],
  ['video.mkv', 1, 1, false, 'sem SxxExx no nome'],
  ['The.Matrix.1999.1080p.mkv', 1, 1, false, 'filme, nao serie'],

  // === PREFIXO DE PASTA ENGANOSO ===
  ['Pasta/S02E01-02-03/S02E03.mkv', 2, 3, true, 'path com prefixo S02E01-02-03'],
  ['Pasta/S02E01-02-03/S02E03.mkv', 2, 1, false, 'path prefixo enganoso, target S2E1'],
];

// Usa o path real do Torbox como prefixo
var PREFIXO = 'O.Senhor.dos.Aneis.Os.Aneis.de.Poder.S02E01-02-03.1080p.WEB-DL.DUAL.5.1/';

console.log('='.repeat(75));
console.log('TESTE V2: POO Generico - Deteccao de Episodio (dados reais + edge cases)');
console.log('='.repeat(75));

var pass = 0, fail = 0;

testCases.forEach(function(tc) {
  var path = tc[0];
  // Expande prefixos "..." com o path real do Torbox
  path = path.replace('...S02E01-02-03.../', PREFIXO);
  
  var ts = tc[1], te = tc[2], expected = tc[3], desc = tc[4];
  var result = arquivoPertenceAoEpisodio(path, ts, te);
  var ok = result.match === expected;
  
  var icon = ok ? 'OK' : 'FAIL';
  console.log(icon + ' ' + desc);
  console.log('  S' + ts + 'E' + te + ' | esperado:' + (expected ? 'ACEITAR' : 'REJEITAR') +
    ' | obtido:' + (result.match ? 'ACEITO' : 'REJEITADO') +
    ' | parsed:S' + result.season + 'E' + result.episode +
    ' | metodo:' + result.metodo);

  if (ok) pass++; else fail++;
});

console.log('\n' + '='.repeat(75));
console.log('RESULTADO: ' + pass + '/' + testCases.length + ' pass (' + fail + ' fail)');
if (fail === 0) console.log('TODOS OS TESTES PASSARAM!');
console.log('='.repeat(75));
