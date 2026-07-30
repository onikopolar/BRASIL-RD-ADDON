// Arquivo: src/titulos/technical-words.ts
// Palavras técnicas otimizadas para filtragem de títulos de torrents
// Exporta constantes para uso no SimilarityCalculator

// Palavras técnicas completas para remoção durante normalização
export const TECHNICAL_WORDS = [
  // Formatos de vídeo
  'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv', 'rmvb', 'm2ts', 'ts', 'm4v', 'vob', 'ogv', '3gp', 'mts', 'm2t', 'mxf',
  
  // Qualidades e resoluções
  '720p', '1080p', '2160p', '4k', 'hd', 'fullhd', 'uhd', 'sd', 'fhd', 'hdr', 'dv', 'uhdhdr', 'blurayremux', 'remux', '4kuhd',
  '480p', '576p', '360p', '240p', '144p', '8k', '2k', 'qhd', 'whd', 'fhd', 'hq', 'lq', 'mhd', 'vcd', 'svcd',
  
  // Codecs de vídeo expandidos
  'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx', 'vp9', 'av1', 'prores', 'dnxhd', 'cineform', 'mjpeg',
  'h263', 'h261', 'mpeg2', 'mpeg4', 'wmv9', 'vc1', 'indeo', 'theora', 'rv', 'realvideo', 'sorenson', 'cinepak',
  'dvavi', 'mpeg1', 'm1v', 'm2v', 'm4v', 'hvc1', 'hev1', 'vp8', 'vp6', 'vp7', 'vp10', 'daala',
  
  // Codecs de áudio expandidos
  'ac3', 'dts', 'aac', 'dd5.1', 'dolby', 'atmos', 'truehd', 'dts-hd', 'dtshd', 'mp3', 'ogg', 'opus', 'flac', 'alac',
  'wav', 'pcm', 'aiff', 'wma', 'vorbis', 'eac3', 'dd+', 'ddp', 'dtsx', 'dtsma', 'lpcm', 'dsd',
  '2.0', '5.1', '7.1', '5.1ch', '7.1ch', '2ch', 'stereo', 'mono', 'surround', '6ch', '8ch',
  'mp2', 'ra', 'ram', 'mid', 'midi', 'amr', 'amrnb', 'amrwb', 'qcelp', 'evrc', 'smv', 'g729',
  
  // Fontes e tipos de release expandidos
  'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv', 'camrip', 'ts', 'tc', 'r5', 'scr', 'dvdscr', 'bdscr', 'webscr',
  'ppvrip', 'hdrip', 'bdscr', 'r6', 'telecine', 'satrip', 'iptv', 'dsr', 'pdtv', 'hdtvrip', 'uhdrip', '4kuhd',
  'amzn', 'nf', 'hulu', 'dsnp', 'atvp', 'hmax', 'appletv', 'prime', 'disney', 'hbo', 'max', 'netflix', 'amazon',
  'hdtc', 'hdts', 'dvdscr', 'r5line', 'dvd5', 'dvd9', 'bd25', 'bd50', 'uhd100', 'webcap', 'hdcam', 'hdrc',
  'sat', 'cable', 'dtv', 'atv', 'itunes', 'google', 'vudu', 'ma', 'uv', 'aiv', 'h264', 'h265',
  
  // Termos de áudio e legendas expandidos
  'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio', 'legendado', 'legendada', 'legenda', 'sub', 'subtitle',
  'multilanguage', 'multiaudio', 'multisub', 'multi', 'tri', 'triaudio', 'trilanguage', 'subforced', 'subs',
  'dub', 'dubbed', 'subtitled', 'captions', 'cc', 'srt', 'ass', 'ssa', 'vtt', 'idx', 'sub', 'sup',
  'english', 'french', 'spanish', 'german', 'italian', 'japanese', 'korean', 'chinese', 'russian',
  
  // Idiomas expandidos
  'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br', 'portugues', 'português', 'eng', 'english', 'ingles', 'spanish', 'espanol',
  'french', 'francês', 'german', 'alemão', 'italian', 'italiano', 'japanese', 'japonês', 'chinese', 'chinês',
  'korean', 'coreano', 'russian', 'russo', 'brazilian', 'brasileiro', 'latino', 'latin', 'internacional',
  'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'no', 'da', 'fi',
  
  // GRUPOS DE RELEASE INTERNACIONAIS CONHECIDOS (PREDOMINANTEMENTE INGLÊS)
  // Trackers e grupos internacionais
  'yts', 'yify', 'rarbg', 'rartv', 'ettv', 'eztv', 'skgtv', 'turbo', 'cakes', 'galaxyrg', 'ctrlhd', 'framestor', 'tayto',
  'ntb', 'cmrg', 'evolve', 'mteam', 'chd', 'hds', 'chdbits', 'hdchina', 'ptp', 'btn', 'ahd', 'bhd', 'decode',
  'fum', 'tbs', 'flux', 'ife', 'legion', 'mrm', 'playbd', 'strife', 'viet', 'vtv', 'ws', 'xforce',
  'sva', 'exc', 'phd', 'grym', 'jyk', 'kings', 'dimension', 'sparks', 'geckos', 'loki', 'memento', 'quid',
  'mazemaze', 'kognitiv', 'anoxmous', 'bamboozle', 'cab', 'c0ke', 'cm8', 'crimson', 'drones', 'ebi',
  
  // GRUPOS DE RELEASE BRASILEIROS CONHECIDOS
  'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'cmdtv', 'cmdb', 'dhg', 'divulgahd', 'legiahd',
  'baixar', 'download', 'downloadseries', 'downloadfilmes', 'brasil', 'brrip', 'br-rip',
  'seriesbr', 'filmesbr', 'bluraybr', 'hdbr', 'webdlbr', 'torrentbr',
  
  // Trackers e sites internacionais adicionais
  '1337x', 'torrentday', 'iptorrents', 'filelist', 'torrentleech', 'demonoid', 'kickasstorrents', 'kat',
  'thepiratebay', 'tpb', 'limetorrents', 'zooqle', 'torrentz2', 'torrentdownloads', 'mononoke',
  'nyaa', 'anidex', 'tokyotosho', 'rutracker', 'nnmclub', 'pornolab', 'empornium',
  
  // Termos de edição e versão expandidos
  'repack', 'proper', 'extended', 'directors', 'cut', 'remastered', 'complete', 'uncensored', 'uncut', 'limited', 'special', 'edition',
  'directors.cut', 'theatrical', 'unrated', 'imax', '3d', '4dx', 'final', 'version', 'collectors', 'anniversary',
  'restored', 'remux', 'se', 'dc', 'ue', 'ce', 'te', 'ee', 'le', 've', 're', 'ue', 'pe', 'fe',
  'extended.cut', 'theatrical.cut', 'ultimate', 'deluxe', 'premium', 'gold', 'platinum', 'definitive',
  'international', 'us', 'uk', 'eu', 'asia', 'jpn', 'kor', 'chn', 'rus', 'bra', 'ger', 'fra', 'ita',
  
  // Palavras comuns de títulos de torrent
  'temporada', 'season', 'episodio', 'episódio', 'episode', 'complete', 'pack', 'collection', 'boxset', 'anthology',
  'movie', 'the movie', 'cinema', 'cinematográfico', 'cinematografico', 'filme', 'serie', 'series', 'show',
  's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13', 's14', 's15',
  'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'e14', 'e15',
  'ep0', 'ep1', 'ep2', 'ep3', 'ep4', 'ep5', 'ep6', 'ep7', 'ep8', 'ep9', 'ep10', 'ep11', 'ep12', 'ep13', 'ep14', 'ep15',
  
  // Termos de versão e qualidade
  'versão', 'versao', 'version', 'edição', 'edicao', 'edition', 'completo', 'completa', 'complete',
  'torrent', 'download', 'baixar', 'assistir', 'online', 'stream', 'streaming',
  'free', 'full', 'part', 'parts', 'cd', 'cd1', 'cd2', 'disc', 'disc1', 'disc2', 'disk', 'disk1', 'disk2',
  
  // Artigos e preposições comuns
  'the', 'of', 'and', 'in', 'to', 'a', 'an', 'for', 'with', 'on', 'at', 'by', 'from', 'as', 'is', 'it', 'that', 'this',
  'or', 'but', 'not', 'be', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
  'can', 'could', 'may', 'might', 'must', 'shall', 'ought',
  
  // Extensões e termos técnicos
  'web', 'dl', 'rip', 'cam', 'part', 'pt', 'vol', 'volume', 'ª', 'º', 'cap', 'chapter', 'ep', 's',
  'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv',
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  
  // Termos de encoding expandidos
  'encoded', 'encoding', 'transcoded', 'transcoding', 'bitrate', 'bit', 'rate', 'fps', 'hz', 'khz', 'mb', 'gb',
  'high', 'quality', 'low', 'medium', 'standard', 'premium', 'ultimate', 'extreme', 'master', 'professional',
  'bitrate', 'samplerate', 'vbr', 'cbr', 'abr', 'crf', 'qp', 'preset', 'profile', 'level', 'tier',
  'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo',
  
  // Termos de container expandidos
  'container', 'format', 'file', 'files', 'disc', 'dvd', 'bd', 'blu', 'ray', 'uhdbluray', 'hddvd',
  'matroska', 'mpegts', 'mpegps', 'avi', 'mov', 'mp4', 'flv', 'wmv', 'ogv', 'webm', '3gp',
  
  // Termos de áudio técnico expandidos
  'channel', 'channels', 'sound', 'track', 'tracks', 'voice', 'over', 'narration', 'commentary',
  'descriptive', 'audiodescription', 'ad', 'sdh', 'cc', 'subtitles', 'karaoke', 'instrumental',
  'vocals', 'dialogue', 'effects', 'foley', 'music', 'score', 'soundtrack',
  
  // Termos de vídeo técnico
  'frame', 'frames', 'resolution', 'aspect', 'ratio', 'pixel', 'pixels', 'color', 'colors', 'grading',
  'gamma', 'contrast', 'brightness', 'saturation', 'hue', 'luminance', 'chroma',
  'interlaced', 'progressive', 'field', 'fields', 'telecine', 'ivtc', 'deinterlace',
  
  // Termos de compressão
  'compressed', 'uncompressed', 'lossless', 'lossy', 'zip', 'rar', '7z', 'gz', 'bz2', 'lzma',
  'archive', 'compression', 'decompression', 'extract', 'extracted',
  
  // Termos de rede e distribuição
  'peer', 'peers', 'seeder', 'seeders', 'leecher', 'leechers', 'swarm', 'tracker', 'trackers',
  'magnet', 'torrent', 'bittorrent', 'utorrent', 'qbittorrent', 'transmission', 'deluge',
  'ratio', 'upload', 'download', 'bandwidth', 'speed', 'throttle', 'throttling',
  
  // Termos gerais de mídia
  'media', 'entertainment', 'film', 'cinema', 'theater', 'theatre', 'broadcast', 'television',
  'streaming', 'vod', 'pvod', 'tvod', 'avod', 'svod', 'live', 'broadcast',
  
  // Termos específicos de séries
  'season', 'series', 'episode', 'pilot', 'finale', 'midseason', 'special', 'marathon', 'binge',
  'arc', 'storyline', 'plot', 'character', 'characters', 'cast', 'crew', 'director', 'producer',
  'writer', 'creator', 'showrunner', 'network', 'studio', 'production',
];

