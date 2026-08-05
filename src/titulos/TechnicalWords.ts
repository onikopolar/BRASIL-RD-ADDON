// Arquivo: src/titulos/technical-words.ts
// Palavras técnicas otimizadas para filtragem de títulos de torrents
// Exporta constantes para uso no SimilarityCalculator

// Palavras técnicas completas para remoção durante normalização
// Acrônimos técnicos para remoção durante normalização
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
  // Formatos 3D e variantes
  'hsbs', 'sbs', 'half-sbs', 'h-sbs', 'hou', 'half-ou', '3d',
  'rgb', 'yuv', 'ycbcr', 'hsv', 'hsl', 'cmyk',
  'ntsc', 'pal', 'secam', 'atsc', 'dvb', 'isdb',
  'ip', 'tcp', 'udp', 'http', 'https', 'ftp', 'sftp',
  'url', 'uri', 'urn', 'uuid', 'guid', 'hash', 'md5', 'sha1', 'sha256',
  // Qualidades e formatos de torrent
  '1080p', '720p', '2160p', '480p', '4k', '8k', 'fullhd', 'full-hd',
  'bluray', 'blu-ray', 'bdrip', 'brrip', 'webrip', 'web-dl', 'webdl',
  'hdtv', 'dvdrip', 'dvd', 'bd', 'remux', 'brrip', 'web',
  // Formatos de vídeo / encoding
  'matte', 'imax',
  // Idioma
  'dublado', 'dublada', 'dual', 'legendado', 'legendada', 'nacional',
  'portugues', 'português', 'pt-br', 'ptbr', 'brazilian',
  // Sufixos de arquivo / sites / tags comuns de torrent
  'www', 'com', 'org', 'net', 'tv', 'br', 'bludv', 'comando', 'comandotorrents',
  'torrents', 'filmes', 'hd', 'full', 'sf', 'dl', 'rip', 'xvid', 'divx',
  'mp3', 'aac', 'ac3', 'dts', 'eac3', 'ddp', 'dd', 'dolby',
  'h264', 'h265', 'x264', 'x265', 'avc', 'hevc', 'vp9', 'av1',
];

// Lista específica de grupos de release internacionais conhecidos
// Uso: para detectar e penalizar releases em inglês
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

// Lista específica de trackers internacionais conhecidos
export const INTERNATIONAL_TRACKERS = [
  '1337x', 'torrentday', 'iptorrents', 'filelist', 'torrentleech',
  'demonoid', 'kickasstorrents', 'kat', 'thepiratebay', 'tpb',
  'limetorrents', 'zooqle', 'torrentz2', 'torrentdownloads', 'mononoke',
  'nyaa', 'anidex', 'tokyotosho', 'rutracker', 'nnmclub', 'rartv', 'bone', 'BONE'
];

// Lista específica de grupos de release brasileiros conhecidos
// Uso: para dar bônus a releases em português
export const BRAZILIAN_RELEASE_GROUPS = [
  'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'comando1', 'cmdtv', 'cmdb',
  'dhg', 'divulgahd', 'legiahd', 'baixar', 'download', 'brasil',
  'seriesbr', 'filmesbr', 'bluraybr', 'hdbr',
  'webdlbr', 'torrentbr', 'starck', 'starckfilmes',
  'lapumia', 'comoeubaixo', 'bludv', 'BLUDV', 'WWW.BLUDV.COM',
  'luanharper', 'SiGLA', 'SF', 'WEB-DL', 'web-dl', 'AZTORRENTS',
  // Coleções / packs
  'trilogia', 'colecao', 'coleção', 'quadrilogy', 'quadrilogia', 'coletanea',
  'franquia', 'saga', 'duologia',
];

// Cache interno: junta todas as palavras "não-título" (técnicas + grupos + trackers)
const _ALL_NON_TITLE_WORDS = new Set<string>([
  ...TECHNICAL_ACRONYMS,
  ...BRAZILIAN_RELEASE_GROUPS,
  ...INTERNATIONAL_RELEASE_GROUPS,
  ...INTERNATIONAL_TRACKERS,
].map(w => w.toLowerCase()));

// Função auxiliar para verificar se uma palavra é técnica/metadado (não parte do título)
// Inclui palavras carregadas do strip-words.txt via TECHNICAL_STRIP_WORDS (definido abaixo)
export function isTechnicalWord(word: string): boolean {
  const lower = word.toLowerCase();
  return _ALL_NON_TITLE_WORDS.has(lower) || (typeof TECHNICAL_STRIP_WORDS !== 'undefined' && TECHNICAL_STRIP_WORDS.has(lower));
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
  'temporada', 'completa', 'completo', 'AZTORRENTS',
];

