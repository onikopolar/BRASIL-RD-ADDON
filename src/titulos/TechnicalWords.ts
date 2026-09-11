// Arquivo: src/titulos/technical-words.ts
// Palavras técnicas e utilitários de parsing de títulos de torrents.

export const TECHNICAL_ACRONYMS = [
  'hdr', 'dv', 'hq', 'bd', 'dvd', 'tv', 'avc', 'hevc', 'aac', 'ac3', 'dts', 'imax', '3d',
  '5.1', '7.1', '2.0', '5.1ch', '7.1ch', '2ch', '1ch', 'hd', 'uhd', 'fhd', 'qhd', 'whd',
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
  'hsbs', 'sbs', 'half-sbs', 'h-sbs', 'hou', 'half-ou', '3d',
  'rgb', 'yuv', 'ycbcr', 'hsv', 'hsl', 'cmyk',
  'ntsc', 'pal', 'secam', 'atsc', 'dvb', 'isdb',
  'ip', 'tcp', 'udp', 'http', 'https', 'ftp', 'sftp',
  'url', 'uri', 'urn', 'uuid', 'guid', 'hash', 'md5', 'sha1', 'sha256',
  '1080p', '720p', '2160p', '480p', '4k', '8k', 'fullhd', 'full-hd',
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'webrip', 'web-dl', 'webdl',
  'hdtv', 'dvdrip', 'dvd', 'bd', 'remux', 'brrip', 'web',
  'matte', 'imax',
  'dublado', 'dublada', 'dual', 'legendado', 'legendada', 'nacional',
  'portugues', 'português', 'pt-br', 'ptbr', 'brazilian',
  'www', 'com', 'org', 'net', 'tv', 'br', 'bludv', 'comando', 'comandotorrents',
  'torrents', 'filmes', 'hd', 'full', 'sf', 'dl', 'rip', 'xvid', 'divx',
  'mp3', 'aac', 'ac3', 'dts', 'eac3', 'ddp', 'dd', 'dolby',
  'h264', 'h265', 'x264', 'x265', 'avc', 'hevc', 'vp9', 'av1',
  '480', '720', '1080', '2160',
  'download', 'baixar', 'assistir', 'online',
];

export const INTERNATIONAL_RELEASE_GROUPS = [
  'skgtv', 'rartv', 'ettv', 'eztv', 'vtv', 'yts', 'yify', 'rarbg',
  'turbo', 'cakes', 'galaxyrg', 'ctrlhd', 'framestor', 'tayto', 'ntb',
  'cmrg', 'evolve', 'mteam', 'chd', 'hds', 'fum', 'tbs', 'flux', 'tgx',
  'ife', 'legion', 'mrm', 'playbd', 'strife', 'viet', 'ws', 'gopo', 'grym', 'mld',
  'sva', 'exc', 'phd', 'grym', 'jyk',
  'sparks',
  'geckos', 'quid', 'mazemaze', 'kognitiv',
  'anoxmous', 'bamboozle', 'cab', 'c0ke', 'cm8', 'crimson', 'drones', 'ebi', 'rartv', '[rartv]',
  'nogrp', 'nogroup', 'unknown',
  'ben', 'benth',
];

export const INTERNATIONAL_TRACKERS = [
  '1337x', 'torrentday', 'iptorrents', 'filelist', 'torrentleech',
  'demonoid', 'kickasstorrents', 'kat', 'thepiratebay', 'tpb',
  'limetorrents', 'zooqle', 'torrentz2', 'torrentdownloads', 'mononoke',
  'nyaa', 'anidex', 'tokyotosho', 'rutracker', 'nnmclub', 'rartv', 'bone', 'BONE',
];

export const BRAZILIAN_RELEASE_GROUPS = [
  'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'comando1', 'cmdtv', 'cmdb',
  'dhg', 'divulgahd', 'legiahd', 'baixar', 'download', 'brasil',
  'seriesbr', 'filmesbr', 'bluraybr', 'hdbr',
  'webdlbr', 'torrentbr', 'starck', 'starckfilmes',
  'lapumia', 'comoeubaixo', 'bludv', 'BLUDV', 'WWW.BLUDV.COM',
  'luanharper', 'SiGLA', 'SF', 'WEB-DL', 'web-dl', 'AZTORRENTS',
  'trilogia', 'colecao', 'coleção', 'quadrilogy', 'quadrilogia', 'coletanea',
  'franquia', 'saga', 'duologia',
];