// Acrônimos técnicos para remoção durante normalização
export const TECHNICAL_ACRONYMS = [
  'hdr', 'dv', 'hq', 'bd', 'dvd', 'tv', 'avc', 'hevc', 'aac', 'ac3', 'dts', 'imax', '3d',
  '5.1', '7.1', '2.0', '5.1ch', '7.1ch', '2ch', 'hd', 'uhd', 'fhd', 'qhd', 'whd',
  'dd', 'ddp', 'dtsx', 'dtsma', 'lpcm', 'dsd', 'pcm', 'wav', 'flac', 'alac',
  'nf', 'amzn', 'atvp', 'hmax', 'dsnp', 'hulu', 'appletv', 'netflix', 'prime',
  'hdr10', 'hdr10+', 'hlg', 'dv', 'dolbyvision', 'atmos', 'dtsx',
  'h264', 'h265', 'vp9', 'av1', 'x264', 'x265', 'divx', 'xvid',
  'mp3', 'aac', 'ogg', 'opus', 'flac', 'alac', 'wma', 'wav',
  'sdr', 'hdr', 'dv', 'uhd', '4k', '8k', 'hd', 'sd',
  'avc', 'hevc', 'mpeg2', 'mpeg4', 'vp8', 'vp9', 'av1',
  'srt', 'ass', 'ssa', 'vtt', 'sub', 'idx', 'sup',
  'iso', 'm2ts', 'mkv', 'mp4', 'avi', 'mov', 'wmv', 'flv',
  'gb', 'mb', 'kb', 'tb', 'pb', 'eb', 'zb', 'yb',
  'fps', 'hz', 'khz', 'mhz', 'ghz', 'bps', 'kbps', 'mbps', 'gbps',
  // Formatos 3D e variantes
  'hsbs', 'sbs', 'half-sbs', 'h-sbs', 'hou', 'half-ou', '3d',
  'rgb', 'yuv', 'ycbcr', 'hsv', 'hsl', 'cmyk',
  'ntsc', 'pal', 'secam', 'atsc', 'dvb', 'isdb',
  'ip', 'tcp', 'udp', 'http', 'https', 'ftp', 'sftp',
  'url', 'uri', 'urn', 'uuid', 'guid', 'hash', 'md5', 'sha1', 'sha256',
];

