"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TitleFilter = void 0;
const logger_1 = require("../utils/logger");
const ImdbScraperService_1 = require("../services/ImdbScraperService");
class TitleFilter {
    constructor() {
        this.logger = new logger_1.Logger('TitleFilter');
        this.imdbScraper = new ImdbScraperService_1.ImdbScraperService();
    }
    normalizeForComparison(title) {
        return title
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\w\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    extractCleanTitle(fullTitle) {
        const sequenceMatch = fullTitle.match(/\b(\w+)\s+(\d+)\b/i);
        let preservedSequence = '';
        if (sequenceMatch) {
            const [, titleWord, number] = sequenceMatch;
            if (/^\d+$/.test(number) && parseInt(number) > 1 && parseInt(number) < 10) {
                preservedSequence = ` ${number}`;
            }
        }
        const cleaned = fullTitle
            .replace(/\s*\(\s*\d{4}\s*\)/g, '')
            .replace(/\s+\d{4}\s+/g, ' ')
            .replace(/\b(2160p|1080p|720p|480p|SD|HD|4K)\b/gi, '')
            .replace(/\b(WEB-DL|WEBRip|BluRay|HDTV|DVD|BD|BR)\b/gi, '')
            .replace(/\b(H264|H265|x264|x265|AVC|HEVC)\b/gi, '')
            .replace(/\b(AC3|DTS|AAC|MP3|Dual|Dublado|Legendado|Legendada)\b/gi, '')
            .replace(/&#?\w+;/g, '')
            .replace(/[._-](?=\d)/g, ' ')
            .replace(/[._-](?=\D)/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        const finalTitle = cleaned + preservedSequence;
        const words = finalTitle.split(' ').filter(word => {
            if (word.length > 2)
                return true;
            if (/^\d+$/.test(word))
                return true;
            if (/^(o|a|os|as|de|do|da|em|no|na|e)$/i.test(word))
                return true;
            return false;
        });
        const result = words.join(' ').trim();
        this.logger.debug('Clean title extraction', {
            original: fullTitle,
            cleaned,
            preservedSequence,
            final: result
        });
        return result || fullTitle;
    }
    isNumberedSequence(title, imdbTitle) {
        const cleanTitle = this.extractCleanTitle(title).toLowerCase();
        const cleanImdb = this.extractCleanTitle(imdbTitle).toLowerCase();
        if (cleanTitle === cleanImdb) {
            return false;
        }
        const imdbWords = cleanImdb.split(' ');
        const titleWords = cleanTitle.split(' ');
        if (titleWords.length > imdbWords.length) {
            let matchesStart = true;
            for (let i = 0; i < imdbWords.length; i++) {
                if (titleWords[i] !== imdbWords[i]) {
                    matchesStart = false;
                    break;
                }
            }
            if (matchesStart) {
                const nextWord = titleWords[imdbWords.length];
                return /^\d+$/.test(nextWord);
            }
        }
        return false;
    }
    extractSeriesMetadata(torrentTitle) {
        const title = torrentTitle.toLowerCase();
        const metadata = {
            hasEpisodeInfo: false
        };
        const completeSeasonPatterns = [
            /(\d+)\s*(?:ª|a|°|o)?\s*temporada\s*(?:completa|inteira)/i,
            /temporada\s*(\d+)\s*(?:completa|inteira)/i,
            /season\s*(\d+)\s*(?:complete|full)/i,
            /s(\d+)\s*(?:complete|full)/i
        ];
        for (const pattern of completeSeasonPatterns) {
            const match = title.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    return {
                        season,
                        isCompleteSeason: true,
                        hasEpisodeInfo: true,
                        matchedPattern: match[0]
                    };
                }
            }
        }
        const seasonPatterns = [
            /(\d+)\s*(?:ª|a|°|o)?\s*temporada/i,
            /temporada\s*(\d+)/i,
            /season\s*(\d+)/i,
            /s(\d+)\b(?!e\d)/i
        ];
        let seasonFound;
        for (const pattern of seasonPatterns) {
            const match = title.match(pattern);
            if (match) {
                const season = parseInt(match[1]);
                if (!isNaN(season) && season > 0) {
                    seasonFound = season;
                    metadata.season = season;
                    metadata.matchedPattern = match[0];
                    break;
                }
            }
        }
        const episodePatterns = [
            /s(\d+)e(\d+)/i,
            /(\d+)x(\d+)/i,
            /temporada[\s\._-]?(\d+)[\s\._-]?epis[oó]dio[\s\._-]?(\d+)/i,
            /ep(?:isode)?\s*(\d+)/i,
            /(\d+)\s*-\s*(\d+)/,
            /\b(\d)(\d{2})\b/
        ];
        for (const pattern of episodePatterns) {
            const match = title.match(pattern);
            if (match) {
                let season = seasonFound;
                let episode;
                if (pattern.source === 's(\\d+)e(\\d+)') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source === '(\\d+)x(\\d+)') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source.includes('temporada') && pattern.source.includes('epis')) {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source.includes('ep')) {
                    episode = parseInt(match[1]);
                }
                else if (pattern.source === '(\\d+)\\s*-\\s*(\\d+)') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else if (pattern.source === '\\b(\\d)(\\d{2})\\b') {
                    season = parseInt(match[1]);
                    episode = parseInt(match[2]);
                }
                else {
                    continue;
                }
                if (!isNaN(episode) && episode > 0) {
                    if (season && !isNaN(season) && season > 0) {
                        metadata.season = season;
                    }
                    metadata.episode = episode;
                    metadata.hasEpisodeInfo = true;
                    metadata.matchedPattern = match[0];
                    break;
                }
            }
        }
        if (metadata.season && !metadata.hasEpisodeInfo) {
            metadata.hasEpisodeInfo = true;
        }
        return metadata;
    }
    async doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode) {
        try {
            const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
            if (imdbTitles.allTitles.length === 0) {
                return {
                    matches: false,
                    similarity: 0,
                    torrentMetadata: this.extractSeriesMetadata(torrentTitle),
                    reason: `Nenhum título encontrado no IMDB para ${imdbId}`
                };
            }
            const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
            if (targetSeason !== undefined) {
                if (torrentMetadata.hasEpisodeInfo) {
                    if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata,
                            reason: `❌ Temporada diferente: Torrent S${torrentMetadata.season} vs Solicitado S${targetSeason}`
                        };
                    }
                    if (targetEpisode !== undefined && torrentMetadata.episode) {
                        if (torrentMetadata.episode !== targetEpisode) {
                            return {
                                matches: false,
                                similarity: 0,
                                torrentMetadata,
                                reason: `❌ Episódio diferente: Torrent E${torrentMetadata.episode} vs Solicitado E${targetEpisode}`
                            };
                        }
                    }
                    if (targetEpisode !== undefined && torrentMetadata.isCompleteSeason) {
                        return {
                            matches: false,
                            similarity: 0,
                            torrentMetadata,
                            reason: '❌ Temporada completa vs episódio específico solicitado'
                        };
                    }
                }
            }
            const titlesToTry = [];
            if (imdbTitles.portugueseTitle) {
                titlesToTry.push({
                    title: imdbTitles.portugueseTitle,
                    language: 'portuguese'
                });
            }
            titlesToTry.push({
                title: imdbTitles.originalTitle,
                language: 'original'
            });
            let bestMatch = {
                similarity: 0,
                matchedTitle: '',
                matchedLanguage: 'original',
                reason: ''
            };
            for (const { title: imdbTitle, language } of titlesToTry) {
                const matchResult = this.compareSingleTitle(torrentTitle, imdbTitle, torrentMetadata, targetSeason, targetEpisode);
                this.logger.debug('Comparação de título', {
                    torrentTitle,
                    imdbTitle,
                    language,
                    similarity: matchResult.similarity,
                    matches: matchResult.matches,
                    reason: matchResult.reason
                });
                if (matchResult.matches && matchResult.similarity > bestMatch.similarity) {
                    bestMatch = {
                        similarity: matchResult.similarity,
                        matchedTitle: imdbTitle,
                        matchedLanguage: language,
                        reason: matchResult.reason
                    };
                }
            }
            if (bestMatch.similarity > 0) {
                const matches = bestMatch.similarity >= 0.7;
                return {
                    matches,
                    matchedTitle: bestMatch.matchedTitle,
                    matchedLanguage: bestMatch.matchedLanguage,
                    similarity: bestMatch.similarity,
                    torrentMetadata,
                    reason: matches ?
                        `✅ ${bestMatch.reason} (similaridade: ${(bestMatch.similarity * 100).toFixed(1)}%)` :
                        `❌ Similaridade insuficiente: ${(bestMatch.similarity * 100).toFixed(1)}%`
                };
            }
            return {
                matches: false,
                similarity: 0,
                torrentMetadata,
                reason: `❌ Nenhum match encontrado com os títulos do IMDB: ${imdbTitles.allTitles.join(', ')}`
            };
        }
        catch (error) {
            this.logger.error('Erro ao comparar títulos', {
                torrentTitle,
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return {
                matches: false,
                similarity: 0,
                torrentMetadata: this.extractSeriesMetadata(torrentTitle),
                reason: `Erro ao processar: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
            };
        }
    }
    compareSingleTitle(torrentTitle, imdbTitle, torrentMetadata, targetSeason, targetEpisode) {
        const cleanTorrent = this.extractCleanTitle(torrentTitle);
        const cleanImdb = this.extractCleanTitle(imdbTitle);
        const normTorrent = this.normalizeForComparison(cleanTorrent);
        const normImdb = this.normalizeForComparison(cleanImdb);
        this.logger.debug('Títulos processados para comparação', {
            torrentTitle,
            cleanTorrent,
            normTorrent,
            imdbTitle,
            cleanImdb,
            normImdb
        });
        if (this.isNumberedSequence(torrentTitle, imdbTitle)) {
            return {
                matches: false,
                similarity: 0.1,
                reason: '❌ É uma sequência numerada diferente (ex: Cars 2, Cars 3)'
            };
        }
        const torrentWords = normTorrent.split(' ');
        const imdbWords = normImdb.split(' ');
        if (imdbWords.length === 1) {
            const imdbWord = imdbWords[0];
            const deceptiveMatches = torrentWords.filter(word => word.includes(imdbWord) && word !== imdbWord);
            if (deceptiveMatches.length > 0) {
                return {
                    matches: false,
                    similarity: 0.1,
                    reason: `❌ Palavra enganosa encontrada: "${imdbWord}" em "${deceptiveMatches.join(', ')}"`
                };
            }
        }
        if (normTorrent === normImdb) {
            return {
                matches: true,
                similarity: 1.0,
                reason: 'Match exato após limpeza'
            };
        }
        if (normTorrent.includes(normImdb) && normImdb.length >= 3) {
            const torrentWordsSet = new Set(torrentWords);
            const imdbWordsSet = new Set(imdbWords);
            let allImdbWordsInTorrent = true;
            for (const imdbWord of imdbWords) {
                if (!torrentWordsSet.has(imdbWord)) {
                    allImdbWordsInTorrent = false;
                    break;
                }
            }
            if (allImdbWordsInTorrent) {
                return {
                    matches: true,
                    similarity: 0.9,
                    reason: 'Título do IMDB encontrado no torrent (palavras completas)'
                };
            }
        }
        if (normImdb.includes(normTorrent) && normTorrent.length >= 3) {
            return {
                matches: true,
                similarity: 0.85,
                reason: 'Título do torrent encontrado no IMDB'
            };
        }
        const similarity = this.calculateSequenceSimilarity(normTorrent, normImdb);
        const baseThreshold = 0.7;
        const adjustedThreshold = targetSeason !== undefined ? 0.8 : baseThreshold;
        const matches = similarity >= adjustedThreshold;
        return {
            matches,
            similarity,
            reason: matches ?
                `Similaridade aceita: ${(similarity * 100).toFixed(1)}% (threshold: ${adjustedThreshold * 100}%)` :
                `Similaridade baixa: ${(similarity * 100).toFixed(1)}% < ${adjustedThreshold * 100}%`
        };
    }
    doTitlesMatchSync(torrentTitle, imdbTitle, targetSeason, targetEpisode) {
        const normTorrent = this.normalizeForComparison(torrentTitle);
        const normImdb = this.normalizeForComparison(imdbTitle);
        this.logger.debug('Title matching analysis (sync)', {
            torrentTitle,
            imdbTitle,
            normTorrent,
            normImdb,
            targetSeason,
            targetEpisode
        });
        if (targetSeason !== undefined) {
            const torrentMetadata = this.extractSeriesMetadata(torrentTitle);
            if (torrentMetadata.hasEpisodeInfo) {
                if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
                    return false;
                }
                if (targetEpisode !== undefined && torrentMetadata.episode) {
                    if (torrentMetadata.episode !== targetEpisode) {
                        return false;
                    }
                }
                if (targetEpisode !== undefined && torrentMetadata.isCompleteSeason) {
                    return false;
                }
            }
        }
        const cleanTorrent = this.extractCleanTitle(torrentTitle);
        const cleanImdb = this.extractCleanTitle(imdbTitle);
        const cleanNormTorrent = this.normalizeForComparison(cleanTorrent);
        const cleanNormImdb = this.normalizeForComparison(cleanImdb);
        if (cleanNormTorrent === cleanNormImdb) {
            return true;
        }
        if (this.isNumberedSequence(torrentTitle, imdbTitle)) {
            return false;
        }
        const torrentWords = new Set(cleanNormTorrent.split(' '));
        const imdbWords = cleanNormImdb.split(' ');
        const allImdbWordsInTorrent = imdbWords.every(word => torrentWords.has(word));
        if (allImdbWordsInTorrent) {
            return true;
        }
        const similarity = this.calculateSequenceSimilarity(cleanNormTorrent, cleanNormImdb);
        return similarity >= 0.8;
    }
    calculateSequenceSimilarity(str1, str2) {
        const words1 = str1.split(' ').filter(w => w.length > 0);
        const words2 = str2.split(' ').filter(w => w.length > 0);
        if (words1.length === 0 || words2.length === 0)
            return 0;
        let maxCommonLength = 0;
        for (let i = 0; i < words1.length; i++) {
            for (let j = 0; j < words2.length; j++) {
                let common = 0;
                let k = 0;
                while (i + k < words1.length && j + k < words2.length &&
                    words1[i + k] === words2[j + k]) {
                    common++;
                    k++;
                }
                if (common > maxCommonLength) {
                    maxCommonLength = common;
                }
            }
        }
        const maxLength = Math.max(words1.length, words2.length);
        return maxCommonLength / maxLength;
    }
    async applyTitleFilter(torrents, imdbId, requestId, targetSeason, targetEpisode) {
        const startTime = Date.now();
        const results = {
            included: [],
            excluded: [],
            reasons: []
        };
        this.logger.info('Aplicando filtro de título com IMDB ID', {
            requestId,
            imdbId,
            targetSeason,
            targetEpisode,
            totalTorrents: torrents.length
        });
        let imdbTitles;
        try {
            imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
            this.logger.debug('Títulos obtidos do IMDB', {
                requestId,
                originalTitle: imdbTitles.originalTitle,
                portugueseTitle: imdbTitles.portugueseTitle,
                allTitlesCount: imdbTitles.allTitles.length
            });
        }
        catch (error) {
            this.logger.error('Erro ao obter títulos do IMDB', {
                requestId,
                imdbId,
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            return [];
        }
        for (const torrent of torrents) {
            const torrentMetadata = this.extractSeriesMetadata(torrent.title);
            let bestMatch = {
                similarity: 0,
                matchedTitle: '',
                matchedLanguage: 'original'
            };
            const titlesToTry = [];
            if (imdbTitles.portugueseTitle) {
                titlesToTry.push({ title: imdbTitles.portugueseTitle, language: 'portuguese' });
            }
            titlesToTry.push({ title: imdbTitles.originalTitle, language: 'original' });
            for (const { title: imdbTitle, language } of titlesToTry) {
                const matchResult = this.compareSingleTitle(torrent.title, imdbTitle, torrentMetadata, targetSeason, targetEpisode);
                if (matchResult.matches && matchResult.similarity > bestMatch.similarity) {
                    bestMatch = {
                        similarity: matchResult.similarity,
                        matchedTitle: imdbTitle,
                        matchedLanguage: language
                    };
                }
            }
            const threshold = targetSeason !== undefined ? 0.8 : 0.7;
            if (bestMatch.similarity >= threshold) {
                results.included.push(torrent);
                results.reasons.push(`✅ Incluído: "${torrent.title}" → "${bestMatch.matchedTitle}" (${(bestMatch.similarity * 100).toFixed(1)}%) [${bestMatch.matchedLanguage}]`);
            }
            else {
                results.excluded.push(torrent);
                const metadataStr = torrentMetadata.season ? `S${torrentMetadata.season}E${torrentMetadata.episode || '?'}` : '';
                results.reasons.push(`❌ Excluído: "${torrent.title}" ${metadataStr} (${(bestMatch.similarity * 100).toFixed(1)}% < ${threshold * 100}%)`);
            }
        }
        const processingTime = Date.now() - startTime;
        this.logger.info('Resultado do filtro de título', {
            requestId,
            imdbId,
            targetSeason,
            targetEpisode,
            totalTorrents: torrents.length,
            included: results.included.length,
            excluded: results.excluded.length,
            processingTime: `${processingTime}ms`,
            inclusionRate: torrents.length > 0 ?
                `${((results.included.length / torrents.length) * 100).toFixed(1)}%` : '0%'
        });
        if (results.reasons.length > 0 && results.reasons.length <= 20) {
            this.logger.debug('Decisões do filtro', {
                requestId,
                reasons: results.reasons
            });
        }
        return results.included;
    }
    applyTitleFilterSync(torrents, imdbTitle, requestId, targetSeason, targetEpisode) {
        const startTime = Date.now();
        const results = {
            included: [],
            excluded: [],
            reasons: []
        };
        this.logger.info('Aplicando filtro de título (sync)', {
            requestId,
            imdbTitle,
            targetSeason,
            targetEpisode,
            totalTorrents: torrents.length
        });
        for (const torrent of torrents) {
            const matches = this.doTitlesMatchSync(torrent.title, imdbTitle, targetSeason, targetEpisode);
            if (matches) {
                results.included.push(torrent);
                results.reasons.push(`✅ Incluído: "${torrent.title}" → "${imdbTitle}" S${targetSeason || '?'}E${targetEpisode || '?'}`);
            }
            else {
                results.excluded.push(torrent);
                const metadata = this.extractSeriesMetadata(torrent.title);
                results.reasons.push(`❌ Excluído: "${torrent.title}" (S${metadata.season || '?'}E${metadata.episode || '?'}) ≠ S${targetSeason || '?'}E${targetEpisode || '?'}`);
            }
        }
        const processingTime = Date.now() - startTime;
        this.logger.info('Resultado do filtro de título (sync)', {
            requestId,
            imdbTitle,
            targetSeason,
            targetEpisode,
            totalTorrents: torrents.length,
            included: results.included.length,
            excluded: results.excluded.length,
            processingTime: `${processingTime}ms`,
            inclusionRate: torrents.length > 0 ?
                `${((results.included.length / torrents.length) * 100).toFixed(1)}%` : '0%'
        });
        if (results.reasons.length > 0 && results.reasons.length <= 10) {
            this.logger.debug('Decisões do filtro (sync)', {
                requestId,
                reasons: results.reasons.slice(0, 10)
            });
        }
        return results.included;
    }
    async testTitleMatch(torrentTitle, imdbId, targetSeason, targetEpisode) {
        return await this.doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode);
    }
    testTitleMatchSync(torrentTitle, imdbTitle, targetSeason, targetEpisode) {
        const normTorrent = this.normalizeForComparison(torrentTitle);
        const normImdb = this.normalizeForComparison(imdbTitle);
        const metadata = this.extractSeriesMetadata(torrentTitle);
        const contains = normTorrent.includes(normImdb);
        const contained = normImdb.includes(normTorrent);
        const similarity = this.calculateSequenceSimilarity(normTorrent, normImdb);
        let matches = contains || contained || similarity >= 0.7;
        if (targetSeason !== undefined && metadata.hasEpisodeInfo) {
            if (metadata.season && metadata.season !== targetSeason) {
                matches = false;
            }
            if (targetEpisode !== undefined && metadata.episode && metadata.episode !== targetEpisode) {
                matches = false;
            }
        }
        return {
            matches,
            normalizedTorrent: normTorrent,
            normalizedImdb: normImdb,
            contains,
            contained,
            similarity,
            metadata
        };
    }
}
exports.TitleFilter = TitleFilter;
