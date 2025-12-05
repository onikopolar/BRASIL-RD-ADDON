"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimilarityCalculator = void 0;
const logger_1 = require("../../utils/logger");
const ImdbScraperService_1 = require("../../services/ImdbScraperService");
class SimilarityCalculator {
    constructor(titleCleaner, useTmdbScraper = true) {
        this.tmdbCache = new Map();
        this.cacheTTL = 5 * 60 * 1000;
        this.TECHNICAL_WORDS = [
            'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv',
            '720p', '1080p', '2160p', '4k', 'hd', 'fullhd', 'uhd', 'sd', 'fhd', 'hdr', 'dv',
            'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx',
            'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv', 'camrip', 'ts', 'tc', 'r5', 'scr', 'dvdscr', 'bdscr', 'webscr',
            'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio', 'legendado', 'legendada', 'legenda',
            'ac3', 'dts', 'aac', 'dd5.1', 'dolby', 'atmos', 'truehd', 'dts-hd', 'dtshd',
            'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br', 'portugues', 'português', 'eng', 'english', 'ingles', 'brazilian', 'espanol', 'spanish',
            'repack', 'proper', 'extended', 'directors', 'cut', 'remastered', 'complete', 'uncensored', 'uncut', 'limited', 'special', 'edition',
            'directors.cut', 'theatrical', 'unrated', 'imax', '3d',
            'yts', 'yify', 'rarbg', 'ettv', 'eztv', 'amzn', 'nf', 'hulu',
            'm2ts', 'iso', 'bdmv', 'mpls', 'playlist', 'chapter',
            'movie', 'the movie', 'cinema', 'cinematográfico', 'cinematografico',
            'brasileiro', 'brasileira', 'nacional', 'nacionais',
            'versão', 'versao', 'version', 'edição', 'edicao', 'edition',
            'completo', 'completa', 'complete',
            'torrent', 'download', 'baixar', 'assistir'
        ];
        this.TECHNICAL_ACRONYMS = [
            'hdr', 'dv', 'hq', 'bd', 'dvd', 'tv', 'avc', 'hevc', 'aac', 'ac3', 'dts', 'imax', '3d',
            '5.1', '7.1', '2.0', '5.1ch', '7.1ch'
        ];
        this.logger = new logger_1.Logger('SimilarityCalculator');
        this.logger.info('SimilarityCalculator v12.0.0 - Filtro Técnico Completo + Contexto Inteligente');
        this.titleCleaner = titleCleaner;
        if (useTmdbScraper) {
            this.tmdbScraper = new ImdbScraperService_1.ImdbScraperService();
        }
        else {
            this.tmdbScraper = null;
        }
        this.confusingSeries = [
            { original: 'american horror story', derivative: 'american horror stories', minSimilarity: 0.8 },
            { original: 'stranger things', derivative: 'stranger things stories', minSimilarity: 0.8 },
            { original: 'megamind', derivative: 'megamind vs', minSimilarity: 0.7 }
        ];
    }
    async smartTitleContainsCheck(torrentTitle, imdbId, torrentMetadata) {
        this.logger.debug(`Análise: ${torrentTitle.substring(0, 50)}...`);
        let movieInfo = null;
        if (this.tmdbScraper) {
            try {
                const cacheKey = `tmdb-${imdbId}`;
                const cached = this.tmdbCache.get(cacheKey);
                let tmdbData;
                if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                    this.logger.debug(`Cache usado: ${imdbId}`);
                    tmdbData = cached.data;
                }
                else {
                    tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId);
                    this.tmdbCache.set(cacheKey, {
                        data: tmdbData,
                        timestamp: Date.now()
                    });
                }
                movieInfo = {
                    portugueseTitle: tmdbData.portugueseTitle,
                    originalTitle: tmdbData.originalTitle,
                    year: tmdbData.year,
                    allTitles: tmdbData.allTitles
                };
            }
            catch (error) {
                this.logger.error(`Erro TMDB ${imdbId}: ${error instanceof Error ? error.message : 'Erro desconhecido'}`);
            }
        }
        if (!movieInfo) {
            return {
                matches: false,
                similarity: 0,
                reason: 'Sem dados TMDB'
            };
        }
        const torrentYear = torrentMetadata?.year || this.extractYearFromTitle(torrentTitle);
        const torrentClean = this.normalizeForComparison(torrentTitle);
        this.logger.debug(`TMDB: ${movieInfo.portugueseTitle || movieInfo.originalTitle} | Torrent: ${torrentClean.substring(0, 40)}`);
        if (movieInfo.year && torrentYear) {
            if (movieInfo.year !== torrentYear) {
                this.logger.warn(`Ano diferente: ${movieInfo.year} ≠ ${torrentYear}`);
                return {
                    matches: false,
                    similarity: 0.3,
                    reason: `Ano errado: ${movieInfo.year} ≠ ${torrentYear}`
                };
            }
        }
        if (this.isSeriesTitle(torrentTitle)) {
            this.logger.warn('Torrent é série mas busca é filme');
            return {
                matches: false,
                similarity: 0.2,
                reason: 'Torrent é série (tem temporada/episódio) mas busca é filme'
            };
        }
        const matchResult = this.semanticContextAnalysis(torrentClean, torrentTitle, movieInfo.portugueseTitle, movieInfo.originalTitle, movieInfo.allTitles, movieInfo.year, torrentYear);
        if (matchResult.matches) {
            this.logger.info(`✅ Match: ${(matchResult.similarity * 100).toFixed(1)}% - ${matchResult.matchedTmdbTitle}`);
        }
        else {
            this.logger.debug(`❌ Sem match: ${(matchResult.similarity * 100).toFixed(1)}%`);
        }
        return matchResult;
    }
    semanticContextAnalysis(torrentClean, originalTorrentTitle, portugueseTitle, originalTitle, allTmdbTitles, tmdbYear, torrentYear) {
        const torrentInfo = this.extractTorrentInfo(torrentClean, originalTorrentTitle);
        this.logger.debug(`Info torrent: núcleo="${torrentInfo.coreClean}", final=${torrentInfo.hasFinal}, parte=${torrentInfo.partNumber}`);
        const torrentWords = torrentInfo.coreClean.split(' ').filter(w => w.length > 0);
        let bestMatch = {
            similarity: 0,
            title: '',
            reason: '',
            matchedTmdbTitle: '',
            isExact: false,
            isSemanticMatch: false
        };
        for (const tmdbTitle of allTmdbTitles) {
            const tmdbClean = this.normalizeForComparison(tmdbTitle);
            const tmdbInfo = this.extractTmdbInfo(tmdbClean, tmdbTitle);
            this.logger.debug(`Info TMDB: núcleo="${tmdbInfo.coreClean}", parte=${tmdbInfo.partNumber}`);
            const partConflict = this.checkPartConflict(torrentInfo, tmdbInfo);
            if (partConflict.shouldReject) {
                this.logger.debug(`Conflito de partes: ${partConflict.reason}`);
                return {
                    matches: false,
                    similarity: 0.3,
                    reason: partConflict.reason,
                    matchedTmdbTitle: tmdbTitle
                };
            }
            if (this.isSameMovieWithPart(torrentInfo, tmdbInfo)) {
                this.logger.debug(`Detectado mesmo filme com parte: ${tmdbTitle} + parte ${torrentInfo.partNumber}`);
                return {
                    matches: true,
                    similarity: 0.85,
                    reason: `Mesmo filme com parte ${torrentInfo.partNumber}`,
                    matchedTmdbTitle: tmdbTitle
                };
            }
            const tmdbWords = tmdbInfo.coreClean.split(' ').filter(w => w.length > 0);
            if (tmdbWords.length === 1) {
                const wordAnalysis = this.analyzeSingleWordTmdbTitle(torrentWords, tmdbWords[0], torrentInfo.coreClean, tmdbInfo.coreClean, originalTorrentTitle, tmdbTitle);
                if (wordAnalysis.similarity > bestMatch.similarity) {
                    bestMatch = {
                        similarity: wordAnalysis.similarity,
                        title: tmdbTitle,
                        reason: wordAnalysis.reason,
                        matchedTmdbTitle: tmdbTitle,
                        isExact: wordAnalysis.isExact,
                        isSemanticMatch: wordAnalysis.isSemanticMatch
                    };
                }
                continue;
            }
            const coreSimilarity = this.calculateEnhancedSimilarity(torrentInfo.coreClean, tmdbInfo.coreClean);
            this.logger.debug(`Similaridade núcleo: ${(coreSimilarity * 100).toFixed(1)}%`);
            if (coreSimilarity >= 0.6) {
                const semanticMatch = this.analyzeEnhancedSemanticMatch(torrentInfo, tmdbInfo, coreSimilarity, torrentClean, tmdbClean);
                if (semanticMatch.similarity > bestMatch.similarity) {
                    bestMatch = {
                        similarity: semanticMatch.similarity,
                        title: tmdbTitle,
                        reason: semanticMatch.reason,
                        matchedTmdbTitle: tmdbTitle,
                        isExact: semanticMatch.isExact,
                        isSemanticMatch: semanticMatch.isSemanticMatch
                    };
                }
            }
            const basicSimilarity = this.calculateEnhancedSimilarity(torrentClean, tmdbClean);
            if (basicSimilarity > bestMatch.similarity) {
                bestMatch = {
                    similarity: basicSimilarity,
                    title: tmdbTitle,
                    reason: `Similaridade: ${(basicSimilarity * 100).toFixed(1)}%`,
                    matchedTmdbTitle: tmdbTitle,
                    isExact: false,
                    isSemanticMatch: false
                };
            }
        }
        const threshold = 0.55;
        if (bestMatch.similarity >= threshold) {
            this.logger.debug(`Match aceito: ${(bestMatch.similarity * 100).toFixed(1)}% >= ${threshold * 100}%`);
            return {
                matches: true,
                similarity: bestMatch.similarity,
                reason: bestMatch.reason,
                matchedTmdbTitle: bestMatch.matchedTmdbTitle
            };
        }
        this.logger.debug(`Match insuficiente: ${(bestMatch.similarity * 100).toFixed(1)}% < ${threshold * 100}%`);
        return {
            matches: false,
            similarity: bestMatch.similarity,
            reason: bestMatch.reason || `Similaridade: ${(bestMatch.similarity * 100).toFixed(1)}%`
        };
    }
    isSameMovieWithPart(torrentInfo, tmdbInfo) {
        if (!torrentInfo.partNumber || !tmdbInfo.coreClean) {
            return false;
        }
        const tmdbCoreLower = tmdbInfo.coreClean.toLowerCase();
        const torrentCoreLower = torrentInfo.coreClean.toLowerCase();
        if (torrentCoreLower.startsWith(tmdbCoreLower)) {
            return torrentInfo.partNumber > 0;
        }
        return false;
    }
    analyzeSingleWordTmdbTitle(torrentWords, tmdbWord, torrentClean, tmdbClean, originalTorrentTitle, tmdbTitle) {
        if (torrentWords.length === 1 && torrentWords[0] === tmdbWord) {
            this.logger.debug(`Título 1 palavra - match exato: ${tmdbWord}`);
            return {
                similarity: 0.9,
                reason: `Título exato: "${tmdbTitle}"`,
                isExact: true,
                isSemanticMatch: true
            };
        }
        const wordIndex = torrentWords.indexOf(tmdbWord);
        if (wordIndex !== -1) {
            const contextAnalysis = this.analyzeWordContext(torrentWords, tmdbWord, wordIndex, originalTorrentTitle);
            if (contextAnalysis.shouldReject) {
                return {
                    similarity: contextAnalysis.similarity,
                    reason: contextAnalysis.reason,
                    isExact: false,
                    isSemanticMatch: false
                };
            }
            const similarity = this.calculateContextualSimilarity(torrentWords, [tmdbWord]);
            return {
                similarity,
                reason: `"${tmdbWord}" em contexto similar`,
                isExact: false,
                isSemanticMatch: similarity >= 0.7
            };
        }
        const basicSimilarity = this.calculateWordSimilarity(torrentClean, tmdbClean);
        return {
            similarity: basicSimilarity,
            reason: `Similaridade: ${(basicSimilarity * 100).toFixed(1)}%`,
            isExact: false,
            isSemanticMatch: false
        };
    }
    analyzeWordContext(torrentWords, tmdbWord, wordIndex, originalTorrentTitle) {
        if (torrentWords.length === 1) {
            return {
                shouldReject: false,
                similarity: 0.9,
                reason: 'Apenas palavra TMDB'
            };
        }
        const adjacentWords = [];
        if (wordIndex > 0)
            adjacentWords.push(torrentWords[wordIndex - 1]);
        if (wordIndex < torrentWords.length - 1)
            adjacentWords.push(torrentWords[wordIndex + 1]);
        if (adjacentWords.length > 0) {
            const significantAdjacent = adjacentWords.filter(w => w.length >= 4 && !this.isTechnicalTerm(w));
            if (significantAdjacent.length > 0) {
                this.logger.debug(`Palavra TMDB forma expressão: "${tmdbWord}" + "${significantAdjacent.join(' ')}"`);
                return {
                    shouldReject: true,
                    similarity: 0.3,
                    reason: `"${tmdbWord}" forma expressão com "${significantAdjacent.join(' ')}"`
                };
            }
        }
        if (wordIndex > 0) {
            const wordsBefore = torrentWords.slice(0, wordIndex);
            const hasSignificantWordsBefore = wordsBefore.some(w => w.length >= 4 && !this.isTechnicalTerm(w));
            if (hasSignificantWordsBefore) {
                this.logger.debug(`Palavra TMDB não está no início: "${wordsBefore.join(' ')}" antes de "${tmdbWord}"`);
                return {
                    shouldReject: true,
                    similarity: 0.4,
                    reason: `"${tmdbWord}" não é primeira palavra (tem "${wordsBefore.join(' ')}" antes)`
                };
            }
        }
        return {
            shouldReject: false,
            similarity: 0.6,
            reason: 'Contexto aceitável'
        };
    }
    isTechnicalTerm(word) {
        const lowerWord = word.toLowerCase();
        return this.TECHNICAL_WORDS.includes(lowerWord) ||
            this.TECHNICAL_ACRONYMS.includes(lowerWord) ||
            /^\d+(?:\.\d+)?(?:ch)?$/i.test(lowerWord);
    }
    calculateContextualSimilarity(torrentWords, tmdbWords) {
        const basicSimilarity = this.calculateWordSimilarity(torrentWords.join(' '), tmdbWords.join(' '));
        let penalty = 0;
        const wordCountDiff = Math.abs(torrentWords.length - tmdbWords.length);
        if (wordCountDiff >= 2) {
            penalty += 0.2;
        }
        if (tmdbWords.length === 1 && torrentWords.length >= 2) {
            penalty += 0.3;
        }
        return Math.max(0, basicSimilarity - penalty);
    }
    extractTorrentInfo(torrentClean, originalTitle) {
        const hasFinal = this.hasFinalInTitle(torrentClean);
        const partNumber = this.extractPartNumber(torrentClean);
        const coreClean = this.extractCleanCore(torrentClean);
        return {
            clean: torrentClean,
            original: originalTitle,
            coreClean,
            hasFinal,
            partNumber,
            year: this.extractYearFromTitle(originalTitle)
        };
    }
    extractTmdbInfo(tmdbClean, originalTitle) {
        const partNumber = this.extractPartNumber(tmdbClean);
        const coreClean = this.extractCleanCore(tmdbClean);
        return {
            clean: tmdbClean,
            original: originalTitle,
            coreClean,
            partNumber,
            year: this.extractYearFromTitle(originalTitle)
        };
    }
    extractCleanCore(title) {
        let core = title.toLowerCase();
        core = core.replace(/\b(19|20)\d{2}\b/g, '');
        this.TECHNICAL_WORDS.forEach(term => {
            const regex = new RegExp(`\\b${term}\\b`, 'gi');
            core = core.replace(regex, '');
        });
        this.TECHNICAL_ACRONYMS.forEach(acronym => {
            const regex = new RegExp(`\\b${acronym}\\b`, 'gi');
            core = core.replace(regex, '');
        });
        core = core.replace(/\b\d+(?:\.\d+)?(?:ch)?\b/gi, '');
        core = core.replace(/[^\w\s]/g, ' ');
        core = core.replace(/\s+/g, ' ').trim();
        return core;
    }
    checkPartConflict(torrentInfo, tmdbInfo) {
        if (tmdbInfo.partNumber === 1 && torrentInfo.hasFinal) {
            return {
                shouldReject: true,
                reason: 'Parte 1 nunca é "O Final"'
            };
        }
        if (tmdbInfo.partNumber && torrentInfo.partNumber && tmdbInfo.partNumber !== torrentInfo.partNumber) {
            return {
                shouldReject: true,
                reason: `Parte diferente: TMDB=${tmdbInfo.partNumber}, Torrent=${torrentInfo.partNumber}`
            };
        }
        return { shouldReject: false, reason: '' };
    }
    hasFinalInTitle(title) {
        return /(?:^|\s)(?:o\s+final|final)(?:\s|$)/i.test(title);
    }
    extractPartNumber(title) {
        const romanMatch = title.match(/\b([i|ii|iii|iv|v])\b/i);
        if (romanMatch) {
            const romanMap = {
                'i': 1, 'ii': 2, 'iii': 3, 'iv': 4, 'v': 5
            };
            return romanMap[romanMatch[1].toLowerCase()] || null;
        }
        const arabicMatch = title.match(/(?:parte?\s*|part\s*)(\d+)/i);
        if (arabicMatch) {
            return parseInt(arabicMatch[1]);
        }
        return null;
    }
    analyzeEnhancedSemanticMatch(torrentInfo, tmdbInfo, coreSimilarity, torrentClean, tmdbClean) {
        const basicSimilarity = this.calculateEnhancedSimilarity(torrentClean, tmdbClean);
        let bonus = 0;
        if (coreSimilarity >= 0.7)
            bonus += 0.1;
        if (coreSimilarity >= 0.8)
            bonus += 0.15;
        if (coreSimilarity >= 0.9)
            bonus += 0.1;
        if (torrentInfo.hasFinal && tmdbInfo.partNumber === 2) {
            bonus += 0.2;
        }
        const finalSimilarity = Math.min(0.95, basicSimilarity + bonus);
        let reason = `Similaridade: ${(finalSimilarity * 100).toFixed(1)}%`;
        if (torrentInfo.hasFinal && tmdbInfo.partNumber === 2) {
            reason += ' ("O Final" = Parte 2)';
        }
        return {
            similarity: finalSimilarity,
            reason,
            isExact: basicSimilarity >= 0.9,
            isSemanticMatch: coreSimilarity >= 0.7
        };
    }
    calculateEnhancedSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        const wordSet1 = new Set(words1);
        let totalScore = 0;
        words2.forEach((word, index) => {
            if (wordSet1.has(word)) {
                const positionWeight = index < 3 ? 1.5 : 1.0;
                totalScore += positionWeight;
            }
        });
        const maxWords = Math.max(words1.length, words2.length);
        return totalScore / maxWords;
    }
    isSeriesTitle(torrentTitle) {
        const seriesPatterns = [
            /s\d{1,2}e\d{1,2}/i,
            /season\s*\d+/i,
            /temporada\s*\d+/i,
            /\d+x\d+/i,
            /epis[oó]dio\s*\d+/i,
            /\d+\s*ª?\s*temporada/i,
            /completa\s*\d+\s*temporada/i
        ];
        return seriesPatterns.some(pattern => pattern.test(torrentTitle));
    }
    extractYearFromTitle(title) {
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            return parseInt(yearMatch[0]);
        }
        return null;
    }
    normalizeForComparison(title) {
        const decodedTitle = title
            .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
            .replace(/&ndash;|&mdash;/g, '-')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;|&apos;/g, "'");
        return decodedTitle
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s:\-]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    calculateWordSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        const wordSet1 = new Set(words1);
        const commonWords = words2.filter(word => wordSet1.has(word));
        return commonWords.length / Math.max(words1.length, words2.length);
    }
    smartTitleContainsCheckSync(torrentTitle, imdbTitle) {
        const normTorrent = this.normalizeForComparison(torrentTitle);
        const normImdb = this.normalizeForComparison(imdbTitle);
        const similarity = this.calculateWordSimilarity(normTorrent, normImdb);
        const threshold = 0.5;
        if (similarity >= threshold) {
            return {
                matches: true,
                similarity,
                reason: `Similaridade: ${(similarity * 100).toFixed(1)}%`
            };
        }
        return {
            matches: false,
            similarity,
            reason: `Similaridade insuficiente: ${(similarity * 100).toFixed(1)}%`
        };
    }
    detectConfusingSeries(torrentTitle, imdbTitle) {
        const torrentLower = torrentTitle.toLowerCase();
        const imdbLower = imdbTitle.toLowerCase();
        for (const confusion of this.confusingSeries) {
            const hasDerivative = torrentLower.includes(confusion.derivative);
            const hasOriginal = imdbLower.includes(confusion.original);
            if (hasDerivative && hasOriginal) {
                return { isConfusing: true, minSimilarity: confusion.minSimilarity };
            }
        }
        return { isConfusing: false, minSimilarity: 0 };
    }
    addConfusingSeries(original, derivative, minSimilarity = 0.8) {
        this.confusingSeries.push({
            original: original.toLowerCase(),
            derivative: derivative.toLowerCase(),
            minSimilarity
        });
    }
    listConfusingSeries() {
        return this.confusingSeries;
    }
    removeConfusingSeries(original, derivative) {
        const originalLower = original.toLowerCase();
        const derivativeLower = derivative.toLowerCase();
        const initialLength = this.confusingSeries.length;
        this.confusingSeries = this.confusingSeries.filter(confusion => !(confusion.original === originalLower && confusion.derivative === derivativeLower));
        return initialLength > this.confusingSeries.length;
    }
    clearCache() {
        this.tmdbCache.clear();
    }
    getStats() {
        return {
            version: '12.0.0',
            feature: 'Filtro Técnico Completo + Contexto Inteligente',
            description: 'Remove HDR, 5.1, acrônimos, detecta "Part I" como mesmo filme, análise contextual rigorosa',
            technicalWordsCount: this.TECHNICAL_WORDS.length,
            technicalAcronymsCount: this.TECHNICAL_ACRONYMS.length,
            threshold: '0.55',
            detection: '"Part I/Part 1" = mesmo filme, "Parte 1" ≠ "O Final"'
        };
    }
}
exports.SimilarityCalculator = SimilarityCalculator;