// Lista específica de grupos de release internacionais conhecidos
// Uso: para detectar e penalizar releases em inglês
export const INTERNATIONAL_RELEASE_GROUPS = [
  'skgtv', 'rartv', 'ettv', 'eztv', 'vtv', 'yts', 'yify', 'rarbg',
  'turbo', 'cakes', 'galaxyrg', 'ctrlhd', 'framestor', 'tayto', 'ntb',
  'cmrg', 'evolve', 'mteam', 'chd', 'hds', 'fum', 'tbs', 'flux', 'tgx',
  'ife', 'legion', 'mrm', 'playbd', 'strife', 'viet', 'ws', 'xforce',
  'sva', 'exc', 'phd', 'grym', 'jyk', 'kings', 'dimension', 'sparks',
  'geckos', 'loki', 'memento', 'quid', 'mazemaze', 'kognitiv',
  'anoxmous', 'bamboozle', 'cab', 'c0ke', 'cm8', 'crimson', 'drones', 'ebi',
];

// Lista específica de trackers internacionais conhecidos
export const INTERNATIONAL_TRACKERS = [
  '1337x', 'torrentday', 'iptorrents', 'filelist', 'torrentleech',
  'demonoid', 'kickasstorrents', 'kat', 'thepiratebay', 'tpb',
  'limetorrents', 'zooqle', 'torrentz2', 'torrentdownloads', 'mononoke',
  'nyaa', 'anidex', 'tokyotosho', 'rutracker', 'nnmclub',
];