const _ALL_NON_TITLE_WORDS = new Set<string>([
  ...TECHNICAL_ACRONYMS,
  ...BRAZILIAN_RELEASE_GROUPS,
  ...INTERNATIONAL_RELEASE_GROUPS,
  ...INTERNATIONAL_TRACKERS,
].map(w => w.toLowerCase()));

export function isTechnicalWord(word: string): boolean {
  return _ALL_NON_TITLE_WORDS.has(word.toLowerCase());
}

// Normaliza texto pra comparação: lowercase, sem acento, sem emoji, sem pontuação.
export function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Emojis e pictogramas (Unicode 12+) — nunca são úteis em títulos de torrent
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\p{Emoji_Presentation}/gu, ' ')
    .replace(/&#0*38;/g, '&')
    .replace(/&#x26;/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&#0*8211;|&ndash;/gi, '-')
    .replace(/&#0*8212;|&mdash;/gi, '-')
    .replace(/&#0*8220;|&ldquo;/gi, '"')
    .replace(/&#0*8221;|&rdquo;/gi, '"')
    .replace(/&#0*8216;|&lsquo;/gi, "'")
    .replace(/&#0*8217;|&rsquo;/gi, "'")
    .replace(/&#0*160;|&nbsp;/gi, ' ')
    .replace(/_/g, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isInternationalReleaseGroup(word: string): boolean {
  return INTERNATIONAL_RELEASE_GROUPS.includes(word.toLowerCase());
}

export function isInternationalTracker(word: string): boolean {
  return INTERNATIONAL_TRACKERS.includes(word.toLowerCase());
}

export function isBrazilianReleaseGroup(word: string): boolean {
  return BRAZILIAN_RELEASE_GROUPS.includes(word.toLowerCase());
}

export const INDICADORES_BRASIL_TORRENTS = [
  'dublado', 'dublada', 'dublagem',
  'dual', 'dual audio',
  'nacional',
  'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br',
  'portugues', 'português', 'portuguese', 'PORTUGUESE', 'Episodio', 'episodio',
  'brasileiro', 'brazilian', 'brasil',
  'por', 'pb',
  'temporada', 'completa', 'completo', 'AZTORRENTS',
];

export const INDICADORES_INTERNACIONAL_TORRENTS = [
  'vo', 'ov',
  'legendado', 'legendada', 'legenda',
  'lege',
  'yg', 'KyoGo', 'kyogo', 'english', 'English', 'hindi', 'Hindi',
  'turg', 'Turg', 'TURG', 'fitgirl', 'FitGirl', 'steamrip',
  'g4ris', 'rartv', 'ntb', 'bone', 'BONE', 'ION10', '10bit', 'CM', 'RDNYB', 'DCPRiP',
  'legedando', 'legedanda', 'legedados', 'legedadas',
];

const COLLECTION_WORDS = new Set([
  'trilogia', 'colecao', 'coleção', 'quadrilogy', 'quadrilogia',
  'coletanea', 'franquia', 'duologia', 'saga', 'todas as temporadas',
  'temporada completa', 'season pack', 'pack completo',
]);

// Detecta título de coleção/franquia/pack. Normaliza internamente — pode receber texto cru.
export function isCollectionTitle(title: string): boolean {
  if (!title) return false;
  const normalizado = normalizarTexto(title);
  if (!normalizado) return false;

  for (const termo of COLLECTION_WORDS) {
    const termoNorm = normalizarTexto(termo);
    if (!termoNorm) continue;

    // Termos compostos: busca substring direta (o espaço já serve de delimitador).
    if (termoNorm.includes(' ')) {
      if (normalizado.includes(termoNorm)) return true;
      continue;
    }

    // Termos de 1 palavra: exige boundary antes e depois pra evitar "sagaz" casar "saga".
    const escaped = termoNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
    if (re.test(normalizado)) return true;
  }

  return false;
}

export function containsInternationalIndicators(title: string): {
  isInternational: boolean;
  indicators: string[];
  reason: string;
} {
  const lowerTitle = title.toLowerCase();
  const foundIndicators: string[] = [];
  for (const group of INTERNATIONAL_RELEASE_GROUPS) {
    if (lowerTitle.includes(group)) foundIndicators.push(group);
  }
  for (const tracker of INTERNATIONAL_TRACKERS) {
    if (lowerTitle.includes(tracker)) foundIndicators.push(tracker);
  }
  if (foundIndicators.length > 0) {
    return {
      isInternational: true,
      indicators: foundIndicators,
      reason: `Contém indicadores internacionais: ${foundIndicators.join(', ')}`,
    };
  }
  return { isInternational: false, indicators: [], reason: 'Nenhum indicador internacional encontrado' };
}

export function containsBrazilianIndicators(title: string): {
  isBrazilian: boolean;
  indicators: string[];
  reason: string;
} {
  const lowerTitle = title.toLowerCase();
  const foundIndicators: string[] = [];
  for (const group of BRAZILIAN_RELEASE_GROUPS) {
    if (lowerTitle.includes(group)) foundIndicators.push(group);
  }
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
      if (match && !foundIndicators.includes(match)) foundIndicators.push(match);
    }
  }
  if (foundIndicators.length > 0) {
    return {
      isBrazilian: true,
      indicators: foundIndicators,
      reason: `Contém indicadores brasileiros: ${foundIndicators.join(', ')}`,
    };
  }
  return { isBrazilian: false, indicators: [], reason: 'Nenhum indicador brasileiro encontrado' };
}

export function getTechnicalWordsStats() {
  return {
    totalAcronyms: TECHNICAL_ACRONYMS.length,
    totalCombined: TECHNICAL_ACRONYMS.length,
    internationalReleaseGroups: INTERNATIONAL_RELEASE_GROUPS.length,
    internationalTrackers: INTERNATIONAL_TRACKERS.length,
    brazilianReleaseGroups: BRAZILIAN_RELEASE_GROUPS.length,
    version: '1.5.0',
    description: 'Boundaries em SxxExx, S04 isolado, padrão Temp..(N) seguro, isCollectionTitle normalizado',
  };
}

export function getPotentialSequelNumbers(title: string): number[] {
  const lower = title.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
  const candidates: number[] = [];
  for (const token of allTokens) {
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 2 && n <= 19) candidates.push(n);
    }
  }
  const romanMap: Record<string, number> = {
    'ii': 2, 'iii': 3, 'iv': 4, 'v': 5, 'vi': 6, 'vii': 7, 'viii': 8, 'ix': 9, 'x': 10,
    'xi': 11, 'xii': 12, 'xiii': 13, 'xiv': 14, 'xv': 15, 'xvi': 16, 'xvii': 17, 'xviii': 18, 'xix': 19, 'xx': 20,
  };
  const romanMatch = title.match(/(?<!-)\b(I{1,3}|IV|VI{0,3}|IX|XI{0,3})\b(?!-)/g);
  if (romanMatch) {
    for (const r of romanMatch) {
      const num = romanMap[r.toLowerCase()];
      if (num && num >= 2 && num <= 20) candidates.push(num);
    }
  }
  const episodeRange = extrairRangeEpisodios(title);
  const result: number[] = [];
  for (const num of candidates) {
    if (episodeRange && num >= episodeRange.episodeStart && num <= episodeRange.episodeEnd) continue;
    if (!_isAudioChannelInOriginal(title, num)) {
      result.push(num);
    }
  }
  return [...new Set(result)];
}

export function extrairAno(texto: string): number[] | undefined {
  if (!texto) return undefined;

  const textoLimpo = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const candidatos = textoLimpo.match(/\b\d{4}\b/g) || [];

  const resolucoes = new Set([1080, 2160, 1440, 4320, 720, 480]);

  const anos = candidatos
    .map(Number)
    .filter(ano => {
      if (ano < 1000 || ano > 9999) return false;
      if (resolucoes.has(ano)) return false;
      return true;
    });

  return anos.length > 0 ? anos : undefined;
}

function _isAudioChannelInOriginal(originalTitle: string, num: number): boolean {
  const audioSpecRe = /[.\-(\s](\d+)\s*\.\s*(\d+)\s*(?:ch)?/gi;
  let m;
  while ((m = audioSpecRe.exec(originalTitle)) !== null) {
    if (parseInt(m[1]) === num || parseInt(m[2]) === num) return true;
  }
  const incompleteSpecRe = /(?:dual|audio|dublado|dolby|ac3|aac|dts|eac3|ddp?|ch|channel)\s*[.\-]\s*(\d+)\s*[.\-]/gi;
  while ((m = incompleteSpecRe.exec(originalTitle)) !== null) {
    if (parseInt(m[1]) === num) return true;
  }
  return false;
}

export interface EpisodeRange {
  season: number;
  episodeStart: number;
  episodeEnd: number;
}

// Extrai range de temporada/episódio de um título. Devolve null quando não há nada.
// Os padrões estão ordenados do mais específico ao mais genérico.
export function extrairRangeEpisodios(title: string): EpisodeRange | null {
  if (!title) return null;

  const t = title
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim();

  // ═══ Padrão 1: SxxExx (com múltiplos episódios opcionais) ═══
  // \b no início evita casar o "S" de "CLASS04"; \b no fim evita match parcial em E01123.
  const sxxExx = t.match(/\bs(\d{1,2})\s*e(\d{1,3})\b/i);
  if (sxxExx) {
    const season = parseInt(sxxExx[1]);
    const firstEp = parseInt(sxxExx[2]);
    const afterMatch = t.substring(sxxExx.index! + sxxExx[0].length);
    const epNums: number[] = [firstEp];

    const hyphenRange = afterMatch.match(/-(\d{1,3})\b/g);
    if (hyphenRange) hyphenRange.forEach(h => epNums.push(parseInt(h.replace('-', ''))));

    const commaRange = afterMatch.match(/(?:-|\s)\d{1,3}\s*[,]\s*(\d{1,3})\b/g);
    if (commaRange) {
      commaRange.forEach(c => {
        const n = c.match(/(\d{1,3})\s*$/);
        if (n) epNums.push(parseInt(n[1]));
      });
    }

    const explicitEps = afterMatch.match(/e(\d{1,3})(?=\s|$|\.|e|E|-)/gi);
    if (explicitEps) {
      explicitEps.forEach(e => epNums.push(parseInt(e.replace(/e/i, '').match(/\d+/)?.[0] || '0')));
    }

    const ptEpRange = afterMatch.match(/\s+e\s+(\d{1,3})\b/gi);
    if (ptEpRange) {
      ptEpRange.forEach(m => {
        const n = m.match(/(\d{1,3})$/);
        if (n) epNums.push(parseInt(n[1]));
      });
    }

    epNums.sort((a, b) => a - b);
    const unique = [...new Set(epNums)];
    return { season, episodeStart: unique[0], episodeEnd: unique[unique.length - 1] };
  }

  // ═══ Padrão 1b: Sxx (yy) ═══
  const sComEpParenteses = t.match(/\bs(\d{1,2})\s*\((\d{1,3})\)/i);
  if (sComEpParenteses) {
    const season = parseInt(sComEpParenteses[1]);
    const episode = parseInt(sComEpParenteses[2]);
    if (![1080, 720, 480, 2160, 1440, 4320].includes(episode)) {
      return { season, episodeStart: episode, episodeEnd: episode };
    }
  }

  // ═══ Padrão 1c: Sxx isolado — season pack (ex.: "Reacher.S04.1080p") ═══
  // \b antes impede "CLASS04"; \b depois impede "S04E01" (que já casou acima).
  const sIsolado = t.match(/\bs(\d{1,2})\b(?!\s*e\d)/i);
  if (sIsolado) {
    return { season: parseInt(sIsolado[1]), episodeStart: 0, episodeEnd: 0 };
  }

  // ═══ Padrão 2: 2x04 ═══
  const seasonXEp = t.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (seasonXEp) {
    return {
      season: parseInt(seasonXEp[1]),
      episodeStart: parseInt(seasonXEp[2]),
      episodeEnd: parseInt(seasonXEp[2]),
    };
  }

  // ═══ Padrão 3: Season 2 Episode 4 ═══
  const seasonEpText = t.match(/\b(?:season|temporada)\s*(\d{1,2})\s*(?:episode|epis[oó]dio|ep|e)\s*(\d{1,3})\b/i);
  if (seasonEpText) {
    return {
      season: parseInt(seasonEpText[1]),
      episodeStart: parseInt(seasonEpText[2]),
      episodeEnd: parseInt(seasonEpText[2]),
    };
  }

  // ═══ Padrão 3b: Temporada/Season/Temp N (M) — com gap controlado ═══
  // [^\d(]{0,20} evita capturar parênteses aleatórios longe do season.
  const tempComEpParenteses = t.match(/\b(?:temporada|season|temp|s)\s*(\d{1,2})\b[^\d(]{0,20}\(\s*(\d{1,3})\s*\)/i);
  if (tempComEpParenteses) {
    const season = parseInt(tempComEpParenteses[1]);
    const episode = parseInt(tempComEpParenteses[2]);
    if (![1080, 720, 480, 2160, 1440, 4320].includes(episode)) {
      return { season, episodeStart: episode, episodeEnd: episode };
    }
  }

  // ═══ Padrão 4a: Episódio N ao M ═══
  const episodioRangeWords = t.match(/\bepis[oó]dios?\s+(\d{1,3})\s*(?:ao?|a|ate|à|aos|e)\s*(\d{1,3})\b/i);
  if (episodioRangeWords) {
    return {
      season: 0,
      episodeStart: parseInt(episodioRangeWords[1]),
      episodeEnd: parseInt(episodioRangeWords[2]),
    };
  }

  // ═══ Padrão 4b: Episódio N-M ═══
  const episodioRangeHyphen = t.match(/\bepis[oó]dios?\s*(\d{1,3})\s*-\s*(\d{1,3})\b/i);
  if (episodioRangeHyphen) {
    return {
      season: 0,
      episodeStart: parseInt(episodioRangeHyphen[1]),
      episodeEnd: parseInt(episodioRangeHyphen[2]),
    };
  }

  // ═══ Padrão 4c: Nº e Mº episódio ═══
  const ptRangeComOrdinal = t.match(/(\d{1,3})\s*º\s*e\s*(\d{1,3})\s*º\s*epis[oó]dio/i);
  if (ptRangeComOrdinal) {
    return {
      season: 0,
      episodeStart: parseInt(ptRangeComOrdinal[1]),
      episodeEnd: parseInt(ptRangeComOrdinal[2]),
    };
  }

  // ═══ Padrão 5b: Nº episódio ═══
  const ptSingleComOrdinal = t.match(/(\d{1,3})\s*º\s*epis[oó]dio/i);
  if (ptSingleComOrdinal) {
    const ep = parseInt(ptSingleComOrdinal[1]);
    return { season: 0, episodeStart: ep, episodeEnd: ep };
  }

  // ═══ Padrão 5: Episódio N ═══
  const episodioOnly = t.match(/\bepis[oó]dio\s*(\d{1,3})\b/i);
  if (episodioOnly) {
    const ep = parseInt(episodioOnly[1]);
    return { season: 0, episodeStart: ep, episodeEnd: ep };
  }

  // ═══ Padrão 6: S02 / Season02 / 2x sozinhos ═══
  const sOnly = t.match(/^s(\d{1,2})$/i);
  if (sOnly) return { season: parseInt(sOnly[1]), episodeStart: 0, episodeEnd: 0 };
  const seasonOnly = t.match(/^season(\d{1,2})$/i);
  if (seasonOnly) return { season: parseInt(seasonOnly[1]), episodeStart: 0, episodeEnd: 0 };
  const xOnly = t.match(/^(\d{1,2})x$/i);
  if (xOnly) return { season: parseInt(xOnly[1]), episodeStart: 0, episodeEnd: 0 };

  // ═══ Padrão 7: Nª temporada ═══
  const tempPack = t.match(/\b(\d{1,2})\s*[ªº°]?\s*temporada\b/i);
  if (tempPack) {
    return { season: parseInt(tempPack[1]), episodeStart: 0, episodeEnd: 0 };
  }

  // ═══ Padrão 8: Season N ═══
  const seasonTag = t.match(/\b(?:season|temporada)\s*(\d{1,2})\b/i);
  if (seasonTag) return { season: parseInt(seasonTag[1]), episodeStart: 0, episodeEnd: 0 };

  // ═══ Padrão 9: temporada completa / complete season / season pack ═══
  const fullSeasonPattern = /\b(\d{1,2})\s*[ªº°]?\s*temporada\s*completa\b/i;
  const fullSeasonMatch = t.match(fullSeasonPattern);
  if (fullSeasonMatch) {
    return { season: parseInt(fullSeasonMatch[1]), episodeStart: 0, episodeEnd: 0 };
  }

  const completeSeasonEn = /\b(?:complete\s+season|season\s+complete)\s*(\d{1,2})\b/i;
  const completeSeasonEnMatch = t.match(completeSeasonEn);
  if (completeSeasonEnMatch) {
    return { season: parseInt(completeSeasonEnMatch[1]), episodeStart: 0, episodeEnd: 0 };
  }

  const seasonPackEn = /\b(?:season\s*pack|complete\s*pack|pack\s*completo)\s*[:\-]?\s*(\d{1,2})\b/i;
  const seasonPackEnMatch = t.match(seasonPackEn);
  if (seasonPackEnMatch) {
    return { season: parseInt(seasonPackEnMatch[1]), episodeStart: 0, episodeEnd: 0 };
  }

  return null;
}

console.log('[INFO] TechnicalWords carregado — v1.5.0');