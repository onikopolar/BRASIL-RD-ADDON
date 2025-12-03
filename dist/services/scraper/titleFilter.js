"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleFilter = void 0;
class TitleFilter {
    constructor() {
        this.promotionalKeywords = [
            'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
            'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
            'spam', 'advertisement', 'publicidade'
        ];
    }
    isValidContent(title) {
        const titleLower = title.toLowerCase();
        return !this.promotionalKeywords.some(keyword => titleLower.includes(keyword));
    }
}
exports.TitleFilter = TitleFilter;
