"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TorrentScraperService = void 0;
const logger_js_1 = require("../../utils/logger.js");
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
const ImdbScraperService_js_1 = require("../../catalogo/ImdbScraperService.js");
const wordpressScraper_js_1 = require("./wordpressScraper.js");
const bludvScraper_js_1 = require("./bludvScraper.js");
const starckScraper_js_1 = require("./starckScraper.js");
const hdrScraper_js_1 = require("./hdrScraper.js");
const TechnicalWords_js_1 = require("../../titulos/TechnicalWords.js");
const logger = new logger_js_1.Logger('TorrentScraperService');
class TorrentScraperService {
    constructor(tmdbScraper) {
        this.version = '6.5.4';
        this.qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        this.tmdbScraper = tmdbScraper || ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.wpScraper = new wordpressScraper_js_1.WordPressScraper();
        this.bludvScraper = new bludvScraper_js_1.BludvScraper();
    }
    async searchTorrents(query, type = 'movie', targetSeason, targetYear, imdbId) {
        const startTime = Date.now();
        try {
            let tmdbData = null;
            if (imdbId) {
                tmdbData = await this.getTmdbData(imdbId, targetSeason);
            }
            const searchQueries = this.generateSearchQueries(query, type, targetSeason, targetYear, tmdbData);
            logger.debug(`🔍 Buscando torrents para: "${query}" | alvo S${targetSeason ?? '?'}E${'?'} | imdbId: ${imdbId ?? 'N/A'}`);
            logger.debug(`🔍 Queries geradas: ${searchQueries.length}`, {
                queries: searchQueries.slice(0, 10),
                total: searchQueries.length,
            });
            const [wpResults, starckResults, hdrResults] = await Promise.all([
                Promise.all([
                    this.bludvScraper.search(query, type, targetSeason, searchQueries).catch(() => []),
                    this.wpScraper.search(query, type, targetSeason, searchQueries).catch(() => []),
                ]).then(([bludvResultados, wpResultados]) => {
                    const seen = new Set();
                    const combined = [...bludvResultados, ...wpResultados];
                    logger.debug(`📊 BLUDV: ${bludvResultados.length} | WP: ${wpResultados.length} | total bruto: ${combined.length}`);
                    if (combined.length > 0) {
                        const sample = combined.slice(0, 3);
                        for (const t of sample) {
                            logger.debug(`📄 Amostra: "${t.title?.substring(0, 50)}" | htmlTitle: "${(t.htmlTitle || '').substring(0, 30)}" | episode: ${t.episode ?? 'N/A'} | provider: ${t.provider}`);
                        }
                    }
                    return combined.filter(t => {
                        if (seen.has(t.magnet))
                            return false;
                        seen.add(t.magnet);
                        return true;
                    });
                }).catch(() => []),
                (0, starckScraper_js_1.searchStarck)(query, type, targetSeason, searchQueries)
                    .then(results => {
                    const seen = new Set();
                    logger.debug(`📊 Starck: ${results.length} resultados brutos`);
                    return results
                        .filter(t => { if (seen.has(t.infoHash))
                        return false; seen.add(t.infoHash); return true; })
                        .map(r => {
                        logger.debug('STARCK_RESULT_BRUTO', {
                            magnetInicio: r.magnet?.substring(0, 80),
                            canonicalName: r.canonicalName,
                            episode: r.episode,
                            season: r.season,
                            qualityHint: r.qualityHint,
                            originalTitle: r.originalTitle,
                            year: r.year,
                        });
                        return this.mapStarckResult(r, type);
                    })
                        .filter((r) => r !== null);
                })
                    .catch(() => []),
                (0, hdrScraper_js_1.searchHdr)(query, type, targetSeason, searchQueries)
                    .then(results => {
                    const seen = new Set();
                    logger.debug(`📊 HDR: ${results.length} resultados brutos`);
                    return results
                        .filter(t => { if (seen.has(t.infoHash))
                        return false; seen.add(t.infoHash); return true; })
                        .map(r => this.mapHdrResult(r, type))
                        .filter((r) => r !== null);
                })
                    .catch(() => []),
            ]);
            const allResults = [...wpResults, ...starckResults, ...hdrResults];
            logger.debug(`📊 Total consolidado: ${allResults.length} torrents (WP+BLUDV: ${wpResults.length}, Starck: ${starckResults.length}, HDR: ${hdrResults.length})`);
            const comHtmlTitle = allResults.filter(t => t.htmlTitle).length;
            const comEpisode = allResults.filter(t => t.episode !== undefined).length;
            logger.debug(`📊 htmlTitle presente em ${comHtmlTitle}/${allResults.length} | episode presente em ${comEpisode}/${allResults.length}`);
            const duration = Date.now() - startTime;
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
    async getTmdbData(imdbId, season) {
        try {
            return await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
        }
        catch {
            return null;
        }
    }
    generateSearchQueries(query, type, targetSeason, targetYear, tmdbData) {
        const queries = [];
        if (type === 'series' && targetSeason !== undefined && tmdbData?.allTitles?.length > 0) {
            const titulosUnicos = [];
            for (const titulo of tmdbData.allTitles) {
                if (titulo && !titulosUnicos.some(t => t.toLowerCase() === titulo.toLowerCase())) {
                    titulosUnicos.push(titulo);
                }
            }
            if (titulosUnicos.length < 2) {
                for (const titulo of [tmdbData.portugueseTitle, tmdbData.portugueseTitleRaw]) {
                    if (titulo && !titulosUnicos.some(t => t.toLowerCase() === titulo.toLowerCase())) {
                        titulosUnicos.push(titulo);
                        if (titulosUnicos.length >= 2)
                            break;
                    }
                }
            }
            if (titulosUnicos.length === 0) {
                titulosUnicos.push(query);
            }
            const titulosSelecionados = titulosUnicos.slice(0, 2);
            for (const titulo of titulosSelecionados) {
                queries.push(`${titulo} ${targetSeason}ª temporada`);
            }
            if (queries.length === 0) {
                queries.push(`${query} ${targetSeason}ª temporada`);
            }
            return queries;
        }
        if (tmdbData?.originalTitle) {
            const yearToUse = targetYear || tmdbData.year;
            const titulosBase = [
                tmdbData.originalTitle,
                tmdbData.portugueseTitle,
                ...(tmdbData.allTitles || [])
            ];
            const titulosUnicos = titulosBase
                .filter((t) => !!t && t.trim().length > 3)
                .map(t => t.trim())
                .filter((t, i, arr) => arr.findIndex(x => x.toLowerCase() === t.toLowerCase()) === i)
                .slice(0, 2);
            for (const titulo of titulosUnicos) {
                if (yearToUse) {
                    queries.push(`${titulo} ${yearToUse}`);
                }
            }
            for (const titulo of titulosUnicos) {
                queries.push(titulo);
            }
        }
        if (queries.length === 0) {
            queries.push(query);
            if (targetYear) {
                queries.push(`${query} ${targetYear}`);
            }
        }
        return [...new Set(queries.filter(q => q && q.trim().length > 3))];
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
        };
    }
    extractDnFromMagnet(magnet) {
        const dnMatch = magnet.match(/dn=([^&]+)/i);
        return dnMatch ? decodeURIComponent(dnMatch[1].replace(/\+/g, ' ')) : magnet;
    }
    mapHdrResult(r, type) {
        if (!r.magnet)
            return null;
        const magnetName = r.canonicalName || this.extractDnFromMagnet(r.magnet) || r.title;
        const quality = this.qualityDetector.extractQualityFromFilename(magnetName);
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(magnetName);
        const season = r.season ?? range?.season ?? undefined;
        const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);
        const language = r.language ? this.mapHdrLanguage(r.language) : 'desconhecido';
        return this.buildTorrentResult({
            title: magnetName,
            magnet: r.magnet,
            seeders: r.seeders,
            leechers: 0,
            size: r.size || 'N/A',
            quality: quality || 'HD',
            provider: 'HDR Torrent',
            language,
            type,
            season,
            episode,
            originalTitle: r.originalTitle,
            year: r.year,
            canonicalName: magnetName,
            confidence: 0.70,
            relevanceScore: 0,
            sizeInBytes: this.calculateSizeInBytes(r.size),
        });
    }
    mapStarckResult(r, type) {
        if (!r.magnet)
            return null;
        const dnDoMagnet = this.extractDnFromMagnet(r.magnet);
        const temDn = dnDoMagnet !== r.magnet;
        const displayName = r.canonicalName || (temDn ? dnDoMagnet : undefined);
        let quality = this.qualityDetector.extractQualityFromFilename(displayName || '');
        if (quality === 'HD' && r.qualityHint) {
            const hintQuality = this.qualityDetector.extractQualityFromFilename(r.qualityHint);
            if (hintQuality !== 'HD')
                quality = hintQuality;
        }
        const range = displayName ? (0, TechnicalWords_js_1.extrairRangeEpisodios)(displayName) : null;
        const season = r.season ?? range?.season ?? undefined;
        const episode = r.episode ?? (range && range.episodeStart > 0 ? range.episodeStart : undefined);
        const titleFinal = r.canonicalName || r.originalTitle || displayName || 'Starck Torrent';
        return this.buildTorrentResult({
            title: titleFinal,
            magnet: r.magnet,
            seeders: 0,
            leechers: 0,
            size: 'N/A',
            quality: quality || 'HD',
            provider: 'Starck',
            language: r.language || 'desconhecido',
            type,
            season,
            episode,
            originalTitle: r.originalTitle,
            year: r.year,
            canonicalName: r.canonicalName || (temDn ? dnDoMagnet : undefined),
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
        return {
            versao: this.version,
            provedoresAtivos: 3,
        };
    }
}
exports.TorrentScraperService = TorrentScraperService;
