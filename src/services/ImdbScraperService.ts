import { Logger } from '../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';

const logger = new Logger('ImdbScraper');

export interface ImdbTitles {
  originalTitle: string;          // Título original (geralmente inglês)
  portugueseTitle: string | null; // Título em português (se disponível)
  allTitles: string[];            // Todos os títulos para comparação
  foundInPortuguese: boolean;     // Se encontrou título específico em pt-BR
}

export class ImdbScraperService {
  private readonly imdbBaseUrl = 'https://www.imdb.com/title';
  private titleCache = new Map<string, ImdbTitles>();

  constructor() {
    logger.info('Servico de scraping do IMDB inicializado - Suporte a multiplos idiomas');
  }

  /**
   * Obtém TODOS os títulos disponíveis para um IMDB ID
   * Inclui original e português (se disponível)
   */
  async getTitlesFromImdbId(imdbId: string): Promise<ImdbTitles> {
    try {
      // Verifica cache primeiro
      if (this.titleCache.has(imdbId)) {
        logger.debug('Usando titulos em cache', { imdbId });
        return this.titleCache.get(imdbId)!;
      }

      logger.info(`Buscando titulos no IMDB: ${imdbId}`);

      // Busca PARALELA para melhor performance
      const [originalResult, portugueseResult] = await Promise.allSettled([
        this.fetchAndParseTitle(imdbId, false), // Inglês/Original
        this.fetchAndParseTitle(imdbId, true)   // Português
      ]);

      // Processa resultado ORIGINAL
      let originalTitle = '';
      if (originalResult.status === 'fulfilled' && originalResult.value) {
        originalTitle = originalResult.value;
      } else {
        logger.warn('Falha ao buscar titulo original', { 
          imdbId, 
          error: originalResult.status === 'rejected' ? originalResult.reason : 'Desconhecido' 
        });
      }

      // Processa resultado PORTUGUÊS
      let portugueseTitle: string | null = null;
      let foundInPortuguese = false;
      
      if (portugueseResult.status === 'fulfilled' && portugueseResult.value) {
        portugueseTitle = portugueseResult.value;
        foundInPortuguese = this.isValidPortugueseTitle(portugueseTitle);
        
        // Se título português não for válido, descarta
        if (!foundInPortuguese) {
          logger.debug('Titulo em portugues nao considerado valido', { 
            imdbId, 
            title: portugueseTitle 
          });
          portugueseTitle = null;
        }
      }

      // Fallback: se não encontrou original, tenta método de fallback
      if (!originalTitle) {
        logger.warn('Tentando fallback para titulo original', { imdbId });
        originalTitle = await this.getEnglishTitleFallback(imdbId);
      }

      if (!originalTitle) {
        throw new Error(`Nao foi possivel obter titulo para ${imdbId}`);
      }

      // Prepara lista de todos os títulos para comparação
      const allTitles = [originalTitle];
      if (portugueseTitle && portugueseTitle !== originalTitle) {
        allTitles.push(portugueseTitle);
      }

      // Remove duplicatas e títulos vazios
      const uniqueTitles = Array.from(new Set(allTitles.filter(title => title.trim().length > 0)));

      const result: ImdbTitles = {
        originalTitle,
        portugueseTitle,
        allTitles: uniqueTitles,
        foundInPortuguese
      };

      // Armazena em cache
      this.titleCache.set(imdbId, result);

      logger.info(`Titulos encontrados no IMDB`, {
        imdbId,
        originalTitle,
        portugueseTitle,
        foundInPortuguese,
        totalTitles: uniqueTitles.length,
        titlesList: uniqueTitles
      });

      return result;

    } catch (error) {
      logger.error('Erro critico ao buscar titulos no IMDB', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });

      // Fallback extremo: tenta método antigo
      try {
        const fallbackTitle = await this.getTitleFromImdbIdFallback(imdbId);
        return {
          originalTitle: fallbackTitle || `Unknown Title (${imdbId})`,
          portugueseTitle: null,
          allTitles: fallbackTitle ? [fallbackTitle] : [],
          foundInPortuguese: false
        };
      } catch {
        return {
          originalTitle: `Unknown Title (${imdbId})`,
          portugueseTitle: null,
          allTitles: [],
          foundInPortuguese: false
        };
      }
    }
  }

  /**
   * Método de compatibilidade - retorna apenas um título
   * (Prefere português, fallback para original)
   */
  async getTitleFromImdbId(imdbId: string): Promise<string | null> {
    try {
      const titles = await this.getTitlesFromImdbId(imdbId);
      // Prefere português, fallback para original
      return titles.portugueseTitle || titles.originalTitle || null;
    } catch (error) {
      logger.error('Erro no metodo de compatibilidade', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  /**
   * Busca e parseia título específico (inglês ou português)
   */
  private async fetchAndParseTitle(imdbId: string, inPortuguese: boolean): Promise<string | null> {
    try {
      const url = inPortuguese 
        ? `${this.imdbBaseUrl}/${imdbId}/?language=pt-BR`
        : `${this.imdbBaseUrl}/${imdbId}`;

      const html = await this.fetchImdbPage(url, inPortuguese);
      const title = this.parseTitleFromHtml(html, imdbId);

      if (!title) {
        return null;
      }

      // Limpa e formata título
      const cleanedTitle = this.cleanTitle(title);
      
      // Validação adicional para português
      if (inPortuguese && !this.isValidPortugueseTitle(cleanedTitle)) {
        return null;
      }

      return cleanedTitle;

    } catch (error) {
      logger.debug(`Falha ao buscar titulo ${inPortuguese ? 'em portugues' : 'original'}`, {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return null;
    }
  }

  /**
   * Busca página do IMDB com headers apropriados
   */
  private async fetchImdbPage(url: string, isPortuguese: boolean): Promise<string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache'
    };

    // Headers específicos para idioma
    if (isPortuguese) {
      headers['Accept-Language'] = 'pt-BR,pt;q=0.9,en;q=0.8';
      headers['Cookie'] = 'lc-main=pt_BR';
    } else {
      headers['Accept-Language'] = 'en-US,en;q=0.9';
    }

    const response = await axios.get(url, {
      timeout: 10000,
      headers,
      validateStatus: (status) => status === 200
    });

    return response.data;
  }

  /**
   * Parseia título do HTML do IMDB
   */
  private parseTitleFromHtml(html: string, imdbId: string): string | null {
    try {
      const $ = cheerio.load(html);

      // Método 1: Tag h1 principal (recomendado pelo IMDB)
      const h1Title = $('h1[data-testid="hero__pageTitle"]').text().trim();
      if (h1Title) {
        return h1Title;
      }

      // Método 2: Primeiro h1 na página
      const firstH1 = $('h1').first().text().trim();
      if (firstH1) {
        return firstH1;
      }

      // Método 3: Meta tag og:title
      const metaTitle = $('meta[property="og:title"]').attr('content');
      if (metaTitle) {
        // Remove " - IMDb" se presente
        return metaTitle.replace(/\s*-\s*IMDb\s*$/i, '').trim();
      }

      // Método 4: Título da página
      const pageTitle = $('title').text().trim();
      if (pageTitle) {
        return pageTitle.replace(/\s*-\s*IMDb\s*$/i, '').trim();
      }

      // Método 5: JSON-LD structured data
      const jsonLdScript = $('script[type="application/ld+json"]').first().html();
      if (jsonLdScript) {
        try {
          const data = JSON.parse(jsonLdScript);
          if (data.name) {
            return data.name.toString().trim();
          }
        } catch (e) {
          // Ignora erro de parse
        }
      }

      // Método 6: Títulos alternativos (Also known as)
      if (this.containsPortugueseMarkers(html)) {
        const altTitleSection = $('.titlereference-overview, [data-testid="akas"]').first();
        if (altTitleSection.length) {
          const altTitles = altTitleSection.text();
          const lines = altTitles.split('\n').map(line => line.trim()).filter(line => line);
          
          for (const line of lines) {
            if (line.toLowerCase().includes('brazil') || 
                line.toLowerCase().includes('portuguese') ||
                this.containsPortugueseMarkers(line)) {
              const title = line.replace(/\(.*?\)/g, '').trim();
              if (title) return title;
            }
          }
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

  /**
   * Limpa título extraindo apenas o nome principal
   */
  private cleanTitle(title: string): string {
    return title
      .replace(/\s*[-–]\s*IMDb\s*$/i, '')      // Remove "- IMDb" no final
      .replace(/\(\s*\d{4}\s*\)$/, '')          // Remove ano (2024)
      .replace(/\s*[|•]\s*.*$/, '')             // Remove tudo depois de | ou •
      .replace(/\s+/g, ' ')                     // Espaços múltiplos para um
      .trim();
  }

  /**
   * Valida se título parece ser em português válido
   */
  private isValidPortugueseTitle(title: string): boolean {
    if (!title || title.length < 2) return false;

    const titleLower = title.toLowerCase();

    // 1. Verifica caracteres acentuados específicos do português
    const hasPortugueseAccents = /[áàâãéèêíïóôõöúüçñ]/i.test(title);
    
    // 2. Verifica palavras/frases comuns em português brasileiro
    const portugueseIndicators = [
      /\b(de|do|da|dos|das)\b/i,
      /\b(no|na|nos|nas)\b/i,
      /\b(um|uma|uns|umas)\b/i,
      /\b(o|a|os|as)\s+[a-z]/i, // Artigo seguido de palavra
      /\b(e|mas|porque|que)\b/i,
      /\b(temporada|epis[oó]dio|s[ée]rie|filme)\b/i,
      /\b(dublado|legendado|nacional|brasil)\b/i
    ];

    const hasPortugueseWords = portugueseIndicators.some(pattern => pattern.test(titleLower));
    
    // 3. Verifica se NÃO parece ser inglês
    const englishIndicators = [
      /\b(the|of|and|in|on|at|to|for)\b/i,
      /\b(season|episode|series|movie)\b/i,
      /\b(web|dl|bluray|dvd|hd)\b/i
    ];

    const hasEnglishWords = englishIndicators.some(pattern => pattern.test(titleLower));

    // É português se: tem acentos OU palavras portuguesas E não tem palavras inglesas óbvias
    return (hasPortugueseAccents || hasPortugueseWords) && !hasEnglishWords;
  }

  /**
   * Detecta marcadores de português no texto
   */
  private containsPortugueseMarkers(text: string): boolean {
    const lowerText = text.toLowerCase();
    return lowerText.includes('brasil') || 
           lowerText.includes('portuguese') ||
           lowerText.includes('português') ||
           /[áàâãéèêíïóôõöúüçñ]/i.test(text);
  }

  /**
   * Fallback para título original (método antigo)
   */
  private async getEnglishTitleFallback(imdbId: string): Promise<string> {
    try {
      const url = `${this.imdbBaseUrl}/${imdbId}`;
      const html = await this.fetchImdbPage(url, false);
      const title = this.parseTitleFromHtml(html, imdbId);
      return title ? this.cleanTitle(title) : '';
    } catch {
      return '';
    }
  }

  /**
   * Fallback completo (método antigo para compatibilidade)
   */
  private async getTitleFromImdbIdFallback(imdbId: string): Promise<string | null> {
    try {
      // Tenta português primeiro
      const portugueseTitle = await this.fetchAndParseTitle(imdbId, true);
      if (portugueseTitle) return portugueseTitle;

      // Fallback para inglês
      const englishTitle = await this.fetchAndParseTitle(imdbId, false);
      return englishTitle;
    } catch {
      return null;
    }
  }

  /**
   * Limpa cache (útil para testes)
   */
  clearCache(): void {
    this.titleCache.clear();
    logger.debug('Cache do IMDB limpo');
  }
}