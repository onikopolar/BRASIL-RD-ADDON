"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageDetector = void 0;
const logger_js_1 = require("../../utils/logger.js");
const ImdbScraperService_js_1 = require("../../services/ImdbScraperService.js");
const TechnicalWords_js_1 = require("./TechnicalWords.js");
class LanguageDetector {
    constructor() {
        this.logger = new logger_js_1.Logger('LanguageDetector');
        this.imdbScraper = ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.INDICADORES_PT = new Set([
            'dublado', 'dublada', 'dublagem',
            'legendado', 'legendada',
            'nacional', 'dual',
        ]);
        this.INDICADORES_EN = new Set([
            'eng', 'english',
        ]);
    }
    static getInstance() {
        if (!LanguageDetector.instance) {
            LanguageDetector.instance = new LanguageDetector();
        }
        return LanguageDetector.instance;
    }
    verificarIdioma(tituloTorrent, tituloPt, tituloEn) {
        const normalizar = (texto) => texto
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ').trim()
            .split(' ').filter(p => p.length > 0);
        const palavrasTorrent = normalizar(tituloTorrent);
        const setPt = new Set(tituloPt ? normalizar(tituloPt) : []);
        const setEn = new Set(normalizar(tituloEn));
        const encontradasPt = [];
        const encontradasEn = [];
        const desconhecidas = [];
        for (const palavra of palavrasTorrent) {
            if (/^\d+$/.test(palavra))
                continue;
            if (this.INDICADORES_PT.has(palavra) || (0, TechnicalWords_js_1.isBrazilianReleaseGroup)(palavra)) {
                encontradasPt.push(palavra);
                continue;
            }
            if (this.INDICADORES_EN.has(palavra) || (0, TechnicalWords_js_1.isInternationalReleaseGroup)(palavra)) {
                encontradasEn.push(palavra);
                continue;
            }
            if (setPt.has(palavra)) {
                encontradasPt.push(palavra);
                continue;
            }
            if (setEn.has(palavra)) {
                encontradasEn.push(palavra);
                continue;
            }
            if ((0, TechnicalWords_js_1.isTechnicalWord)(palavra))
                continue;
            desconhecidas.push(palavra);
        }
        if (encontradasPt.length > 0) {
            return {
                ehPortugues: true,
                motivo: encontradasEn.length > 0
                    ? `PT detectado (${encontradasPt.join(', ')}) com EN (${encontradasEn.join(', ')})`
                    : `PT detectado: ${encontradasPt.join(', ')}`,
                palavrasPt: encontradasPt,
                palavrasEn: encontradasEn,
                desconhecidas,
            };
        }
        if (encontradasEn.length > 0) {
            return {
                ehPortugues: false,
                motivo: `Apenas EN: ${encontradasEn.join(', ')}. Desconhecidas: ${desconhecidas.join(', ')}`,
                palavrasPt: [],
                palavrasEn: encontradasEn,
                desconhecidas,
            };
        }
        return {
            ehPortugues: true,
            motivo: `Nenhum indicador claro. Desconhecidas: ${desconhecidas.join(', ')}`,
            palavrasPt: [],
            palavrasEn: [],
            desconhecidas,
        };
    }
    async verificarConteudoPortugues(tituloTorrent, imdbId) {
        if (imdbId) {
            try {
                const tmdb = await this.imdbScraper.getTitlesFromImdbId(imdbId);
                if (tmdb && tmdb.allTitles.length > 0) {
                    const resultado = this.verificarIdioma(tituloTorrent, tmdb.portugueseTitle, tmdb.originalTitle);
                    this.logger.debug('verificarConteudoPortugues (TMDB)', {
                        titulo: tituloTorrent.substring(0, 60),
                        ehPortugues: resultado.ehPortugues,
                        motivo: resultado.motivo,
                    });
                    return resultado.ehPortugues;
                }
            }
            catch {
            }
        }
        const resultado = this.verificarIdioma(tituloTorrent, null, tituloTorrent);
        return resultado.ehPortugues;
    }
    isPortugueseContent(tituloTorrent) {
        const resultado = this.verificarIdioma(tituloTorrent, null, tituloTorrent);
        return resultado.ehPortugues;
    }
    analisarTitulo(tituloTorrent, tituloPt, tituloEn) {
        return this.verificarIdioma(tituloTorrent, tituloPt || null, tituloEn || tituloTorrent);
    }
}
exports.LanguageDetector = LanguageDetector;
