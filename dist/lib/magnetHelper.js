"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractHashFromMagnet = extractHashFromMagnet;
exports.generateLazyResolveUrl = generateLazyResolveUrl;
function extractHashFromMagnet(magnet) {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}
function generateLazyResolveUrl(magnet, apiKey, type, season, episode) {
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
