import { TorrentResult } from './torrentTypes';

export class TitleFilter {
    private readonly promotionalKeywords = [
        'promo', 'trailer', 'sample', '1xbet', 'bet', 'propaganda',
        'apostas', 'casino', 'bônus', 'aviator', 'blaze', 'bonus',
        'spam', 'advertisement', 'publicidade'
    ];

    isValidContent(title: string): boolean {
        const titleLower = title.toLowerCase();
        return !this.promotionalKeywords.some(keyword => titleLower.includes(keyword));
    }

    // Outros métodos de filtragem por título...
}
