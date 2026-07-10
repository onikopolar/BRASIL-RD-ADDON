import { QualityPattern } from './torrentTypes.js';

export const maxRetries = 3;
export const retryDelay = 1500;

export const allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);

export const qualityPriority: Record<string, number> = {
    '2160p': 400,
    '1080p': 300,
    '720p': 200,
    'HD': 150
};

export const ignoredWords = new Set([
    'filme', 'series', 'temporada', 'season', 'download', 'torrent',
    'com', 'de', 'e', 'the', 'and', 'pt-br', 'dual', 'dublado',
    'legendado', 'bluray', 'web-dl', '1080p', '720p', '480p', '2160p',
    'complete', 'completa', 'full', 'webrip', 'hdtv', 'brrip', 'bdrip',
    'acesse', 'original', 'www', 'tv', 'encoder', 'by', 'mkv', 'mp4',
    'avi', 'x264', 'x265', 'h264', 'h265', 'aac', 'ac3', 'dts'
]);

export const promotionalKeywords = [
    'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
    'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
    'spam', 'advertisement', 'publicidade'
];

export const qualityPatterns: QualityPattern[] = [
    { pattern: /\.2160p\./i, quality: '2160p', confidence: 100 },
    { pattern: /\.4k\./i, quality: '2160p', confidence: 100 },
    { pattern: /\b2160p\b/i, quality: '2160p', confidence: 98 },
    { pattern: /\b4k\b/i, quality: '2160p', confidence: 98 },
    { pattern: /2160p/i, quality: '2160p', confidence: 95 },
    { pattern: /4k/i, quality: '2160p', confidence: 95 },
    { pattern: /\buhd\b/i, quality: '2160p', confidence: 90 },
    { pattern: /\bultra.hd\b/i, quality: '2160p', confidence: 90 },
    
    { pattern: /\.1080p\./i, quality: '1080p', confidence: 100 },
    { pattern: /\b1080p\b/i, quality: '1080p', confidence: 98 },
    { pattern: /1080p/i, quality: '1080p', confidence: 95 },
    { pattern: /\bfhd\b/i, quality: '1080p', confidence: 90 },
    { pattern: /\bfull.hd\b/i, quality: '1080p', confidence: 90 },
    
    { pattern: /\.720p\./i, quality: '720p', confidence: 100 },
    { pattern: /\b720p\b/i, quality: '720p', confidence: 98 },
    { pattern: /720p/i, quality: '720p', confidence: 95 },
    { pattern: /\bhd.rip\b/i, quality: '720p', confidence: 85 },
    
    { pattern: /\.hd\./i, quality: 'HD', confidence: 90 },
    { pattern: /\bhd\b/i, quality: 'HD', confidence: 80 },
    { pattern: /\bhigh.def\b/i, quality: 'HD', confidence: 80 },

    { pattern: /\.web-dl\./i, quality: '1080p', confidence: 95 },
    { pattern: /\.bluray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.blu-ray\./i, quality: '1080p', confidence: 90 },
    { pattern: /\.remux\./i, quality: '2160p', confidence: 95 },
    { pattern: /\.webrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.hdtv\./i, quality: '720p', confidence: 80 },
    { pattern: /\.brrip\./i, quality: '1080p', confidence: 85 },
    { pattern: /\.bdrip\./i, quality: '1080p', confidence: 85 }
];

export const episodePatterns: RegExp[] = [
    /(\d+)x(\d+)/i,
    /s(\d+)e(\d+)/i,
    /season[\s\._-]?(\d+)[\s\._-]?episode[\s\._-]?(\d+)/i,
    /ep[\s\._-]?(\d+)/i,
    /(\d+)(?:\s*-\s*|\s*)(\d+)/,
    /^(\d+)$/
];