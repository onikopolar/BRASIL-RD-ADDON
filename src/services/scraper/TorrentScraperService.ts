import { Logger } from '../../utils/logger';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { TorrentResult } from './torrentTypes';
import { torrentIndexerConfig, scraperProviders } from './scraperProviders';
import { QualityDetector } from '../../lib/qualityDetector';
import { SimilarityCalculator } from '../../lib/title-filter/SimilarityCalculator';

const logger = new Logger('TorrentScraperService');

export class TorrentScraperService {
    private readonly qualityDetector: QualityDetector;
    private readonly similarityCalculator: SimilarityCalculator;
    private readonly version = '5.3.0';

    constructor(similarityCalculator?: SimilarityCalculator) {
        this.qualityDetector = new QualityDetector();
        this.similarityCalculator = similarityCalculator || new SimilarityCalculator();
        
        logger.info(`TorrentScraperService v${this.version} iniciado`);
        logger.info(`Melhorias: Mantém temporada na query de busca`);
        logger.info(`Provedores ativos: ${this.countActiveProviders()}`);
    }

    async searchTorrents(
        query: string,
        type: 'movie' | 'series' = 'movie',
        targetSeason?: number,
        targetYear?: number
    ): Promise<TorrentResult[]> {
        const startTime = Date.now();
        
        // NÃO normaliza removendo temporada - isso é ESSENCIAL!
        const searchQuery = this.prepareSearchQuery(query, type, targetSeason);
        
        logger.info('Iniciando busca multi-provedor', {
            queryOriginal: query,
            queryBusca: searchQuery,
            tipo: type,
            temporadaAlvo: targetSeason,
            anoAlvo: targetYear
        });

        try {
            const allResults: TorrentResult[] = [];

            // Busca no TorrentIndexer
            if (torrentIndexerConfig.enabled) {
                try {
                    const torrentIndexerResults = await this.searchTorrentIndexer(
                        searchQuery, 
                        type, 
                        targetSeason, 
                        targetYear
                    );
                    
                    if (torrentIndexerResults.length > 0) {
                        logger.debug('TorrentIndexer resultados', {
                            quantidade: torrentIndexerResults.length
                        });
                        allResults.push(...torrentIndexerResults);
                    }
                } catch (error) {
                    logger.debug('TorrentIndexer falhou', {
                        erro: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                }
            }

            // Busca em scrapers web
            const webScrapersResults = await this.searchWebScrapers(searchQuery, type);
            
            if (webScrapersResults.length > 0) {
                logger.debug('Scrapers web resultados', {
                    quantidade: webScrapersResults.length
                });
                allResults.push(...webScrapersResults);
            }

            // Filtra por temporada de forma inteligente
            const filteredResults = this.filterResultsBySeason(allResults, targetSeason, type);
            
            // Remove duplicados
            const uniqueResults = this.removeDuplicateResults(filteredResults);
            
            const duration = Date.now() - startTime;
            
            if (uniqueResults.length > 0) {
                logger.info('Busca finalizada com sucesso', {
                    totalResultados: uniqueResults.length,
                    tempo: `${duration}ms`,
                    resultadosPorFonte: this.countBySource(uniqueResults),
                    temporadaFiltrada: targetSeason
                });
            } else {
                logger.info('Busca sem resultados', {
                    queryBusca: searchQuery,
                    temporadaAlvo: targetSeason,
                    tipo: type,
                    tempo: `${duration}ms`,
                    resultadoBruto: allResults.length
                });
            }

            return uniqueResults;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.error('Erro na busca multi-provedor', {
                queryOriginal: query,
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${duration}ms`
            });
            return [];
        }
    }

    // Prepara query de busca mantendo temporada
    private prepareSearchQuery(
        query: string, 
        type: 'movie' | 'series', 
        targetSeason?: number
    ): string {
        // Para séries com temporada específica, mantém "temporada" ou "season" na query
        if (type === 'series' && targetSeason !== undefined) {
            // Verifica se já tem temporada na query
            const hasSeasonInQuery = /temporada|season|s\d+/i.test(query);
            
            if (!hasSeasonInQuery) {
                // Adiciona temporada à query
                const seasonStr = targetSeason.toString().padStart(2, '0');
                const queryWithSeason = `${query} s${seasonStr}`;
                
                logger.debug('Query expandida com temporada', {
                    original: query,
                    expandida: queryWithSeason
                });
                
                return queryWithSeason;
            }
        }
        
        // Para outros casos, apenas limpa caracteres problemáticos
        return this.cleanQuery(query);
    }

    // Limpa query sem remover temporada
    private cleanQuery(query: string): string {
        return query
            .replace(/[^\w\s\-\.\:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
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

            // Adiciona temporada se especificada
            if (type === 'series' && targetSeason !== undefined) {
                params.season = targetSeason.toString();
            }

            // Adiciona ano se especificado
            if (targetYear !== undefined) {
                params.year = targetYear.toString();
            }
            
            logger.debug('Buscando no TorrentIndexer', {
                query: query,
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
                logger.debug('TorrentIndexer dados invalidos');
                return [];
            }

            const results = data.results.slice(0, 30);
            
            const mappedResults = results.map((indexerResult: any) => 
                this.mapTorrentIndexerResult(indexerResult, type)
            ).filter((result: TorrentResult | null): result is TorrentResult => result !== null);

            const duration = Date.now() - startTime;
            
            if (mappedResults.length > 0) {
                logger.debug('TorrentIndexer processado', {
                    resultados: mappedResults.length,
                    tempo: `${duration}ms`
                });
            }

            return mappedResults;

        } catch (error) {
            const duration = Date.now() - startTime;
            logger.debug('Erro no TorrentIndexer', {
                tempo: `${duration}ms`
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
            logger.debug('Nenhum provedor web ativo');
            return [];
        }

        logger.debug('Iniciando scrapers web', {
            query: query,
            provedores: activeProviders.map(p => p.name)
        });

        const promises = activeProviders.map(provider => 
            this.searchWithProvider(provider, query, type)
                .catch(error => {
                    logger.debug(`Provedor ${provider.name} falhou`, {
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
            logger.debug('Scrapers web concluidos', {
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
                logger.debug(`Provedor ${provider.name} retornou resultados`, {
                    quantidade: mappedResults.length,
                    tempo: `${duration}ms`
                });
            }

            return mappedResults;

        } catch (error) {
            logger.debug(`Erro no provedor ${provider.name}`);
            return [];
        }
    }

    private async scrapeProviderPage(provider: any, query: string): Promise<any[]> {
        try {
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodedQuery}`;
            
            logger.debug(`Scraping pagina de busca`, {
                provedor: provider.name,
                url: searchUrl
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
            
            const itemSelectors = provider.itemSelector?.split(',').map((s: string) => s.trim()) || ['article', '.post', '.item'];
            const titleSelectors = provider.titleSelector?.split(',').map((s: string) => s.trim()) || ['h2 a', 'h3 a', '.title a'];
            
            // Fase 1: Coletar links das páginas
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
                    
                    if (title && pageUrl && pageUrl.includes(provider.baseUrl)) {
                        const result: any = {
                            title: title,
                            pageUrl: pageUrl,
                            provider: provider.name
                        };
                        
                        pageLinks.push(result);
                    }
                });
                
                if (pageLinks.length > 0) {
                    break;
                }
            }
            
            logger.debug(`Links coletados`, {
                provedor: provider.name,
                linksEncontrados: pageLinks.length
            });
            
            // Fase 2: Extrair magnet de cada página (limitar a 3 para performance)
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
                    logger.debug(`Falha ao extrair magnet da pagina`, {
                        provedor: provider.name,
                        index: i
                    });
                }
            }
            
            logger.debug(`Scraping concluido`, {
                provedor: provider.name,
                resultadosComMagnet: results.length,
                primeiroMagnet: results[0]?.link?.substring(0, 80)
            });
            
            return results;
            
        } catch (error) {
            throw new Error(`Scraping ${provider.name} falhou: ${error instanceof Error ? error.message : 'Erro'}`);
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
            
            // Procurar magnet link
            const magnetLink = $('a[href^="magnet:"]').attr('href');
            if (magnetLink) {
                return magnetLink;
            }
            
            // Procurar em scripts ou outros lugares
            const html = response.data;
            const magnetMatch = html.match(/magnet:\?[^"\']+/);
            if (magnetMatch) {
                return magnetMatch[0];
            }
            
            return null;
            
        } catch (error) {
            logger.debug(`Erro ao extrair magnet`, {
                url: pageUrl.substring(0, 100),
                erro: error instanceof Error ? error.message : 'Erro'
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

    // Filtro de temporada mais inteligente
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
            
            // Se o resultado já tem temporada definida, usa ela
            if (result.season !== undefined) {
                return result.season === targetSeason;
            }
            
            // Detecta temporada no título
            const detectedSeason = this.extractSeasonNumber(title);
            if (detectedSeason !== null) {
                return detectedSeason === targetSeason;
            }
            
            // Aceita pacotes/temporadas completas
            const isCompletePack = title.includes('complete') || 
                                  title.includes('pack') || 
                                  title.includes('temporada completa') ||
                                  title.includes('season pack');
            
            if (isCompletePack) {
                logger.debug('Aceitando pack/temporada completa', {
                    title: result.title.substring(0, 60),
                    temporadaAlvo: targetSeason
                });
                return true;
            }
            
            // Resultado sem informação de temporada específica
            return false;
        });

        if (results.length !== filtered.length) {
            logger.debug('Filtro por temporada', {
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
            logger.debug('Duplicados removidos', {
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
        
        // Bonus por idioma português
        if (language && (language.includes('pt') || language.includes('dual'))) {
            score += 25;
        }
        
        // Bonus por qualidade
        if (titleLower.includes('1080p') || titleLower.includes('2160p') || titleLower.includes('4k')) {
            score += 15;
        } else if (titleLower.includes('720p') || titleLower.includes('hd')) {
            score += 10;
        }
        
        // Penalidade por baixa qualidade
        if (titleLower.includes('480p') || titleLower.includes('sd')) {
            score -= 15;
        }
        
        // Bonus por fonte
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

    private cleanTitle(title: string): string {
        return title
            .replace(/\s+/g, ' ')
            .replace(/\[.*?\]/g, '')
            .replace(/\(.*?\)/g, '')
            .trim();
    }

    private extractLanguage(title: string): string {
        const titleLower = title.toLowerCase();
        
        if (titleLower.includes('dual') && (titleLower.includes('audio') || titleLower.includes('áudio'))) {
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
        if (titleLower.includes('english') || titleLower.includes('inglês') || titleLower.includes('(eng)')) {
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
            'BLUDV': 60,
            'Starck Filmes': 50,
            'Comando Torrents': 40,
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
            'User-Agent': 'Brasil-RD-Addon/5.3.0',
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
            versão: this.version,
            descrição: 'Sistema multi-provedor com scraping real usando Cheerio',
            melhoria: 'Mantém temporada na query de busca para resultados específicos',
            provedoresAtivos: this.countActiveProviders(),
            filtroTemporada: 'Inteligente - aceita packs e temporadas completas',
            fluxo: 'Query completa -> Scraping -> Filtro inteligente'
        };
    }
}