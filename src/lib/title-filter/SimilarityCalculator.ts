// Arquivo: src/lib/title-filter/SimilarityCalculator.ts
import { Logger } from '../../utils/logger';
import { SmartTitleMatch, SeriesConfusion } from './interfaces';
import { ImdbScraperService } from '../../services/ImdbScraperService';

// Importa as palavras técnicas do arquivo centralizado
import { TECHNICAL_WORDS, TECHNICAL_ACRONYMS } from './TechnicalWords';

export class SimilarityCalculator {
  private readonly logger: Logger;
  private confusingSeries: SeriesConfusion[];
  private readonly titleCleaner: any;
  private readonly tmdbScraper: ImdbScraperService | null;
  
  private readonly tmdbCache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;

  // Versionamento Semântico v23.3.2 - Corrige importação de palavras técnicas
  private readonly VERSION = '23.3.2';

  // Delegar palavras técnicas para arquivo externo
  private readonly TECHNICAL_WORDS = TECHNICAL_WORDS;
  private readonly TECHNICAL_ACRONYMS = TECHNICAL_ACRONYMS;

  constructor(titleCleaner?: any, useTmdbScraper: boolean = true) {
    this.logger = new Logger('SimilarityCalculator');
    this.logger.info(`SimilarityCalculator v${this.VERSION} iniciado - Importação de palavras técnicas corrigida`);
    this.titleCleaner = titleCleaner;
    
    if (useTmdbScraper) {
      this.tmdbScraper = new ImdbScraperService();
    } else {
      this.tmdbScraper = null;
    }
    
    this.confusingSeries = [
      { original: 'american horror story', derivative: 'american horror stories', minSimilarity: 0.85 },
      { original: 'stranger things', derivative: 'stranger things stories', minSimilarity: 0.85 }
    ];
  }

  async smartTitleContainsCheck(
    torrentTitle: string, 
    imdbId: string,
    torrentMetadata?: { year?: number; season?: number }
  ): Promise<SmartTitleMatch> {
    
    this.logger.debug('Análise iniciada', {
      título: torrentTitle.substring(0, 60),
      temporada: torrentMetadata?.season
    });

    let movieInfo: {
      portugueseTitle: string | null;
      originalTitle: string;
      year?: number;
      allTitles: string[];
      mediaType?: 'movie' | 'tv';
    } | null = null;
    
    if (this.tmdbScraper) {
      try {
        const season = torrentMetadata?.season;
        const cacheKey = season ? `tmdb-${imdbId}:s${season}` : `tmdb-${imdbId}`;
        const cached = this.tmdbCache.get(cacheKey);
        
        let tmdbData;
        if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
          this.logger.debug('Cache TMDB usado', { imdbId, season });
          tmdbData = cached.data;
        } else {
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
          mediaType: tmdbData.mediaType
        };
        
        this.logger.debug('Dados TMDB obtidos', {
          imdbId,
          temporada: season,
          ano: tmdbData.year,
          tipo: tmdbData.mediaType,
          títuloPT: movieInfo.portugueseTitle || 'não encontrado',
          títuloOriginal: movieInfo.originalTitle
        });
        
      } catch (error) {
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
    const torrentClean = this.normalizeForComparison(torrentTitle);
    
    this.logger.debug('Contexto da análise', {
      anoTMDB: movieInfo.year,
      anoTorrent: torrentYear,
      temporada: torrentMetadata?.season,
      tipo: movieInfo.mediaType
    });

    const matchResult = this.enhancedContextAnalysis(
      torrentClean,
      torrentTitle,
      movieInfo.portugueseTitle,
      movieInfo.originalTitle,
      movieInfo.allTitles,
      movieInfo.year,
      torrentYear,
      movieInfo.mediaType,
      torrentMetadata?.season
    );

    if (matchResult.matches) {
      const yearValidation = this.contextualYearValidation(
        movieInfo,
        torrentYear,
        torrentTitle,
        matchResult.similarity,
        matchResult.confidence,
        torrentMetadata?.season
      );
      
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
        versão: this.VERSION
      });
    } else {
      this.logger.debug('Match insuficiente', {
        similaridade: `${(matchResult.similarity * 100).toFixed(1)}%`,
        motivo: matchResult.reason,
        versão: this.VERSION
      });
    }

