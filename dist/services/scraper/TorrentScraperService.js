"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentScraperService = void 0;
const logger_1 = require("../../utils/logger");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const scraperProviders_1 = require("./scraperProviders");
const qualityDetector_1 = require("../../lib/qualityDetector");
const SimilarityCalculator_1 = require("../../lib/title-filter/SimilarityCalculator");
const logger = new logger_1.Logger('TorrentScraperService');
class TorrentScraperService {
    constructor(similarityCalculator) {
        this.version = '5.4.1';
        this.qualityDetector = new qualityDetector_1.QualityDetector();
        this.similarityCalculator = similarityCalculator || new SimilarityCalculator_1.SimilarityCalculator();
        logger.info(`TorrentScraperService v${this.version} iniciado`);
        logger.info(`Melhorias: Corrigida extracao de titulos do Starck Filmes`);
        logger.info(`Provedores ativos: ${this.countActiveProviders()}`);
    }
    async searchTorrents(query, type = 'movie', targetSeason, targetYear) {
        const startTime = Date.now();
        const searchQuery = this.prepareSearchQuery(query, type, targetSeason);
        logger.info('Iniciando busca multi-provedor', {
            queryOriginal: query,
            queryBusca: searchQuery,
            tipo: type,
            temporadaAlvo: targetSeason,
            anoAlvo: targetYear
        });
        try {
            const allResults = [];
            if (scraperProviders_1.torrentIndexerConfig.enabled) {
                try {
                    const torrentIndexerResults = await this.searchTorrentIndexer(searchQuery, type, targetSeason, targetYear);
                    if (torrentIndexerResults.length > 0) {
                        logger.debug('TorrentIndexer resultados', {
                            quantidade: torrentIndexerResults.length
                        });
                        allResults.push(...torrentIndexerResults);
                    }
                }
                catch (error) {
                    logger.debug('TorrentIndexer falhou', {
                        erro: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                }
            }
            const webScrapersResults = await this.searchWebScrapers(searchQuery, type);
            if (webScrapersResults.length > 0) {
                logger.debug('Scrapers web resultados', {
                    quantidade: webScrapersResults.length
                });
                allResults.push(...webScrapersResults);
            }
            const filteredResults = this.filterResultsBySeason(allResults, targetSeason, type);
            const uniqueResults = this.removeDuplicateResults(filteredResults);
            const duration = Date.now() - startTime;
            if (uniqueResults.length > 0) {
                logger.info('Busca finalizada com sucesso', {
                    totalResultados: uniqueResults.length,
                    tempo: `${duration}ms`,
                    resultadosPorFonte: this.countBySource(uniqueResults),
                    temporadaFiltrada: targetSeason
                });
            }
            else {
                logger.info('Busca sem resultados', {
                    queryBusca: searchQuery,
                    temporadaAlvo: targetSeason,
                    tipo: type,
                    tempo: `${duration}ms`,
                    resultadoBruto: allResults.length
                });
            }
            return uniqueResults;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger.error('Erro na busca multi-provedor', {
                queryOriginal: query,
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${duration}ms`
            });
            return [];
        }
    }
    prepareSearchQuery(query, type, targetSeason) {
        if (type === 'series' && targetSeason !== undefined) {
            const hasSeasonInQuery = /temporada|season|s\d+/i.test(query);
            if (!hasSeasonInQuery) {
                const seasonStr = targetSeason.toString().padStart(2, '0');
                const queryWithSeason = `${query} s${seasonStr}`;
                logger.debug('Query expandida com temporada', {
                    original: query,
                    expandida: queryWithSeason
                });
                return queryWithSeason;
            }
        }
        return this.cleanQuery(query);
    }
    cleanQuery(query) {
        return query
            .replace(/[^\w\s\-\.\:]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    async searchTorrentIndexer(query, type, targetSeason, targetYear) {
        const startTime = Date.now();
        try {
            const category = type === 'series' ? 'tv' : 'movies';
            const params = {
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
            logger.debug('Buscando no TorrentIndexer', {
                query: query,
                tipo: type,
                temporadaFiltro: targetSeason,
                ano: targetYear
            });
            const response = await axios_1.default.get(`${scraperProviders_1.torrentIndexerConfig.baseUrl}/search`, {
                timeout: scraperProviders_1.torrentIndexerConfig.timeout,
                headers: this.getTorrentIndexerHeaders(),
                params: params
            });
            const data = response.data;
            if (!data.results || !Array.isArray(data.results)) {
                logger.debug('TorrentIndexer dados invalidos');
                return [];
            }
            const results = data.results.slice(0, 30);
            const mappedResults = results.map((indexerResult) => this.mapTorrentIndexerResult(indexerResult, type)).filter((result) => result !== null);
            const duration = Date.now() - startTime;
            if (mappedResults.length > 0) {
                logger.debug('TorrentIndexer processado', {
                    resultados: mappedResults.length,
                    tempo: `${duration}ms`
                });
            }
            return mappedResults;
        }
        catch (error) {
            const duration = Date.now() - startTime;
            logger.debug('Erro no TorrentIndexer', {
                tempo: `${duration}ms`
            });
            return [];
        }
    }
    async searchWebScrapers(query, type) {
        const startTime = Date.now();
        const allResults = [];
        const activeProviders = scraperProviders_1.scraperProviders
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
        const promises = activeProviders.map(provider => this.searchWithProvider(provider, query, type)
            .catch(error => {
            logger.debug(`Provedor ${provider.name} falhou`, {
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }));
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
    async searchWithProvider(provider, query, type) {
        const startTime = Date.now();
        try {
            const results = await this.scrapeProviderPage(provider, query);
            const mappedResults = results.map(item => this.mapProviderResult(item, provider.name, type)).filter((result) => result !== null);
            const duration = Date.now() - startTime;
            if (mappedResults.length > 0) {
                logger.debug(`Provedor ${provider.name} retornou resultados`, {
                    quantidade: mappedResults.length,
                    tempo: `${duration}ms`
                });
            }
            return mappedResults;
        }
        catch (error) {
            logger.debug(`Erro no provedor ${provider.name}`, {
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
    }
    async scrapeProviderPage(provider, query) {
        try {
            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `${provider.baseUrl}${provider.searchPath}${encodedQuery}`;
            logger.debug(`Scraping pagina de busca`, {
                provedor: provider.name,
                url: searchUrl
            });
            const response = await axios_1.default.get(searchUrl, {
                timeout: provider.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
                }
            });
            const $ = cheerio.load(response.data);
            const pageLinks = [];
            const itemSelectors = provider.itemSelector?.split(',').map((s) => s.trim()) || ['article', '.post', '.item'];
            const titleSelectors = provider.titleSelector?.split(',').map((s) => s.trim()) || ['h2 a', 'h3 a', '.title a'];
            if (provider.name === 'Starck Filmes') {
                logger.debug(`Usando logica especifica para Starck Filmes`);
                $('h3.sl-title').each((index, element) => {
                    const $titleElement = $(element);
                    const title = $titleElement.text().trim();
                    let pageUrl = '';
                    const $container = $titleElement.closest('.movies, .slide-item, .post-catalog, .item');
                    if ($container.length) {
                        const $link = $container.find('a').first();
                        pageUrl = $link.attr('href') || '';
                    }
                    else {
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
                            logger.debug(`Item Starck Filmes encontrado`, {
                                titulo: title.substring(0, 60),
                                url: pageUrl.substring(0, 80)
                            });
                        }
                    }
                });
            }
            else {
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
                            const duplicateTitle = pageLinks.some(link => link.title === title || link.pageUrl === pageUrl);
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
            logger.debug(`Links coletados`, {
                provedor: provider.name,
                linksEncontrados: pageLinks.length,
                primeiroTitulo: pageLinks[0]?.title?.substring(0, 60),
                primeiroLink: pageLinks[0]?.pageUrl?.substring(0, 80)
            });
            if (pageLinks.length === 0) {
                logger.debug(`Nenhum link encontrado para ${provider.name}`);
                return [];
            }
            const results = [];
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
                        logger.debug(`Magnet encontrado para pagina`, {
                            provedor: provider.name,
                            index: i,
                            titulo: pageLink.title.substring(0, 60)
                        });
                    }
                }
                catch (error) {
                    logger.debug(`Falha ao extrair magnet da pagina`, {
                        provedor: provider.name,
                        index: i,
                        erro: error instanceof Error ? error.message : 'Erro desconhecido'
                    });
                }
            }
            logger.debug(`Scraping concluido`, {
                provedor: provider.name,
                resultadosComMagnet: results.length
            });
            return results;
        }
        catch (error) {
            logger.debug(`Scraping ${provider.name} falhou`, {
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            throw error;
        }
    }
    async extractMagnetFromPage(pageUrl, timeout) {
        try {
            logger.debug(`Extraindo magnet da pagina`, {
                url: pageUrl.substring(0, 100)
            });
            const response = await axios_1.default.get(pageUrl, {
                timeout: timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
            });
            const $ = cheerio.load(response.data);
            const magnetLink = $('a[href^="magnet:"]').attr('href');
            if (magnetLink) {
                logger.debug(`Magnet encontrado via seletor`, {
                    magnet: magnetLink.substring(0, 80)
                });
                return magnetLink;
            }
            const html = response.data;
            const magnetRegex = /magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"\s]*/g;
            const magnetMatch = html.match(magnetRegex);
            if (magnetMatch && magnetMatch[0]) {
                logger.debug(`Magnet encontrado via regex`, {
                    magnet: magnetMatch[0].substring(0, 80)
                });
                return magnetMatch[0];
            }
            logger.debug(`Nenhum magnet encontrado na pagina`);
            return null;
        }
        catch (error) {
            logger.debug(`Erro ao extrair magnet`, {
                url: pageUrl.substring(0, 100),
                erro: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return null;
        }
    }
    mapTorrentIndexerResult(indexerResult, type) {
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
            size: indexerResult.size || 'Tamanho nao especificado',
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
    mapProviderResult(item, providerName, type) {
        if (!item.title || !item.link) {
            return null;
        }
        const quality = this.qualityDetector.extractQualityFromFilename(item.title);
        const seasonNumber = this.extractSeasonNumber(item.title);
        const language = this.extractLanguage(item.title);
        if (!this.qualityDetector.isValidQuality(quality)) {
            return null;
        }
        const result = {
            title: this.cleanTitle(item.title),
            magnet: item.link,
            seeders: item.seeders || this.estimateSeeders(providerName, quality),
            leechers: item.leechers || 0,
            size: item.size || 'Tamanho nao especificado',
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
    filterResultsBySeason(results, targetSeason, type) {
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
                logger.debug('Aceitando pack/temporada completa', {
                    title: result.title.substring(0, 60),
                    temporadaAlvo: targetSeason
                });
                return true;
            }
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
    removeDuplicateResults(results) {
        const uniqueMagnets = new Set();
        const uniqueResults = [];
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
    calculateRelevanceScore(title, actualSeason, language) {
        let score = 70;
        const titleLower = title.toLowerCase();
        if (language && (language.includes('pt') || language.includes('dual'))) {
            score += 25;
        }
        if (titleLower.includes('1080p') || titleLower.includes('2160p') || titleLower.includes('4k')) {
            score += 15;
        }
        else if (titleLower.includes('720p') || titleLower.includes('hd')) {
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
    extractSeasonNumber(text) {
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
    cleanTitle(title) {
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
    extractLanguage(title) {
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
        if (titleLower.includes('portugues') || titleLower.includes('portugues') || titleLower.includes('pt-br') || titleLower.includes('ptbr')) {
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
    calculateSizeInBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Tamanho nao especificado') {
            return 1.5 * 1024 * 1024 * 1024;
        }
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match)
            return 1.5 * 1024 * 1024 * 1024;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G')
            return value * 1024 * 1024 * 1024;
        if (unit === 'MB' || unit === 'M')
            return value * 1024 * 1024;
        return 1.5 * 1024 * 1024 * 1024;
    }
    estimateSeeders(provider, quality) {
        const baseSeeders = {
            'TorrentIndexer': 70,
            'Pop Torrent': 65,
            'Starck Filmes': 50,
            'default': 35
        };
        const qualityMultiplier = {
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
    getTorrentIndexerHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/5.4.1',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
    countActiveProviders() {
        const activeWeb = scraperProviders_1.scraperProviders.filter(p => p.priority > 0).length;
        const activeIndexer = scraperProviders_1.torrentIndexerConfig.enabled ? 1 : 0;
        return activeWeb + activeIndexer;
    }
    countBySource(results) {
        const counts = {};
        results.forEach(result => {
            counts[result.provider] = (counts[result.provider] || 0) + 1;
        });
        return counts;
    }
    getStats() {
        const activeProviders = scraperProviders_1.scraperProviders
            .filter(p => p.priority > 0)
            .map(p => ({ nome: p.name, prioridade: p.priority }));
        return {
            versao: this.version,
            descricao: 'Sistema multi-provedor com scraping real usando Cheerio',
            melhoria: 'Corrigida extracao de titulos do Starck Filmes',
            provedoresAtivos: this.countActiveProviders(),
            provedores: activeProviders,
            fluxo: 'Query completa -> Scraping -> Filtro inteligente'
        };
    }
}
exports.TorrentScraperService = TorrentScraperService;
