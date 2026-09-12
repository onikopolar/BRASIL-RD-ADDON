"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentScraperService = void 0;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const logger_js_1 = require("../../utils/logger.js");
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
const ImdbScraperService_js_1 = require("../../catalogo/ImdbScraperService.js");
const wordpressScraper_js_1 = require("./wordpressScraper.js");
const bludvScraper_js_1 = require("./bludvScraper.js");
const starckScraper_js_1 = require("./starckScraper.js");
const hdrScraper_js_1 = require("./hdrScraper.js");
const TechnicalWords_js_1 = require("../../titulos/TechnicalWords.js");
const logger = new logger_js_1.Logger('TorrentScraperService');
function isScraperAtivo(nome) {
    const arquivo = path_1.default.join(process.cwd(), 'scrapers-state.json');
    if (!(0, fs_1.existsSync)(arquivo))
        return true;
    try {
        const estado = JSON.parse((0, fs_1.readFileSync)(arquivo, 'utf8'));
        return estado[nome.toLowerCase()] !== false;
    }
    catch {
        return true;
    }
}
function dedupBy(arr, keyFn) {
    const vistos = new Set();
    return arr.filter(item => {
        const key = keyFn(item);
        if (vistos.has(key))
            return false;
        vistos.add(key);
        return true;
    });
}
function mapAndFilter(arr, fn) {
    const out = [];
    for (const item of arr) {
        const mapped = fn(item);
        if (mapped !== null)
            out.push(mapped);
    }
    return out;
}
class TorrentScraperService {
    constructor(tmdbScraper) {
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.tmdbScraper = tmdbScraper || ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.wpScraper = new wordpressScraper_js_1.WordPressScraper();
        this.bludvScraper = new bludvScraper_js_1.BludvScraper();
    }
    async searchTorrents(query, type = 'movie', targetSeason, targetYear, imdbId) {
        const startTime = Date.now();
        try {
            const tmdbData = imdbId ? await this.getTmdbData(imdbId, targetSeason) : null;
            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);
            logger.debug(`🔍 Buscando torrents para: "${query}" | alvo S${targetSeason ?? '?'}E? | imdbId: ${imdbId ?? 'N/A'}`);
            logger.debug(`🔍 Queries geradas: ${searchQueries.length}`, {
                queries: searchQueries.slice(0, 10),
                total: searchQueries.length,
            });
            const runs = await Promise.all([
                this.runScraper('BLUDV', isScraperAtivo('bludv'), async () => {
                    const raw = await this.bludvScraper.search(query, type, targetSeason, searchQueries, imdbId);
                    return dedupBy(raw, r => r.magnet);
                }),
                this.runScraper('WP', isScraperAtivo('wordpress'), async () => {
                    const raw = await this.wpScraper.search(query, type, targetSeason, searchQueries, imdbId);
                    return dedupBy(raw, r => r.magnet);
                }),
                this.runScraper('Starck', isScraperAtivo('starck'), async () => {
                    const raw = await (0, starckScraper_js_1.searchStarck)(query, type, targetSeason, searchQueries);
                    const deduped = dedupBy(raw, r => r.infoHash);
                    return mapAndFilter(deduped, r => this.mapStarckResult(r, type));
                }),
                this.runScraper('HDR', isScraperAtivo('hdr'), async () => {
                    const raw = await (0, hdrScraper_js_1.searchHdr)(query, type, targetSeason, searchQueries, targetYear, imdbId);
                    const deduped = dedupBy(raw, r => r.infoHash);
                    return mapAndFilter(deduped, r => this.mapHdrResult(r, type));
                }),
            ]);
            const allResults = runs.flatMap(r => r.results);
            const duration = Date.now() - startTime;
            const detalhes = runs.map(r => `${r.nome}=${r.results.length}(${r.duration}ms)`).join(', ');
            logger.debug(`📊 ${allResults.length} torrents em ${duration}ms | ${detalhes}`);
            if (duration > 5000) {
                logger.warn('Coleta de torrents lenta', {
                    tempo: `${duration}ms`,
                    resultados: allResults.length,
                    queries: searchQueries.length,
                });
            }
            return allResults;
        }
        catch (error) {
            logger.error('Erro na coleta de torrents', {
                erro: error instanceof Error ? error.message : 'Erro desconhecido',
                tempo: `${Date.now() - startTime}ms`,
            });
            return [];
        }
    }
    async runScraper(nome, ativo, fn) {
        if (!ativo)
            return { nome, results: [], duration: 0 };
        const start = Date.now();
        try {
            const results = await fn();
            return { nome, results, duration: Date.now() - start };
        }
        catch (err) {
            logger.debug(`[${nome}] falhou: ${err instanceof Error ? err.message : 'erro'}`);
            return { nome, results: [], duration: Date.now() - start };
        }
    }
    async getTmdbData(imdbId, season) {
        try {
            return await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
        }
        catch (err) {
            logger.debug(`TMDB falhou para ${imdbId}: ${err instanceof Error ? err.message : 'erro'}`);
            return null;
        }
    }
    generateSearchQueries(query, type, targetSeason, targetYear, tmdbData) {
        if (type === 'series' && targetSeason !== undefined && tmdbData?.allTitles?.length > 0) {
            return this.generateSeriesQueries(query, targetSeason, tmdbData);
        }
        if (tmdbData?.originalTitle) {
            return this.generateMovieQueries(query, targetYear, tmdbData);
        }
        return this.generateFallbackQueries(query, targetYear);
    }
    generateSeriesQueries(query, season, tmdbData) {
        const titulos = this.coletarTitulosUnicos(...(tmdbData.allTitles || []), tmdbData.portugueseTitle, tmdbData.portugueseTitleRaw);
        const selecionados = titulos.length > 0 ? titulos.slice(0, 2) : [query];
        const queries = selecionados.map(t => `${t} ${season}ª temporada`);
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }
    generateMovieQueries(query, targetYear, tmdbData) {
        const yearToUse = targetYear || tmdbData.year;
        const titulos = this.coletarTitulosUnicos(tmdbData.originalTitle, tmdbData.portugueseTitle, ...(tmdbData.allTitles || []));
        const selecionados = titulos.slice(0, 2);
        const queries = [...selecionados];
        if (yearToUse) {
            for (const t of selecionados)
                queries.push(`${t} ${yearToUse}`);
        }
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }
    generateFallbackQueries(query, targetYear) {
        const queries = [query];
        if (targetYear)
            queries.push(`${query} ${targetYear}`);
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
    }
    coletarTitulosUnicos(...titulos) {
        const vistos = new Set();
        const unicos = [];
        for (const t of titulos) {
            if (!t)
                continue;
            const limpo = t.trim();
            if (limpo.length <= 3)
                continue;
            const chave = limpo.toLowerCase();
            if (vistos.has(chave))
                continue;
            vistos.add(chave);
            unicos.push(limpo);
        }
        return unicos;
    }
    buildTorrentResult(params) {
        return {
            title: params.title,
            magnet: params.magnet,
            seeders: params.seeders,
            leechers: params.leechers ?? 0,
            size: params.size,
            quality: params.quality,
            provider: params.provider,
            language: params.language,
            type: params.type,
            relevanceScore: params.relevanceScore ?? 0,
            sizeInBytes: params.sizeInBytes ?? 0,
            season: params.season,
            episode: params.episode,
            lastUpdated: new Date(),
            confidence: params.confidence ?? 0.7,
            originalTitle: params.originalTitle,
            year: params.year,
            canonicalName: params.canonicalName,
            infoHash: params.infoHash,
            imdbConfirmed: params.imdbConfirmed,
        };
    }
    extractDnFromMagnet(magnet) {
        const dnMatch = magnet.match(/dn=([^&]+)/i);
        if (!dnMatch)
            return undefined;
        return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
    }
    mapHdrResult(r, type) {
        if (!r.magnet)
            return null;
        const dnDoMagnet = this.extractDnFromMagnet(r.magnet);
        const temDn = dnDoMagnet !== undefined;
        const magnetName = r.canonicalName || dnDoMagnet || r.title;
        const quality = this.qualityDetector.extractQualityFromFilename(magnetName);
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(magnetName);
        const season = r.season ?? range?.seasonStart ?? undefined;
        const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);
        const language = r.language ? this.mapHdrLanguage(r.language) : 'desconhecido';
        logger.debug(`HDR_MAP | temDn=${temDn} | canon="${(r.canonicalName || '').substring(0, 40)}" | dn="${(dnDoMagnet || '').substring(0, 40)}" | fallbackTitle="${r.title.substring(0, 40)}" | escolhido="${magnetName.substring(0, 50)}"`);
        return this.buildTorrentResult({
            title: r.title,
            magnet: r.magnet,
            seeders: r.seeders,
            leechers: 0,
            size: r.size || 'N/A',
            quality: quality || 'HD',
            provider: 'HDR Torrent',
            imdbConfirmed: r.imdbConfirmed,
            language,
            type,
            season,
            episode,
            originalTitle: r.originalTitle,
            year: r.year,
            canonicalName: magnetName,
            infoHash: r.infoHash,
            confidence: 0.70,
            relevanceScore: 0,
            sizeInBytes: this.calculateSizeInBytes(r.size),
        });
    }
    mapStarckResult(r, type) {
        if (!r.magnet)
            return null;
        const dnDoMagnet = this.extractDnFromMagnet(r.magnet);
        const temDn = dnDoMagnet !== undefined;
        const displayName = r.canonicalName || dnDoMagnet;
        let quality = this.qualityDetector.extractQualityFromFilename(displayName || '');
        if (quality === 'HD' && r.quality) {
            const q = this.qualityDetector.extractQualityFromFilename(r.quality);
            if (q !== 'HD')
                quality = q;
        }
        if (quality === 'HD' && r.qualityHint) {
            const hintQuality = this.qualityDetector.extractQualityFromFilename(r.qualityHint);
            if (hintQuality !== 'HD')
                quality = hintQuality;
        }
        const range = displayName ? (0, TechnicalWords_js_1.extrairRangeEpisodios)(displayName) : null;
        const season = r.season ?? range?.seasonStart ?? undefined;
        const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);
        const titleFinal = r.canonicalName || r.originalTitle || displayName || 'Starck Torrent';
        logger.debug(`STARCK_MAP | temDn=${temDn} | canon="${(r.canonicalName || '').substring(0, 40)}" | dn="${(dnDoMagnet || '').substring(0, 40)}" | qualityBotao="${(r.quality || '').substring(0, 20)}" | originalTitle="${(r.originalTitle || '').substring(0, 40)}" | escolhido="${titleFinal.substring(0, 50)}" | qualidadeFinal=${quality}`);
        return this.buildTorrentResult({
            title: titleFinal,
            magnet: r.magnet,
            seeders: 0,
            leechers: 0,
            size: r.size || 'N/A',
            quality: quality || 'HD',
            provider: 'Starck',
            language: r.language || 'desconhecido',
            type,
            season,
            episode,
            originalTitle: r.originalTitle,
            year: r.year,
            canonicalName: r.canonicalName || dnDoMagnet,
            infoHash: r.infoHash,
            confidence: 0.70,
            relevanceScore: 0,
        });
    }
    mapHdrLanguage(label) {
        switch (label) {
            case 'Dual Áudio': return 'Dual Áudio';
            case 'Dublado': return 'Dublado';
            case 'Legendado': return 'Legendado';
            case 'Nacional': return 'Nacional';
            default: return 'desconhecido';
        }
    }
    calculateSizeInBytes(sizeStr) {
        if (!sizeStr || sizeStr === 'Tamanho não especificado')
            return 1.5 * 1024 ** 3;
        const match = sizeStr.match(/(\d+\.?\d*)\s*(GB|MB|G|M)/i);
        if (!match)
            return 1.5 * 1024 ** 3;
        const value = parseFloat(match[1]);
        const unit = match[2].toUpperCase();
        if (unit === 'GB' || unit === 'G')
            return value * 1024 ** 3;
        if (unit === 'MB' || unit === 'M')
            return value * 1024 ** 2;
        return 1.5 * 1024 ** 3;
    }
    getStats() {
        const nomes = ['bludv', 'wordpress', 'starck', 'hdr'];
        return {
            provedoresAtivos: nomes.filter(isScraperAtivo).length,
        };
    }
}
exports.TorrentScraperService = TorrentScraperService;
