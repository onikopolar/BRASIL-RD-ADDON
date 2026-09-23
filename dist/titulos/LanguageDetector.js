"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LanguageDetector = void 0;
const logger_js_1 = require("../utils/logger.js");
const TechnicalWords_js_1 = require("./TechnicalWords.js");
class LanguageDetector {
    constructor() {
        this.logger = new logger_js_1.Logger('LanguageDetector');
        this.indicadoresPt = new Set(TechnicalWords_js_1.INDICADORES_BRASIL_TORRENTS.map(w => w.toLowerCase()));
        this.indicadoresEn = new Set(TechnicalWords_js_1.INDICADORES_INTERNACIONAL_TORRENTS.map(w => w.toLowerCase()));
    }
    static getInstance() {
        if (!LanguageDetector.instance) {
            LanguageDetector.instance = new LanguageDetector();
        }
        return LanguageDetector.instance;
    }
    verificarIdioma(tituloTorrent) {
        const palavras = tituloTorrent
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ').trim()
            .split(' ').filter(p => p.length > 0);
        const encontradasPt = [];
        const encontradasEn = [];
        const desconhecidas = [];
        for (const palavra of palavras) {
            if (/^\d+$/.test(palavra))
                continue;
            if (this.indicadoresEn.has(palavra) || (0, TechnicalWords_js_1.isInternationalReleaseGroup)(palavra)) {
                encontradasEn.push(palavra);
                continue;
            }
            if (this.indicadoresPt.has(palavra) || (0, TechnicalWords_js_1.isBrazilianReleaseGroup)(palavra)) {
                encontradasPt.push(palavra);
                continue;
            }
            if ((0, TechnicalWords_js_1.isTechnicalWord)(palavra))
                continue;
            desconhecidas.push(palavra);
        }
        if (encontradasEn.length > 0) {
            return {
                ehPortugues: false,
                motivo: encontradasPt.length > 0
                    ? `EN detectado (${encontradasEn.join(', ')}) — ignora PT (${encontradasPt.join(', ')})`
                    : `EN detectado: ${encontradasEn.join(', ')}`,
                palavrasPt: encontradasPt,
                palavrasEn: encontradasEn,
                desconhecidas,
            };
        }
        if (encontradasPt.length > 0) {
            return {
                ehPortugues: true,
                motivo: `PT detectado: ${encontradasPt.join(', ')}`,
                palavrasPt: encontradasPt,
                palavrasEn: encontradasEn,
                desconhecidas,
            };
        }
        return {
            ehPortugues: false,
            motivo: `Nenhum indicador. Desconhecidas: ${desconhecidas.join(', ')}`,
            palavrasPt: [],
            palavrasEn: [],
            desconhecidas,
        };
    }
    isPortugueseContent(tituloTorrent) {
        return this.verificarIdioma(tituloTorrent).ehPortugues;
    }
}
exports.LanguageDetector = LanguageDetector;
