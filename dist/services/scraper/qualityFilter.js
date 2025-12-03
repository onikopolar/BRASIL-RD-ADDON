"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.QualityFilter = void 0;
class QualityFilter {
    constructor() {
        this.allowedQualities = new Set(['2160p', '1080p', '720p', 'HD']);
        this.qualityPriority = {
            '2160p': 400,
            '1080p': 300,
            '720p': 200,
            'HD': 150
        };
    }
    isAllowedQuality(quality) {
        return this.allowedQualities.has(quality);
    }
    getQualityPriority(quality) {
        return this.qualityPriority[quality] || 100;
    }
    groupByQuality(results) {
        const groups = new Map();
        for (const quality of this.allowedQualities) {
            groups.set(quality, []);
        }
        for (const result of results) {
            if (this.allowedQualities.has(result.quality)) {
                groups.get(result.quality).push(result);
            }
        }
        return groups;
    }
}
exports.QualityFilter = QualityFilter;
