"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimilarityCalculator = void 0;
const logger_js_1 = require("../../utils/logger.js");
const ImdbScraperService_js_1 = require("../../services/ImdbScraperService.js");
class SimilarityCalculator {
    static getInstance() {
        if (!SimilarityCalculator.instance) {
            SimilarityCalculator.instance = new SimilarityCalculator(undefined, true);
        }
        return SimilarityCalculator.instance;
    }
    constructor(_titleCleaner, useTmdbScraper = true) {
        this.tmdbCache = new Map();
        this.cacheTTL = 5 * 60 * 1000;
        this.logger = new logger_js_1.Logger('SimilarityCalculator');
        this.tmdbScraper = useTmdbScraper ? ImdbScraperService_js_1.ImdbScraperService.getInstance() : null;
    }
    async smartTitleContainsCheck(torrentTitle, imdbId, torrentMetadata) {
        let movieInfo = null;
        if (this.tmdbScraper) {
            try {
                const season = torrentMetadata?.season;
                const cacheKey = season ? `tmdb-${imdbId}:s${season}` : `tmdb-${imdbId}`;
                const cached = this.tmdbCache.get(cacheKey);
                let tmdbData;
                if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                    tmdbData = cached.data;
                }
                else {
                    tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
                    this.tmdbCache.set(cacheKey, { data: tmdbData, timestamp: Date.now() });
                }
                movieInfo = {
                    portugueseTitle: tmdbData.portugueseTitle,
                    originalTitle: tmdbData.originalTitle,
                    year: tmdbData.year,
                    allTitles: tmdbData.allTitles,
                    mediaType: tmdbData.mediaType,
                    belongsToCollection: tmdbData.belongsToCollection
                };
            }
            catch (error) {
                this.logger.error('Erro ao buscar TMDB', { imdbId, error: error instanceof Error ? error.message : 'Erro' });
            }
        }
        if (!movieInfo) {
            return { matches: false, similarity: 0, reason: 'Sem dados do TMDB' };
        }
        const torrentYear = torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);
        return this.comparacaoPalavraPorPalavra(torrentTitle, movieInfo, torrentYear, torrentMetadata?.season);
    }
    comparacaoPalavraPorPalavra(tituloTorrent, movieInfo, anoTorrent, temporadaAlvo) {
        const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
        if (titulosValidos.length === 0) {
            return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
        }
        const palavrasTorrent = this.normalizarParaComparacao(tituloTorrent)
            .split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
        const setTorrent = new Set(palavrasTorrent);
        const todasPalavrasTmdb = new Set();
        for (const titulo of titulosValidos) {
            for (const palavra of this.normalizarParaComparacao(titulo).split(' ')) {
                if (palavra.length > 2 && !/^\d+$/.test(palavra)) {
                    todasPalavrasTmdb.add(palavra);
                }
            }
        }
        const palavrasEstranhas = [];
        for (const palavra of palavrasTorrent) {
            if (!todasPalavrasTmdb.has(palavra)) {
                palavrasEstranhas.push(palavra);
            }
        }
        let melhorTitulo = '';
        let melhorEncontradas = 0;
        let melhorTotal = 0;
        let melhorFaltando = [];
        for (const titulo of titulosValidos) {
            const palavrasTmdb = [];
            for (const palavra of this.normalizarParaComparacao(titulo).split(' ')) {
                if (palavra.length > 2 && !/^\d+$/.test(palavra)) {
                    palavrasTmdb.push(palavra);
                }
            }
            let encontradas = 0;
            const faltando = [];
            for (const palavra of palavrasTmdb) {
                if (setTorrent.has(palavra)) {
                    encontradas++;
                }
                else {
                    faltando.push(palavra);
                }
            }
            if (encontradas > melhorEncontradas || (encontradas === melhorEncontradas && faltando.length < melhorFaltando.length)) {
                melhorEncontradas = encontradas;
                melhorTotal = palavrasTmdb.length;
                melhorFaltando = faltando;
                melhorTitulo = titulo;
            }
        }
        const tmdbCompleto = melhorFaltando.length === 0;
        const proporcao = melhorTotal > 0 ? melhorEncontradas / melhorTotal : 0;
        const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
        const anoTmdb = movieInfo.year;
        if (melhorEncontradas === 0) {
            return { matches: false, similarity: 0, reason: 'Nenhuma palavra TMDB' };
        }
        if (anoTorrent && anoTmdb && anoTorrent !== anoTmdb) {
            const diferenca = Math.abs(anoTmdb - anoTorrent);
            if (diferenca <= 2 && proporcao >= 0.85) {
                return { matches: true, similarity: proporcao, reason: `Match + ano próximo (${diferenca}a): "${melhorTitulo}"` };
            }
            return { matches: false, similarity: proporcao * 0.6, reason: `Ano diferente: TMDB ${anoTmdb} != ${anoTorrent}` };
        }
        if (anoTorrent && anoTmdb && anoTorrent === anoTmdb && proporcao >= 0.7) {
            return { matches: true, similarity: proporcao, reason: `Ano bate (${anoTorrent}) + match ${melhorEncontradas}/${melhorTotal}: "${melhorTitulo}"` };
        }
        if (!anoTorrent) {
            if (movieInfo.mediaType === 'tv' && temTemporada) {
                if (proporcao >= 0.65) {
                    return { matches: true, similarity: proporcao, reason: `Série S${temporadaAlvo} explícita: "${melhorTitulo}"` };
                }
                return { matches: false, similarity: proporcao * 0.5, reason: `Série S${temporadaAlvo} com match baixo: ${melhorEncontradas}/${melhorTotal}` };
            }
            if (proporcao >= 0.9) {
                return { matches: true, similarity: proporcao, reason: 'Similaridade alta sem ano' };
            }
            return { matches: false, similarity: proporcao * 0.7, reason: `Requer ano. TMDB: ${anoTmdb}` };
        }
        if (tmdbCompleto && palavrasEstranhas.length === 0) {
            return { matches: true, similarity: 1.0, reason: `Match completo: "${melhorTitulo}"` };
        }
        if (tmdbCompleto && palavrasEstranhas.length > 0 && melhorTotal <= 2) {
            return { matches: false, similarity: proporcao * 0.5, reason: `TMDB curto + estranha: [${palavrasEstranhas.join(', ')}]` };
        }
        if (tmdbCompleto && palavrasEstranhas.length > 0) {
            return { matches: true, similarity: 0.75, reason: `TMDB completo + extras: [${palavrasEstranhas.join(', ')}]` };
        }
        if (!tmdbCompleto && palavrasEstranhas.length > 0) {
            return { matches: false, similarity: proporcao * 0.4, reason: `Faltam: [${melhorFaltando.join(', ')}] + estranhas: [${palavrasEstranhas.join(', ')}]` };
        }
        if (proporcao >= 0.6) {
            return { matches: true, similarity: proporcao, reason: `Match parcial: [${melhorEncontradas}/${melhorTotal}] "${melhorTitulo}"` };
        }
        return { matches: false, similarity: proporcao, reason: `Match insuficiente: [${melhorEncontradas}/${melhorTotal}] "${melhorTitulo}"` };
    }
    temTemporadaExplicita(titulo, temporada) {
        const lower = titulo.toLowerCase();
        const padroes = [`s${temporada.toString().padStart(2, '0')}`, `s${temporada}`, `season ${temporada}`, `temporada ${temporada}`, `temporada ${temporada}ª`, ` ${temporada}ª temporada`, `t${temporada}`, `t${temporada.toString().padStart(2, '0')}`];
        return padroes.some(p => lower.includes(p));
    }
    temEpisodioExplicito(titulo) {
        return /\be\d{1,10}\b|\bep\d{1,10}\b|\bepisode \d{1,10}\b|\bepisódio \d{1,10}\b/i.test(titulo);
    }
    normalizarParaComparacao(titulo) {
        return titulo
            .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
            .replace(/&[AEIOUYaeiouy](?:grave|acute|circ|tilde|uml|ring|cedil|slash);/g, ' ')
            .replace(/&(?:ndash|mdash|amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|rdquo|ldquo|hellip);/g, ' ')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/[\/\.\-_:]/g, ' ')
            .replace(/\b\d{3,4}[pi]\b/gi, ' ').replace(/\b[0-9]+k\b/gi, ' ').replace(/\b[hx]\d{3}\b/gi, ' ')
            .replace(/\b\d+\.\d+(?:ch)?\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    extrairAnoDoTitulo(titulo) {
        const m = titulo.match(/\b(19|20)\d{2}\b/);
        return m ? parseInt(m[0]) : null;
    }
    getStats() {
        return {
            algoritmo: 'comparação palavra-por-palavra com ano/temporada inline',
            regras: [
                'ano bate → match forte (>=70%)',
                'ano diferente → rejeitar (tolerância ±2a)',
                'temporada explícita → bypass ano',
                'match completo + estranhas → aceitar',
                'faltam TMDB + estranhas → rejeitar'
            ]
        };
    }
}
exports.SimilarityCalculator = SimilarityCalculator;