// Lista específica de grupos de release brasileiros conhecidos
// Uso: para dar bônus a releases em português
export const BRAZILIAN_RELEASE_GROUPS = [
  'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'comando1', 'cmdtv', 'cmdb',
  'dhg', 'divulgahd', 'legiahd', 'baixar', 'download', 'brasil',
  'seriesbr', 'filmesbr', 'bluraybr', 'hdbr',
  'webdlbr', 'torrentbr', 'starck', 'starckfilmes'
];

// Função auxiliar para verificar se uma palavra é técnica
export function isTechnicalWord(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return TECHNICAL_WORDS.includes(lowerWord) || TECHNICAL_ACRONYMS.includes(lowerWord);
}

// Função para verificar se é grupo de release internacional
export function isInternationalReleaseGroup(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return INTERNATIONAL_RELEASE_GROUPS.includes(lowerWord);
}

// Função para verificar se é tracker internacional
export function isInternationalTracker(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return INTERNATIONAL_TRACKERS.includes(lowerWord);
}

// Função para verificar se é grupo de release brasileiro
export function isBrazilianReleaseGroup(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return BRAZILIAN_RELEASE_GROUPS.includes(lowerWord);
}

// ─── INDICADORES DE IDIOMA PARA TORRENTS ───
// Palavras que indicam que um torrent eh brasileiro / PT-BR.
// Fonte unica para LanguageDetector — sem duplicacao, sem filtro.

export const INDICADORES_BRASIL_TORRENTS = [
  // Dublagem (apenas variantes PT-BR — 'dub' e 'dubbed' sao universais)
  'dublado', 'dublada', 'dublagem',
  // Dual audio
  'dual', 'dual audio',
  // Legendas
  'legendado', 'legendada', 'legenda',
  // Nacional
  'nacional',
  // PT-BR codes
  'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br',
  // Portugues
  'portugues', 'português', 'portuguese', 'PORTUGUESE', 'Episodio', 'episodio',
  // Brasileiro
  'brasileiro', 'brazilian', 'brasil',
  // Abreviacoes comuns em releases (ex: ITA.POR.SUBS)
  'por', 'pb',
  // Marcadores de temporada (PT-BR)
  'temporada', 'completa', 'completo',
];

/** Palavras que indicam que um torrent eh internacional / nao-PT-BR */
export const INDICADORES_INTERNACIONAL_TORRENTS = [
  // VO / OV (version original)
  'vo', 'ov',
  // Abreviacoes comuns de fansub
  'yg',
];

// ─── FUNCOES ───

