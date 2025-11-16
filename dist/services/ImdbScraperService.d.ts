export declare class ImdbScraperService {
    private readonly imdbBaseUrl;
    constructor();
    getTitleFromImdbId(imdbId: string): Promise<string | null>;
    private getPortugueseTitle;
    private getEnglishTitle;
    private fetchImdbPage;
    private parseTitleFromHtml;
    private cleanTitle;
    private isValidPortugueseTitle;
}
