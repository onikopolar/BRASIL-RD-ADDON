import { Logger } from '../../utils/logger';
import { SmartTitleMatch, SeriesConfusion } from './interfaces';
import { ImdbScraperService } from '../../services/ImdbScraperService';

export class SimilarityCalculator {
  private readonly logger: Logger;
  private confusingSeries: SeriesConfusion[];
  private readonly titleCleaner: any;
  private readonly tmdbScraper: ImdbScraperService | null;
  
  private readonly tmdbCache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTTL = 5 * 60 * 1000;

  // Versionamento Semântico v23.1.3 - Fix Ordem das Regras
  private readonly VERSION = '23.1.3';

  // Palavras técnicas otimizadas
  private readonly TECHNICAL_WORDS = [
    'mkv', 'mp4', 'avi', 'webm', 'mpg', 'mpeg', 'mov', 'wmv', 'flv', 'rmvb',
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
    'versão', 'versao', 'version', 'edição', 'edicao', 'edition',
    'completo', 'completa', 'complete', 'torrent', 'download', 'baixar', 'assistir',
    'the', 'of', 'and', 'in', 'to', 'a', 'an', 'for', 'with', 'on', 'at',
    'web', 'dl', 'rip', 'cam', 'part', 'pt', 'vol', 'volume',
    'i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', '4', '5'
  ];

  private readonly TECHNICAL_ACRONYMS = [
    'hdr', 'dv', 'hq', 'bd', 'dvd', 'tv', 'avc', 'hevc', 'aac', 'ac3', 'dts', 'imax', '3d',
    '5.1', '7.1', '2.0', '5.1ch', '7.1ch'
  ];

  constructor(titleCleaner?: any, useTmdbScraper: boolean = true) {
    this.logger = new Logger('SimilarityCalculator');
    this.logger.info(`SimilarityCalculator v${this.VERSION} iniciado - Fix Ordem das Regras`);
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
      titulo: torrentTitle.substring(0, 60),
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
          tituloPT: movieInfo.portugueseTitle || 'não encontrado',
          tituloOriginal: movieInfo.originalTitle
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
      movieInfo.mediaType
    );