// Função para verificar se título contém indicadores internacionais
export function containsInternationalIndicators(title: string): {
  isInternational: boolean;
  indicators: string[];
  reason: string;
} {
  const lowerTitle = title.toLowerCase();
  const foundIndicators: string[] = [];
  
  // Verificar grupos de release internacionais
  for (const group of INTERNATIONAL_RELEASE_GROUPS) {
    if (lowerTitle.includes(group)) {
      foundIndicators.push(group);
    }
  }
  
  // Verificar trackers internacionais
  for (const tracker of INTERNATIONAL_TRACKERS) {
    if (lowerTitle.includes(tracker)) {
      foundIndicators.push(tracker);
    }
  }
  
  if (foundIndicators.length > 0) {
    return {
      isInternational: true,
      indicators: foundIndicators,
      reason: `Contém indicadores internacionais: ${foundIndicators.join(', ')}`
    };
  }
  
  return {
    isInternational: false,
    indicators: [],
    reason: 'Nenhum indicador internacional encontrado'
  };
}

// Função para verificar se título contém indicadores brasileiros
export function containsBrazilianIndicators(title: string): {
  isBrazilian: boolean;
  indicators: string[];
  reason: string;
} {
  const lowerTitle = title.toLowerCase();
  const foundIndicators: string[] = [];
  
  // Verificar grupos de release brasileiros
  for (const group of BRAZILIAN_RELEASE_GROUPS) {
    if (lowerTitle.includes(group)) {
      foundIndicators.push(group);
    }
  }
  
  // Verificar padrões brasileiros comuns
  const brazilianPatterns = [
    /1ª.*temporada/i,
    /temporada.*completa/i,
    /dublado/i,
    /legendado/i,
    /pt.*br/i,
    /brasil/i,
  ];
  
  for (const pattern of brazilianPatterns) {
    if (pattern.test(lowerTitle)) {
      const match = lowerTitle.match(pattern)?.[0];
      if (match && !foundIndicators.includes(match)) {
        foundIndicators.push(match);
      }
    }
  }
  
  if (foundIndicators.length > 0) {
    return {
      isBrazilian: true,
      indicators: foundIndicators,
      reason: `Contém indicadores brasileiros: ${foundIndicators.join(', ')}`
    };
  }
  
  return {
    isBrazilian: false,
    indicators: [],
    reason: 'Nenhum indicador brasileiro encontrado'
  };
}

// Estatísticas das palavras técnicas
export function getTechnicalWordsStats() {
  return {
    totalWords: TECHNICAL_WORDS.length,
    totalAcronyms: TECHNICAL_ACRONYMS.length,
    totalCombined: TECHNICAL_WORDS.length + TECHNICAL_ACRONYMS.length,
    internationalReleaseGroups: INTERNATIONAL_RELEASE_GROUPS.length,
    internationalTrackers: INTERNATIONAL_TRACKERS.length,
    brazilianReleaseGroups: BRAZILIAN_RELEASE_GROUPS.length,
    version: '1.3.0', // getPotentialSequelNumbers para delegar deteccao de sequencia
    description: 'Delegacao de deteccao de numeros de sequencia via contexto tecnico'
  };
}

// Extrai numeros (2-19) do titulo que podem indicar sequencia de franquia.
// Filtra numeros que aparecem em contexto tecnico (audio, qualidade, episodios).
// Delega para isTechnicalWord + regex de padroes conhecidos.
export function getPotentialSequelNumbers(title: string): number[] {
  const lower = title.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Extrai todos os tokens (split por espaco E por ponto)
  const spaceTokens = lower
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  const allTokens = new Set<string>();
  for (const t of spaceTokens) {
    allTokens.add(t);
    t.split('.').forEach(sub => allTokens.add(sub));
  }

  // Extrai numeros puros 2-19
  const candidates: number[] = [];
  for (const token of allTokens) {
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 2 && n <= 19) candidates.push(n);
    }
  }

  // Filtra: mantem só os que NAO estao em contexto tecnico
  const episodeRange = extrairRangeEpisodios(title);
  const result: number[] = [];
  for (const num of candidates) {
    // Dentro do range de episódios → não é número de sequência
    if (episodeRange && num >= episodeRange.episodeStart && num <= episodeRange.episodeEnd) continue;
    if (!_isInTechnicalContext(lower, num, allTokens) &&
        !_isAudioChannelInOriginal(title, num)) {
      result.push(num);
    }
  }

  return [...new Set(result)];
}

