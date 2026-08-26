"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QualityDetector = void 0;
class QualityDetector {
    constructor() {
        this.explicitResolutionPatterns = [
            { pattern: /\b(2160p|4k|uhd)\b/i, quality: '2160p', confidence: 100 },
            { pattern: /\b(1080p|fhd|full hd)\b/i, quality: '1080p', confidence: 100 },
            { pattern: /\b(720p|hd)\b/i, quality: '720p', confidence: 100 },
            { pattern: /\b(480p|sd)\b/i, quality: 'SD', confidence: 100 }
        ];
        this.sourcePatterns = [
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
        for (const { pattern, quality } of this.explicitResolutionPatterns) {
            if (pattern.test(cleanTitle)) {
                foundQualities.add(quality);
            }
        }
        if (foundQualities.size > 0) {
            return Array.from(foundQualities)
                .filter(q => this.allowedQualities.has(q))
                .sort((a, b) => this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b));
        }
        for (const { pattern, quality } of this.sourcePatterns) {
            if (pattern.test(cleanTitle) && this.allowedQualities.has(quality)) {
                foundQualities.add(quality);
            }
        }
        if (foundQualities.size === 0) {
            foundQualities.add(this.inferQualityFromContext(cleanTitle));
        }
        return Array.from(foundQualities)
            .filter(q => this.allowedQualities.has(q))
            .sort((a, b) => this.qualityOrder.indexOf(a) - this.qualityOrder.indexOf(b));
    }
    extractBestQuality(title) {
        const allQualities = this.extractAllQualities(title);
        return allQualities.length > 0 ? allQualities[0] : this.inferQualityFromContext(title.toLowerCase());
    }
    extractWorstQuality(title) {
        const allQualities = this.extractAllQualities(title);
        return allQualities.length > 0 ? allQualities[allQualities.length - 1] : 'HD';
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