    if (matchResult.matches) {
      const yearValidation = this.contextualYearValidation(
        movieInfo,
        torrentYear,
        torrentTitle,
        matchResult.similarity,
        matchResult.confidence
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
        confianca: matchResult.confidence || 'alta',
        motivo: matchResult.reason,
        versao: this.VERSION
      });
    } else {
      this.logger.debug('Match insuficiente', {
        similaridade: `${(matchResult.similarity * 100).toFixed(1)}%`,
        motivo: matchResult.reason,
        versao: this.VERSION
      });
    }

    return matchResult;
  }

  private contextualYearValidation(
    movieInfo: any, 
    torrentYear: number | null, 
    torrentTitle: string,
    semanticSimilarity: number,
    confidence?: string
  ): { shouldReject: boolean; reason: string } {
    
    if (!movieInfo.year) {
      return { shouldReject: false, reason: 'TMDB sem ano' };
    }
    
    if (!torrentYear) {
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
        reason: `Ano diferente: TMDB ${movieInfo.year} ≠ Torrent ${torrentYear}`
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
    mediaType?: 'movie' | 'tv'
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
      confidence: 'baixa' as 'baixa' | 'media' | 'alta',
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
        mediaType
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
        confianca: bestMatch.confidence,
        threshold: `${(effectiveThreshold * 100).toFixed(1)}%`,
        contexto: bestMatch.contextAnalysis,
        motivo: bestMatch.reason,
        versao: this.VERSION
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
      versao: this.VERSION
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
          lowerTitle === 'nao encontrado' || 
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
    mediaType?: 'movie' | 'tv'
  ): {
    similarity: number;
    confidence: 'baixa' | 'media' | 'alta';
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
    
    return this.normalContextAnalysis(torrentClean, tmdbClean, mediaType);
  }

  private analyzeSingleWordTitle(
    tmdbWord: string,
    torrentClean: string,
    mediaType?: 'movie' | 'tv'
  ): {
    similarity: number;
    confidence: 'baixa' | 'media' | 'alta';
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
        contextAnalysis: 'titulo_curto_nao_contem'
      };
    }
    
    // FIX v23.1.3: ORDEM CORRETA - DENSIDADE PRIMEIRO
    const densityAnalysis = this.analyzeSemanticDensity([tmdbWord], torrentWords);
    
    if (densityAnalysis.isExcessive) {
      return {
        similarity: 0.1,
        confidence: 'baixa',
        reason: `Densidade excessiva: ${torrentWords.length} vs 1 palavras`,
        contextAnalysis: 'densidade_excessiva_imediata'
      };
    }
    
    // FIX v23.1.3: CONTEXTO GLOBAL SEGUNDO
    const contextAnalysis = this.analyzeGlobalContext(tmdbWord, torrentWords);
    
    if (!contextAnalysis.hasStrongContext) {
      return {
        similarity: 0.2,
        confidence: 'baixa',
        reason: `Contexto fraco: ${contextAnalysis.reason}`,
        contextAnalysis: 'contexto_fraco_imediato'
      };
    }
    
    // FIX v23.1.3: POSIÇÃO TERCEIRO
    const wordPosition = torrentWords.findIndex(word => word === tmdbWord);
    const isFirstWord = wordPosition === 0;
    
    const basicSimilarity = 1.0;
    const extraWords = torrentWords.length - 1;
    
    // FIX v23.1.3: PENALIDADES MAIS RESTRITIVAS
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
    
    // FIX v23.1.3: BÔNUS REDUZIDOS E CONDICIONAIS
    const startsWithBonus = torrentClean.startsWith(tmdbWord + ' ');
    const isVeryShortTitle = tmdbWord.length <= 3;
    
    if (startsWithBonus && isFirstWord && extraWords <= 1) {
      finalSimilarity = Math.min(0.9, finalSimilarity * 1.1);
    }
    
    if (isVeryShortTitle && extraWords === 0) {
      finalSimilarity = Math.min(1.0, finalSimilarity * 1.05);
    }
    
    let confidence: 'baixa' | 'media' | 'alta' = 'baixa';
    let reason = '';
    
    if (finalSimilarity >= 0.85) {
      confidence = 'alta';
      reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.7) {
      confidence = 'media';
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
    
    let contextAnalysisStr = `titulo_curto_1_palavra:penalidade_${penalty.toFixed(2)}`;
    
    if (densityAnalysis.isExcessive) {
      contextAnalysisStr += `|densidade_excessiva:${densityAnalysis.ratio.toFixed(1)}`;
    }
    
    if (!isFirstWord) {
      contextAnalysisStr += `|posicao_${wordPosition}`;
    }
    
    if (!contextAnalysis.hasStrongContext) {
      contextAnalysisStr += '|contexto_fraco';
    }
    
    if (startsWithBonus) {
      contextAnalysisStr += '|comeca_com_tmdb';
    }
    
    if (isVeryShortTitle) {
      contextAnalysisStr += '|titulo_muito_curto';
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
    confidence: 'baixa' | 'media' | 'alta';
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
        contextAnalysis: 'titulo_duas_palavras_faltando'
      };
    }
    
    // FIX v23.1.3: DENSIDADE PRIMEIRO
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
    
    let confidence: 'baixa' | 'media' | 'alta' = 'baixa';
    let reason = '';
    
    if (finalSimilarity >= 0.85) {
      confidence = 'alta';
      reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.7) {
      confidence = 'media';
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
    
    let contextAnalysis = `titulo_duas_palavras:penalidade_${penalty.toFixed(2)}`;
    if (densityAnalysis.isExcessive) {
      contextAnalysis += `|densidade_excessiva:${densityAnalysis.ratio.toFixed(1)}`;
    }
    if (startsWithBonus) {
      contextAnalysis += '|comeca_com_tmdb';
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

  // FIX v23.1.3: Análise de densidade mais restritiva
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
    
    // FIX v23.1.3: REGRAS MAIS RESTRITIVAS
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

  // FIX v23.1.3: Análise de contexto mais restritiva
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
    
    // FIX v23.1.3: Títulos muito curtos (1-3 letras) precisam de contexto MUITO forte
    if (tmdbLength <= 3) {
      if (torrentWords.length >= 2) {
        return {
          hasStrongContext: false,
          reason: `Título muito curto (${tmdbLength} letras) com contexto expandido`
        };
      }
    }
    
    // FIX v23.1.3: Títulos curtos (4-5 letras) ainda precisam de cuidado
    if (tmdbLength <= 5 && torrentWords.length >= 3) {
      return {
        hasStrongContext: false,
        reason: `Título curto com muito contexto adicional`
      };
    }
    
    // Regra geral: se tem 3+ palavras totais para 1 palavra TMDB
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
    mediaType?: 'movie' | 'tv'
  ): {
    similarity: number;
    confidence: 'baixa' | 'media' | 'alta';
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
      contextAnalysis += '|contem_tmdb';
    } else if (containmentAnalysis.contained) {
      finalSimilarity = Math.min(1.0, finalSimilarity + 0.15);
      contextAnalysis += '|contido_por_tmdb';
    }
    
    if (densityAnalysis.hasGoodContext) {
      finalSimilarity = Math.min(1.0, finalSimilarity + 0.1);
      contextAnalysis += '|contexto_suficiente';
    }
    
    let confidence: 'baixa' | 'media' | 'alta' = 'baixa';
    let reason = '';
    
    if (finalSimilarity >= 0.85) {
      confidence = 'alta';
      reason = `Match forte: ${(finalSimilarity * 100).toFixed(1)}%`;
    } else if (finalSimilarity >= 0.7) {
      confidence = 'media';
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
    
    return {
      similarity: finalSimilarity,
      confidence,
      reason,
      contextAnalysis
    };
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

  private removeTechnicalWords(title: string): string {
    let clean = title;
    
    clean = clean.replace(/[\/\.\-_:]/g, ' ');
    
    this.TECHNICAL_WORDS.forEach(term => {
      const regex = new RegExp(`\\b${term}\\b`, 'gi');
      clean = clean.replace(regex, '');
    });
    
    this.TECHNICAL_ACRONYMS.forEach(acronym => {
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

  getStats() {
    return {
      version: this.VERSION,
      feature: 'Fix Ordem das Regras - Densidade Primeiro',
      description: 'Correção da ordem de análise para priorizar densidade sobre bônus',
      thresholdMovies: '0.75 (ajustável para títulos curtos)',
      thresholdSeries: '0.65',
      fixes: [
        'Ordem corrigida: 1) Densidade 2) Contexto 3) Posição 4) Bônus',
        'Densidade mais restritiva: 2+ palavras para título único = excessivo',
        'Contexto mais restritivo para títulos curtos (1-5 letras)',
        'Bônus reduzidos e condicionais',
        'Penalidades mais severas para palavras extras'
      ],
      exampleFixes: [
        '"Rio Doce": antes 100% → agora ~10% (REJEITADO)',
        '"Day of the Wicked": antes 90% → agora ~15% (REJEITADO)',
        '"Wicked (2024)": mantém 100% (ACEITO)',
        '"Rio 2011 dublado": análise correta'
      ]
    };
  }
}

export type { SmartTitleMatch, SeriesConfusion };