/** Verifica se um numero aparece apenas em contexto tecnico no titulo */
function _isInTechnicalContext(
  lowerTitle: string,
  num: number,
  allTokens: Set<string>
): boolean {
  const numStr = String(num);

  // a) Tokens NAO-puros que contem o numero e sao technical words
  //    Ex: "5.1", "1080p", "2ch", "dd5.1", "s2", "e2", "ep2", "cd2"
  for (const token of allTokens) {
    if (!/^\d+$/.test(token) && token.includes(numStr) && isTechnicalWord(token)) {
      return true;
    }
  }

  // b) Audio channels como "5.1", "7.1", "2.0" no titulo original
  //    Cobre titulos TPB onde "DUAL.5.1" vira um token so
  const audioRe = /(\d+\.\d+(?:ch)?)/g;
  let m;
  while ((m = audioRe.exec(lowerTitle)) !== null) {
    if (isTechnicalWord(m[1])) {
      const nums = m[1].match(/\d+/g);
      if (nums && nums.map(Number).includes(num)) return true;
    }
  }

  // c) Range de episodios: S01E01-02, S01E01 02
  const epRangeRe = /s\d+e\d+[-\s]+0*(\d+)/gi;
  while ((m = epRangeRe.exec(lowerTitle)) !== null) {
    if (Number(m[1]) === num) return true;
  }

  // d) Range de episodios sem Sxx: E01-02
  const eRangeRe = /\be\d+[-\s]+0*(\d+)\b/gi;
  while ((m = eRangeRe.exec(lowerTitle)) !== null) {
    if (Number(m[1]) === num) return true;
  }

  // e) Audio channel dentro de spec no título ORIGINAL (antes de normalizar dots)
  //    Ex: "DUAL.5.1" → "5" e "1" são canais. Mas "Velozes 5 DUAL" → "5" é sequência.
  //    Busca o número em patterns como .5.1, .7.1ch, -5.1, etc no título com dots originais
  //    Passamos o título original como parâmetro extra
  
  return false;
}

/** 
 * Verifica se um número está em contexto de spec de áudio no título ORIGINAL.
 * Chamada externamente por getPotentialSequelNumbers com o título antes da normalização.
 */
