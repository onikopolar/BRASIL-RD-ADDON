import { Logger } from '../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';

const logger = new Logger('ImdbScraper');

export class ImdbScraperService {
    private readonly imdbBaseUrl = 'https://www.imdb.com/title';

    constructor() {
        logger.info('Servico de scraping do IMDB inicializado');
    }

    async getTitleFromImdbId(imdbId: string): Promise<string | null> {
        try {
            logger.info(`Buscando titulo no IMDB: ${imdbId}`);
            
            // Primeiro tenta buscar em português
            const portugueseTitle = await this.getPortugueseTitle(imdbId);
            if (portugueseTitle) {
                logger.info(`Titulo em portugues encontrado no IMDB: ${portugueseTitle}`, { imdbId });
                return portugueseTitle;
            }

            // Fallback para inglês
            const englishTitle = await this.getEnglishTitle(imdbId);
            if (englishTitle) {
                logger.info(`Titulo em ingles encontrado no IMDB: ${englishTitle}`, { imdbId });
                return englishTitle;
            }

            logger.warn(`Titulo nao encontrado no IMDB`, { imdbId });
            return null;

        } catch (error) {
            logger.error('Erro ao buscar titulo no IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }

    private async getPortugueseTitle(imdbId: string): Promise<string | null> {
        try {
            const url = `${this.imdbBaseUrl}/${imdbId}/?language=pt-BR`;
            const html = await this.fetchImdbPage(url);
            const title = this.parseTitleFromHtml(html, imdbId);
            
            return title && this.isValidPortugueseTitle(title) ? title : null;

        } catch (error) {
            logger.warn('Nao foi possivel obter titulo em portugues', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }

    private async getEnglishTitle(imdbId: string): Promise<string | null> {
        try {
            const url = `${this.imdbBaseUrl}/${imdbId}`;
            const html = await this.fetchImdbPage(url);
            const title = this.parseTitleFromHtml(html, imdbId);
            
            return title ? title : null;

        } catch (error) {
            logger.warn('Nao foi possivel obter titulo em ingles', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }

    private async fetchImdbPage(url: string): Promise<string> {
        const response = await axios.get(url, {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        });
        
        return response.data;
    }

    private parseTitleFromHtml(html: string, imdbId: string): string | null {
        try {
            const $ = cheerio.load(html);
            
            // Método 1: Tag h1 principal
            const h1Title = $('h1[data-testid="hero__pageTitle"]').text().trim();
            if (h1Title) {
                return this.cleanTitle(h1Title);
            }

            // Método 2: Primeiro h1
            const firstH1 = $('h1').first().text().trim();
            if (firstH1) {
                return this.cleanTitle(firstH1);
            }

            // Método 3: Meta tag og:title
            const metaTitle = $('meta[property="og:title"]').attr('content');
            if (metaTitle) {
                return this.cleanTitle(metaTitle);
            }

            // Método 4: JSON-LD structured data
            const jsonLd = $('script[type="application/ld+json"]').first().html();
            if (jsonLd) {
                try {
                    const data = JSON.parse(jsonLd);
                    if (data.name) {
                        return this.cleanTitle(data.name);
                    }
                } catch (e) {
                    // Ignora erro de parse JSON
                }
            }

            return null;
        } catch (error) {
            logger.error('Erro ao parsear HTML do IMDB', {
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }

    private cleanTitle(title: string): string {
        return title
            .replace(/- IMDb$/, '')
            .replace(/\(\d{4}\)/, '')
            .replace(/\s*-\s*IMDb\s*$/, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private isValidPortugueseTitle(title: string): boolean {
        // Verifica se o título contém palavras comuns em português
        const portugueseIndicators = [
            ' o ', ' a ', ' os ', ' as ', ' do ', ' da ', ' dos ', ' das ',
            ' no ', ' na ', ' nos ', ' nas ', ' pelo ', ' pela ', ' pelos ', ' pelas ',
            ' um ', ' uma ', ' uns ', ' umas ', ' é ', ' são ', ' foi ', ' foram '
        ];

        const titleLower = title.toLowerCase();
        
        // Verifica se tem caracteres acentuados comuns em português
        const hasPortugueseChars = /[áàâãéèêíïóôõöúüçñ]/i.test(title);
        
        // Verifica se tem palavras comuns em português
        const hasPortugueseWords = portugueseIndicators.some(word => 
            titleLower.includes(word)
        );

        return hasPortugueseChars || hasPortugueseWords || titleLower.length > 3;
    }
}