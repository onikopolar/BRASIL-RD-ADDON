"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentIndexerService = void 0;
const logger_1 = require("../utils/logger");
const axios_1 = __importDefault(require("axios"));
class TorrentIndexerService {
    baseUrl = 'https://torrent-indexer.darklyn.org';
    mirrors = [
        'https://torrent-indexer.darklyn.org', // São Paulo (default)
        'https://torrent-indexer.br-sp1.darklyn.org', // São Paulo mirror
        'https://torrent-indexer.br-pb1.darklyn.org', // Paraíba mirror
        'https://torrent-indexer.us-sc1.darklyn.org' // US mirror
    ];
    logger;
    currentMirrorIndex = 0;
    constructor() {
        this.logger = new logger_1.Logger('TorrentIndexer');
        this.logger.info('Serviço Torrent Indexer inicializado', {
            mirrors: this.mirrors.length,
            supportedSites: [
                'bludv', 'comando_torrents', 'torrent-dos-filmes',
                'starck-filmes', 'rede_torrent', 'filme_torrent', 'vaca_torrent'
            ]
        });
    }
    async searchTorrents(query, indexer = 'search', // 'search' para cache global ou nome específico
    category, season, limit = 20) {
        const startTime = Date.now();
        try {
            this.logger.debug('Iniciando busca no Torrent Indexer', {
                query,
                indexer,
                category,
                season,
                limit
            });
            // Prepara parâmetros baseados na documentação
            const params = {
                q: query.toLowerCase(),
                filter_results: 'true'
            };
            if (category) {
                params.category = category;
            }
            if (season && category === 'tv') {
                params.season = season.toString();
            }
            // Constrói a URL baseada no tipo de indexer
            let endpoint;
            if (indexer === 'search') {
                endpoint = '/search';
            }
            else {
                endpoint = `/indexers/${indexer}`;
            }
            const searchUrl = `${this.getCurrentMirror()}${endpoint}`;
            this.logger.debug('URL da busca', { searchUrl, params });
            const response = await axios_1.default.get(searchUrl, {
                timeout: 15000,
                headers: this.getAPIHeaders(),
                params
            });
            const data = response.data;
            this.logger.debug('Resposta recebida do Torrent Indexer', {
                resultsCount: data.count,
                indexerUsed: indexer
            });
            const results = data.results || [];
            const filteredResults = this.filterRelevantResults(results, query, category, season);
            const duration = Date.now() - startTime;
            this.logger.info('Busca no Torrent Indexer concluída', {
                query,
                indexer,
                category,
                season,
                totalResults: data.count,
                filteredResults: filteredResults.length,
                duration: `${duration}ms`,
                mirror: this.getCurrentMirror()
            });
            return filteredResults.slice(0, limit);
        }
        catch (error) {
            this.logger.error('Erro na busca do Torrent Indexer', {
                query,
                indexer,
                category,
                season,
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                mirror: this.getCurrentMirror()
            });
            // Tenta próximo mirror em caso de erro
            return this.retryWithNextMirror(query, indexer, category, season, limit);
        }
    }
    async retryWithNextMirror(query, indexer, category, season, limit = 20) {
        if (this.currentMirrorIndex >= this.mirrors.length - 1) {
            return []; // Todos os mirrors falharam
        }
        this.currentMirrorIndex++;
        this.logger.info('Tentando próximo mirror', {
            newMirror: this.getCurrentMirror(),
            mirrorIndex: this.currentMirrorIndex
        });
        // Aguarda um pouco antes de tentar novamente
        await this.delay(1000);
        return this.searchTorrents(query, indexer, category, season, limit);
    }
    filterRelevantResults(results, query, category, season) {
        const queryLower = query.toLowerCase();
        const resultsWithScores = results.map(result => {
            const qualityScore = this.getQualityScore(result.title);
            return {
                ...result,
                quality_score: qualityScore
            };
        });
        const filtered = resultsWithScores.filter(result => {
            const titleLower = result.title.toLowerCase();
            // Filtro básico por relevância da query
            const hasQueryWords = queryLower.split(' ').some(word => word.length > 2 && titleLower.includes(word));
            if (!hasQueryWords)
                return false;
            // Filtro de temporada para séries
            if (category === 'tv' && season) {
                const seasonPattern = new RegExp(`\\b(?:s|temporada|season)\\s*${season}\\b`, 'i');
                if (!seasonPattern.test(result.title)) {
                    return false;
                }
            }
            return true;
        }).sort((a, b) => {
            // Ordena por qualidade e depois por seeders
            const aScore = a.quality_score + (a.seed_count / 100);
            const bScore = b.quality_score + (b.seed_count / 100);
            return bScore - aScore;
        });
        // Remove a propriedade quality_score antes de retornar
        return filtered.map(({ quality_score, ...result }) => result);
    }
    getQualityScore(title) {
        const titleLower = title.toLowerCase();
        if (titleLower.includes('4k') || titleLower.includes('2160p'))
            return 100;
        if (titleLower.includes('1080p'))
            return 80;
        if (titleLower.includes('720p'))
            return 60;
        if (titleLower.includes('480p'))
            return 40;
        // Bônus para formatos de qualidade
        if (titleLower.includes('bluray') || titleLower.includes('web-dl'))
            return 30;
        if (titleLower.includes('dvdrip'))
            return 20;
        return 10;
    }
    getCurrentMirror() {
        return this.mirrors[this.currentMirrorIndex];
    }
    getAPIHeaders() {
        return {
            'User-Agent': 'Brasil-RD-Addon/1.0',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8'
        };
    }
    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    // Método para listar indexers disponíveis
    getAvailableIndexers() {
        return [
            { id: 'search', name: 'Cache Global', description: 'Busca em todos os indexers (cache)' },
            { id: 'bludv', name: 'BLUDV', description: 'BLUDV - Filmes e Séries' },
            { id: 'comando_torrents', name: 'Comando Torrents', description: 'Comando Torrents' },
            { id: 'torrent-dos-filmes', name: 'Torrent dos Filmes', description: 'Torrent dos Filmes' },
            { id: 'starck-filmes', name: 'Starck Filmes', description: 'Starck Filmes' },
            { id: 'rede_torrent', name: 'Rede Torrent', description: 'Rede Torrent' },
            { id: 'filme_torrent', name: 'Filme Torrent', description: 'Filme Torrent' },
            { id: 'vaca_torrent', name: 'Vaca Torrent', description: 'Vaca Torrent' }
        ];
    }
    // Método para testar a conexão com todos os mirrors
    async testAllMirrors() {
        const results = [];
        for (let i = 0; i < this.mirrors.length; i++) {
            const mirror = this.mirrors[i];
            const startTime = Date.now();
            try {
                const response = await axios_1.default.get(`${mirror}/search?q=test`, {
                    timeout: 10000,
                    headers: this.getAPIHeaders()
                });
                const responseTime = Date.now() - startTime;
                results.push({
                    mirror,
                    status: response.status === 200,
                    responseTime
                });
                this.logger.debug('Teste de mirror', { mirror, status: 'OK', responseTime });
            }
            catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
                results.push({
                    mirror,
                    status: false,
                    responseTime: -1
                });
                this.logger.debug('Teste de mirror', { mirror, status: 'FALHA', error: errorMessage });
            }
            await this.delay(500); // Evita sobrecarregar
        }
        // Ordena mirrors por performance
        const workingMirrors = results.filter(r => r.status).sort((a, b) => a.responseTime - b.responseTime);
        this.currentMirrorIndex = this.mirrors.indexOf(workingMirrors[0]?.mirror || this.mirrors[0]);
        this.logger.info('Teste de mirrors concluído', {
            totalMirrors: this.mirrors.length,
            workingMirrors: workingMirrors.length,
            bestMirror: this.getCurrentMirror()
        });
        return results;
    }
}
exports.TorrentIndexerService = TorrentIndexerService;
//# sourceMappingURL=TorrentIndexerService.js.map