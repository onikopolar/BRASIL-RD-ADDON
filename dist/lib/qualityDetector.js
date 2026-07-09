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
        this.allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
        this.qualityOrder = ['2160p', '1080p', '720p', 'HD'];
    }
    static getInstance() {
        if (!QualityDetector.instance) {
            QualityDetector.instance = new QualityDetector();
        }
        return QualityDetector.instance;
    }
    extractAllQualities(title) {
        const cleanTitle = title.toLowerCase();
        const foundQualities = new Set();
        for (const { pattern, quality, confidence } of this.qualityPatterns) {
            if (pattern.test(cleanTitle) && confidence >= 80) {
                foundQualities.add(quality);
            }
        }
        if (foundQualities.size === 0) {
            const inferred = this.inferQualityFromContext(cleanTitle);
            foundQualities.add(inferred);
        }
        return Array.from(foundQualities)
            .filter(quality => this.allowedQualities.has(quality))
            .sort((a, b) => {
            const indexA = this.qualityOrder.indexOf(a);
            const indexB = this.qualityOrder.indexOf(b);
            return indexA - indexB;
        });
    }
    extractBestQuality(title) {
        const allQualities = this.extractAllQualities(title);
        if (allQualities.length > 0) {
            return allQualities[0];
        }
        return this.inferQualityFromContext(title.toLowerCase());
    }
    extractWorstQuality(title) {
        const allQualities = this.extractAllQualities(title);
        if (allQualities.length > 0) {
            return allQualities[allQualities.length - 1];
        }
        return 'HD';
    }
    hasMultipleQualities(title) {
        const qualities = this.extractAllQualities(title);
        return qualities.length > 1;
    }
    expandQualityRange(title) {
        const cleanTitle = title.toLowerCase();
        const qualities = new Set();
        const rangePatterns = [
            /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*\|\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*&\s*(\d{3,4}p)/gi,
            /(\d{3,4}p)\s*\+\s*(\d{3,4}p)/gi
        ];
        for (const pattern of rangePatterns) {
            const matches = cleanTitle.match(pattern);
            if (matches) {
                matches.forEach(match => {
                    const numberMatches = match.match(/\d{3,4}p/gi);
                    if (numberMatches) {
                        numberMatches.forEach(num => {
                            if (num.includes('2160') || num.includes('4k')) {
                                qualities.add('2160p');
                            }
                            else if (num.includes('1080')) {
                                qualities.add('1080p');
                            }
                            else if (num.includes('720')) {
                                qualities.add('720p');
                            }
                        });
                    }
                });
            }
        }
        if (qualities.size > 0) {
            return Array.from(qualities).sort((a, b) => this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b));
        }
        return this.extractAllQualities(title);
    }
    extractQuality(title) {
        return this.extractBestQuality(title);
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
    extractQualityFromFilename(filename) {
        return this.extractBestQuality(filename);
    }
    extractQualityFromStreamName(name) {
        if (!name)
            return 'HD';
        return this.extractBestQuality(name);
    }
    isValidQuality(quality) {
        return this.allowedQualities.has(quality);
    }
    hasQuality(title, quality) {
        const qualities = this.extractAllQualities(title);
        return qualities.includes(quality);
    }
    getQualityOrder(quality) {
        const index = this.qualityOrder.indexOf(quality);
        return index !== -1 ? index : this.qualityOrder.length;
    }
}
exports.QualityDetector = QualityDetector;
