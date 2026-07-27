"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BRAZILIAN_RELEASE_GROUPS = exports.INTERNATIONAL_TRACKERS = exports.INTERNATIONAL_RELEASE_GROUPS = exports.TECHNICAL_ACRONYMS = exports.TECHNICAL_WORDS = void 0;
exports.isTechnicalWord = isTechnicalWord;
exports.isInternationalReleaseGroup = isInternationalReleaseGroup;
exports.isInternationalTracker = isInternationalTracker;
exports.isBrazilianReleaseGroup = isBrazilianReleaseGroup;
exports.getLanguageTerms = getLanguageTerms;
exports.containsInternationalIndicators = containsInternationalIndicators;
exports.containsBrazilianIndicators = containsBrazilianIndicators;
exports.getTechnicalWordsStats = getTechnicalWordsStats;
exports.TECHNICAL_WORDS = [
    'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv', 'rmvb', 'm2ts', 'ts', 'm4v', 'vob', 'ogv', '3gp', 'mts', 'm2t', 'mxf',
    '720p', '1080p', '2160p', '4k', 'hd', 'fullhd', 'uhd', 'sd', 'fhd', 'hdr', 'dv', 'uhdhdr', 'blurayremux', 'remux', '4kuhd',
    '480p', '576p', '360p', '240p', '144p', '8k', '2k', 'qhd', 'whd', 'fhd', 'hq', 'lq', 'mhd', 'vcd', 'svcd',
    'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx', 'vp9', 'av1', 'prores', 'dnxhd', 'cineform', 'mjpeg',
    'h263', 'h261', 'mpeg2', 'mpeg4', 'wmv9', 'vc1', 'indeo', 'theora', 'rv', 'realvideo', 'sorenson', 'cinepak',
    'dvavi', 'mpeg1', 'm1v', 'm2v', 'm4v', 'hvc1', 'hev1', 'vp8', 'vp6', 'vp7', 'vp10', 'daala',
    'ac3', 'dts', 'aac', 'dd5.1', 'dolby', 'atmos', 'truehd', 'dts-hd', 'dtshd', 'mp3', 'ogg', 'opus', 'flac', 'alac',
    'wav', 'pcm', 'aiff', 'wma', 'vorbis', 'eac3', 'dd+', 'ddp', 'dtsx', 'dtsma', 'lpcm', 'dsd',
    '2.0', '5.1', '7.1', '5.1ch', '7.1ch', '2ch', 'stereo', 'mono', 'surround', '6ch', '8ch',
    'mp2', 'ra', 'ram', 'mid', 'midi', 'amr', 'amrnb', 'amrwb', 'qcelp', 'evrc', 'smv', 'g729',
    'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv', 'camrip', 'ts', 'tc', 'r5', 'scr', 'dvdscr', 'bdscr', 'webscr',
    'ppvrip', 'hdrip', 'bdscr', 'r6', 'telecine', 'satrip', 'iptv', 'dsr', 'pdtv', 'hdtvrip', 'uhdrip', '4kuhd',
    'amzn', 'nf', 'hulu', 'dsnp', 'atvp', 'hmax', 'appletv', 'prime', 'disney', 'hbo', 'max', 'netflix', 'amazon',
    'hdtc', 'hdts', 'dvdscr', 'r5line', 'dvd5', 'dvd9', 'bd25', 'bd50', 'uhd100', 'webcap', 'hdcam', 'hdrc',
    'sat', 'cable', 'dtv', 'atv', 'itunes', 'google', 'vudu', 'ma', 'uv', 'aiv', 'h264', 'h265',
    'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio', 'legendado', 'legendada', 'legenda', 'sub', 'subtitle',
    'multilanguage', 'multiaudio', 'multisub', 'multi', 'tri', 'triaudio', 'trilanguage', 'subforced', 'subs',
    'dub', 'dubbed', 'subtitled', 'captions', 'cc', 'srt', 'ass', 'ssa', 'vtt', 'idx', 'sub', 'sup',
    'english', 'french', 'spanish', 'german', 'italian', 'japanese', 'korean', 'chinese', 'russian',
    'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br', 'portugues', 'português', 'eng', 'english', 'ingles', 'spanish', 'espanol',
    'french', 'francês', 'german', 'alemão', 'italian', 'italiano', 'japanese', 'japonês', 'chinese', 'chinês',
    'korean', 'coreano', 'russian', 'russo', 'brazilian', 'brasileiro', 'latino', 'latin', 'internacional',
    'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh', 'ru', 'ar', 'hi', 'tr', 'nl', 'pl', 'sv', 'no', 'da', 'fi',
    'yts', 'yify', 'rarbg', 'rartv', 'ettv', 'eztv', 'skgtv', 'turbo', 'cakes', 'galaxyrg', 'ctrlhd', 'framestor', 'tayto',
    'ntb', 'cmrg', 'evolve', 'mteam', 'chd', 'hds', 'chdbits', 'hdchina', 'ptp', 'btn', 'ahd', 'bhd', 'decode',
    'fum', 'tbs', 'flux', 'ife', 'legion', 'mrm', 'playbd', 'strife', 'viet', 'vtv', 'ws', 'xforce',
    'sva', 'exc', 'phd', 'grym', 'jyk', 'kings', 'dimension', 'sparks', 'geckos', 'loki', 'memento', 'quid',
    'mazemaze', 'kognitiv', 'anoxmous', 'bamboozle', 'cab', 'c0ke', 'cm8', 'crimson', 'drones', 'ebi',
    'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'cmdtv', 'cmdb', 'dhg', 'divulgahd', 'legiahd',
    'baixar', 'download', 'downloadseries', 'downloadfilmes', 'brasil', 'brrip', 'br-rip',
    'seriesbr', 'filmesbr', 'bluraybr', 'hdbr', 'webdlbr', 'torrentbr',
    '1337x', 'torrentday', 'iptorrents', 'filelist', 'torrentleech', 'demonoid', 'kickasstorrents', 'kat',
    'thepiratebay', 'tpb', 'limetorrents', 'zooqle', 'torrentz2', 'torrentdownloads', 'mononoke',
    'nyaa', 'anidex', 'tokyotosho', 'rutracker', 'nnmclub', 'pornolab', 'empornium',
    'repack', 'proper', 'extended', 'directors', 'cut', 'remastered', 'complete', 'uncensored', 'uncut', 'limited', 'special', 'edition',
    'directors.cut', 'theatrical', 'unrated', 'imax', '3d', '4dx', 'final', 'version', 'collectors', 'anniversary',
    'restored', 'remux', 'se', 'dc', 'ue', 'ce', 'te', 'ee', 'le', 've', 're', 'ue', 'pe', 'fe',
    'extended.cut', 'theatrical.cut', 'ultimate', 'deluxe', 'premium', 'gold', 'platinum', 'definitive',
    'international', 'us', 'uk', 'eu', 'asia', 'jpn', 'kor', 'chn', 'rus', 'bra', 'ger', 'fra', 'ita',
    'temporada', 'season', 'episodio', 'episódio', 'episode', 'complete', 'pack', 'collection', 'boxset', 'anthology',
    'movie', 'the movie', 'cinema', 'cinematográfico', 'cinematografico', 'filme', 'serie', 'series', 'show',
    's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 's12', 's13', 's14', 's15',
    'e0', 'e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9', 'e10', 'e11', 'e12', 'e13', 'e14', 'e15',
    'ep0', 'ep1', 'ep2', 'ep3', 'ep4', 'ep5', 'ep6', 'ep7', 'ep8', 'ep9', 'ep10', 'ep11', 'ep12', 'ep13', 'ep14', 'ep15',
    'versão', 'versao', 'version', 'edição', 'edicao', 'edition', 'completo', 'completa', 'complete',
    'torrent', 'download', 'baixar', 'assistir', 'online', 'stream', 'streaming',
    'free', 'full', 'part', 'parts', 'cd', 'cd1', 'cd2', 'disc', 'disc1', 'disc2', 'disk', 'disk1', 'disk2',
    'the', 'of', 'and', 'in', 'to', 'a', 'an', 'for', 'with', 'on', 'at', 'by', 'from', 'as', 'is', 'it', 'that', 'this',
    'or', 'but', 'not', 'be', 'are', 'was', 'were', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should',
    'can', 'could', 'may', 'might', 'must', 'shall', 'ought',
    'web', 'dl', 'rip', 'cam', 'part', 'pt', 'vol', 'volume', 'ª', 'º', 'cap', 'chapter', 'ep', 's',
    'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
    'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
    'encoded', 'encoding', 'transcoded', 'transcoding', 'bitrate', 'bit', 'rate', 'fps', 'hz', 'khz', 'mb', 'gb',
    'high', 'quality', 'low', 'medium', 'standard', 'premium', 'ultimate', 'extreme', 'master', 'professional',
    'bitrate', 'samplerate', 'vbr', 'cbr', 'abr', 'crf', 'qp', 'preset', 'profile', 'level', 'tier',
    'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo',
    'container', 'format', 'file', 'files', 'disc', 'dvd', 'bd', 'blu', 'ray', 'uhdbluray', 'hddvd',
    'matroska', 'mpegts', 'mpegps', 'avi', 'mov', 'mp4', 'flv', 'wmv', 'ogv', 'webm', '3gp',
    'channel', 'channels', 'sound', 'track', 'tracks', 'voice', 'over', 'narration', 'commentary',
    'descriptive', 'audiodescription', 'ad', 'sdh', 'cc', 'subtitles', 'karaoke', 'instrumental',
    'vocals', 'dialogue', 'effects', 'foley', 'music', 'score', 'soundtrack',
    'frame', 'frames', 'resolution', 'aspect', 'ratio', 'pixel', 'pixels', 'color', 'colors', 'grading',
    'gamma', 'contrast', 'brightness', 'saturation', 'hue', 'luminance', 'chroma',
    'interlaced', 'progressive', 'field', 'fields', 'telecine', 'ivtc', 'deinterlace',
    'compressed', 'uncompressed', 'lossless', 'lossy', 'zip', 'rar', '7z', 'gz', 'bz2', 'lzma',
    'archive', 'compression', 'decompression', 'extract', 'extracted',
    'peer', 'peers', 'seeder', 'seeders', 'leecher', 'leechers', 'swarm', 'tracker', 'trackers',
    'magnet', 'torrent', 'bittorrent', 'utorrent', 'qbittorrent', 'transmission', 'deluge',
    'ratio', 'upload', 'download', 'bandwidth', 'speed', 'throttle', 'throttling',
    'media', 'entertainment', 'film', 'cinema', 'theater', 'theatre', 'broadcast', 'television',
    'streaming', 'vod', 'pvod', 'tvod', 'avod', 'svod', 'live', 'broadcast',
    'season', 'series', 'episode', 'pilot', 'finale', 'midseason', 'special', 'marathon', 'binge',
    'arc', 'storyline', 'plot', 'character', 'characters', 'cast', 'crew', 'director', 'producer',
    'writer', 'creator', 'showrunner', 'network', 'studio', 'production',
];
exports.TECHNICAL_ACRONYMS = [
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
    'hsbs', 'sbs', 'half-sbs', 'h-sbs', 'hou', 'half-ou', '3d',
    'rgb', 'yuv', 'ycbcr', 'hsv', 'hsl', 'cmyk',
    'ntsc', 'pal', 'secam', 'atsc', 'dvb', 'isdb',
    'ip', 'tcp', 'udp', 'http', 'https', 'ftp', 'sftp',
    'url', 'uri', 'urn', 'uuid', 'guid', 'hash', 'md5', 'sha1', 'sha256',
];
exports.INTERNATIONAL_RELEASE_GROUPS = [
    'skgtv', 'rartv', 'ettv', 'eztv', 'vtv', 'yts', 'yify', 'rarbg',
    'turbo', 'cakes', 'galaxyrg', 'ctrlhd', 'framestor', 'tayto', 'ntb',
    'cmrg', 'evolve', 'mteam', 'chd', 'hds', 'fum', 'tbs', 'flux',
    'ife', 'legion', 'mrm', 'playbd', 'strife', 'viet', 'ws', 'xforce',
    'sva', 'exc', 'phd', 'grym', 'jyk', 'kings', 'dimension', 'sparks',
    'geckos', 'loki', 'memento', 'quid', 'mazemaze', 'kognitiv',
    'anoxmous', 'bamboozle', 'cab', 'c0ke', 'cm8', 'crimson', 'drones', 'ebi',
];
exports.INTERNATIONAL_TRACKERS = [
    '1337x', 'torrentday', 'iptorrents', 'filelist', 'torrentleech',
    'demonoid', 'kickasstorrents', 'kat', 'thepiratebay', 'tpb',
    'limetorrents', 'zooqle', 'torrentz2', 'torrentdownloads', 'mononoke',
    'nyaa', 'anidex', 'tokyotosho', 'rutracker', 'nnmclub',
];
exports.BRAZILIAN_RELEASE_GROUPS = [
    'bludv', 'blu-dv', 'mkvplus', 'mkv+', 'comando', 'cmdtv', 'cmdb',
    'dhg', 'divulgahd', 'legiahd', 'baixar', 'download', 'brasil',
    'brrip', 'br-rip', 'seriesbr', 'filmesbr', 'bluraybr', 'hdbr',
    'webdlbr', 'torrentbr',
];
function isTechnicalWord(word) {
    const lowerWord = word.toLowerCase();
    return exports.TECHNICAL_WORDS.includes(lowerWord) || exports.TECHNICAL_ACRONYMS.includes(lowerWord);
}
function isInternationalReleaseGroup(word) {
    const lowerWord = word.toLowerCase();
    return exports.INTERNATIONAL_RELEASE_GROUPS.includes(lowerWord);
}
function isInternationalTracker(word) {
    const lowerWord = word.toLowerCase();
    return exports.INTERNATIONAL_TRACKERS.includes(lowerWord);
}
function isBrazilianReleaseGroup(word) {
    const lowerWord = word.toLowerCase();
    return exports.BRAZILIAN_RELEASE_GROUPS.includes(lowerWord);
}
function getLanguageTerms() {
    return [
        'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
        'legendado', 'legendada', 'legenda', 'pt-br', 'ptbr', 'pt_br',
        'pt.br', 'pt br', 'portugues', 'português', 'brazilian', 'multi',
        'portuguese', 'brasileiro', 'latino', 'espanol', 'spanish'
    ];
}
function containsInternationalIndicators(title) {
    const lowerTitle = title.toLowerCase();
    const foundIndicators = [];
    for (const group of exports.INTERNATIONAL_RELEASE_GROUPS) {
        if (lowerTitle.includes(group)) {
            foundIndicators.push(group);
        }
    }
    for (const tracker of exports.INTERNATIONAL_TRACKERS) {
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
function containsBrazilianIndicators(title) {
    const lowerTitle = title.toLowerCase();
    const foundIndicators = [];
    for (const group of exports.BRAZILIAN_RELEASE_GROUPS) {
        if (lowerTitle.includes(group)) {
            foundIndicators.push(group);
        }
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
function getTechnicalWordsStats() {
    return {
        totalWords: exports.TECHNICAL_WORDS.length,
        totalAcronyms: exports.TECHNICAL_ACRONYMS.length,
        totalCombined: exports.TECHNICAL_WORDS.length + exports.TECHNICAL_ACRONYMS.length,
        internationalReleaseGroups: exports.INTERNATIONAL_RELEASE_GROUPS.length,
        internationalTrackers: exports.INTERNATIONAL_TRACKERS.length,
        brazilianReleaseGroups: exports.BRAZILIAN_RELEASE_GROUPS.length,
        version: '1.1.0',
        description: 'Adicionada detecção inteligente de releases internacionais/brasileiros'
    };
}
console.log('[INFO] [TechnicalWords] Versão 1.1.0 carregada - Detecção inteligente de releases');
console.log('[DEBUG] [TechnicalWords] Iniciada verificação de grupos internacionais/brasileiros');
