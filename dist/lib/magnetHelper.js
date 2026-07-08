"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHashFromMagnet = extractHashFromMagnet;
exports.generateLazyResolveUrl = generateLazyResolveUrl;
exports.generateOldLazyResolveUrl = generateOldLazyResolveUrl;
function base32ToHex(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = base32.toUpperCase().replace(/=+$/, '');
    let bits = '';
    for (let i = 0; i < cleaned.length; i++) {
        const val = alphabet.indexOf(cleaned[i]);
        if (val === -1)
            throw new Error(`Caractere inválido em Base32: ${cleaned[i]}`);
        bits += val.toString(2).padStart(5, '0');
    }
    const relevantBits = bits.slice(0, 160);
    let hex = '';
    for (let i = 0; i < relevantBits.length; i += 4) {
        const nibble = relevantBits.substring(i, i + 4);
        hex += parseInt(nibble, 2).toString(16);
    }
    return hex.padStart(40, '0').slice(0, 40).toLowerCase();
}
function extractHashFromMagnet(magnet) {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    if (!match)
        return null;
    let hash = match[1].toLowerCase();
    if (hash.length === 32 && /^[a-z2-7]+$/.test(hash)) {
        try {
            hash = base32ToHex(hash);
        }
        catch {
            return null;
        }
    }
    else if (hash.length !== 40 || !/^[a-f0-9]{40}$/.test(hash)) {
        return null;
    }
    return hash;
}
function generateLazyResolveUrl(magnet, apiKey, filename = 'video.mkv', fileIndex = 0, type, season, episode) {
    const infoHash = extractHashFromMagnet(magnet);
    if (!infoHash) {
        throw new Error('Could not extract info hash from magnet');
    }
    const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
    const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
    const encodedFilename = encodeURIComponent(filename);
    let url = `${protocol}://${domain}/resolve/realdebrid/${apiKey}/${infoHash}/null/${fileIndex}/${encodedFilename}`;
    const params = new URLSearchParams();
    if (type)
        params.append('type', type);
    if (type === 'series' && season !== undefined) {
        params.append('season', season.toString());
        if (episode !== undefined)
            params.append('episode', episode.toString());
    }
    const queryString = params.toString();
    if (queryString)
        url += `?${queryString}`;
    return url;
}
function generateOldLazyResolveUrl(magnet, apiKey, type, season, episode) {
    const encodedMagnet = Buffer.from(magnet).toString('base64');
    const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
    const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
    let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}`;
    if (type)
        url += `&type=${type}`;
    if (type === 'series' && season !== undefined) {
        url += `&season=${season}`;
        if (episode !== undefined)
            url += `&episode=${episode}`;
    }
    return url;
}
