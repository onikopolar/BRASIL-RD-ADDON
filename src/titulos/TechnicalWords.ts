// Arquivo: src/titulos/technical-words.ts
// Palavras técnicas otimizadas para filtragem de títulos de torrents
// Exporta constantes para uso no SimilarityCalculator

// Palavras técnicas completas para remoção durante normalização
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
  'anoxmous', 'bamboozle', 'cab', 'c0ke', 'cm8', 'crimson', 'drones', 'ebi', 'rartv', '[rartv]'
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
  'luanharper','SiGLA', 'SF', 'WEB-DL', 'web-dl'
];

// Função auxiliar para verificar se uma palavra é técnica
export function isTechnicalWord(word: string): boolean {
  const lowerWord = word.toLowerCase();
  return TECHNICAL_ACRONYMS.includes(lowerWord);
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
  'temporada', 'completa', 'completo',
];

/** Palavras que indicam que um torrent eh internacional / nao-PT-BR */
export const INDICADORES_INTERNACIONAL_TORRENTS = [
  // VO / OV (version original)
  'vo', 'ov',
  // Legendas (legendado = nao-dublado, tratar como internacional)
  'legendado', 'legendada', 'legenda',
  // Abreviacoes comuns de fansub
  'yg', 'KyoGo', 'kyogo', 'english', 'English', 'hindi', "Hindi",
  'turg', 'Turg','TURG','fitgirl', 'FitGirl','steamrip',
  'g4ris', 'rartv', 'ntb', 'bone', 'BONE'

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

  // c) Contexto PT de episódio/temporada: "Episódio 5", "5ª Temporada", "Temporada 5"
  const epPtRe = /\b(?:episodio|episódio)\s+(\d{1,3})\b/gi;
  while ((m = epPtRe.exec(lowerTitle)) !== null) {
    if (Number(m[1]) === num) return true;
  }
  const tempPtRe = /\b(\d{1,2})\s*ª?\s*(?:temporada|temp)\b|\b(?:temporada|temp)\s+(\d{1,2})\b/gi;
  while ((m = tempPtRe.exec(lowerTitle)) !== null) {
    const n = Number(m[1] || m[2]);
    if (n === num) return true;
  }

  // d) Range de episodios: S01E01-02, S01E01 02
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
  'download', 'listao', 'filmes', 'acesse',
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
  // PT: versões estendidas
  'estendido', 'estendida', 'versao', 'versão',
  // Domínios/spam nos DNs de magnet
  'sitedetorrents', 'hidratorrents',
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
  /\b\d{3,4}x\d{3,4}\b/gi,      // resolução WxH (1280x544, 1920x1080)
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

// ═══════════════════════════════════════════════════════════════════════
//  STRIP AUTO-LEARNER — auto-adiciona palavras ao TECHNICAL_STRIP_WORDS
//  com verificação reversa no TMDB (se a palavra existe em algum título
//  real, ela NÃO é termo técnico — é palavra legítima).
// ═══════════════════════════════════════════════════════════════════════

const AUTO_LEARN_THRESHOLD = 3;
const TMDB_API_KEY = typeof process !== 'undefined' ? (process.env as any)?.TMDB_API_KEY : undefined;

const learnerCounts = new Map<string, { count: number; imdbIds: Set<string> }>();
const tmdbVerifiedWords = new Set<string>();

// ── Persistência: data/strip-words.txt (1 palavra por linha) ──
import * as fs from 'fs';
import * as path from 'path';
const STRIP_FILE = path.join(process.cwd(), 'data', 'strip-words.txt');

// Carrega palavras persistidas no startup
try {
  if (fs.existsSync(STRIP_FILE)) {
    const lines = fs.readFileSync(STRIP_FILE, 'utf-8').split('\n').map(l => l.trim()).filter(Boolean);
    for (const w of lines) TECHNICAL_STRIP_WORDS.add(w);
    console.log(`[StripAutoLearner] 📂 ${lines.length} palavras carregadas de data/strip-words.txt`);
  }
} catch { /* ignora */ }

function persistStripWord(word: string): void {
  try {
    const dir = path.dirname(STRIP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(STRIP_FILE, word + '\n');
  } catch { /* ignora */ }
}

let axiosModule: any = null;
async function getAxios() {
  if (!axiosModule) {
    axiosModule = await import('axios');
  }
  return axiosModule.default || axiosModule;
}

/**
 * Verifica se uma palavra existe em QUALQUER título do TMDB.
 * Se existir, é palavra legítima (ex: "korra"), não termo técnico.
 * Fallback: se API falhar, usa TMDB search HTML.
 */
async function tmdbReverseLookup(word: string): Promise<boolean> {
  // Tenta API primeiro
  if (TMDB_API_KEY) {
    try {
      const axios = await getAxios();
      const resp = await axios.get('https://api.themoviedb.org/3/search/multi', {
        params: {
          api_key: TMDB_API_KEY,
          query: word,
          language: 'pt-BR',
          page: 1,
        },
        timeout: 5000,
      });
      const total = resp.data?.total_results || 0;
      if (total > 0) return true;
    } catch {
      // API falhou, tenta HTML
    }
  }

  // Fallback: TMDB search HTML
  try {
    const axios = await getAxios();
    const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(word)}`;
    const resp = await axios.get(searchUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    });
    const html: string = resp.data;
    // Procura por links /movie/ ou /tv/ nos resultados
    const hasResults = /\/movie\/\d+/.test(html) || /\/tv\/\d+/.test(html);
    return hasResults;
  } catch {
    return false;
  }
}

/**
 * Registra uma palavra anômala detectada em rejeição Condition F.
 * 
 * Fluxo:
 * 1. Acumula ocorrências por IMDB
 * 2. Ao atingir threshold → verifica TMDB reverso
 * 3. Se TMDB tem ≥1 resultado → palavra é legítima, NUNCA strip
 * 4. Se TMDB tem 0 resultados → termo técnico, AUTO-ADICIONA ao strip
 * 
 * @param word Palavra anômala (lowercase)
 * @param imdbId IMDB do torrent onde foi detectada
 * @returns true se a palavra foi auto-adicionada agora
 */
export function registerStripCandidate(word: string, imdbId?: string): boolean {
  const key = word.toLowerCase();
  
  // Já verificado pelo TMDB como palavra real → ignora
  if (tmdbVerifiedWords.has(key)) return false;
  
  if (!learnerCounts.has(key)) {
    learnerCounts.set(key, { count: 0, imdbIds: new Set() });
  }
  
  const entry = learnerCounts.get(key)!;
  entry.count++;
  if (imdbId) entry.imdbIds.add(imdbId);
  
  // Threshold: ≥N IMDBs diferentes
  if (entry.imdbIds.size >= AUTO_LEARN_THRESHOLD && !TECHNICAL_STRIP_WORDS.has(key)) {
    // Dispara verificação TMDB assíncrona (fire-and-forget)
    tmdbReverseLookup(key).then(existsInTmdb => {
      if (existsInTmdb) {
        // Palavra existe no TMDB → é legítima, NUNCA strip
        tmdbVerifiedWords.add(key);
        console.log(`[StripAutoLearner] 🔒 "${key}" existe no TMDB — NÃO é termo técnico, bloqueado permanentemente`);
      } else {
        // Palavra NÃO existe no TMDB → salva no arquivo (carrega no próximo startup)
        persistStripWord(key);
        console.log(`[StripAutoLearner] ✅ "${key}" → salvo em data/strip-words.txt (${entry.imdbIds.size} IMDBs)`);
      }
    }).catch(() => {
      persistStripWord(key);
      console.log(`[StripAutoLearner] ⚠️ "${key}" → salvo (fallback)`);
    });
    
    return true; // vai ser processado async
  }
  
  return false;
}

/**
 * Retorna estatísticas do auto-learner.
 */
export function getStripLearnerStats() {
  const candidates = [...learnerCounts.entries()]
    .filter(([, v]) => v.imdbIds.size >= 2)
    .sort(([, a], [, b]) => b.imdbIds.size - a.imdbIds.size);
  
  return {
    totalTracked: learnerCounts.size,
    autoLearned: [...TECHNICAL_STRIP_WORDS].filter(w => learnerCounts.has(w)).length,
    tmdbBlocked: tmdbVerifiedWords.size,
    pending: candidates.filter(([w]) => !TECHNICAL_STRIP_WORDS.has(w) && !tmdbVerifiedWords.has(w)).map(([w, v]) => ({
      word: w,
      occurrences: v.count,
      uniqueImdbs: v.imdbIds.size,
    })),
  };
}
