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
  'cmrg', 'evolve', 'mteam', 'chd', 'hds', 'fum', 'tbs', 'flux',
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
  'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'cmdtv', 'cmdb',
  'dhg', 'divulgahd', 'legiahd', 'baixar', 'download', 'brasil',
  'brrip', 'br-rip', 'seriesbr', 'filmesbr', 'bluraybr', 'hdbr',
  'webdlbr', 'torrentbr',
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

// Função para obter apenas termos de idioma
export function getLanguageTerms(): string[] {
  return [
    'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
    'legendado', 'legendada', 'legenda', 'pt-br', 'ptbr', 'pt_br',
    'pt.br', 'pt br', 'portugues', 'português', 'brazilian', 'multi',
    'portuguese', 'brasileiro', 'latino', 'espanol', 'spanish'
  ];
}

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
    version: '1.1.0', // Atualização: Minor (novas funcionalidades)
    description: 'Adicionada detecção inteligente de releases internacionais/brasileiros'
  };
}

// Log de atualização da versão
console.log('[INFO] [TechnicalWords] Versão 1.1.0 carregada - Detecção inteligente de releases');
console.log('[DEBUG] [TechnicalWords] Iniciada verificação de grupos internacionais/brasileiros');