    return matchResult;
  }

  private contextualYearValidation(
    movieInfo: any, 
    torrentYear: number | null, 
    torrentTitle: string,
    semanticSimilarity: number,
    confidence?: string,
    targetSeason?: number
  ): { shouldReject: boolean; reason: string } {
    
    if (!movieInfo.year) {
      return { shouldReject: false, reason: 'TMDB sem ano' };
    }
    
    if (!torrentYear) {
      // Flexibilidade para séries com temporada explícita
      if (movieInfo.mediaType === 'tv' && targetSeason) {
        const temTemporadaExplicita = this.hasExplicitSeason(torrentTitle, targetSeason);
        const temEpisodioExplicito = this.hasExplicitEpisode(torrentTitle);
        
        if (temTemporadaExplicita) {
          // Séries com temporada explícita podem não ter ano
          let bonus = 0.1;
          if (temEpisodioExplicito) {
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

  private enhancedContextAnalysis(
    torrentClean: string,
    originalTorrentTitle: string,
    portugueseTitle: string | null,
    originalTitle: string,
    allTmdbTitles: string[],
    tmdbYear: number | undefined,
    torrentYear: number | null,
    mediaType?: 'movie' | 'tv',
    targetSeason?: number
  ): SmartTitleMatch & { matchedTmdbTitle?: string; confidence?: string; contextAnalysis?: string } {
    
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
      confidence: 'baixa' as 'baixa' | 'média' | 'alta',
      title: '',
      reason: '',
      matchedTmdbTitle: '',
      contextAnalysis: ''
    };
    
    for (const tmdbTitle of validTmdbTitles) {
      const tmdbClean = this.normalizeForComparison(tmdbTitle);
      
      const contextResult = this.smartContextAnalysis(
        torrentClean,
        tmdbClean,
        mediaType,
        targetSeason,
        originalTorrentTitle
      );
      
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
        versão: this.VERSION
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
      versão: this.VERSION
    });
    return {
      matches: false,
      similarity: bestMatch.similarity,
      reason: bestMatch.reason || `Similaridade: ${(bestMatch.similarity * 100).toFixed(1)}%`
    };
  }

  private filterValidTmdbTitles(allTitles: string[], originalTitle: string): string[] {
    const validTitles: string[] = [];
    
    for (const title of allTitles) {
      if (!title || title.trim().length === 0) continue;
      
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

  private smartContextAnalysis(
    torrentClean: string,
    tmdbClean: string,
    mediaType?: 'movie' | 'tv',
    targetSeason?: number,
    originalTorrentTitle?: string
  ): {
    similarity: number;
    confidence: 'baixa' | 'média' | 'alta';
    reason: string;
    contextAnalysis: string;
  } {
    
    const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
    const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
    
    if (tmdbWords.length === 1) {
      return this.analyzeSingleWordTitle(tmdbClean, torrentClean, mediaType);
    }
    
    if (tmdbWords.length === 2) {
      return this.analyzeDoubleWordTitle(tmdbClean, torrentClean, mediaType);
    }
    
    return this.normalContextAnalysis(torrentClean, tmdbClean, mediaType, targetSeason, originalTorrentTitle);
  }

  private analyzeSingleWordTitle(
    tmdbWord: string,
    torrentClean: string,
    mediaType?: 'movie' | 'tv'
  ): {
    similarity: number;
    confidence: 'baixa' | 'média' | 'alta';
    reason: string;
    contextAnalysis: string;
  } {
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
    
    let penalty: number;
    if (extraWords === 0) {
      penalty = 1.0;
    } else if (extraWords === 1) {
      penalty = 0.7;
    } else if (extraWords === 2) {
      penalty = 0.5;
    } else if (extraWords === 3) {
      penalty = 0.3;
    } else {
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
    
    let confidence: 'baixa' | 'média' | 'alta' = 'baixa';
    let reason = '';
    
    if (finalSimilarity >= 0.85) {
      confidence = 'alta';
      reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.7) {
      confidence = 'média';
      reason = `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.5) {
      confidence = 'baixa';
      reason = `Match baixo: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else {
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

  private analyzeDoubleWordTitle(
    tmdbClean: string,
    torrentClean: string,
    mediaType?: 'movie' | 'tv'
  ): {
    similarity: number;
    confidence: 'baixa' | 'média' | 'alta';
    reason: string;
    contextAnalysis: string;
  } {
    const tmdbWords = tmdbClean.split(' ').filter(w => w.length > 0);
    const torrentWords = torrentClean.split(' ').filter(w => w.length > 0);
    
    const containsBothWords = tmdbWords.every(word => 
      torrentWords.some(tWord => tWord === word)
    );
    
    if (!containsBothWords) {
      const missingWords = tmdbWords.filter(word => 
        !torrentWords.some(tWord => tWord === word)
      );
      
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
    
    let penalty: number;
    if (extraWords === 0) {
      penalty = 1.0;
    } else if (extraWords === 1) {
      penalty = 0.9;
    } else if (extraWords === 2) {
      penalty = 0.8;
    } else if (extraWords === 3) {
      penalty = 0.7;
    } else {
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
    
    let confidence: 'baixa' | 'média' | 'alta' = 'baixa';
    let reason = '';
    
    if (finalSimilarity >= 0.85) {
      confidence = 'alta';
      reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.7) {
      confidence = 'média';
      reason = `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.5) {
      confidence = 'baixa';
      reason = `Match baixo: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else {
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

  private analyzeSemanticDensity(tmdbWords: string[], torrentWords: string[]): {
    isExcessive: boolean;
    ratio: number;
    reason: string;
  } {
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

  private analyzeGlobalContext(tmdbWord: string, torrentWords: string[]): {
    hasStrongContext: boolean;
    reason: string;
  } {
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

  private normalContextAnalysis(
    torrentClean: string,
    tmdbClean: string,
    mediaType?: 'movie' | 'tv',
    targetSeason?: number,
    originalTorrentTitle?: string
  ): {
    similarity: number;
    confidence: 'baixa' | 'média' | 'alta';
    reason: string;
    contextAnalysis: string;
  } {
    
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
    } else if (containmentAnalysis.contained) {
      finalSimilarity = Math.min(1.0, finalSimilarity + 0.15);
      contextAnalysis += '|contido_por_tmdb';
    }
    
    if (densityAnalysis.hasGoodContext) {
      finalSimilarity = Math.min(1.0, finalSimilarity + 0.1);
      contextAnalysis += '|contexto_suficiente';
    }
    
    // Bônus para séries com temporada explícita
    if (mediaType === 'tv' && targetSeason && originalTorrentTitle) {
      const temTemporadaExplicita = this.hasExplicitSeason(originalTorrentTitle, targetSeason);
      const temEpisodioExplicito = this.hasExplicitEpisode(originalTorrentTitle);
      
      if (temTemporadaExplicita) {
        let bonus = 0.1;
        if (temEpisodioExplicito) {
          bonus += 0.05;
        }
        
        finalSimilarity = Math.min(1.0, finalSimilarity + bonus);
        contextAnalysis += `|temporada_explícita_s${targetSeason}`;
        
        if (temEpisodioExplicito) {
          contextAnalysis += '|episódio_explícito';
        }
      }
    }
    
    let confidence: 'baixa' | 'média' | 'alta' = 'baixa';
    let reason = '';
    
    if (finalSimilarity >= 0.85) {
      confidence = 'alta';
      reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.7) {
      confidence = 'média';
      reason = `Match moderado: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else {
      confidence = 'baixa';
      reason = `Similaridade baixa: ${(finalSimilarity * 100).toFixed(1)}%`;
    }
    
    if (densityAnalysis.hasExcessiveWords) {
      reason += ` (muitas palavras extras: ${densityAnalysis.torrentWords} vs ${densityAnalysis.tmdbWords})`;
    }
    
    if (containmentAnalysis.contains) {
      reason += ' (torrent contém título TMDB)';
    } else if (containmentAnalysis.contained) {
      reason += ' (TMDB contém título torrent)';
    }
    
    // Adiciona informação sobre temporada se aplicável
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

  // Detecta temporada explícita no título do torrent
  private hasExplicitSeason(torrentTitle: string, targetSeason: number): boolean {
    const lowerTitle = torrentTitle.toLowerCase();
    
    // Padrões para temporada explícita
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

  // Detecta episódio explícito no título do torrent
  private hasExplicitEpisode(torrentTitle: string): boolean {
    const lowerTitle = torrentTitle.toLowerCase();
    
    // Padrões para episódio explícito
    const episodePatterns = [
      /\be\d{1,10}\b/,
      /\bep\d{1,10}\b/,
      /\bepisode \d{1,10}\b/,
      /\bepis[oó]dio \d{1,10}\b/
    ];
    
    return episodePatterns.some(pattern => pattern.test(lowerTitle));
  }

  private calculateEnhancedSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ').filter(w => w.length > 0);
    const words2 = str2.split(' ').filter(w => w.length > 0);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
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

  private analyzeWordDensity(torrentClean: string, tmdbClean: string): {
    hasExcessiveWords: boolean;
    hasGoodContext: boolean;
    wordRatio: number;
    torrentWords: number;
    tmdbWords: number;
  } {
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

  private analyzeIntelligentContainment(torrentClean: string, tmdbClean: string): {
    contains: boolean;
    contained: boolean;
  } {
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

  // Normaliza título para comparação
  normalizeForComparison(title: string): string {
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
    
    const finalClean = this.removeTechnicalWords(clean);
    
    return finalClean;
  }

  // Remove palavras técnicas do título usando as listas importadas
  private removeTechnicalWords(title: string): string {
    let clean = title;
    
    clean = clean.replace(/[\/\.\-_:]/g, ' ');
    
    // Usa as palavras técnicas importadas do arquivo externo
    this.TECHNICAL_WORDS.forEach((term: string) => {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      clean = clean.replace(regex, '');
    });
    
    this.TECHNICAL_ACRONYMS.forEach((acronym: string) => {
      const regex = new RegExp(`\\b${acronym}\\b`, 'gi');
      clean = clean.replace(regex, '');
    });
    
    clean = clean.replace(/\b\d{3,4}[pi]\b/gi, '');
    clean = clean.replace(/\b[0-9]+k\b/gi, '');
    clean = clean.replace(/\b[hx]\d{3}\b/gi, '');
    clean = clean.replace(/\b\d+\.\d+(?:ch)?\b/gi, '');
    clean = clean.replace(/\b(19|20)\d{2}\b/g, '');
    clean = clean.replace(/\b\d+\b/g, '');
    
    clean = clean.replace(/\s+/g, ' ').trim();
    
    return clean;
  }

  private extractYearFromTitle(title: string): number | null {
    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      return parseInt(yearMatch[0]);
    }
    return null;
  }

  calculateWordSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ').filter(w => w.length > 0);
    const words2 = str2.split(' ').filter(w => w.length > 0);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    if (words1.length === 1 && words2.includes(words1[0])) {
      return 1.0;
    }
    
    const wordSet1 = new Set(words1);
    const commonWords = words2.filter(word => wordSet1.has(word));
    
    const maxLength = Math.max(words1.length, words2.length);
    return maxLength > 0 ? commonWords.length / maxLength : 0;
  }

  smartTitleContainsCheckSync(torrentTitle: string, imdbTitle: string): SmartTitleMatch {
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

  detectConfusingSeries(torrentTitle: string, imdbTitle: string): { 
    isConfusing: boolean; 
    minSimilarity: number 
  } {
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

  addConfusingSeries(original: string, derivative: string, minSimilarity: number = 0.8): void {
    this.confusingSeries.push({
      original: original.toLowerCase(),
      derivative: derivative.toLowerCase(),
      minSimilarity
    });
  }

  listConfusingSeries(): SeriesConfusion[] {
    return this.confusingSeries;
  }

  clearCache(): void {
    this.tmdbCache.clear();
  }

  // Sugere query de busca otimizada para conteúdo em português
  suggestSearchQuery(baseTitle: string, type: 'movie' | 'series', season?: number): string {
    this.logger.debug('Gerando query de busca otimizada', { 
      baseTitle, 
      type, 
      season 
    });
    
    // Limpa o título base mantendo apenas as palavras principais
    const cleanBase = this.normalizeForComparison(baseTitle).trim();
    
    if (cleanBase.length === 0) {
      this.logger.warn('Título base vazio após limpeza', { baseTitle });
      return baseTitle;
    }
    
    // Termos de idioma prioritários para português
    const languageTerms = this.getLanguageSearchTerms();
    
    // Constrói a query base
    let query = cleanBase;
    
    // Para séries, adiciona formato de temporada
    if (type === 'series' && season !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      query = `${query} s${seasonStr}`;
    }
    
    // Adiciona termos de idioma
    if (languageTerms.length > 0) {
      // Usa OR para aumentar chances de encontrar qualquer versão em português
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

  // Extrai termos de idioma relevantes para busca
  getLanguageSearchTerms(): string[] {
    // Filtra apenas os termos de idioma da lista de palavras técnicas
    const languageTerms = [
      'dublado', 'dublada', 'dublagem', 'dual', 'audio', 'áudio',
      'legendado', 'legendada', 'legenda', 'pt-br', 'ptbr', 'pt_br',
      'pt.br', 'pt br', 'portugues', 'português', 'brazilian', 'multi'
    ];
    
    const validTerms = languageTerms.filter(term => 
      this.TECHNICAL_WORDS.includes(term)
    );
    
    this.logger.debug('Termos de idioma disponíveis', {
      totalEncontrados: validTerms.length,
      termos: validTerms
    });
    
    return validTerms;
  }

  // Versão simplificada para queries rápidas
  suggestSimpleSearchQuery(baseTitle: string, type: 'movie' | 'series', season?: number): string {
    const cleanTitle = this.normalizeForComparison(baseTitle).trim();
    
    if (type === 'series' && season !== undefined) {
      return `${cleanTitle} s${season.toString().padStart(2, '0')} dual OR dublado OR portugues`;
    }
    
    return `${cleanTitle} dual OR dublado OR portugues`;
  }

  getStats() {
    const languageTerms = this.getLanguageSearchTerms();
    
    return {
      versão: this.VERSION,
      feature: 'Palavras técnicas importadas de arquivo externo',
      descrição: 'Centraliza palavras técnicas em arquivo separado para manutenção mais fácil',
      limiarFilmes: '0.75 (ajustável para títulos curtos)',
      limiarSéries: '0.65',
      termosTécnicos: {
        totalPalavras: this.TECHNICAL_WORDS.length,
        totalAcrônimos: this.TECHNICAL_ACRONYMS.length,
        fonte: 'Arquivo técnico-words.ts externo'
      },
      termosIdioma: {
        total: languageTerms.length,
        termos: languageTerms
      },
      melhorias: [
        'Palavras técnicas movidas para arquivo separado',
        'Manutenção centralizada das listas de palavras',
        'Fácil atualização de termos técnicos',
        'Reuso em diferentes partes do sistema',
        'Detecção mais precisa de conteúdo técnico'
      ],
      exemplos: [
        'Filme: "Interestelar (2014) 1080p DUAL" → "interestelar"',
        'Série: "Breaking Bad S01E01 720p DUBLADO" → "breaking bad"',
        'Termos removidos: 1080p, dual, dublado, s01e01'
      ]
    };
  }
}

export type { SmartTitleMatch, SeriesConfusion };