"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimilarityCalculator = void 0;
const logger_1 = require("../../utils/logger");
const ImdbScraperService_1 = require("../../services/ImdbScraperService");
const TechnicalWords_1 = require("./TechnicalWords");
class SimilarityCalculator {
    constructor(titleCleaner, useTmdbScraper = true) {
        this.tmdbCache = new Map();
        this.cacheTTL = 5 * 60 * 1000;
        this.VERSAO = '23.5.1';
        this.TECHNICAL_WORDS = TechnicalWords_1.TECHNICAL_WORDS;
        this.TECHNICAL_ACRONYMS = TechnicalWords_1.TECHNICAL_ACRONYMS;
        this.logger = new logger_1.Logger('SimilarityCalculator');
        this.logger.info(`SimilarityCalculator v${this.VERSAO} iniciado - Correção crítica para filmes numerados`);
        this.titleCleaner = titleCleaner;
        if (useTmdbScraper) {
            this.tmdbScraper = new ImdbScraperService_1.ImdbScraperService();
        }
        else {
            this.tmdbScraper = null;
        }
        this.confusingSeries = [
            { original: 'american horror story', derivative: 'american horror stories', minSimilarity: 0.85 },
            { original: 'stranger things', derivative: 'stranger things stories', minSimilarity: 0.85 }
        ];
    }
    async smartTitleContainsCheck(torrentTitle, imdbId, torrentMetadata) {
        this.logger.debug('Análise iniciada', {
            título: torrentTitle.substring(0, 60),
            temporada: torrentMetadata?.season
        });
        let movieInfo = null;
        if (this.tmdbScraper) {
            try {
                const season = torrentMetadata?.season;
                const cacheKey = season ? `tmdb-${imdbId}:s${season}` : `tmdb-${imdbId}`;
                const cached = this.tmdbCache.get(cacheKey);
                let tmdbData;
                if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
                    this.logger.debug('Cache TMDB usado', { imdbId, season });
                    tmdbData = cached.data;
                }
                else {
                    tmdbData = await this.tmdbScraper.getTitlesFromImdbId(imdbId, season);
                    this.tmdbCache.set(cacheKey, {
                        data: tmdbData,
                        timestamp: Date.now()
                    });
                }
                movieInfo = {
                    portugueseTitle: tmdbData.portugueseTitle,
                    originalTitle: tmdbData.originalTitle,
                    year: tmdbData.year,
                    allTitles: tmdbData.allTitles,
                    mediaType: tmdbData.mediaType,
                    belongsToCollection: tmdbData.belongsToCollection
                };
                this.logger.debug('Dados TMDB obtidos', {
                    imdbId,
                    temporada: season,
                    ano: tmdbData.year,
                    tipo: tmdbData.mediaType,
                    títuloPT: movieInfo.portugueseTitle || 'não encontrado',
                    títuloOriginal: movieInfo.originalTitle,
                    temColeção: !!movieInfo.belongsToCollection
                });
            }
            catch (error) {
                this.logger.error('Erro ao buscar TMDB', {
                    imdbId,
                    temporada: torrentMetadata?.season,
                    erro: error instanceof Error ? error.message : 'Erro desconhecido'
                });
            }
        }
        if (!movieInfo) {
            return {
                matches: false,
                similarity: 0,
                reason: 'Sem dados do TMDB'
            };
        }
        const torrentYear = torrentMetadata?.year || this.extractYearFromTitle(torrentTitle);
        const torrentClean = this.normalizeForComparison(torrentTitle, movieInfo.mediaType);
        this.logger.debug('Contexto da análise', {
            anoTMDB: movieInfo.year,
            anoTorrent: torrentYear,
            temporada: torrentMetadata?.season,
            tipo: movieInfo.mediaType,
            temColeção: !!movieInfo.belongsToCollection
        });
        const matchResult = this.enhancedContextAnalysis(torrentClean, torrentTitle, movieInfo.portugueseTitle, movieInfo.originalTitle, movieInfo.allTitles, movieInfo.year, torrentYear, movieInfo.mediaType, movieInfo.belongsToCollection, torrentMetadata?.season);
        if (matchResult.matches) {
            const yearValidation = this.contextualYearValidation(movieInfo, torrentYear, torrentTitle, matchResult.similarity, matchResult.confidence, torrentMetadata?.season);
            if (yearValidation.shouldReject) {
                this.logger.debug('Rejeitado por ano inválido', { motivo: yearValidation.reason });
                return {
                    matches: false,
                    similarity: matchResult.similarity * 0.7,
                    reason: yearValidation.reason
                };
            }
            this.logger.info('Match ACEITO', {
                similaridade: `${(matchResult.similarity * 100).toFixed(1)}%`,
                confiança: matchResult.confidence || 'alta',
                motivo: matchResult.reason,
                versão: this.VERSAO
            });
        }
        else {
            this.logger.debug('Match insuficiente', {
                similaridade: `${(matchResult.similarity * 100).toFixed(1)}%`,
                motivo: matchResult.reason,
                versão: this.VERSAO
            });
        }
        return matchResult;
    }
    contextualYearValidation(movieInfo, torrentYear, torrentTitle, semanticSimilarity, confidence, targetSeason) {
        if (!movieInfo.year) {
            return { shouldReject: false, reason: 'TMDB sem ano' };
        }
        if (!torrentYear) {
            if (movieInfo.mediaType === 'tv' && targetSeason) {
                const temTemporadaExplícita = this.hasExplicitSeason(torrentTitle, targetSeason);
                const temEpisódioExplícito = this.hasExplicitEpisode(torrentTitle);
                if (temTemporadaExplícita) {
                    let bonus = 0.1;
                    if (temEpisódioExplícito) {
                        bonus += 0.05;
                    }
                    if (semanticSimilarity + bonus >= 0.65) {
                        return {
                            shouldReject: false,
                            reason: `Série com temporada explícita (S${targetSeason}) - ano opcional`
                        };
                    }
                }
            }
            if (semanticSimilarity >= 0.9) {
                return { shouldReject: false, reason: 'Similaridade muito alta, ano opcional' };
            }
            if (confidence === 'alta') {
                return { shouldReject: false, reason: 'Confiança alta, ano opcional' };
            }
            return {
                shouldReject: true,
                reason: `Requer ano. TMDB: ${movieInfo.year}`
            };
        }
        if (movieInfo.year !== torrentYear) {
            const yearDiff = Math.abs(movieInfo.year - torrentYear);
            if (yearDiff <= 2 && semanticSimilarity >= 0.85) {
                return { shouldReject: false, reason: `Diferença pequena (${yearDiff} anos) com contexto forte` };
            }
            return {
                shouldReject: true,
                reason: `Ano diferente: TMDB ${movieInfo.year} != Torrent ${torrentYear}`
            };
        }
        return { shouldReject: false, reason: 'Ano válido' };
    }
    enhancedContextAnalysis(torrentClean, originalTorrentTitle, portugueseTitle, originalTitle, allTmdbTitles, tmdbYear, torrentYear, mediaType, belongsToCollection, targetSeason) {
        const validTmdbTitles = this.filterValidTmdbTitles(allTmdbTitles, originalTitle);
        if (validTmdbTitles.length === 0) {
            this.logger.warn('Nenhum título TMDB válido encontrado', {
                imdbId: 'n/a',
                originalTitle,
                allTitles: allTmdbTitles
            });
            return {
                matches: false,
                similarity: 0,
                reason: 'Nenhum título TMDB válido encontrado'
            };
        }
        let bestMatch = {
            similarity: 0,
            confidence: 'baixa',
            title: '',
            reason: '',
            matchedTmdbTitle: '',
            contextAnalysis: ''
        };
        for (const tmdbTitle of validTmdbTitles) {
            const tmdbClean = this.normalizeForComparison(tmdbTitle, mediaType);
            const contextResult = this.smartContextAnalysis(torrentClean, tmdbClean, mediaType, belongsToCollection, targetSeason, originalTorrentTitle);
            if (contextResult.similarity > bestMatch.similarity) {
                bestMatch = {
                    similarity: contextResult.similarity,
                    confidence: contextResult.confidence,
                    title: tmdbTitle,
                    reason: contextResult.reason,
                    matchedTmdbTitle: tmdbTitle,
                    contextAnalysis: contextResult.contextAnalysis
                };
            }
        }
        const threshold = mediaType === 'movie' ? 0.75 : 0.65;
        const tmdbTitleLength = validTmdbTitles[0]?.length || 0;
        const effectiveThreshold = tmdbTitleLength <= 3 ? threshold * 0.7 : threshold;
        if (bestMatch.similarity >= effectiveThreshold) {
            this.logger.debug('Match encontrado', {
                similaridade: `${(bestMatch.similarity * 100).toFixed(1)}%`,
                confiança: bestMatch.confidence,
                threshold: `${(effectiveThreshold * 100).toFixed(1)}%`,
                contexto: bestMatch.contextAnalysis,
                motivo: bestMatch.reason,
                versão: this.VERSAO
            });
            return {
                matches: true,
                similarity: bestMatch.similarity,
                reason: bestMatch.reason,
                matchedTmdbTitle: bestMatch.matchedTmdbTitle,
                confidence: bestMatch.confidence,
                contextAnalysis: bestMatch.contextAnalysis
            };
        }
        this.logger.debug('Similaridade insuficiente', {
            similaridade: `${(bestMatch.similarity * 100).toFixed(1)}%`,
            threshold: `${(effectiveThreshold * 100).toFixed(1)}%`,
            contexto: bestMatch.contextAnalysis,
            motivo: bestMatch.reason || 'Similaridade insuficiente',
            versão: this.VERSAO
        });
        return {
            matches: false,
            similarity: bestMatch.similarity,
            reason: bestMatch.reason || `Similaridade: ${(bestMatch.similarity * 100).toFixed(1)}%`
        };
    }
    filterValidTmdbTitles(allTitles, originalTitle) {
        const validTitles = [];
        for (const title of allTitles) {
            if (!title || title.trim().length === 0)
                continue;
            const lowerTitle = title.toLowerCase().trim();
            if (lowerTitle === 'n/a' ||
                lowerTitle === 'não encontrado' ||
                lowerTitle === 'not found' ||
                lowerTitle === 'unknown') {
                continue;
            }
            validTitles.push(title);
        }
        if (validTitles.length === 0 && originalTitle) {
            validTitles.push(originalTitle);
        }
        return validTitles;
    }
    smartContextAnalysis(torrentClean, tmdbClean, mediaType, belongsToCollection, targetSeason, originalTorrentTitle) {
        const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
        const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
        if (mediaType === 'movie') {
            const sequenceCheck = this.checkSequenceCompatibility(torrentClean, tmdbClean, belongsToCollection);
            if (!sequenceCheck.compatible) {
                return {
                    similarity: sequenceCheck.similarity,
                    confidence: 'baixa',
                    reason: sequenceCheck.reason,
                    contextAnalysis: 'sequência_incompatível'
                };
            }
        }
        if (tmdbWords.length === 1) {
            return this.analyzeSingleWordTitle(tmdbClean, torrentClean, mediaType);
        }
        if (tmdbWords.length === 2) {
            return this.analyzeDoubleWordTitle(tmdbClean, torrentClean, mediaType, belongsToCollection);
        }
        return this.normalContextAnalysis(torrentClean, tmdbClean, mediaType, targetSeason, originalTorrentTitle);
    }
    checkSequenceCompatibility(torrentClean, tmdbClean, belongsToCollection) {
        const torrentSequence = this.extractSequenceNumber(torrentClean);
        const tmdbSequence = this.extractSequenceNumber(tmdbClean);
        this.logger.debug('Verificação de sequência', {
            torrent: torrentClean,
            tmdb: tmdbClean,
            torrentSequence,
            tmdbSequence,
            coleção: !!belongsToCollection
        });
        if (!torrentSequence && tmdbSequence) {
            if (belongsToCollection && (tmdbSequence === '1' || tmdbSequence === 'i')) {
                this.logger.debug('Permite sem número para primeira sequência em coleção', {
                    tmdbSequence,
                    coleção: !!belongsToCollection
                });
                return {
                    compatible: true,
                    similarity: 0.8,
                    reason: `TMDB é primeira sequência (${tmdbSequence}) em coleção, torrent sem número pode ser o primeiro`
                };
            }
            else {
                this.logger.debug('Rejeita torrent sem número para filme numerado', {
                    tmdbSequence,
                    torrentSemNúmero: true
                });
                return {
                    compatible: false,
                    similarity: 0.15,
                    reason: `TMDB tem sequência ${tmdbSequence} mas torrent não tem número - filme diferente`
                };
            }
        }
        if (torrentSequence && !tmdbSequence) {
            if (belongsToCollection) {
                if (torrentSequence === '1' || torrentSequence === 'i') {
                    return {
                        compatible: true,
                        similarity: 0.8,
                        reason: `Primeira sequência (${torrentSequence}) em coleção - pode ser o primeiro filme`
                    };
                }
                else {
                    return {
                        compatible: false,
                        similarity: 0.1,
                        reason: `Torrent tem sequência ${torrentSequence} mas TMDB não tem e não é a primeira da coleção`
                    };
                }
            }
            else {
                return {
                    compatible: false,
                    similarity: 0.1,
                    reason: `Torrent tem sequência ${torrentSequence} mas TMDB não tem e não pertence a coleção`
                };
            }
        }
        if (torrentSequence && tmdbSequence) {
            if (torrentSequence === tmdbSequence) {
                return {
                    compatible: true,
                    similarity: 1,
                    reason: `Números de sequência iguais: ${torrentSequence}`
                };
            }
            else {
                this.logger.debug('Sequências diferentes - filme diferente', {
                    torrentSequence,
                    tmdbSequence
                });
                return {
                    compatible: false,
                    similarity: 0.1,
                    reason: `Números de sequência diferentes: Torrent ${torrentSequence} vs TMDB ${tmdbSequence}`
                };
            }
        }
        return {
            compatible: true,
            similarity: 1,
            reason: 'Nenhum número de sequência encontrado'
        };
    }
    extractSequenceNumber(title) {
        const words = title.split(' ').filter(w => w.length > 0);
        if (words.length === 0)
            return null;
        const seqMatch = title.match(/seq(\d+)/i);
        if (seqMatch && seqMatch[1]) {
            const num = parseInt(seqMatch[1]);
            if (num >= 1 && num <= 20) {
                return seqMatch[1];
            }
        }
        const lastWord = words[words.length - 1].toLowerCase();
        if (/^\d+$/.test(lastWord)) {
            const num = parseInt(lastWord);
            if (num >= 1 && num <= 20) {
                return lastWord;
            }
        }
        const romanMap = {
            'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5',
            'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10',
            'xi': '11', 'xii': '12', 'xiii': '13', 'xiv': '14', 'xv': '15',
            'xvi': '16', 'xvii': '17', 'xviii': '18', 'xix': '19', 'xx': '20'
        };
        if (romanMap[lastWord]) {
            return romanMap[lastWord];
        }
        for (let i = 0; i < words.length; i++) {
            const word = words[i].toLowerCase();
            if (romanMap[word]) {
                return romanMap[word];
            }
            if (/^\d+$/.test(word) && parseInt(word) <= 20) {
                return word;
            }
        }
        const sequencePatterns = [
            /part[ée]?\s*(\d+)/i,
            /pt\.?\s*(\d+)/i,
            /volume\s*(\d+)/i,
            /vol\.?\s*(\d+)/i,
            /filme\s*(\d+)/i,
            /movie\s*(\d+)/i,
            /edição\s*(\d+)/i,
            /edition\s*(\d+)/i,
            /seq(\d+)/i
        ];
        for (const pattern of sequencePatterns) {
            const match = title.match(pattern);
            if (match && match[1]) {
                const num = parseInt(match[1]);
                if (num >= 1 && num <= 20) {
                    return match[1];
                }
            }
        }
        return null;
    }
    analyzeSingleWordTitle(tmdbWord, torrentClean, mediaType) {
        const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
        const containsWord = torrentWords.some(word => word === tmdbWord);
        if (!containsWord) {
            return {
                similarity: 0,
                confidence: 'baixa',
                reason: `Palavra única "${tmdbWord}" não encontrada`,
                contextAnalysis: 'título_curto_não_contém'
            };
        }
        const densityAnalysis = this.analyzeSemanticDensity([tmdbWord], torrentWords);
        if (densityAnalysis.isExcessive) {
            return {
                similarity: 0.1,
                confidence: 'baixa',
                reason: `Densidade excessiva: ${torrentWords.length} vs 1 palavras`,
                contextAnalysis: 'densidade_excessiva_imediata'
            };
        }
        const contextAnalysis = this.analyzeGlobalContext(tmdbWord, torrentWords);
        if (!contextAnalysis.hasStrongContext) {
            return {
                similarity: 0.2,
                confidence: 'baixa',
                reason: `Contexto fraco: ${contextAnalysis.reason}`,
                contextAnalysis: 'contexto_fraco_imediato'
            };
        }
        const wordPosition = torrentWords.findIndex(word => word === tmdbWord);
        const isFirstWord = wordPosition === 0;
        const basicSimilarity = 1.0;
        const extraWords = torrentWords.length - 1;
        let penalty;
        if (extraWords === 0) {
            penalty = 1.0;
        }
        else if (extraWords === 1) {
            penalty = 0.7;
        }
        else if (extraWords === 2) {
            penalty = 0.5;
        }
        else if (extraWords === 3) {
            penalty = 0.3;
        }
        else {
            penalty = Math.max(0.1, 1.0 - (extraWords * 0.2));
        }
        if (!isFirstWord) {
            const positionPenalty = 1.0 - (wordPosition * 0.4);
            penalty *= Math.max(0.1, positionPenalty);
        }
        let finalSimilarity = basicSimilarity * penalty;
        const startsWithBonus = torrentClean.startsWith(tmdbWord + ' ');
        const isVeryShortTitle = tmdbWord.length <= 3;
        if (startsWithBonus && isFirstWord && extraWords <= 1) {
            finalSimilarity = Math.min(0.9, finalSimilarity * 1.1);
        }
        if (isVeryShortTitle && extraWords === 0) {
            finalSimilarity = Math.min(1.0, finalSimilarity * 1.05);
        }
        let confidence = 'baixa';
        let reason = '';
        if (finalSimilarity >= 0.85) {
            confidence = 'alta';
            reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else if (finalSimilarity >= 0.7) {
            confidence = 'média';
            reason = `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else if (finalSimilarity >= 0.5) {
            confidence = 'baixa';
            reason = `Match baixo: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else {
            reason = `Similaridade muito baixa: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        reason += ` (palavra única "${tmdbWord}" com ${extraWords} palavras extras)`;
        if (densityAnalysis.isExcessive) {
            reason += ` [DENSIDADE: ${torrentWords.length} vs 1 palavras]`;
        }
        if (!isFirstWord) {
            reason += ` [POSIÇÃO: palavra na posição ${wordPosition + 1}]`;
        }
        if (!contextAnalysis.hasStrongContext) {
            reason += ` [CONTEXTO: ${contextAnalysis.reason}]`;
        }
        if (startsWithBonus && isFirstWord) {
            reason += ' [BÔNUS: começa com título]';
        }
        if (isVeryShortTitle) {
            reason += ' [BÔNUS: título muito curto]';
        }
        let contextAnalysisStr = `título_curto_1_palavra:penalidade_${penalty.toFixed(2)}`;
        if (densityAnalysis.isExcessive) {
            contextAnalysisStr += `|densidade_excessiva:${densityAnalysis.ratio.toFixed(1)}`;
        }
        if (!isFirstWord) {
            contextAnalysisStr += `|posição_${wordPosition}`;
        }
        if (!contextAnalysis.hasStrongContext) {
            contextAnalysisStr += '|contexto_fraco';
        }
        if (startsWithBonus) {
            contextAnalysisStr += '|começa_com_tmdb';
        }
        if (isVeryShortTitle) {
            contextAnalysisStr += '|título_muito_curto';
        }
        return {
            similarity: finalSimilarity,
            confidence,
            reason,
            contextAnalysis: contextAnalysisStr
        };
    }
    analyzeDoubleWordTitle(tmdbClean, torrentClean, mediaType, belongsToCollection) {
        const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
        const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
        const containsBothWords = tmdbWords.every(word => torrentWords.some(tWord => tWord === word));
        if (!containsBothWords) {
            const missingWords = tmdbWords.filter(word => !torrentWords.some(tWord => tWord === word));
            return {
                similarity: 0.1,
                confidence: 'baixa',
                reason: `Palavras faltando: ${missingWords.join(', ')}`,
                contextAnalysis: 'título_duas_palavras_faltando'
            };
        }
        const densityAnalysis = this.analyzeSemanticDensity(tmdbWords, torrentWords);
        if (densityAnalysis.isExcessive) {
            return {
                similarity: 0.15,
                confidence: 'baixa',
                reason: `Densidade excessiva: ${torrentWords.length} vs ${tmdbWords.length} palavras`,
                contextAnalysis: 'densidade_excessiva_imediata'
            };
        }
        const basicSimilarity = this.calculateWordSimilarity(tmdbClean, torrentClean);
        const extraWords = torrentWords.length - tmdbWords.length;
        let penalty;
        if (extraWords === 0) {
            penalty = 1.0;
        }
        else if (extraWords === 1) {
            penalty = 0.9;
        }
        else if (extraWords === 2) {
            penalty = 0.8;
        }
        else if (extraWords === 3) {
            penalty = 0.7;
        }
        else {
            penalty = Math.max(0.5, 1.0 - (extraWords * 0.12));
        }
        if (densityAnalysis.isExcessive) {
            penalty *= 0.4;
        }
        const tmdbPhrase = tmdbWords.join(' ');
        const startsWithBonus = torrentClean.startsWith(tmdbPhrase + ' ');
        let finalSimilarity = basicSimilarity * penalty;
        if (startsWithBonus && extraWords <= 3) {
            finalSimilarity = Math.min(1.0, finalSimilarity * 1.25);
        }
        const hasVeryShortWords = tmdbWords.every(word => word.length <= 3);
        if (hasVeryShortWords && extraWords <= 2) {
            finalSimilarity = Math.min(1.0, finalSimilarity * 1.15);
        }
        let confidence = 'baixa';
        let reason = '';
        if (finalSimilarity >= 0.85) {
            confidence = 'alta';
            reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else if (finalSimilarity >= 0.7) {
            confidence = 'média';
            reason = `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else if (finalSimilarity >= 0.5) {
            confidence = 'baixa';
            reason = `Match baixo: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else {
            confidence = 'baixa';
            reason = `Match muito baixo: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        reason += ` (${tmdbWords.length} vs ${torrentWords.length} palavras)`;
        if (densityAnalysis.isExcessive) {
            reason += ` [DENSIDADE: ${torrentWords.length} vs ${tmdbWords.length} palavras]`;
        }
        if (startsWithBonus) {
            reason += ' [BÔNUS: começa com título]';
        }
        if (hasVeryShortWords) {
            reason += ' [BÔNUS: palavras muito curtas]';
        }
        let contextAnalysis = `título_duas_palavras:penalidade_${penalty.toFixed(2)}`;
        if (densityAnalysis.isExcessive) {
            contextAnalysis += `|densidade_excessiva:${densityAnalysis.ratio.toFixed(1)}`;
        }
        if (startsWithBonus) {
            contextAnalysis += '|começa_com_tmdb';
        }
        if (hasVeryShortWords) {
            contextAnalysis += '|palavras_curtas';
        }
        return {
            similarity: finalSimilarity,
            confidence,
            reason,
            contextAnalysis
        };
    }
    analyzeSemanticDensity(tmdbWords, torrentWords) {
        const tmdbLength = tmdbWords.length;
        const torrentLength = torrentWords.length;
        if (tmdbLength === 0) {
            return {
                isExcessive: false,
                ratio: 0,
                reason: 'TMDB sem palavras'
            };
        }
        const ratio = torrentLength / tmdbLength;
        const isExcessive = ratio >= 2.0 ||
            (tmdbLength === 1 && torrentLength >= 2) ||
            (tmdbLength === 2 && torrentLength >= 4);
        return {
            isExcessive,
            ratio,
            reason: isExcessive ?
                `Densidade excessiva: ${torrentLength} vs ${tmdbLength} palavras` :
                `Densidade normal: ${torrentLength} vs ${tmdbLength} palavras`
        };
    }
    analyzeGlobalContext(tmdbWord, torrentWords) {
        const tmdbIndex = torrentWords.indexOf(tmdbWord);
        if (tmdbIndex === -1) {
            return {
                hasStrongContext: false,
                reason: 'Palavra TMDB não encontrada'
            };
        }
        const tmdbLength = tmdbWord.length;
        if (tmdbLength <= 3) {
            if (torrentWords.length >= 2) {
                return {
                    hasStrongContext: false,
                    reason: `Título muito curto (${tmdbLength} letras) com contexto expandido`
                };
            }
        }
        if (tmdbLength <= 5 && torrentWords.length >= 3) {
            return {
                hasStrongContext: false,
                reason: `Título curto com muito contexto adicional`
            };
        }
        if (torrentWords.length >= 3) {
            return {
                hasStrongContext: false,
                reason: 'Contexto muito expandido para título único'
            };
        }
        return {
            hasStrongContext: true,
            reason: 'Contexto apropriado'
        };
    }
    normalContextAnalysis(torrentClean, tmdbClean, mediaType, targetSeason, originalTorrentTitle) {
        const basicSimilarity = this.calculateEnhancedSimilarity(torrentClean, tmdbClean);
        const densityAnalysis = this.analyzeWordDensity(torrentClean, tmdbClean);
        const containmentAnalysis = this.analyzeIntelligentContainment(torrentClean, tmdbClean);
        let finalSimilarity = basicSimilarity;
        let contextAnalysis = `base:${(basicSimilarity * 100).toFixed(1)}`;
        if (densityAnalysis.hasExcessiveWords) {
            finalSimilarity *= 0.6;
            contextAnalysis += `|densidade_alta:${densityAnalysis.wordRatio.toFixed(1)}`;
        }
        if (containmentAnalysis.contains) {
            finalSimilarity = Math.min(1.0, finalSimilarity + 0.2);
            contextAnalysis += '|contém_tmdb';
        }
        else if (containmentAnalysis.contained) {
            if (mediaType === 'movie') {
                const tmdbSequence = this.extractSequenceNumber(tmdbClean);
                if (tmdbSequence) {
                    finalSimilarity = Math.min(1.0, finalSimilarity + 0.05);
                    contextAnalysis += '|contido_por_tmdb_penalizado';
                }
                else {
                    finalSimilarity = Math.min(1.0, finalSimilarity + 0.15);
                    contextAnalysis += '|contido_por_tmdb';
                }
            }
            else {
                finalSimilarity = Math.min(1.0, finalSimilarity + 0.15);
                contextAnalysis += '|contido_por_tmdb';
            }
        }
        if (densityAnalysis.hasGoodContext) {
            finalSimilarity = Math.min(1.0, finalSimilarity + 0.1);
            contextAnalysis += '|contexto_suficiente';
        }
        if (mediaType === 'tv' && targetSeason && originalTorrentTitle) {
            const temTemporadaExplícita = this.hasExplicitSeason(originalTorrentTitle, targetSeason);
            const temEpisódioExplícito = this.hasExplicitEpisode(originalTorrentTitle);
            if (temTemporadaExplícita) {
                let bonus = 0.1;
                if (temEpisódioExplícito) {
                    bonus += 0.05;
                }
                finalSimilarity = Math.min(1.0, finalSimilarity + bonus);
                contextAnalysis += `|temporada_explícita_s${targetSeason}`;
                if (temEpisódioExplícito) {
                    contextAnalysis += '|episódio_explícito';
                }
            }
        }
        let confidence = 'baixa';
        let reason = '';
        if (finalSimilarity >= 0.85) {
            confidence = 'alta';
            reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else if (finalSimilarity >= 0.7) {
            confidence = 'média';
            reason = `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        else {
            confidence = 'baixa';
            reason = `Similaridade baixa: ${(finalSimilarity * 100).toFixed(1)}%`;
        }
        if (densityAnalysis.hasExcessiveWords) {
            reason += ` (muitas palavras extras: ${densityAnalysis.torrentWords} vs ${densityAnalysis.tmdbWords})`;
        }
        if (containmentAnalysis.contains) {
            reason += ' (torrent contém título TMDB)';
        }
        else if (containmentAnalysis.contained) {
            reason += ' (TMDB contém título torrent)';
        }
        if (mediaType === 'tv' && targetSeason) {
            const temTemp = this.hasExplicitSeason(originalTorrentTitle || '', targetSeason);
            if (temTemp) {
                reason += ` [TEMPORADA: S${targetSeason} explícita]`;
            }
        }
        return {
            similarity: finalSimilarity,
            confidence,
            reason,
            contextAnalysis
        };
    }
    hasExplicitSeason(torrentTitle, targetSeason) {
        const lowerTitle = torrentTitle.toLowerCase();
        const seasonPatterns = [
            `s${targetSeason.toString().padStart(2, '0')}`,
            `s${targetSeason}`,
            `season ${targetSeason}`,
            `temporada ${targetSeason}`,
            `temporada ${targetSeason}ª`,
            ` ${targetSeason}ª temporada`,
            `t${targetSeason}`,
            `t${targetSeason.toString().padStart(2, '0')}`,
        ];
        return seasonPatterns.some(pattern => lowerTitle.includes(pattern));
    }
    hasExplicitEpisode(torrentTitle) {
        const lowerTitle = torrentTitle.toLowerCase();
        const episodePatterns = [
            /\be\d{1,10}\b/,
            /\bep\d{1,10}\b/,
            /\bepisode \d{1,10}\b/,
            /\bepis[oó]dio \d{1,10}\b/
        ];
        return episodePatterns.some(pattern => pattern.test(lowerTitle));
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
                const positionWeight = index < 2 ? 1.3 : 1.0;
                totalScore += positionWeight;
            }
        });
        const maxPossibleScore = words2.reduce((sum, word, index) => {
            const positionWeight = index < 2 ? 1.3 : 1.0;
            return sum + positionWeight;
        }, 0);
        return maxPossibleScore > 0 ? totalScore / maxPossibleScore : 0;
    }
    analyzeWordDensity(torrentClean, tmdbClean) {
        const torrentWords = torrentClean.split(' ').filter(w => w.length > 2);
        const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 2);
        if (tmdbWords.length === 0) {
            return {
                hasExcessiveWords: false,
                hasGoodContext: false,
                wordRatio: 0,
                torrentWords: torrentWords.length,
                tmdbWords: 0
            };
        }
        const wordRatio = torrentWords.length / tmdbWords.length;
        const hasExcessiveWords = wordRatio > 2.0;
        const hasGoodContext = torrentWords.length >= 3 && wordRatio <= 1.8;
        return {
            hasExcessiveWords,
            hasGoodContext,
            wordRatio,
            torrentWords: torrentWords.length,
            tmdbWords: tmdbWords.length
        };
    }
    analyzeIntelligentContainment(torrentClean, tmdbClean) {
        const contains = torrentClean.includes(tmdbClean);
        const contained = tmdbClean.includes(torrentClean);
        const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 2);
        if (contains && tmdbWords.length <= 2) {
            return {
                contains: false,
                contained
            };
        }
        return {
            contains,
            contained
        };
    }
    normalizeForComparison(title, mediaType) {
        const decodedTitle = title
            .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec))
            .replace(/&ndash;|&mdash;/g, ' ')
            .replace(/&amp;/g, ' ')
            .replace(/&lt;/g, ' ')
            .replace(/&gt;/g, ' ')
            .replace(/&quot;/g, ' ')
            .replace(/&#039;|&apos;/g, ' ');
        const normalized = decodedTitle
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
        const clean = normalized
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const finalClean = this.removeTechnicalWords(clean, mediaType);
        this.logger.debug('Normalização concluída', {
            original: title.substring(0, 50),
            normalizado: finalClean,
            tipoMídia: mediaType || 'desconhecido'
        });
        return finalClean;
    }
    removeTechnicalWords(title, mediaType) {
        let clean = title;
        const preservedSequences = new Map();
        if (mediaType === 'movie') {
            const sequenceRegex = /^(.+?)\s+(\d+|i{1,3}|iv|v|vi{0,3}|ix|x)$/i;
            const match = clean.match(sequenceRegex);
            if (match) {
                const baseTitle = match[1];
                const sequenceNum = match[2].toLowerCase();
                const romanToArabic = {
                    'i': '1', 'ii': '2', 'iii': '3', 'iv': '4', 'v': '5',
                    'vi': '6', 'vii': '7', 'viii': '8', 'ix': '9', 'x': '10'
                };
                const arabicSequence = romanToArabic[sequenceNum] || sequenceNum;
                if (/^\d+$/.test(arabicSequence)) {
                    const num = parseInt(arabicSequence);
                    if (num >= 1 && num <= 20) {
                        const placeholder = `_SEQ${num}_`;
                        preservedSequences.set(placeholder, ` ${num}`);
                        clean = baseTitle + placeholder;
                    }
                }
            }
        }
        clean = clean.replace(/[\/\.\-_:]/g, ' ');
        this.TECHNICAL_WORDS.forEach((term) => {
            if (!/^\d+$/.test(term)) {
                const regex = new RegExp(`\\b${term}\\b`, 'gi');
                clean = clean.replace(regex, '');
            }
        });
        this.TECHNICAL_ACRONYMS.forEach((acronym) => {
            const regex = new RegExp(`\\b${acronym}\\b`, 'gi');
            clean = clean.replace(regex, '');
        });
        clean = clean.replace(/\b\d{3,4}[pi]\b/gi, '');
        clean = clean.replace(/\b[0-9]+k\b/gi, '');
        clean = clean.replace(/\b[hx]\d{3}\b/gi, '');
        clean = clean.replace(/\b\d+\.\d+(?:ch)?\b/gi, '');
        clean = clean.replace(/\b(19|20)\d{2}\b/g, '');
        const tempMarkers = new Map();
        preservedSequences.forEach((value, placeholder) => {
            const tempMarker = `_TEMP_${placeholder}_`;
            tempMarkers.set(tempMarker, value);
            clean = clean.replace(placeholder, tempMarker);
        });
        clean = clean.replace(/\b\d+\b/g, '');
        tempMarkers.forEach((value, tempMarker) => {
            clean = clean.replace(tempMarker, value);
        });
        clean = clean.replace(/\s+/g, ' ').trim();
        return clean;
    }
    extractYearFromTitle(title) {
        const yearMatch = title.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            return parseInt(yearMatch[0]);
        }
        return null;
    }
    calculateWordSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        if (words1.length === 1 && words2.includes(words1[0])) {
            return 1.0;
        }
        const wordSet1 = new Set(words1);
        const commonWords = words2.filter(word => wordSet1.has(word));
        const maxLength = Math.max(words1.length, words2.length);
        return maxLength > 0 ? commonWords.length / maxLength : 0;
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
    clearCache() {
        this.tmdbCache.clear();
    }
    suggestSearchQuery(baseTitle, type, season) {
        this.logger.debug('Gerando query de busca otimizada', {
            baseTitle,
            type,
            season
        });
        const cleanBase = this.normalizeForComparison(baseTitle).trim();
        if (cleanBase.length === 0) {
            this.logger.warn('Título base vazio após limpeza', { baseTitle });
            return baseTitle;
        }
        const languageTerms = this.getLanguageSearchTerms();
        let query = cleanBase;
        if (type === 'series' && season !== undefined) {
            const seasonStr = season.toString().padStart(2, '0');
            query = `${query} s${seasonStr}`;
        }
        if (languageTerms.length > 0) {
            const languageQuery = languageTerms.join(' OR ');
            query = `${query} ${languageQuery}`;
            this.logger.debug('Query de busca gerada', {
                queryBase: cleanBase,
                termosIdioma: languageTerms.length,
                queryFinal: query
            });
        }
        return query;
    }
    getLanguageSearchTerms() {
        const languageTerms = [
            'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
            'legendado', 'legendada', 'legenda', 'pt-br', 'ptbr', 'pt_br',
            'pt.br', 'pt br', 'português', 'português', 'brazilian', 'multi'
        ];
        const validTerms = languageTerms.filter(term => this.TECHNICAL_WORDS.includes(term));
        return validTerms;
    }
    suggestSimpleSearchQuery(baseTitle, type, season) {
        const cleanTitle = this.normalizeForComparison(baseTitle).trim();
        if (type === 'series' && season !== undefined) {
            return `${cleanTitle} s${season.toString().padStart(2, '0')} dual OR dublado OR português`;
        }
        return `${cleanTitle} dual OR dublado OR português`;
    }
    getStats() {
        const languageTerms = this.getLanguageSearchTerms();
        return {
            versão: this.VERSAO,
            feature: 'Correção crítica para filmes numerados',
            descrição: 'Rejeita títulos sem número quando TMDB tem número de sequência',
            limiarFilmes: '0.75 (ajustável para títulos curtos)',
            limiarSéries: '0.65',
            termosTécnicos: {
                totalPalavras: this.TECHNICAL_WORDS.length,
                totalAcrônimos: this.TECHNICAL_ACRONYMS.length,
                fonte: 'Arquivo technical-words.ts externo'
            },
            termosIdioma: {
                total: languageTerms.length,
                termos: languageTerms
            },
            melhorias: [
                'Correção crítica: "A Escolha Perfeita" vs "A Escolha Perfeita 2" agora rejeitado',
                'Permite apenas sequência 1 quando TMDB pertence a coleção',
                'Verificação rigorosa de compatibilidade de sequências',
                'Reduz bônus para "contido por TMDB" em filmes numerados',
                'Logs detalhados para debugging de sequências'
            ],
            exemplos: [
                '"A Escolha Perfeita" vs "A Escolha Perfeita 2" → REJEITADO (corrigido)',
                '"A Escolha Perfeita 2" vs "A Escolha Perfeita 2" → ACEITO',
                '"A Escolha Perfeita 3" vs "A Escolha Perfeita 2" → REJEITADO',
                '"Velozes e Furiosos I" vs "Velozes e Furiosos" (coleção) → ACEITO (primeiro filme)'
            ]
        };
    }
}
exports.SimilarityCalculator = SimilarityCalculator;
