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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextAnalyzer = void 0;
const logger_1 = require("../../utils/logger");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const TitleTranslator_1 = require("./../title-filter/TitleTranslator");
class ContextAnalyzer {
    constructor(translator) {
        this.learnedCount = 0;
        this.TECHNICAL_TERMS = [
            'torrent', '8211', '8220', '8221',
            '1080p', '720p', '480p', '4k', '2160p',
            'mp4', 'mkv', 'avi', 'webm', 'mov',
            'x264', 'x265', 'h264', 'h265', 'hevc',
            'web-dl', 'webrip', 'bluray', 'dvdrip', 'hdtv'
        ];
        this.logger = new logger_1.Logger('ContextAnalyzer');
        this.learnedPatterns = new Map();
        this.blacklist = new Set();
        this.whitelist = new Set();
        this.dataFile = path.join(process.cwd(), 'data', 'context-analyzer-learned.json');
        this.translator = translator || new TitleTranslator_1.TitleTranslator();
        this.loadLearnedData();
        this.logger.info('ContextAnalyzer inicializado com TitleTranslator', {
            patterns: this.learnedPatterns.size,
            learnedCount: this.learnedCount,
            translatorCacheSize: this.translator.getStats().cacheSize
        });
    }
    loadLearnedData() {
        try {
            if (fs.existsSync(this.dataFile)) {
                const rawData = fs.readFileSync(this.dataFile, 'utf8');
                const data = JSON.parse(rawData);
                this.learnedPatterns = new Map(Object.entries(data.learnedPatterns || {}));
                this.blacklist = new Set(data.blacklist || []);
                this.whitelist = new Set(data.whitelist || []);
                this.learnedCount = data.learnedCount || 0;
                this.logger.debug('Aprendizado anterior carregado', {
                    patterns: this.learnedPatterns.size,
                    learnedCount: this.learnedCount
                });
            }
            else {
                this.logger.debug('Iniciando com aprendizado zero - estado puro');
            }
        }
        catch (error) {
            this.logger.warn('Erro ao carregar aprendizado anterior', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                file: this.dataFile
            });
        }
    }
    saveLearnedData() {
        try {
            const dir = path.dirname(this.dataFile);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            const data = {
                learnedPatterns: Object.fromEntries(this.learnedPatterns),
                blacklist: Array.from(this.blacklist),
                whitelist: Array.from(this.whitelist),
                learnedCount: this.learnedCount,
                lastUpdated: new Date().toISOString()
            };
            fs.writeFileSync(this.dataFile, JSON.stringify(data, null, 2));
            this.logger.debug('Aprendizado salvo', {
                file: this.dataFile,
                learnedCount: this.learnedCount
            });
        }
        catch (error) {
            this.logger.error('Erro ao salvar aprendizado', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                file: this.dataFile
            });
        }
    }
    analyzeContext(torrentTitle, imdbTitle) {
        const torrentNorm = this.normalize(torrentTitle);
        const imdbNorm = this.normalize(imdbTitle);
        this.logger.debug('Análise de contexto com tradução', {
            torrent: torrentNorm.substring(0, 60),
            imdb: imdbNorm.substring(0, 60)
        });
        const translatedMatch = this.tryTranslationMatch(torrentNorm, imdbNorm);
        if (translatedMatch.matched) {
            return {
                matches: translatedMatch.isMatch,
                confidence: translatedMatch.confidence,
                reason: translatedMatch.reason,
                learned: false
            };
        }
        if (this.isInBlacklist(torrentNorm, imdbNorm)) {
            return {
                matches: false,
                confidence: 0.95,
                reason: 'Combinação conhecida como diferente',
                learned: false
            };
        }
        if (this.isInWhitelist(torrentNorm, imdbNorm)) {
            return {
                matches: true,
                confidence: 0.95,
                reason: 'Combinação conhecida como igual',
                learned: false
            };
        }
        const analysis = this.smartSemanticAnalysis(torrentNorm, imdbNorm);
        const learnedSomething = this.learnIntelligently(torrentNorm, imdbNorm, analysis.matches, analysis.confidence);
        return {
            matches: analysis.matches,
            confidence: analysis.confidence,
            reason: analysis.reason,
            learned: learnedSomething
        };
    }
    tryTranslationMatch(torrent, imdb) {
        const hasDirectTranslation = this.translator.findMatch(torrent, imdb);
        if (hasDirectTranslation) {
            return {
                matched: true,
                isMatch: true,
                confidence: 0.9,
                reason: 'Tradução conhecida encontrada'
            };
        }
        const translatedTorrent = this.translator.translateTitle(torrent);
        if (translatedTorrent !== torrent) {
            const similarity = this.calculateSimilarity(translatedTorrent, imdb);
            if (similarity > 0.7) {
                return {
                    matched: true,
                    isMatch: true,
                    confidence: 0.85,
                    reason: `Título traduzido é similar (${Math.round(similarity * 100)}%)`
                };
            }
        }
        const translatorAny = this.translator;
        const translationCache = translatorAny.translationCache;
        const cacheEntries = translationCache ? Array.from(translationCache.entries()) : [];
        const reverseTranslations = cacheEntries
            .filter((entry) => {
            const [pt, en] = entry;
            return imdb.includes(en);
        })
            .map((entry) => entry[0]);
        if (reverseTranslations.length > 0) {
            for (const ptWord of reverseTranslations) {
                if (torrent.includes(ptWord)) {
                    return {
                        matched: true,
                        isMatch: true,
                        confidence: 0.8,
                        reason: `Tradução reversa encontrada: "${ptWord}"`
                    };
                }
            }
        }
        return { matched: false, isMatch: false, confidence: 0, reason: '' };
    }
    isInBlacklist(torrent, imdb) {
        const combo = `${torrent}|${imdb}`;
        return this.blacklist.has(combo);
    }
    isInWhitelist(torrent, imdb) {
        const combo = `${torrent}|${imdb}`;
        return this.whitelist.has(combo);
    }
    smartSemanticAnalysis(torrent, imdb) {
        const torrentCore = this.extractRealTitleCore(torrent);
        const imdbCore = this.extractRealTitleCore(imdb);
        this.logger.debug('Núcleos para análise semântica', {
            torrentCore,
            imdbCore
        });
        const directSimilarity = this.calculateSimilarity(torrentCore, imdbCore);
        const keywordSimilarity = this.calculateKeywordSimilarity(torrentCore, imdbCore);
        const structuralScore = this.calculateStructuralScore(torrentCore, imdbCore);
        const finalScore = (directSimilarity * 0.5) + (keywordSimilarity * 0.3) + (structuralScore * 0.2);
        this.logger.debug('Scores calculados', {
            directSimilarity,
            keywordSimilarity,
            structuralScore,
            finalScore
        });
        if (finalScore >= 0.75) {
            return {
                matches: true,
                confidence: finalScore,
                reason: `Alta similaridade combinada (${Math.round(finalScore * 100)}%)`
            };
        }
        if (finalScore <= 0.25) {
            return {
                matches: false,
                confidence: 1 - finalScore,
                reason: `Muito diferente (${Math.round(finalScore * 100)}%)`
            };
        }
        if (this.areLikelyTranslations(torrentCore, imdbCore)) {
            return {
                matches: true,
                confidence: 0.65,
                reason: 'Possíveis traduções de nomes próprios'
            };
        }
        return {
            matches: false,
            confidence: 0.5,
            reason: `Similaridade moderada (${Math.round(finalScore * 100)}%) - muito conservador`
        };
    }
    calculateSimilarity(text1, text2) {
        if (!text1 || !text2)
            return 0;
        const words1 = text1.split(' ').filter(w => w.length > 2);
        const words2 = text2.split(' ').filter(w => w.length > 2);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        const set1 = new Set(words1);
        const set2 = new Set(words2);
        const common = words1.filter(w => set2.has(w)).length;
        const maxWords = Math.max(words1.length, words2.length);
        return common / maxWords;
    }
    calculateKeywordSimilarity(text1, text2) {
        const keywords1 = this.extractMeaningfulKeywords(text1);
        const keywords2 = this.extractMeaningfulKeywords(text2);
        if (keywords1.length === 0 || keywords2.length === 0)
            return 0;
        const set1 = new Set(keywords1);
        const set2 = new Set(keywords2);
        const common = keywords1.filter(k => set2.has(k)).length;
        const maxKeywords = Math.max(keywords1.length, keywords2.length);
        return common / maxKeywords;
    }
    calculateStructuralScore(text1, text2) {
        const words1 = text1.split(' ').filter(w => w.length > 2);
        const words2 = text2.split(' ').filter(w => w.length > 2);
        const lengthScore = words1.length === words2.length ? 0.3 : 0;
        const avgLen1 = words1.reduce((sum, w) => sum + w.length, 0) / words1.length || 0;
        const avgLen2 = words2.reduce((sum, w) => sum + w.length, 0) / words2.length || 0;
        const lengthDiff = Math.abs(avgLen1 - avgLen2);
        const lengthSimilarityScore = lengthDiff <= 1 ? 0.3 : 0.2 - (lengthDiff * 0.1);
        return Math.max(0, lengthScore + lengthSimilarityScore);
    }
    areLikelyTranslations(text1, text2) {
        const words1 = text1.split(' ').filter(w => w.length > 3);
        const words2 = text2.split(' ').filter(w => w.length > 3);
        if (words1.length === 1 && words2.length === 1) {
            const w1 = words1[0];
            const w2 = words2[0];
            const lengthDiff = Math.abs(w1.length - w2.length);
            return lengthDiff <= 2;
        }
        return false;
    }
    extractRealTitleCore(title) {
        let core = title.toLowerCase();
        this.TECHNICAL_TERMS.forEach(term => {
            core = core.replace(new RegExp(`\\b${term}\\b`, 'gi'), ' ');
        });
        core = core.replace(/\b\d{4}\b/g, ' ');
        core = core.replace(/\b\d+\b/g, ' ');
        core = core.replace(/\s+/g, ' ').trim();
        return core;
    }
    learnIntelligently(torrent, imdb, isMatch, confidence) {
        let learned = false;
        if (confidence >= 0.8) {
            const torrentCore = this.extractRealTitleCore(torrent);
            const imdbCore = this.extractRealTitleCore(imdb);
            if (isMatch) {
                const key = `${torrentCore}|${imdbCore}`;
                if (!this.whitelist.has(key)) {
                    this.whitelist.add(key);
                    this.learnedCount++;
                    learned = true;
                    this.learnTranslationsFromMatch(torrentCore, imdbCore);
                    this.logger.debug('Aprendizado WHITELIST (alta confiança)', {
                        key,
                        confidence,
                        learnedCount: this.learnedCount
                    });
                }
            }
            else if (confidence >= 0.9) {
                const key = `${torrentCore}|${imdbCore}`;
                if (!this.blacklist.has(key)) {
                    this.blacklist.add(key);
                    this.learnedCount++;
                    learned = true;
                    this.logger.debug('Aprendizado BLACKLIST (muito diferente)', {
                        key,
                        confidence,
                        learnedCount: this.learnedCount
                    });
                }
            }
        }
        if (confidence >= 0.6) {
            const torrentCore = this.extractRealTitleCore(torrent);
            const imdbCore = this.extractRealTitleCore(imdb);
            const learnedFromTorrent = this.learnFromSingleTitle(torrentCore);
            const learnedFromImdb = this.learnFromSingleTitle(imdbCore);
            if (learnedFromTorrent || learnedFromImdb) {
                learned = true;
            }
        }
        if (learned) {
            this.saveLearnedData();
        }
        return learned;
    }
    learnTranslationsFromMatch(torrentCore, imdbCore) {
        const torrentKeywords = this.extractMeaningfulKeywords(torrentCore);
        const imdbKeywords = this.extractMeaningfulKeywords(imdbCore);
        torrentKeywords.forEach(tWord => {
            imdbKeywords.forEach(iWord => {
                if (tWord !== iWord &&
                    tWord.length > 4 &&
                    iWord.length > 4 &&
                    !this.isVeryCommonWord(tWord) &&
                    !this.isVeryCommonWord(iWord)) {
                    this.translator.learnTranslation(tWord, iWord);
                    if (!this.learnedPatterns.has(tWord)) {
                        this.learnedPatterns.set(tWord, [iWord]);
                    }
                    else {
                        const existing = this.learnedPatterns.get(tWord);
                        if (!existing.includes(iWord)) {
                            this.learnedPatterns.set(tWord, [...existing, iWord]);
                        }
                    }
                }
            });
        });
    }
    learnFromSingleTitle(title) {
        const keywords = this.extractMeaningfulKeywords(title);
        let learned = false;
        keywords.forEach(keyword => {
            if (!this.learnedPatterns.has(keyword)) {
                const otherKeywords = keywords
                    .filter(k => k !== keyword)
                    .slice(0, 2);
                if (otherKeywords.length > 0) {
                    this.learnedPatterns.set(keyword, otherKeywords);
                    this.learnedCount++;
                    learned = true;
                    this.logger.debug('Novo padrão aprendido (de título único)', {
                        keyword,
                        relatedWords: otherKeywords,
                        learnedCount: this.learnedCount
                    });
                }
            }
        });
        return learned;
    }
    extractMeaningfulKeywords(text) {
        const words = text.split(' ')
            .filter(word => word.length > 4)
            .filter(word => !this.isVeryCommonWord(word))
            .filter(word => !this.TECHNICAL_TERMS.includes(word.toLowerCase()));
        return [...new Set(words)];
    }
    isVeryCommonWord(word) {
        const veryCommon = [
            'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for',
            'with', 'by', 'from', 'as', 'but', 'so', 'if',
            'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
            'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas',
            'por', 'para', 'com', 'sem', 'sob', 'sobre', 'que', 'como',
            'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'will', 'would', 'should', 'could',
            'this', 'that', 'these', 'those'
        ];
        return veryCommon.includes(word.toLowerCase());
    }
    normalize(text) {
        return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    analyzeWithTranslation(torrentTitle, imdbTitle, isPortuguese = true) {
        if (isPortuguese) {
            this.logger.debug('Análise com foco em tradução PT→EN');
        }
        return this.analyzeContext(torrentTitle, imdbTitle);
    }
    learnTranslationManually(portugueseWord, englishWord) {
        this.translator.learnTranslation(portugueseWord, englishWord);
        if (!this.learnedPatterns.has(portugueseWord)) {
            this.learnedPatterns.set(portugueseWord, [englishWord]);
        }
        else {
            const existing = this.learnedPatterns.get(portugueseWord);
            if (!existing.includes(englishWord)) {
                this.learnedPatterns.set(portugueseWord, [...existing, englishWord]);
            }
        }
        this.learnedCount++;
        this.saveLearnedData();
        this.logger.info('Tradução aprendida manualmente', {
            portuguese: portugueseWord,
            english: englishWord,
            learnedCount: this.learnedCount
        });
    }
    knowsTranslation(portugueseWord) {
        return this.translator.getStats().cacheSize > 0;
    }
    getStats() {
        const translatorStats = this.translator.getStats();
        const patterns = Array.from(this.learnedPatterns.entries());
        return {
            learnedPatterns: this.learnedPatterns.size,
            blacklistSize: this.blacklist.size,
            whitelistSize: this.whitelist.size,
            learnedCount: this.learnedCount,
            translatorCacheSize: translatorStats.cacheSize,
            translatorFailedMatches: translatorStats.failedMatchesCount,
            dataFile: this.dataFile,
            samplePatterns: patterns.slice(0, 5),
            sampleBlacklist: Array.from(this.blacklist).slice(0, 3),
            sampleWhitelist: Array.from(this.whitelist).slice(0, 3)
        };
    }
    clearLearning() {
        this.learnedPatterns.clear();
        this.blacklist.clear();
        this.whitelist.clear();
        this.learnedCount = 0;
        if (fs.existsSync(this.dataFile)) {
            fs.unlinkSync(this.dataFile);
        }
        this.logger.info('Todo o aprendizado foi limpo - estado puro');
    }
}
exports.ContextAnalyzer = ContextAnalyzer;
