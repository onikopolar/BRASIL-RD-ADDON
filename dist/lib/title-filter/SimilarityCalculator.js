"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimilarityCalculator = void 0;
const logger_js_1 = require("../../utils/logger.js");
const ImdbScraperService_js_1 = require("../../services/ImdbScraperService.js");
const LanguageDetector_js_1 = require("./LanguageDetector.js");
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
        this.languageDetector = LanguageDetector_js_1.LanguageDetector.getInstance();
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
        const torqueYear = torrentMetadata?.year || this.extrairAnoDoTitulo(torrentTitle);
        const resultado = this.comparacaoPalavraPorPalavra(torrentTitle, movieInfo, torqueYear, torrentMetadata?.season);
        resultado.mediaType = movieInfo.mediaType;
        return resultado;
    }
    comparacaoPalavraPorPalavra(tituloTorrent, movieInfo, anoTorrent, temporadaAlvo) {
        const titulosValidos = movieInfo.allTitles.filter(t => t && t.trim().length > 0);
        if (titulosValidos.length === 0) {
            return { matches: false, similarity: 0, reason: 'Nenhum título TMDB' };
        }
        const palavrasTorrent = this.normalizarParaComparacao(tituloTorrent)
            .split(' ').filter(w => w.length > 2 && !/^\d+$/.test(w));
        const setTorrent = new Set(palavrasTorrent);
        const tmdbUniao = new Set();
        let t = 0;
        while (t < titulosValidos.length) {
            const normalizado = this.normalizarParaComparacao(titulosValidos[t]).split(' ');
            let w = 0;
            while (w < normalizado.length) {
                const palavra = normalizado[w];
                if (palavra.length > 2 && !/^\d+$/.test(palavra)) {
                    tmdbUniao.add(palavra);
                }
                w++;
            }
            t++;
        }
        const palavrasEstranhas = [];
        let i = 0;
        while (i < palavrasTorrent.length) {
            const palavra = palavrasTorrent[i];
            if (!tmdbUniao.has(palavra)) {
                palavrasEstranhas.push(palavra);
            }
            i++;
        }
        let encontradas = 0;
        const faltando = [];
        const uniaoArray = Array.from(tmdbUniao);
        let k = 0;
        while (k < uniaoArray.length) {
            const palavra = uniaoArray[k];
            if (setTorrent.has(palavra)) {
                encontradas++;
            }
            else {
                faltando.push(palavra);
            }
            k++;
        }
        const tmdbCompleto = faltando.length === 0;
        const totalTmdb = tmdbUniao.size;
        const proporcao = totalTmdb > 0 ? encontradas / totalTmdb : 0;
        const temTemporada = !!(temporadaAlvo && this.temTemporadaExplicita(tituloTorrent, temporadaAlvo));
        const anoTmdb = movieInfo.year;
        if (encontradas === 0) {
            return { matches: false, similarity: 0, reason: 'Nenhuma palavra TMDB' };
        }
        const anoBate = !!(anoTorrent && anoTmdb && anoTorrent === anoTmdb);
        const anoProximo = !!(anoTorrent && anoTmdb && Math.abs(anoTmdb - anoTorrent) <= 2);
        const temIndicadorPt = this.languageDetector.isPortugueseContent(tituloTorrent);
        const temPalavrasSuficientes = encontradas >= 2;
        const temEpisodioExplicito = !!(temporadaAlvo && this.temEpisodioExplicito(tituloTorrent));
        if (anoBate && temIndicadorPt && temPalavrasSuficientes) {
            return { matches: true, similarity: proporcao, reason: `Ano bate (${anoTorrent}) + PT + ${encontradas}/${totalTmdb} palavras` };
        }
        if (anoBate && tmdbCompleto) {
            return { matches: true, similarity: proporcao, reason: `Ano bate (${anoTorrent}) + match completo ${encontradas}/${totalTmdb}` };
        }
        if (anoProximo && temIndicadorPt && temPalavrasSuficientes) {
            return { matches: true, similarity: proporcao, reason: `Ano proximo (${anoTorrent}~=${anoTmdb}) + PT + ${encontradas}/${totalTmdb}` };
        }
        if (movieInfo.mediaType === 'tv' && temTemporada && temPalavrasSuficientes) {
            return { matches: true, similarity: proporcao, reason: `Serie S${temporadaAlvo} explicita + ${encontradas}/${totalTmdb}` };
        }
        if (temIndicadorPt && tmdbCompleto) {
            return { matches: true, similarity: proporcao, reason: `PT + match completo ${encontradas}/${totalTmdb}` };
        }
        if (anoTorrent && anoTmdb && anoTorrent !== anoTmdb && !temIndicadorPt) {
            return { matches: false, similarity: proporcao * 0.6, reason: `Ano diferente: TMDB ${anoTmdb} != ${anoTorrent} (sem PT)` };
        }
        if (tmdbCompleto && palavrasEstranhas.length === 0) {
            return { matches: true, similarity: 1.0, reason: `Match completo: ${encontradas}/${totalTmdb} palavras` };
        }
        if (tmdbCompleto && palavrasEstranhas.length > 0 && totalTmdb <= 2) {
            return { matches: false, similarity: 0.5, reason: `TMDB curto + estranha: [${palavrasEstranhas.join(', ')}]` };
        }
        if (tmdbCompleto && palavrasEstranhas.length > 0) {
            return { matches: true, similarity: 0.75, reason: `TMDB completo + extras: [${palavrasEstranhas.join(', ')}]` };
        }
        if (!tmdbCompleto && palavrasEstranhas.length > 0) {
            return { matches: false, similarity: 0.4, reason: `Faltam: [${faltando.join(', ')}] + estranhas: [${palavrasEstranhas.join(', ')}]` };
        }
        if (encontradas >= 2) {
            return { matches: true, similarity: proporcao, reason: `Match parcial: [${encontradas}/${totalTmdb}]` };
        }
        return { matches: false, similarity: proporcao, reason: `Match insuficiente: [${encontradas}/${totalTmdb}]` };
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