function _isAudioChannelInOriginal(originalTitle: string, num: number): boolean {
  const numStr = String(num);
  // Patterns de spec de áudio no título original (com dots):
  //   "5.1", "7.1ch", "2.0" → spec completo (dois números)
  //   ".5.", "-5.", " 5."  → número isolado entre delimitadores de spec
  const audioSpecRe = /[.\-(\s](\d+)\s*\.\s*(\d+)\s*(?:ch)?/gi;
  let m;
  while ((m = audioSpecRe.exec(originalTitle)) !== null) {
    if (parseInt(m[1]) === num || parseInt(m[2]) === num) return true;
  }
  // Spec incompleto: número entre dots/delimitadores perto de palavra de audio
  // Ex: "DUAL.5." → "5" é canal mesmo sem o ".1"
  const incompleteSpecRe = /(?:dual|audio|dublado|dolby|ac3|aac|dts|eac3|ddp?|ch|channel)\s*[.\-]\s*(\d+)\s*[.\-]/gi;
  while ((m = incompleteSpecRe.exec(originalTitle)) !== null) {
    if (parseInt(m[1]) === num) return true;
  }
  return false;
}

// Log de atualizacao da versao
console.log('[INFO] [TechnicalWords] Versao 1.2.0 carregada - Deteccao de sequencia delegada');

// ═══════════════════════════════════════════════════════════════════════
//  EXTRAIR RANGE DE EPISÓDIOS — para filtro no banco de dados
// ═══════════════════════════════════════════════════════════════════════

export interface EpisodeRange {
  season: number;
  episodeStart: number;
  episodeEnd: number;
}

/**
 * Extrai o range de episódios de um título de torrent.
 * 
 * Padrões suportados:
 *   S02E04              → season=2, start=4, end=4
 *   S02E01-02-03        → season=2, start=1, end=3
 *   S02E01-10           → season=2, start=1, end=10
 *   S02E01 E02 E03      → season=2, start=1, end=3
 *   2x04                → season=2, start=4, end=4
 *   Season 2 Episode 4  → season=2, start=4, end=4
 *   2ª Temporada Ep 4   → season=2, start=4, end=4
 * 
 * Retorna null para:
 *   - Packs completos (1ª Temporada Completa, Complete Season, Season Pack)
 *   - Títulos sem informação de episódio
 *   - Filmes
 */
export function extrairRangeEpisodios(title: string): EpisodeRange | null {
  const t = title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  // ═══ Packs completos — retorna null (temporada inteira) ═══
  const isFullSeason = /\b(?:temporada\s*completa|season\s*pack|complete\s*season|complete\s*pack|pack\s*completo)\b/i;
  if (isFullSeason.test(t)) return null;

  // ═══ Padrão 1: SxxExx (S02E04, S02E01-02-03, S02E01-10) ═══
  // Captura season e PRIMEIRO episódio, depois varre por todos os números de episódio
  const sxxExx = t.match(/s(\d{1,2})\s*e(\d{1,3})/i);
  if (sxxExx) {
    const season = parseInt(sxxExx[1]);
    const firstEp = parseInt(sxxExx[2]);

    // Pega a parte DEPOIS do match SxxExx para extrair ranges tipo -02-03, -10
    const afterMatch = t.substring(sxxExx.index! + sxxExx[0].length);

    // Extrai episódios adicionais em formato de range: -02, -03, E04, E05
    // Só captura números que estão claramente em posição de episódio:
    //   "-02" (hífen + número), " 03" após hífen anterior, "E04" (E + número)
    const epNums: number[] = [firstEp];
    
    // Range com hífen: S02E01-02-03 → captura -02, -03
    const hyphenRange = afterMatch.match(/-(\d{1,3})\b/g);
    if (hyphenRange) {
      hyphenRange.forEach(h => epNums.push(parseInt(h.replace('-', ''))));
    }
    
    // Range com vírgula ou espaço após hífen: S02E01-02,03 ou S02E01-02 03
    const commaRange = afterMatch.match(/(?:-|\s)\d{1,3}\s*[,]\s*(\d{1,3})\b/g);
    if (commaRange) {
      commaRange.forEach(c => {
        const n = c.match(/(\d{1,3})\s*$/);
        if (n) epNums.push(parseInt(n[1]));
      });
    }
    
    // Episódios explícitos E02, E03 — podem ser adjacentes (E01E02E03)
    const explicitEps = afterMatch.match(/e(\d{1,3})(?=\s|$|\.|e|E|-)/gi);
    if (explicitEps) {
      explicitEps.forEach(e => epNums.push(parseInt(e.replace(/e/i, '').match(/\d+/)?.[0] || '0')));
    }
    
    // Português: "S01E01 e 02", "S01E01 e 02 e 03" ("e" separado por espaços)
    const ptEpRange = afterMatch.match(/\s+e\s+(\d{1,3})\b/gi);
    if (ptEpRange) {
      ptEpRange.forEach(m => {
        const n = m.match(/(\d{1,3})$/);
        if (n) epNums.push(parseInt(n[1]));
      });
    }

    epNums.sort((a, b) => a - b);
    // Dedup
    const unique = [...new Set(epNums)];
    return {
      season,
      episodeStart: unique[0],
      episodeEnd: unique[unique.length - 1],
    };
  }

  // ═══ Padrão 2: 2x04 (Season x Episode) ═══
  const seasonXEp = t.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (seasonXEp) {
    return {
      season: parseInt(seasonXEp[1]),
      episodeStart: parseInt(seasonXEp[2]),
      episodeEnd: parseInt(seasonXEp[2]),
    };
  }

  // ═══ Padrão 3: Season 2 Episode 4, Temporada 2 Episódio 4 ═══
  const seasonEpText = t.match(/\b(?:season|temporada)\s*(\d{1,2})\s*(?:episode|epis[oó]dio|ep|e)\s*(\d{1,3})\b/i);
  if (seasonEpText) {
    return {
      season: parseInt(seasonEpText[1]),
      episodeStart: parseInt(seasonEpText[2]),
      episodeEnd: parseInt(seasonEpText[2]),
    };
  }

  return null;
}
console.log('[DEBUG] [TechnicalWords] Iniciada verificação de grupos internacionais/brasileiros');

// ═══════════════════════════════════════════════════════════════════════
//  NORMALIZAÇÃO DE TÍTULOS — remove SÓ palavras técnicas
//  Deixa temporada/episódio para outros métodos lidarem com regex próprio
// ═══════════════════════════════════════════════════════════════════════

/** Palavras puramente técnicas que devem ser removidas na normalização */
const TECHNICAL_STRIP_WORDS = new Set([
  // Extensões
  'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv', 'rmvb', 'm2ts', 'ts', 'm4v', 'vob', 'ogv', '3gp',
  // Qualidades
  '720p', '1080p', '2160p', '4k', '480p', '360p', 'sd', 'hd', 'fhd', 'uhd', 'hdr', 'fullhd', '8k', '2k',
  // Codecs vídeo
  'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx', 'vp9', 'av1',
  // Codecs áudio
  'ac3', 'aac', 'dts', 'eac3', 'mp3', 'ogg', 'opus', 'flac', 'truehd', 'atmos', 'dtshd', 'dts-hd',
  // Fontes
  'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv', 'remux', 'web', 'dl', 'bd', 'dvd',
  // Áudio canais (5.1, 7.1, etc — o regex também pega)
  '5.1', '7.1', '2.0', '2ch', '6ch', '5.1ch', '7.1ch',
  // Palavras de áudio/legenda (ruído na comparação de títulos)
  'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
  'legendado', 'legendada', 'legenda', 'dub', 'dubbed',
  // Grupos release comuns (ruído visual)
  'yts', 'yify', 'rarbg', 'ettv', 'eztv', 'ion10', 'bludv', 'comando', 'comando1', 'tpb', 'starck', 'starckfilmes',
  // Grupos release encontrados nos scrapers
  'btm', 'sujaidr', 'xebec', 'douglasvip', 'deejayahmed', 'jeremiah', 'leroy', 'pitt',
  'ethel', 'coyote', 'reenc', 'psa', 'mang0', 'rdnyb', 'grace', 'bone', 'syncup', 'pong',
  // Domínios/URLs que poluem o dn do magnet
  'www', 'com', 'org', 'net', 'tv', 'xyz', 'info', 'io', 'to', 'cc',
  'hidratorrents', 'hdr',
  // Códigos de idioma em releases multi (ex: ESP-ENG, ITA, FRE)
  'esp', 'eng', 'ita', 'fre', 'ger', 'jpn', 'kor', 'rus', 'por',
  // Tags de sites WordPress (Listão Filmes, etc)
  'download', 'listao', 'filmes', 'terror', 'acao', 'aventura', 'drama', 'comedia', 'guerra',
  'classicos', 'acesse', 'original',
  // Metadados de temporada
  'temporada', 'completa', 'season', 'complete', 'parts', 
  // Codecs e variantes
  '10bit', '10bits', 'hdr10', 'hdr10p', 'dd', 'ddp', 'ddp5', 'sdr', 'blu', 'extras',
  'remastered', '3d', 'imax', 'dv', 'hdr10plus', 'dovi', 'BAIXARAPIDO.COM', 'COMOEUBAIXO.COM', 'BRRip',
  'WWW.RAPIDOTORRENTS.COM', 'RAPIDOTORRENTS', '.com', '.COM', 'www.', 'rapidotorrents',
  // Spam de sites nos DNs de magnet
  'site', 'visite', 'www',
  // Metadados soltos
  'movie', 'film', 'series', 'vol', 'volume', 'extended',
  // Entidades HTML numéricas que escapam da normalização
  '8211', '8230', '038',
  // Lançamentos multi (ex: "S01E01-02-03")
  's01', 's02', 's03', 's04', 's05', 's06', 's07', 's08',
]);

// Regex de qualidade/codec (padrões que não são palavras isoladas)
const TECHNICAL_STRIP_REGEX = [
  /\b\d{3,4}[pi]\b/gi,          // 1080p, 720p, 2160p, 480p
  /\b\d+k\b/gi,                 // 4K, 8K
  /\b[hx]\d{3}\b/gi,            // x264, h265
  /\b\d+\.\d+(?:ch)?\b/gi,      // 5.1, 2.0ch
  /\b(?:19|20)\d{2}\b/g,        // anos (deixa pra validarAno)
];

/**
 * Normaliza título de torrent removendo SÓ palavras técnicas.
 * NÃO remove SxxExx, temporada, episódio — isso é responsabilidade
 * de outros métodos (extrairRangeEpisodios, validarTemporada, etc).
 */
export function normalizarTituloTorrent(title: string): string {
  let result = title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Remove palavras técnicas
  const words = result.split(' ');
  const filtered = words.filter(w => !TECHNICAL_STRIP_WORDS.has(w));
  result = filtered.join(' ');

  // Remove padrões regex (qualidade, codec, ano — mas NÃO SxxExx)
  for (const re of TECHNICAL_STRIP_REGEX) {
    result = result.replace(re, ' ').replace(/\s+/g, ' ').trim();
  }

  return result;
}