/** Palavras que indicam que um torrent eh internacional / nao-PT-BR */
export const INDICADORES_INTERNACIONAL_TORRENTS = [
  // VO / OV (version original)
  'vo', 'ov',
  // Legendas (legendado = nao-dublado, tratar como internacional)
  'legendado', 'legendada', 'legenda',
  // Forma truncada de "legendado" (ex: titulo cortado por limite de caracteres)
  // NOTA: "legend" NAO incluso — falso positivo com "Legends" (titulos de filmes)
  'lege',
  // Abreviacoes comuns de fansub
  'yg', 'KyoGo', 'kyogo', 'english', 'English', 'hindi', "Hindi",
  'turg', 'Turg', 'TURG', 'fitgirl', 'FitGirl', 'steamrip',
  'g4ris', 'rartv', 'ntb', 'bone', 'BONE', 'ION10', '10bit', 'CM', 'RDNYB', 'DCPRiP',

];

// ─── FUNCOES ───

// Palavras que indicam coletânea/pack de filmes
const COLLECTION_WORDS = new Set([
  'trilogia', 'colecao', 'coleção', 'quadrilogy', 'quadrilogia',
  'coletanea', 'franquia', 'duologia', 'saga',
  'all seasons', 'todas as temporadas', 'temporada completa', 'complete season',
  'season pack', 'complete series', 'serie completa',
  'todos os episódios', 'todos os episodios', 'temporadas',
]);

/** Verifica se o título do torrent é uma coletânea (trilogia, quadrilogia, etc.) */
export function isCollectionTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return [...COLLECTION_WORDS].some(w => lower.includes(w));
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
    totalAcronyms: TECHNICAL_ACRONYMS.length,
    totalCombined: TECHNICAL_ACRONYMS.length,
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

  // Extrai todos os tokens (split por espaço E por ponto)
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

  // Extrai números puros 2-19
  const candidates: number[] = [];
  for (const token of allTokens) {
    if (/^\d+$/.test(token)) {
      const n = Number(token);
      if (n >= 2 && n <= 19) candidates.push(n);
    }
  }

  // Extrai números romanos (I, II, III, IV...) do título original
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

  // Filtra: remove números que estão em contexto de episódio ou especificação de áudio
  const episodeRange = extrairRangeEpisodios(title);
  const result: number[] = [];
  for (const num of candidates) {
    // Dentro do range de episódios → não é número de sequência
    if (episodeRange && num >= episodeRange.episodeStart && num <= episodeRange.episodeEnd) continue;
    // Especificação de áudio (ex.: "5.1") → não é número de sequência
    if (!_isAudioChannelInOriginal(title, num)) {
      result.push(num);
    }
  }

  return [...new Set(result)];
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

  // ═══ Padrão 4: S6, S06, season6, 6x (temporada avulsa, sem episódio) ═══
  const sOnly = t.match(/^s(\d{1,2})$/i);
  if (sOnly) return { season: parseInt(sOnly[1]), episodeStart: 0, episodeEnd: 0 };
  const seasonOnly = t.match(/^season(\d{1,2})$/i);
  if (seasonOnly) return { season: parseInt(seasonOnly[1]), episodeStart: 0, episodeEnd: 0 };
  const xOnly = t.match(/^(\d{1,2})x$/i);
  if (xOnly) return { season: parseInt(xOnly[1]), episodeStart: 0, episodeEnd: 0 };

  // ═══ Padrão 5: "5° Temporada", "1ª Temporada", "2 Temporada" (pack sem episódio) ═══
  const tempPack = t.match(/\b(\d{1,2})\s*[ªº°]?\s*temporada\b/i);
  if (tempPack) return { season: parseInt(tempPack[1]), episodeStart: 0, episodeEnd: 0 };

  // ═══ Padrão 6: "Season 5", "Temporada 5" (avulso, sem episódio) ═══
  const seasonTag = t.match(/\b(?:season|temporada)\s*(\d{1,2})\b/i);
  if (seasonTag) return { season: parseInt(seasonTag[1]), episodeStart: 0, episodeEnd: 0 };

  return null;
}
console.log('[DEBUG] [TechnicalWords] Iniciada verificação de grupos internacionais/brasileiros');

// ═══════════════════════════════════════════════════════════════════════
//  NORMALIZAÇÃO DE TÍTULOS — remove SÓ palavras técnicas
//  Deixa temporada/episódio para outros métodos lidarem com regex próprio
// ═══════════════════════════════════════════════════════════════════════

/** Palavras técnicas mantidas como Set vazio — o sistema de strip-words foi descontinuado
 *  em favor da extração de Título Original diretamente do HTML dos sites (BLUDV, Comando). */
export const TECHNICAL_STRIP_WORDS: Set<string> = new Set();
