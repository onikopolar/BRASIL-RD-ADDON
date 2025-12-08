"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHashFromMagnet = extractHashFromMagnet;
exports.generateLazyResolveUrl = generateLazyResolveUrl;
exports.generateOldLazyResolveUrl = generateOldLazyResolveUrl;
function extractHashFromMagnet(magnet) {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
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
    if (type) {
        params.append('type', type);
    }
    if (type === 'series' && season !== undefined) {
        params.append('season', season.toString());
        if (episode !== undefined) {
            params.append('episode', episode.toString());
        }
    }
    const queryString = params.toString();
    if (queryString) {
        url += `?${queryString}`;
    }
    return url;
}
function generateOldLazyResolveUrl(magnet, apiKey, type, season, episode) {
    const encodedMagnet = Buffer.from(magnet).toString('base64');
    const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
    const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
    let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}`;
    if (type) {
        url += `&type=${type}`;
    }
    if (type === 'series' && season !== undefined) {
        url += `&season=${season}`;
        if (episode !== undefined) {
            url += `&episode=${episode}`;
        }
    }
    return url;
}
