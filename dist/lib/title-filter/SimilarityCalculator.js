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
            '720p', '1080p', '2160p', '4k', 'hd', 'fullhd', 'uhd', 'sd',
            'x264', 'x265', 'h264', 'h265', 'avc', 'hevc', 'xvid', 'divx',
            'web-dl', 'webrip', 'bluray', 'brrip', 'bdrip', 'dvdrip', 'hdtv',
            'camrip', 'ts', 'tc', 'r5', 'scr', 'dvdscr', 'bdscr', 'webscr',
            'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
            'legendado', 'legendada', 'legenda', 'ac3', 'dts', 'aac', 'dd5.1',
            'dolby', 'atmos', 'truehd', 'dts-hd', 'dtshd',
            'pt-br', 'ptbr', 'pt_br', 'pt.br', 'pt br', 'portugues', 'português',
            'eng', 'english', 'ingles', 'brazilian', 'espanol', 'spanish',
            'repack', 'proper', 'extended', 'directors', 'cut', 'remastered',
            'complete', 'uncensored', 'uncut', 'limited', 'special', 'edition',
            'directors.cut', 'theatrical', 'unrated', 'imax', '3d',
            'yts', 'yify', 'rarbg', 'ettv', 'eztv', 'amzn', 'nf', 'hulu',
            'm2ts', 'iso', 'bdmv', 'mpls', 'playlist', 'chapter',
            'movie', 'the movie', 'cinema', 'cinematográfico', 'cinematografico',
            'brasileiro', 'brasileira', 'nacional', 'nacionais',
            'versão', 'versao', 'version', 'edição', 'edicao', 'edition',
            'completo', 'completa', 'complete', 'torrent', 'download', 'baixar', 'assistir'
        ];
        this.logger = new logger_1.Logger('SimilarityCalculator');
        this.logger.info('SimilarityCalculator v6.0.0 iniciado - Match Exato Rigoroso');
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
        this.logger.debug('Verificando título', {
            torrentTitle: torrentTitle.substring(0, 80),
            imdbId
        });
        let movieInfo = null;
        if (this.tmdbScraper) {
            try {
                const cacheKey = `tmdb-${imdbId}`;
                const cached = this.tmdbCache.get(cacheKey);
                let tmdbData;
                if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                    this.logger.debug('Cache TMDB usado', { imdbId });
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
                this.logger.error('Erro TMDB', {
                    imdbId,
                    error: error instanceof Error ? error.message : 'Erro desconhecido'
                });
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
        this.logger.debug('Dados TMDB vs Torrent', {
            tmdbPortugues: movieInfo.portugueseTitle,
            tmdbOriginal: movieInfo.originalTitle,
            tmdbAno: movieInfo.year,
            torrentAno: torrentYear,
            torrentClean: torrentClean.substring(0, 60)
        });
        if (movieInfo.year && torrentYear) {
            if (movieInfo.year !== torrentYear) {
                this.logger.warn('Ano diferente - rejeitado', {
                    solicitado: movieInfo.year,
                    torrent: torrentYear
                });
                return {
                    matches: false,
                    similarity: 0.3,
                    reason: `Ano errado: ${movieInfo.year} ≠ ${torrentYear}`
                };
            }
        }
        if (this.isSeriesTitle(torrentTitle)) {
            this.logger.warn('Torrent é série, busca é filme - rejeitado', {
                torrentTitle: torrentTitle.substring(0, 80),
                imdbId
            });
            return {
                matches: false,
                similarity: 0.2,
                reason: 'Torrent é série (tem temporada/episódio) mas busca é filme'
            };
        }
        const matchResult = this.findExactTmdbMatch(torrentClean, torrentTitle, movieInfo.portugueseTitle, movieInfo.originalTitle, movieInfo.allTitles);
        if (matchResult.matches) {
            this.logger.info('Match TMDB encontrado', {
                similaridade: matchResult.similarity,
                tituloTmdb: matchResult.matchedTmdbTitle || movieInfo.portugueseTitle || movieInfo.originalTitle
            });
        }
        return matchResult;
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
    findExactTmdbMatch(torrentClean, originalTorrentTitle, portugueseTitle, originalTitle, allTmdbTitles) {
        const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
        const torrentNonTechWords = torrentWords.filter(w => !this.TECHNICAL_WORDS.includes(w));
        const torrentCore = torrentNonTechWords.join(' ');
        this.logger.debug('Análise TMDB iniciada', {
            torrentCore,
            torrentOriginal: originalTorrentTitle.substring(0, 60),
            tmdbTitulos: allTmdbTitles.length
        });
        for (const tmdbTitle of allTmdbTitles) {
            const tmdbClean = this.normalizeForComparison(tmdbTitle);
            const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
            const tmdbNonTechWords = tmdbWords.filter(w => !this.TECHNICAL_WORDS.includes(w));
            const tmdbCore = tmdbNonTechWords.join(' ');
            if (tmdbCore.length === 0)
                continue;
            if (torrentCore === tmdbCore) {
                this.logger.debug('Match exato core TMDB', {
                    torrentCore,
                    tmdbCore,
                    tmdbTitle
                });
                return {
                    matches: true,
                    similarity: 0.95,
                    reason: `Título TMDB exato: "${tmdbTitle}"`,
                    matchedTmdbTitle: tmdbTitle
                };
            }
            if (this.isIsolatedSubstring(torrentClean, tmdbClean) && tmdbClean.length >= 3) {
                this.logger.debug('Torrent contém título TMDB isolado', {
                    torrent: torrentClean,
                    tmdbTitle: tmdbClean,
                    tmdbOriginal: tmdbTitle
                });
                if (tmdbNonTechWords.length === 1) {
                    const tmdbWord = tmdbNonTechWords[0];
                    if (torrentNonTechWords.length > 1) {
                        const torrentIndex = torrentNonTechWords.indexOf(tmdbWord);
                        if (torrentIndex !== -1) {
                            const adjacentWords = [];
                            if (torrentIndex > 0)
                                adjacentWords.push(torrentNonTechWords[torrentIndex - 1]);
                            if (torrentIndex < torrentNonTechWords.length - 1)
                                adjacentWords.push(torrentNonTechWords[torrentIndex + 1]);
                            if (adjacentWords.length > 0) {
                                const formsDifferentExpression = this.formsDifferentExpression(tmdbWord, adjacentWords);
                                if (formsDifferentExpression) {
                                    this.logger.debug('Título 1 palavra forma expressão diferente', {
                                        palavraTmdb: tmdbWord,
                                        palavrasAdjacentes: adjacentWords,
                                        expressaoPossivel: [...adjacentWords, tmdbWord].join(' ')
                                    });
                                    return {
                                        matches: false,
                                        similarity: 0.3,
                                        reason: `"${tmdbWord}" forma expressão diferente com "${adjacentWords.join(' ')}"`
                                    };
                                }
                            }
                        }
                    }
                }
                return {
                    matches: true,
                    similarity: 0.9,
                    reason: `Contém título TMDB: "${tmdbTitle}"`,
                    matchedTmdbTitle: tmdbTitle
                };
            }
            if (tmdbCore.includes(torrentCore) && torrentCore.length >= 3) {
                this.logger.debug('TMDB contém torrent core', {
                    torrentCore,
                    tmdbCore,
                    tmdbTitle
                });
                return {
                    matches: true,
                    similarity: 0.85,
                    reason: `TMDB contém: "${tmdbTitle}"`,
                    matchedTmdbTitle: tmdbTitle
                };
            }
        }
        const targetTitle = portugueseTitle || originalTitle;
        const targetClean = this.normalizeForComparison(targetTitle);
        const targetWords = targetClean.split(' ').filter(w => w.length > 0);
        const targetNonTechWords = targetWords.filter(w => !this.TECHNICAL_WORDS.includes(w));
        const targetCore = targetNonTechWords.join(' ');
        if (targetNonTechWords.length === 1) {
            const singleWord = targetNonTechWords[0];
            const hasOnlyTargetWord = torrentNonTechWords.length === 1 &&
                torrentNonTechWords[0] === singleWord;
            const hasTargetWordWithYear = torrentNonTechWords.length === 2 &&
                torrentNonTechWords[0] === singleWord &&
                /^\d{4}$/.test(torrentNonTechWords[1]);
            if (hasOnlyTargetWord || hasTargetWordWithYear) {
                this.logger.debug('Título 1 palavra TMDB aceito', {
                    palavra: singleWord,
                    torrentNonTech: torrentNonTechWords,
                    tmdbTitle: targetTitle
                });
                return {
                    matches: true,
                    similarity: 0.9,
                    reason: `Título TMDB de 1 palavra: "${targetTitle}"`,
                    matchedTmdbTitle: targetTitle
                };
            }
            if (torrentNonTechWords.includes(singleWord) && torrentNonTechWords.length > 1) {
                this.logger.debug('Título 1 palavra em contexto maior - rejeitado', {
                    palavraTmdb: singleWord,
                    contexto: torrentNonTechWords.join(' '),
                    tmdbTitle: targetTitle
                });
                return {
                    matches: false,
                    similarity: 0.3,
                    reason: `"${torrentNonTechWords.join(' ')}" ≠ "${targetTitle}" (contexto diferente)`
                };
            }
        }
        let bestMatch = { similarity: 0, title: '', reason: '' };
        for (const tmdbTitle of allTmdbTitles) {
            const tmdbClean = this.normalizeForComparison(tmdbTitle);
            const similarity = this.calculateEnhancedSimilarity(torrentClean, tmdbClean);
            if (similarity > bestMatch.similarity) {
                bestMatch = {
                    similarity,
                    title: tmdbTitle,
                    reason: `Similaridade com "${tmdbTitle}": ${(similarity * 100).toFixed(1)}%`
                };
            }
        }
        const isBrazilianMovie = this.isBrazilianMovieTitle(originalTitle, portugueseTitle);
        const threshold = isBrazilianMovie ? 0.4 : 0.5;
        if (bestMatch.similarity >= threshold) {
            this.logger.debug('Match por similaridade TMDB', {
                tituloTmdb: bestMatch.title,
                similaridade: bestMatch.similarity,
                threshold
            });
            return {
                matches: true,
                similarity: bestMatch.similarity,
                reason: bestMatch.reason,
                matchedTmdbTitle: bestMatch.title
            };
        }
        this.logger.debug('Nenhum match TMDB suficiente', {
            melhorSimilaridade: bestMatch.similarity,
            threshold,
            torrentCore
        });
        return {
            matches: false,
            similarity: bestMatch.similarity,
            reason: `Melhor similaridade TMDB: ${(bestMatch.similarity * 100).toFixed(1)}% < ${threshold * 100}%`
        };
    }
    isIsolatedSubstring(torrentClean, substring) {
        if (substring.length === 0)
            return false;
        const pattern = new RegExp(`(^|\\s)${substring}(\\s|$)`);
        return pattern.test(torrentClean);
    }
    formsDifferentExpression(baseWord, adjacentWords) {
        const expressionFormingWords = [
            'doce', 'grande', 'negro', 'bravo', 'janeiro', 'hudson',
            'aberto', 'fechado', 'calmo', 'revolto', 'morto', 'vivo',
            'novo', 'velho', 'alto', 'baixo', 'longo', 'curto',
            'quente', 'frio', 'doce', 'salgado', 'amargo'
        ];
        for (const adjacentWord of adjacentWords) {
            if (expressionFormingWords.includes(adjacentWord)) {
                return true;
            }
            const connectingWords = ['de', 'da', 'do', 'das', 'dos', 'em', 'no', 'na'];
            if (connectingWords.includes(adjacentWord)) {
                return true;
            }
        }
        return false;
    }
    calculateEnhancedSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        const wordSet1 = new Set(words1);
        const commonWords = words2.filter(word => wordSet1.has(word));
        const wordSimilarity = commonWords.length / Math.max(words1.length, words2.length);
        let orderPenalty = 0;
        if (commonWords.length >= 2) {
            const str1Order = words1.filter(w => commonWords.includes(w));
            const str2Order = words2.filter(w => commonWords.includes(w));
            for (let i = 0; i < Math.min(str1Order.length, str2Order.length); i++) {
                if (str1Order[i] !== str2Order[i]) {
                    orderPenalty += 0.1;
                }
            }
        }
        return Math.max(0, wordSimilarity - orderPenalty);
    }
    isBrazilianMovieTitle(originalTitle, portugueseTitle) {
        const titleToCheck = (portugueseTitle || originalTitle).toLowerCase();
        const brazilianKeywords = ['brasil', 'brasileiro', 'nacional'];
        return brazilianKeywords.some(keyword => titleToCheck.includes(keyword));
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
            .replace(/&ndash;/g, '–')
            .replace(/&mdash;/g, '—')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&apos;/g, "'");
        return decodedTitle
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
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
            version: '6.0.0',
            feature: 'Match Exato Rigoroso - Rejeita "Rio Doce" para "Rio"',
            confusingSeriesCount: this.confusingSeries.length,
            tmdbScraperAvailable: !!this.tmdbScraper,
            cacheSize: this.tmdbCache.size,
            technicalWordsCount: this.TECHNICAL_WORDS.length,
            strategy: 'Substring isolada + análise contexto para 1 palavra'
        };
    }
}
exports.SimilarityCalculator = SimilarityCalculator;
