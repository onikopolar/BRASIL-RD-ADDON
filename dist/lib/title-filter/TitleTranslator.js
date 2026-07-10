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
exports.TitleTranslator = void 0;
const logger_js_1 = require("../../utils/logger.js");
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
class TitleTranslator {
    constructor() {
        this.GOOGLE_TRANSLATE_URL = 'https://translate.google.com/m';
        this.requestDelay = 500;
        this.knownTranslations = new Map([
            ['os mercenarios', 'the expendables'],
            ['os mercenários', 'the expendables'],
            ['a casa do dragao', 'house of the dragon'],
            ['a casa do dragão', 'house of the dragon'],
            ['casa do dragao', 'house of the dragon'],
            ['casa do dragão', 'house of the dragon'],
            ['doutor estranho', 'doctor strange'],
            ['doutor estranho no multiverso da loucura', 'doctor strange in the multiverse of madness'],
            ['senhor dos aneis', 'lord of the rings'],
            ['senhor dos anéis', 'lord of the rings'],
            ['o senhor dos aneis', 'the lord of the rings'],
            ['o senhor dos anéis', 'the lord of the rings'],
            ['assassinos da lua', 'killers of the flower moon'],
            ['assassinos da lua das flores', 'killers of the flower moon'],
            ['missao impossivel', 'mission impossible'],
            ['missão impossível', 'mission impossible'],
            ['vingadores', 'avengers'],
            ['vingadores ultimato', 'avengers endgame'],
            ['vingadores guerra infinita', 'avengers infinity war'],
            ['vingadores era de ultron', 'avengers age of ultron'],
            ['homem aranha', 'spider man'],
            ['homem aranha no aranhaverso', 'spider man into the spider verse'],
            ['homem aranha através do aranhaverso', 'spider man across the spider verse'],
            ['batman', 'batman'],
            ['superman', 'superman'],
            ['wolverine', 'wolverine'],
            ['panico', 'scream'],
            ['pânico', 'scream'],
            ['o poderoso chefao', 'the godfather'],
            ['o poderoso chefão', 'the godfather'],
            ['avatar', 'avatar'],
            ['star wars', 'star wars'],
            ['guerra nas estrelas', 'star wars'],
            ['coringa', 'joker'],
            ['o homem de aco', 'man of steel'],
            ['o homem de aço', 'man of steel'],
            ['mulher maravilha', 'wonder woman'],
            ['liga da justica', 'justice league'],
            ['aquaman', 'aquaman'],
            ['flash', 'flash'],
            ['aranhaverso', 'spider verse'],
            ['viuva negra', 'black widow'],
            ['thor', 'thor'],
            ['capitao america', 'captain america'],
            ['homem de ferro', 'iron man'],
            ['hulk', 'hulk'],
            ['temporada', 'season'],
            ['dublado', 'dubbed'],
            ['legendado', 'subtitled'],
            ['episodio', 'episode'],
            ['episódio', 'episode'],
            ['filme', 'movie'],
            ['serie', 'series'],
            ['série', 'series'],
            ['hd', 'hd'],
            ['fullhd', 'full hd'],
            ['4k', '4k'],
            ['bluray', 'bluray'],
            ['webdl', 'web dl'],
            ['hdtv', 'hdtv'],
            ['no', 'in'],
            ['na', 'in the'],
            ['nas', 'in the'],
            ['nos', 'in the'],
            ['da', 'of the'],
            ['do', 'of the'],
            ['das', 'of the'],
            ['dos', 'of the'],
            ['de', 'of'],
            ['em', 'in'],
            ['com', 'with'],
            ['sem', 'without'],
            ['para', 'for'],
            ['por', 'by'],
            ['a', 'the'],
            ['o', 'the'],
            ['as', 'the'],
            ['os', 'the'],
            ['um', 'a'],
            ['uma', 'a'],
            ['ao', 'to the'],
            ['à', 'to the'],
            ['aos', 'to the'],
            ['às', 'to the']
        ]);
        this.logger = new logger_js_1.Logger('TitleTranslator');
    }
    async translateTitle(fullTitle) {
        this.logger.debug('Iniciando tradução de título', {
            original: fullTitle.substring(0, 80)
        });
        const normalizedTitle = this.normalizeTitle(fullTitle);
        const dictionaryTranslation = this.translateWithDictionary(normalizedTitle);
        if (dictionaryTranslation && this.isFullyTranslated(normalizedTitle, dictionaryTranslation)) {
            this.logger.debug(' Tradução completa via dicionário', {
                original: normalizedTitle.substring(0, 60),
                translated: dictionaryTranslation.substring(0, 60)
            });
            return dictionaryTranslation;
        }
        try {
            await this.delay(this.requestDelay);
            const response = await axios_1.default.get(this.GOOGLE_TRANSLATE_URL, {
                params: {
                    sl: 'pt',
                    tl: 'en',
                    q: fullTitle
                },
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9'
                },
                timeout: 5000
            });
            const $ = cheerio.load(response.data);
            const translatedText = $('.result-container').text().trim();
            if (translatedText && translatedText.length > 0) {
                const googleTranslation = this.cleanTranslatedText(translatedText);
                this.logger.debug(' Tradução via Google Translate', {
                    original: normalizedTitle.substring(0, 60),
                    google: googleTranslation.substring(0, 60)
                });
                const finalTranslation = this.combineTranslations(normalizedTitle, googleTranslation);
                return finalTranslation;
            }
            return dictionaryTranslation || normalizedTitle;
        }
        catch (error) {
            this.logger.warn('Falha ao traduzir título', {
                title: normalizedTitle.substring(0, 60),
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return dictionaryTranslation || normalizedTitle;
        }
    }
    translateWithDictionary(title) {
        const words = title.split(' ').filter(w => w.length > 0);
        if (words.length === 0)
            return '';
        const translatedWords = [];
        for (let i = 0; i < words.length; i++) {
            let translated = false;
            for (let phraseLength = 4; phraseLength >= 1; phraseLength--) {
                if (i + phraseLength <= words.length) {
                    const phrase = words.slice(i, i + phraseLength).join(' ');
                    if (this.knownTranslations.has(phrase)) {
                        translatedWords.push(this.knownTranslations.get(phrase) || phrase);
                        i += phraseLength - 1;
                        translated = true;
                        break;
                    }
                }
            }
            if (!translated) {
                const word = words[i];
                if (this.knownTranslations.has(word)) {
                    translatedWords.push(this.knownTranslations.get(word) || word);
                }
                else {
                    translatedWords.push(word);
                }
            }
        }
        return translatedWords.join(' ');
    }
    combineTranslations(original, googleTranslation) {
        const dictTranslation = this.translateWithDictionary(original);
        if (dictTranslation && dictTranslation !== original) {
            const dictWords = dictTranslation.split(' ');
            const originalWords = original.split(' ');
            const finalWords = dictWords.map((dictWord, index) => {
                if (index < originalWords.length && dictWord === originalWords[index]) {
                    const googleWords = googleTranslation.split(' ');
                    if (index < googleWords.length && googleWords[index] !== originalWords[index]) {
                        return googleWords[index];
                    }
                }
                return dictWord;
            });
            return finalWords.join(' ');
        }
        return googleTranslation;
    }
    isFullyTranslated(original, translation) {
        const originalWords = original.split(' ').filter(w => w.length > 0);
        const translationWords = translation.split(' ').filter(w => w.length > 0);
        if (originalWords.length !== translationWords.length)
            return false;
        let changedWords = 0;
        for (let i = 0; i < originalWords.length; i++) {
            if (originalWords[i] !== translationWords[i]) {
                changedWords++;
            }
        }
        return changedWords >= originalWords.length * 0.7;
    }
    normalizeTitle(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    cleanTranslatedText(text) {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    isAlreadyEnglish(title) {
        const portugueseWords = [
            'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
            'por', 'para', 'com', 'sem', 'o', 'a', 'os', 'as', 'um', 'uma',
            'ao', 'à', 'aos', 'às', 'num', 'numa', 'nuns', 'numas',
            'dublado', 'legendado', 'temporada', 'episodio', 'episódio'
        ];
        const words = title.toLowerCase().split(' ');
        const portugueseCount = words.filter(w => portugueseWords.includes(w)).length;
        const totalWords = words.length;
        return totalWords > 0 && (portugueseCount / totalWords) < 0.3;
    }
    addTranslation(portuguese, english) {
        const key = this.normalizeTitle(portuguese);
        const value = english.toLowerCase().trim();
        this.knownTranslations.set(key, value);
        this.logger.debug(' Tradução adicionada ao dicionário', {
            portuguese: key,
            english: value
        });
    }
    hasTranslation(phrase) {
        const normalized = this.normalizeTitle(phrase);
        return this.knownTranslations.has(normalized);
    }
    getAllTranslations() {
        const result = {};
        this.knownTranslations.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }
    getStats() {
        return {
            translatorType: 'Google Translate + Dicionário Avançado',
            requestDelay: this.requestDelay,
            knownTranslations: this.knownTranslations.size,
            features: [
                'Tradução palavra por palavra',
                'Tradução de frases completas',
                'Combinação Google + Dicionário',
                'Rate limiting automático'
            ]
        };
    }
}
exports.TitleTranslator = TitleTranslator;
