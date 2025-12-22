import { Logger } from '../../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { TorrentResult } from './torrentTypes';
import { torrentIndexerConfig, scraperProviders } from './scraperProviders';
import { QualityDetector } from '../../lib/qualityDetector';
import { ImdbScraperService } from '../ImdbScraperService';

const logger = new Logger('TorrentScraperService');

export class TorrentScraperService {
    private readonly qualityDetector: QualityDetector;
    private readonly tmdbScraper: ImdbScraperService;
    
    // Versionamento Semantico v6.1.0 - FIX: Remove filtro de similaridade interno, apenas coleta torrents brutos
    private readonly version = '6.1.0';

    constructor(tmdbScraper?: ImdbScraperService) {
        this.qualityDetector = new QualityDetector();
        this.tmdbScraper = tmdbScraper || new ImdbScraperService();
        
        logger.info(`TorrentScraperService v${this.version} iniciado`);
        logger.info(`Melhorias: Coleta bruta de torrents baseada no TMDB, sem filtro interno`);
        logger.info(`Provedores ativos: ${this.countActiveProviders()}`);
        logger.info(`Função: Apenas coletor de torrents brutos - filtragem feita externamente`);
    }

    async searchTorrents(
        query: string,
        type: 'movie' | 'series' = 'movie',
        targetSeason?: number,
        targetYear?: number,
        imdbId?: string
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        
        logger.info('Iniciando coleta bruta de torrents com TMDB', {
            queryOriginal: query,
            tipo: type,
            temporadaAlvo: targetSeason,
            anoAlvo: targetYear,
            imdbId: imdbId
        });

        try {
            let tmdbData = null;
            if (imdbId) {
                tmdbData = await this.getTmdbData(imdbId, targetSeason);
                if (tmdbData) {
                    logger.debug('Dados TMDB obtidos para geração de queries', {
                        imdbId: imdbId,
                        temTituloPortugues: !!tmdbData.portugueseTitle,
                        temTituloOriginal: !!tmdbData.originalTitle,
                        todosTitulos: tmdbData.allTitles.length,
                        ano: tmdbData.year,
                        prioridadePortugues: tmdbData.portuguesePriority
                    });
                } else {
                    logger.debug('TMDB não retornou dados, usando query original', { imdbId });
                }
            }

            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);
            logger.debug('Queries geradas para coleta bruta', {
                totalQueries: searchQueries.length,
                queries: searchQueries.map(q => q.substring(0, 60)),
                baseadasEmTmdb: tmdbData !== null
            });

            const allResults: TorrentResult[] = [];

            if (torrentIndexerConfig.enabled) {
                try {
                    const torrentIndexerResults = await this.searchTorrentIndexerWithQueries(
                        searchQueries, 
                        type, 
                        targetSeason, 
                        targetYear,
                        tmdbData
                    );
                    
                    if (torrentIndexerResults.length > 0) {
                        logger.debug('TorrentIndexer resultados coletados', {
                            quantidade: torrentIndexerResults.length
                        });
                        allResults.push(...torrentIndexerResults);
                    }
                } catch (error) {
                    logger.debug('TorrentIndexer falhou na coleta', {
                        erro: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                }
            }

            const webScrapersResults = await this.searchWebScrapersWithQueries(searchQueries, type, tmdbData);
            
            if (webScrapersResults.length > 0) {
                logger.debug('Scrapers web resultados coletados', {
                    quantidade: webScrapersResults.length
                });
                allResults.push(...webScrapersResults);
            }

            const filteredResults = this.filterResultsBySeason(allResults, targetSeason, type);
            const uniqueResults = this.removeDuplicateResults(filteredResults);
            
            const duration = Date.now() - startTime;
            
            if (uniqueResults.length > 0) {
                logger.info('Coleta bruta finalizada - retornando para filtragem externa', {
                    totalResultadosBrutos: uniqueResults.length,
                    tempo: `${duration}ms`,
                    resultadosPorFonte: this.countBySource(uniqueResults),
                    temporadaFiltrada: targetSeason,
                    nota: 'Similaridade será aplicada pelo TitleFilter posteriormente',
                    versao: this.version
                });
            } else {
                logger.info('Coleta bruta não encontrou resultados', {
                    tempo: `${duration}ms`,
                    queriesUsadas: searchQueries.length,
                    nota: 'Nenhum torrent encontrado com as queries geradas'
                });
            }

            return uniqueResults;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error('Erro na coleta bruta de torrents', {
                queryOriginal: query,
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${duration}ms`
            });
            return [];
        }
    }

    private async getTmdbData(imdbId: string, season?: number): Promise<any> {
        try {
            logger.debug('Obtendo dados do TMDB para geração de queries', { imdbId, season });
            
            const tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
            return tmdbData;
        } catch (error) {
            logger.debug('Falha ao obter dados do TMDB para queries', {
                imdbId,
                season,
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }

    private generateSearchQueries(
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number,
        targetYear?: number,
        tmdbData?: any
    ): string[] {
        const queries: string[] = [];
        
        if (tmdbData && tmdbData.allTitles && tmdbData.allTitles.length > 0) {
            const yearToUse = targetYear || tmdbData.year;
            
            tmdbData.allTitles.forEach((title: string) => {
                queries.push(title);
                
                if (yearToUse) {
                    queries.push(`${title} ${yearToUse}`);
                }
                
                if (type === 'series' && targetSeason !== undefined) {
                    queries.push(`${title} ${targetSeason}ª temporada`);
                    queries.push(`${title} temporada ${targetSeason}`);
                    queries.push(`${title} season ${targetSeason}`);
                }
                
                if (title.match(/^\d/)) {
                    const tituloSemNumeros = title.replace(/^\d+\s*/, '');
                    if (tituloSemNumeros !== title && tituloSemNumeros.trim().length > 3) {
                        queries.push(tituloSemNumeros);
                    }
                }
            });
        }
        
        if (queries.length === 0) {
            const baseQuery = this.prepareSearchQuery(query, type, targetSeason);
            queries.push(baseQuery);
            
            if (targetYear) {
                queries.push(`${baseQuery} ${targetYear}`);
            }
        }
        
        const uniqueQueries = [...new Set(queries.filter(q => q && q.trim().length > 3))];
        
        logger.debug('Queries finalizadas para coleta', {
            quantidadeFinal: uniqueQueries.length,
            nota: 'Filtragem por similaridade será feita externamente pelo TitleFilter'
        });
        
        return uniqueQueries;
    }

    private async searchTorrentIndexerWithQueries(
        queries: string[],
        type: 'movie' | 'series',
        targetSeason?: number,
        targetYear?: number,
        tmdbData?: any
    ): Promise<TorrentResult[]> {
        const allResults: TorrentResult[] = [];
        const yearToUse = targetYear || tmdbData?.year;
        
        for (const query of queries.slice(0, 3)) {
            try {
                const results = await this.searchTorrentIndexer(query, type, targetSeason, yearToUse);
                allResults.push(...results);
                
                if (results.length > 0) {
                    logger.debug('Query coletada com sucesso no TorrentIndexer', {
                        query: query.substring(0, 80),
                        resultados: results.length
                    });
                }
            } catch (error) {
                logger.debug('Query falhou na coleta no TorrentIndexer', {
                    query: query.substring(0, 80)
                });
            }
        }
        
        return allResults;
    }

    private async searchWebScrapersWithQueries(
        queries: string[],
        type: 'movie' | 'series',
        tmdbData?: any
    ): Promise<TorrentResult[]> {
        const allResults: TorrentResult[] = [];
        
        for (const query of queries.slice(0, 2)) {
            try {
                const results = await this.searchWebScrapers(query, type);
                allResults.push(...results);
                
                if (results.length > 0) {
                    logger.debug('Query coletada com sucesso em scrapers web', {
                        query: query.substring(0, 80),
                        resultados: results.length
                    });
                }
            } catch (error) {
                logger.debug('Query falhou na coleta em scrapers web', {
                    query: query.substring(0, 80)
                });
            }
        }
        
        return allResults;
    }

    private async searchTorrentIndexer(
        query: string,
        type: 'movie' | 'series',
        targetSeason?: number,
        targetYear?: number
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        
        try {
            const category = type === 'series' ? 'tv' : 'movies';
            
            const params: any = {
                q: query,
                filter_results: 'true',
                category: category
            };

            if (type === 'series' && targetSeason !== undefined) {
                params.season = targetSeason.toString();
            }

            if (targetYear !== undefined) {
                params.year = targetYear.toString();
            }
            
            logger.debug('Coletando do TorrentIndexer', {
                query: query.substring(0, 100),
                tipo: type,
                temporadaFiltro: targetSeason,
                ano: targetYear
            });

            const response = await axios.get(`${torrentIndexerConfig.baseUrl}/search`, {
                timeout: torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params: params
            });

            const data = response.data;
            
            if (!data.results || !Array.isArray(data.results)) {
                logger.debug('TorrentIndexer dados invalidos na coleta');
                return [];
            }

            const results = data.results.slice(0, 20);
            
            const mappedResults = results.map((indexerResult: any) => 
                this.mapTorrentIndexerResult(indexerResult, type)
            ).filter((result: TorrentResult | null): result is TorrentResult => result !== null);

            const duration = Date.now() - startTime;
            
            if (mappedResults.length > 0) {
                logger.debug('TorrentIndexer processado na coleta', {
                    resultados: mappedResults.length,
                    tempo: `${duration}ms`
                });
            }

            return mappedResults;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.debug('Erro na coleta do TorrentIndexer', {
                tempo: `${duration}ms`,
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
    }

    private async searchWebScrapers(
        query: string,
        type: 'movie' | 'series'
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        const allResults: TorrentResult[] = [];
        
        const activeProviders = scraperProviders
            .filter(provider => provider.priority > 0)
            .sort((a, b) => b.priority - a.priority);
        
        if (activeProviders.length === 0) {
            logger.debug('Nenhum provedor web ativo para coleta');
            return [];
        }

        logger.debug('Iniciando coleta em scrapers web', {
            query: query.substring(0, 100),
            provedores: activeProviders.map(p => p.name)
        });

        const promises = activeProviders.map(provider => 
            this.searchWithProvider(provider, query, type)
                .catch(error => {
                    logger.debug(`Provedor ${provider.name} falhou na coleta`, {
                        erro: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                    return [];
                })
        );

        const resultsArrays = await Promise.all(promises);
        
        resultsArrays.forEach(results => {
            if (results.length > 0) {
                allResults.push(...results);
            }
        });

        const duration = Date.now() - startTime;
        
        if (allResults.length > 0) {
            logger.debug('Scrapers web concluidos na coleta', {
                totalResultados: allResults.length,
                tempo: `${duration}ms`
            });
        }

        return allResults;
    }

    private async searchWithProvider(
        provider: any,
        query: string,
        type: 'movie' | 'series'
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        
        try {
            const results = await this.scrapeProviderPage(provider, query);
            
            const mappedResults = results.map(item => 
                this.mapProviderResult(item, provider.name, type)
            ).filter((result: TorrentResult | null): result is TorrentResult => result !== null);

            const duration = Date.now() - startTime;
            
            if (mappedResults.length > 0) {
                logger.debug(`Provedor ${provider.name} coletou resultados`, {
                    quantidade: mappedResults.length,
                    tempo: `${duration}ms`
                });
            }

            return mappedResults;

        } catch (error) {
            logger.debug(`Erro no provedor ${provider.name} na coleta`, {
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
    }

    private async scrapeProviderPage(provider: any, query: string): Promise<any[]> {
        try {
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodedQuery}`;
            
            logger.debug(`Coletando da pagina de busca`, {
                provedor: provider.name,
                url: searchUrl.substring(0, 120)
            });

            const response = await axios.get(searchUrl, {
                timeout: provider.timeout,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                }
            });
            
            const $ = cheerio.load(response.data);
            const pageLinks: any[] = [];
            
            if (provider.name === 'Starck Filmes') {
                logger.debug(`Usando logica especifica para Starck Filmes na coleta`);
                
                $('h3.sl-title').each((index, element) => {
                    const $titleElement = $(element);
                    const title = $titleElement.text().trim();
                    
                    let pageUrl = '';
                    const $container = $titleElement.closest('.movies, .slide-item, .post-catalog, .item');
                    
                    if ($container.length) {
                        const $link = $container.find('a').first();
                        pageUrl = $link.attr('href') || '';
                    } else {
                        const $link = $titleElement.parent().find('a').first();
                        pageUrl = $link.attr('href') || '';
                    }
                    
                    if (title && pageUrl && !title.includes('...')) {
                        const duplicate = pageLinks.some(link => link.pageUrl === pageUrl);
                        
                        if (!duplicate) {
                            pageLinks.push({
                                title: title,
                                pageUrl: pageUrl,
                                provider: provider.name
                            });
                        }
                    }
                });
            } else {
                const itemSelectors = provider.itemSelector?.split(',').map((s: string) => s.trim()) || ['article', '.post', '.item'];
                const titleSelectors = provider.titleSelector?.split(',').map((s: string) => s.trim()) || ['h2 a', 'h3 a', '.title a'];
                
                for (const itemSelector of itemSelectors) {
                    $(itemSelector).each((index, element) => {
                        const $element = $(element);
                        
                        let title = '';
                        let pageUrl = '';
                        
                        for (const titleSelector of titleSelectors) {
                            const titleElement = $element.find(titleSelector);
                            if (titleElement.length > 0) {
                                title = titleElement.text().trim();
                                pageUrl = titleElement.attr('href') || '';
                                break;
                            }
                        }
                        
                        if (title && pageUrl) {
                            const duplicateTitle = pageLinks.some(link => 
                                link.title === title || link.pageUrl === pageUrl
                            );
                            
                            if (!duplicateTitle) {
                                pageLinks.push({
                                    title: title,
                                    pageUrl: pageUrl,
                                    provider: provider.name
                                });
                            }
                        }
                    });
                    
                    if (pageLinks.length > 0) {
                        break;
                    }
                }
            }
            
            if (pageLinks.length === 0) {
                logger.debug(`Nenhum link encontrado para ${provider.name} na coleta`);
                return [];
            }
            
            const results: any[] = [];
            const maxPages = Math.min(pageLinks.length, 3);
            
            for (let i = 0; i < maxPages; i++) {
                try {
                    const pageLink = pageLinks[i];
                    const magnet = await this.extractMagnetFromPage(pageLink.pageUrl, provider.timeout);
                    
                    if (magnet) {
                        results.push({
                            title: pageLink.title,
                            link: magnet,
                            pageUrl: pageLink.pageUrl,
                            provider: provider.name
                        });
                    }
                } catch (error) {
                    logger.debug(`Falha ao extrair magnet na coleta`, {
                        provedor: provider.name,
                        index: i
                    });
                }
            }
            
            return results;
            
        } catch (error) {
            logger.debug(`Scraping ${provider.name} falhou na coleta`, {
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            throw error;
        }
    }

    private async extractMagnetFromPage(pageUrl: string, timeout: number): Promise<string | null> {
        try {
            const response = await axios.get(pageUrl, {
                timeout: timeout,
                headers: { 
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            
            const $ = cheerio.load(response.data);
            
            const magnetLink = $('a[href^="magnet:"]').attr('href');
            if (magnetLink) {
                return magnetLink;
            }
            
            const html = response.data;
            const magnetRegex = /magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"\s]*/g;
            const magnetMatch = html.match(magnetRegex);
            
            if (magnetMatch && magnetMatch[0]) {
                return magnetMatch[0];
            }
            
            return null;
            
        } catch (error) {
            logger.debug(`Erro ao extrair magnet na coleta`, {
                url: pageUrl.substring(0, 120),
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }

    private mapTorrentIndexerResult(
        indexerResult: any, 
        type: 'movie' | 'series'
    ): TorrentResult | null {
        if (!indexerResult.title || !indexerResult.magnet_link) {
            return null;
        }

        const quality = this.qualityDetector.extractQualityFromFilename(indexerResult.title);
        const seasonNumber = this.extractSeasonNumber(indexerResult.title);
        const language = this.extractLanguage(indexerResult.title);

        if (!this.qualityDetector.isValidQuality(quality)) {
            return null;
        }

        return {
            title: this.cleanTitle(indexerResult.title),
            magnet: indexerResult.magnet_link,
            seeders: indexerResult.seed_count || this.estimateSeeders('TorrentIndexer', quality),
            leechers: indexerResult.leech_count || 0,
            size: indexerResult.size || 'Tamanho não especificado',
            quality: quality,
            provider: 'TorrentIndexer',
            language: language,
            type: type,
            relevanceScore: this.calculateRelevanceScore(indexerResult.title, seasonNumber, language),
            sizeInBytes: this.calculateSizeInBytes(indexerResult.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(indexerResult.date || Date.now()),
            confidence: 0.8
        };
    }

    private mapProviderResult(
        item: any,
        providerName: string,
        type: 'movie' | 'series'
    ): TorrentResult | null {
        if (!item.title || !item.link) {
            return null;
        }

        const quality = this.qualityDetector.extractQualityFromFilename(item.title);
        const seasonNumber = this.extractSeasonNumber(item.title);
        const language = this.extractLanguage(item.title);

        if (!this.qualityDetector.isValidQuality(quality)) {
            return null;
        }

        const result: TorrentResult = {
            title: this.cleanTitle(item.title),
            magnet: item.link,
            seeders: item.seeders || this.estimateSeeders(providerName, quality),
            leechers: item.leechers || 0,
            size: item.size || 'Tamanho não especificado',
            quality: quality,
            provider: providerName,
            language: language,
            type: type,
            relevanceScore: this.calculateRelevanceScore(item.title, seasonNumber, language),
            sizeInBytes: this.calculateSizeInBytes(item.size),
            season: seasonNumber !== null ? seasonNumber : undefined,
            lastUpdated: new Date(),
            confidence: 0.6
        };

        return result;
    }

    private filterResultsBySeason(
        results: TorrentResult[], 
        targetSeason?: number,
        type?: 'movie' | 'series'
    ): TorrentResult[] {
        if (targetSeason === undefined || type !== 'series') {
            return results;
        }

        const filtered = results.filter(result => {
            const title = result.title.toLowerCase();
            
            if (result.season !== undefined) {
                return result.season === targetSeason;
            }
            
            const detectedSeason = this.extractSeasonNumber(title);
            if (detectedSeason !== null) {
                return detectedSeason === targetSeason;
            }
            
            const isCompletePack = title.includes('complete') || 
                                  title.includes('pack') || 
                                  title.includes('temporada completa') ||
                                  title.includes('season pack');
            
            if (isCompletePack) {
                logger.debug('Coletando pack/temporada completa para filtragem externa', {
                    title: result.title.substring(0, 80),
                    temporadaAlvo: targetSeason
                });
                return true;
            }
            
            return false;
        });

        if (results.length !== filtered.length) {
            logger.debug('Filtro por temporada aplicado na coleta', {
                antes: results.length,
                depois: filtered.length,
                temporadaAlvo: targetSeason
            });
        }

        return filtered;
    }

    private removeDuplicateResults(results: TorrentResult[]): TorrentResult[] {
        const uniqueMagnets = new Set<string>();
        const uniqueResults: TorrentResult[] = [];

        for (const result of results) {
            if (!uniqueMagnets.has(result.magnet)) {
                uniqueMagnets.add(result.magnet);
                uniqueResults.push(result);
            }
        }

        if (results.length !== uniqueResults.length) {
            logger.debug('Duplicados removidos na coleta bruta', {
                antes: results.length,
                depois: uniqueResults.length
            });
        }

        return uniqueResults;
    }

    private calculateRelevanceScore(
        title: string, 
        actualSeason?: number | null,
        language?: string
    ): number {
        let score = 70;
        
        const titleLower = title.toLowerCase();
        
        if (language && (language.includes('pt') || language.includes('dual'))) {
            score += 25;
        }
        
        if (titleLower.includes('1080p') || titleLower.includes('2160p') || titleLower.includes('4k')) {
            score += 15;
        } else if (titleLower.includes('720p') || titleLower.includes('hd')) {
            score += 10;
        }
        
        if (titleLower.includes('480p') || titleLower.includes('sd')) {
            score -= 15;
        }
        
        if (titleLower.includes('web-dl') || titleLower.includes('bluray') || titleLower.includes('remux')) {
            score += 10;
        }
        
        return Math.max(0, Math.min(100, score));
    }

    private extractSeasonNumber(text: string): number | null {
        const patterns = [
            /S(\d+)/i,
            /Season\s+(\d+)/i,
            /Temporada\s+(\d+)/i,
            /(\d+)\s*x/i,
            /(\d+)ª?\s*Temp/i,
            /s(\d+)\s*e\d+/i,
            /(\d+)\s*temporada/i
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return season;
                }
            }
        }
        return null;
    }

    private prepareSearchQuery(
        query: string, 
        type: 'movie' | 'series', 
        targetSeason?: number
    ): string {
        if (type === 'series' && targetSeason !== undefined) {
            const hasSeasonInQuery = /temporada|season|s\d+/i.test(query);
            
            if (!hasSeasonInQuery) {
                const seasonStr = targetSeason.toString().padStart(2, '0');
                const queryWithSeason = `${query} s${seasonStr}`;
                
                return queryWithSeason;
            }
        }
        
        return this.cleanQuery(query);
    }

    private cleanQuery(query: string): string {
        return query
            .replace(/[^\w\s\-\.\:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private cleanTitle(title: string): string {
        if (title.length > 100) {
            const lines = title.split(/(?=[A-ZÀ-Ú])/);
            if (lines.length > 1) {
                const firstValidLine = lines.find(line => line.trim().length > 10);
                if (firstValidLine) {
                    title = firstValidLine.trim();
                }
            }
        }
        
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
    }

    private extractLanguage(title: string): string {
        const titleLower = title.toLowerCase();
        
        if (titleLower.includes('dual') && (titleLower.includes('audio') || titleLower.includes('audio'))) {
            return 'pt-BR,en';
        }
        if (titleLower.includes('dublado') || titleLower.includes('dublada') || titleLower.includes('dublagem')) {
            return 'pt-BR';
        }
        if (titleLower.includes('legendado') || titleLower.includes('legendada') || titleLower.includes('legenda')) {
            return 'pt';
        }
        if (titleLower.includes('português') || titleLower.includes('portugues') || titleLower.includes('pt-br') || titleLower.includes('ptbr')) {
            return 'pt-BR';
        }
        if (titleLower.includes('brazilian') || titleLower.includes('brasil')) {
            return 'pt-BR';
        }
        if (titleLower.includes('multi') || titleLower.includes('multilanguage')) {
            return 'multi';
        }
        if (titleLower.includes('english') || titleLower.includes('ingles') || titleLower.includes('(eng)')) {
            return 'en';
        }
        
        return 'desconhecido';
    }

    private calculateSizeInBytes(sizeStr: string): number {
        if (!sizeStr || sizeStr === 'Tamanho não especificado') {
            return 1.5 * 1024 * 1024 * 1024;
        }
        
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match) return 1.5 * 1024 * 1024 * 1024;

        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();

        if (unit === 'GB' || unit === 'G') return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M') return value * 1024 * 1024;

        return 1.5 * 1024 * 1024 * 1024;
    }

    private estimateSeeders(provider: string, quality: string): number {
        const baseSeeders: Record<string, number> = {
            'TorrentIndexer': 70,
            'Pop Torrent': 65,
            'Starck Filmes': 50,
            'default': 35
        };

        const qualityMultiplier: Record<string, number> = {
            '2160p': 1.5,
            '1080p': 1.3,
            '720p': 1.0,
            'HD': 1.1,
            'desconhecido': 0.8,
            '480p': 0.6
        };

        const base = baseSeeders[provider] || baseSeeders['default'];
        const multiplier = qualityMultiplier[quality] || 0.8;
        return Math.round(base * multiplier);
    }

    private getTorrentIndexerHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/6.1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }

    private countActiveProviders(): number {
        const activeWeb = scraperProviders.filter(p => p.priority > 0).length;
        const activeIndexer = torrentIndexerConfig.enabled ? 1 : 0;
        return activeWeb + activeIndexer;
    }

    private countBySource(results: TorrentResult[]): Record<string, number> {
        const counts: Record<string, number> = {};
        
        results.forEach(result => {
            counts[result.provider] = (counts[result.provider] || 0) + 1;
        });
        
        return counts;
    }

    getStats() {
        const activeProviders = scraperProviders
            .filter(p => p.priority > 0)
            .map(p => ({ nome: p.name, prioridade: p.priority }));
        
        return {
            versao: this.version,
            descricao: 'Sistema multi-provedor apenas para coleta bruta de torrents',
            funcao: 'Coletor bruto - não aplica filtro de similaridade',
            integracaoTmdb: 'Apenas para geração de queries inteligentes',
            provedoresAtivos: this.countActiveProviders(),
            provedores: activeProviders,
            fluxo: 'TMDB -> Queries inteligentes -> Coleta bruta -> Retorna tudo para filtragem externa',
            nota: 'Filtragem por similaridade é responsabilidade do TitleFilter/CatalogProvider'
        };
    }
}