"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QualityDetector = void 0;
class QualityDetector {
    constructor() {
        this.qualityPatterns = [
            { pattern: /\.2160p\./i, quality: '2160p', confidence: 100 },
            { pattern: /\.4k\./i, quality: '2160p', confidence: 100 },
            { pattern: /\b2160p\b/i, quality: '2160p', confidence: 98 },
            { pattern: /\b4k\b/i, quality: '2160p', confidence: 98 },
            { pattern: /\.1080p\./i, quality: '1080p', confidence: 100 },
            { pattern: /\b1080p\b/i, quality: '1080p', confidence: 98 },
            { pattern: /\.720p\./i, quality: '720p', confidence: 100 },
            { pattern: /\b720p\b/i, quality: '720p', confidence: 98 },
            { pattern: /\.hd\./i, quality: 'HD', confidence: 90 },
            { pattern: /\bhd\b/i, quality: 'HD', confidence: 80 },
        ];
    }
    extractQuality(title) {
        const cleanTitle = title.toLowerCase();
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(cleanTitle) && confidence >= 95) {
                return quality;
            }
        }
        return this.inferQualityFromContext(cleanTitle);
    }
    inferQualityFromContext(titleLower) {
        if (titleLower.includes('remux') || titleLower.includes('web-dl')) {
            return '1080p';
        }
        if (titleLower.includes('bluray') || titleLower.includes('blu-ray')) {
            return '1080p';
        }
        if (titleLower.includes('hdtv')) {
            return '720p';
        }
        return 'HD';
    }
}
exports.QualityDetector = QualityDetector;
