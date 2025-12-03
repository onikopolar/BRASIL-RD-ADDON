import { Logger } from '../utils/logger';
import { ImdbScraperService, ImdbTitles } from '../services/ImdbScraperService';

export interface SeriesMetadata {
  season?: number;
  episode?: number;
  isCompleteSeason?: boolean;
  hasEpisodeInfo: boolean;
  matchedPattern?: string;
}

export interface TitleMatchResult {
  matches: boolean;
  matchedTitle?: string;           // Qual título do IMDB que deu match
  matchedLanguage?: 'original' | 'portuguese';
  similarity: number;
  torrentMetadata: SeriesMetadata;
  reason: string;
}

export class TitleFilter {
  private readonly logger: Logger;
  private imdbScraper: ImdbScraperService;

  constructor() {
    this.logger = new Logger('TitleFilter');
    this.imdbScraper = new ImdbScraperService();
  }

  /**
   * Normaliza um título para comparação
   */
  normalizeForComparison(title: string): string {
    return title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove acentos
      .replace(/[^\w\s]/g, ' ')        // Substitui símbolos por espaço
      .replace(/\s+/g, ' ')            // Remove espaços múltiplos
      .trim();
  }

 /**
 * Extrai o TÍTULO LIMPO (sem qualidade, ano, etc)
 * MAS PRESERVA NÚMEROS IMPORTANTES (Cars 3, Toy Story 2, etc)
 */
extractCleanTitle(fullTitle: string): string {
  // Primeiro, extraímos possíveis números de sequência ANTES de limpar
  const sequenceMatch = fullTitle.match(/\b(\w+)\s+(\d+)\b/i);
  let preservedSequence = '';
  
  if (sequenceMatch) {
    const [, titleWord, number] = sequenceMatch;
    // Verifica se é um número de sequência provável (2, 3, 4, II, III, etc)
    if (/^\d+$/.test(number) && parseInt(number) > 1 && parseInt(number) < 10) {
      preservedSequence = ` ${number}`;
    }
  }

  // Remove padrões comuns de torrent MAS PRESERVA O TÍTULO BASE
  const cleaned = fullTitle
    // Remove anos entre parênteses ou sozinhos, mas não números que fazem parte do título
    .replace(/\s*\(\s*\d{4}\s*\)/g, '')  // (2024)
    .replace(/\s+\d{4}\s+/g, ' ')        // 2024 (com espaços)
    // Qualidades - remove apenas se forem palavras isoladas
    .replace(/\b(2160p|1080p|720p|480p|SD|HD|4K)\b/gi, '')
    // Formatos
    .replace(/\b(WEB-DL|WEBRip|BluRay|HDTV|DVD|BD|BR)\b/gi, '')
    // Codecs  
    .replace(/\b(H264|H265|x264|x265|AVC|HEVC)\b/gi, '')
    // Áudio
    .replace(/\b(AC3|DTS|AAC|MP3|Dual|Dublado|Legendado|Legendada)\b/gi, '')
    // Remove palavras HTML/entidades
    .replace(/&#?\w+;/g, '')
    // Substitui pontos/traços por espaço, mas mantém sequências como "Cars.3"
    .replace(/[._-](?=\d)/g, ' ')  // Só substitui se tiver número depois
    .replace(/[._-](?=\D)/g, ' ')  // Só substitui se NÃO tiver número depois
    .replace(/\s+/g, ' ')
    .trim();

  // Se detectamos uma sequência importante, garantimos que ela está presente
  const finalTitle = cleaned + preservedSequence;
  
  // Remove palavras muito curtas que não são significativas
  const words = finalTitle.split(' ').filter(word => {
    // Mantém palavras com mais de 2 caracteres
    if (word.length > 2) return true;
    
    // Mantém números (como "3" em "Cars 3")
    if (/^\d+$/.test(word)) return true;
    
    // Mantém algumas preposições importantes
    if (/^(o|a|os|as|de|do|da|em|no|na|e)$/i.test(word)) return true;
    
    return false;
  });

  const result = words.join(' ').trim();
  
  // DEBUG: Para ver o que está acontecendo
  this.logger.debug('Clean title extraction', {
    original: fullTitle,
    cleaned,
    preservedSequence,
    final: result
  });
  
  return result || fullTitle; // Fallback para título original se tudo for removido
}

  /**
   * Verifica se é uma sequência numérica do filme (Cars 2, Cars 3, etc)
   */
  private isNumberedSequence(title: string, imdbTitle: string): boolean {
    const cleanTitle = this.extractCleanTitle(title).toLowerCase();
    const cleanImdb = this.extractCleanTitle(imdbTitle).toLowerCase();
    
    // Se os títulos limpós são iguais, não é sequência
    if (cleanTitle === cleanImdb) {
      return false;
    }
    
    // Verifica se o título do torrent começa com o título do IMDB + número
    // Ex: "cars 3" começa com "cars" + " 3"
    const imdbWords = cleanImdb.split(' ');
    const titleWords = cleanTitle.split(' ');
    
    // Se o título do torrent tem mais palavras que o do IMDB
    if (titleWords.length > imdbWords.length) {
      // Verifica se as primeiras palavras correspondem
      let matchesStart = true;
      for (let i = 0; i < imdbWords.length; i++) {
        if (titleWords[i] !== imdbWords[i]) {
          matchesStart = false;
          break;
        }
      }
      
      // Se começa igual, verifica se a próxima palavra é um número
      if (matchesStart) {
        const nextWord = titleWords[imdbWords.length];
        return /^\d+$/.test(nextWord);
      }
    }
    
    return false;
  }

  /**
   * Extrai metadados de série do título do torrent
   */
  extractSeriesMetadata(torrentTitle: string): SeriesMetadata {
    const title = torrentTitle.toLowerCase();
    const metadata: SeriesMetadata = {
      hasEpisodeInfo: false
    };

    // Padrões para temporada completa
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

    // Padrões para temporada (sem episódio específico)
    const seasonPatterns = [
      /(\d+)\s*(?:ª|a|°|o)?\s*temporada/i,
      /temporada\s*(\d+)/i,
      /season\s*(\d+)/i,
      /s(\d+)\b(?!e\d)/i
    ];

    let seasonFound: number | undefined;

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

    // Padrões para episódio
    const episodePatterns = [
      /s(\d+)e(\d+)/i,           // S01E01
      /(\d+)x(\d+)/i,            // 1x01
      /temporada[\s\._-]?(\d+)[\s\._-]?epis[oó]dio[\s\._-]?(\d+)/i,  // Temporada 1 Episodio 2
      /ep(?:isode)?\s*(\d+)/i,   // Ep 01, Episode 01
      /(\d+)\s*-\s*(\d+)/,       // 1-01
      /\b(\d)(\d{2})\b/           // 101 (S1E01)
    ];

    for (const pattern of episodePatterns) {
      const match = title.match(pattern);
      if (match) {
        let season = seasonFound;
        let episode: number;

        if (pattern.source === 's(\\d+)e(\\d+)') {
          // S01E01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source === '(\\d+)x(\\d+)') {
          // 1x01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('temporada') && pattern.source.includes('epis')) {
          // Temporada 1 Episodio 2
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source.includes('ep')) {
          // Ep 01
          episode = parseInt(match[1]);
        } else if (pattern.source === '(\\d+)\\s*-\\s*(\\d+)') {
          // 1-01
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else if (pattern.source === '\\b(\\d)(\\d{2})\\b') {
          // 101
          season = parseInt(match[1]);
          episode = parseInt(match[2]);
        } else {
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

    // Se encontrou temporada mas não episódio, ainda é informação válida
    if (metadata.season && !metadata.hasEpisodeInfo) {
      metadata.hasEpisodeInfo = true;
    }

    return metadata;
  }

  /**
   * VERIFICA SE TÍTULOS COMBINAM (COM SUPORTE A MÚLTIPLOS TÍTULOS DO IMDB)
   * Versão assíncrona que busca títulos no IMDB automaticamente
   */
  async doTitlesMatch(
    torrentTitle: string,
    imdbId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<TitleMatchResult> {
    try {
      // Obtém TODOS os títulos do IMDB (original + português)
      const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);

      if (imdbTitles.allTitles.length === 0) {
        return {
          matches: false,
          similarity: 0,
          torrentMetadata: this.extractSeriesMetadata(torrentTitle),
          reason: `Nenhum título encontrado no IMDB para ${imdbId}`
        };
      }

      // VALIDAÇÃO ESPECÍFICA PARA SÉRIES (se aplicável)
      const torrentMetadata = this.extractSeriesMetadata(torrentTitle);

      if (targetSeason !== undefined) {
        // Se o torrent tem informação de temporada, validar
        if (torrentMetadata.hasEpisodeInfo) {
          // VALIDAÇÃO 1: Temporada diferente
          if (torrentMetadata.season && torrentMetadata.season !== targetSeason) {
            return {
              matches: false,
              similarity: 0,
              torrentMetadata,
              reason: `❌ Temporada diferente: Torrent S${torrentMetadata.season} vs Solicitado S${targetSeason}`
            };
          }

          // VALIDAÇÃO 2: Episódio diferente (se solicitado e se torrent tem episódio)
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

          // VALIDAÇÃO 3: Se busca episódio específico e torrent é temporada completa
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

      // PRIORIDADE: Primeiro tenta título em português, depois inglês
      const titlesToTry = [];
      
      if (imdbTitles.portugueseTitle) {
        titlesToTry.push({
          title: imdbTitles.portugueseTitle,
          language: 'portuguese' as const
        });
      }
      
      titlesToTry.push({
        title: imdbTitles.originalTitle,
        language: 'original' as const
      });

      // COMPARA COM CADA TÍTULO DISPONÍVEL DO IMDB
      let bestMatch = {
        similarity: 0,
        matchedTitle: '',
        matchedLanguage: 'original' as 'original' | 'portuguese',
        reason: ''
      };

      for (const { title: imdbTitle, language } of titlesToTry) {
        const matchResult = this.compareSingleTitle(
          torrentTitle,
          imdbTitle,
          torrentMetadata,
          targetSeason,
          targetEpisode
        );

        // DEBUG: Logar cada comparação
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

      // Se encontrou um match aceitável
      if (bestMatch.similarity > 0) {
        const matches = bestMatch.similarity >= 0.7; // Threshold aumentado para 70%

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

      // Nenhum match encontrado
      return {
        matches: false,
        similarity: 0,
        torrentMetadata,
        reason: `❌ Nenhum match encontrado com os títulos do IMDB: ${imdbTitles.allTitles.join(', ')}`
      };

    } catch (error) {
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

  /**
   * Compara título do torrent com UM título específico do IMDB
   * COM CORREÇÕES PARA EVITAR MATCHES FALSOS
   */
  private compareSingleTitle(
    torrentTitle: string,
    imdbTitle: string,
    torrentMetadata: SeriesMetadata,
    targetSeason?: number,
    targetEpisode?: number
  ): { matches: boolean; similarity: number; reason: string } {
    // 1. Extrai títulos limpos (sem qualidade, ano, etc)
    const cleanTorrent = this.extractCleanTitle(torrentTitle);
    const cleanImdb = this.extractCleanTitle(imdbTitle);
    
    // Normaliza para comparação
    const normTorrent = this.normalizeForComparison(cleanTorrent);
    const normImdb = this.normalizeForComparison(cleanImdb);

    // DEBUG: Log dos títulos processados
    this.logger.debug('Títulos processados para comparação', {
      torrentTitle,
      cleanTorrent,
      normTorrent,
      imdbTitle,
      cleanImdb,
      normImdb
    });

    // 2. VERIFICAÇÕES DE REJEIÇÃO IMEDIATA

    // Rejeita se for uma sequência numerada diferente (Cars 2, Cars 3, etc)
    if (this.isNumberedSequence(torrentTitle, imdbTitle)) {
      return {
        matches: false,
        similarity: 0.1,
        reason: '❌ É uma sequência numerada diferente (ex: Cars 2, Cars 3)'
      };
    }

    // Rejeita se contém palavras enganosas (como "oscars" contendo "cars")
    const torrentWords = normTorrent.split(' ');
    const imdbWords = normImdb.split(' ');
    
    // Se o título do IMDB é uma única palavra, verifica se não é substring enganosa
    if (imdbWords.length === 1) {
      const imdbWord = imdbWords[0];
      // Procura por palavras no torrent que contenham a palavra do IMDB
      const deceptiveMatches = torrentWords.filter(word => 
        word.includes(imdbWord) && word !== imdbWord
      );
      
      if (deceptiveMatches.length > 0) {
        return {
          matches: false,
          similarity: 0.1,
          reason: `❌ Palavra enganosa encontrada: "${imdbWord}" em "${deceptiveMatches.join(', ')}"`
        };
      }
    }

    // 3. CASOS DE MATCH VÁLIDO

    // CASO 1: Match exato após limpeza e normalização
    if (normTorrent === normImdb) {
      return {
        matches: true,
        similarity: 1.0,
        reason: 'Match exato após limpeza'
      };
    }

    // CASO 2: O título LIMPO do torrent CONTÉM o título LIMPO do IMDB
    // Mas só se não for substring enganosa
    if (normTorrent.includes(normImdb) && normImdb.length >= 3) {
      // Verifica se não é apenas uma parte de palavra
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

    // CASO 3: O título LIMPO do IMDB CONTÉM o título LIMPO do torrent
    if (normImdb.includes(normTorrent) && normTorrent.length >= 3) {
      return {
        matches: true,
        similarity: 0.85,
        reason: 'Título do torrent encontrado no IMDB'
      };
    }

    // 4. SIMILARIDADE POR SEQUÊNCIA (fallback)
    const similarity = this.calculateSequenceSimilarity(normTorrent, normImdb);
    
    // Threshold mais alto para evitar falsos positivos
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

  /**
   * Método de compatibilidade - versão síncrona com título direto
   * (Mantido para código existente)
   */
  doTitlesMatchSync(
    torrentTitle: string,
    imdbTitle: string,
    targetSeason?: number,
    targetEpisode?: number
  ): boolean {
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);

    // DEBUG
    this.logger.debug('Title matching analysis (sync)', {
      torrentTitle,
      imdbTitle,
      normTorrent,
      normImdb,
      targetSeason,
      targetEpisode
    });

    // VALIDAÇÃO ESPECÍFICA PARA SÉRIES
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

    // Nova lógica de comparação
    const cleanTorrent = this.extractCleanTitle(torrentTitle);
    const cleanImdb = this.extractCleanTitle(imdbTitle);
    
    const cleanNormTorrent = this.normalizeForComparison(cleanTorrent);
    const cleanNormImdb = this.normalizeForComparison(cleanImdb);

    // Verifica match exato
    if (cleanNormTorrent === cleanNormImdb) {
      return true;
    }

    // Verifica se não é sequência numerada
    if (this.isNumberedSequence(torrentTitle, imdbTitle)) {
      return false;
    }

    // Verifica contém (apenas palavras completas)
    const torrentWords = new Set(cleanNormTorrent.split(' '));
    const imdbWords = cleanNormImdb.split(' ');
    
    const allImdbWordsInTorrent = imdbWords.every(word => torrentWords.has(word));
    if (allImdbWordsInTorrent) {
      return true;
    }

    // Similaridade como fallback
    const similarity = this.calculateSequenceSimilarity(cleanNormTorrent, cleanNormImdb);
    return similarity >= 0.8; // Threshold alto para sync
  }

  /**
   * Calcula similaridade baseada em SEQUÊNCIA de palavras
   */
  private calculateSequenceSimilarity(str1: string, str2: string): number {
    const words1 = str1.split(' ').filter(w => w.length > 0);
    const words2 = str2.split(' ').filter(w => w.length > 0);

    if (words1.length === 0 || words2.length === 0) return 0;

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

  /**
   * Filtra torrents baseado no IMDB ID (usa múltiplos títulos)
   */
  async applyTitleFilter(
    torrents: any[],
    imdbId: string,
    requestId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<any[]> {
    const startTime = Date.now();
    const results = {
      included: [] as any[],
      excluded: [] as any[],
      reasons: [] as string[]
    };

    this.logger.info('Aplicando filtro de título com IMDB ID', {
      requestId,
      imdbId,
      targetSeason,
      targetEpisode,
      totalTorrents: torrents.length
    });

    // Obtém títulos do IMDB uma vez para todos os torrents
    let imdbTitles: ImdbTitles;
    try {
      imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
      this.logger.debug('Títulos obtidos do IMDB', {
        requestId,
        originalTitle: imdbTitles.originalTitle,
        portugueseTitle: imdbTitles.portugueseTitle,
        allTitlesCount: imdbTitles.allTitles.length
      });
    } catch (error) {
      this.logger.error('Erro ao obter títulos do IMDB', {
        requestId,
        imdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return []; // Retorna vazio se não conseguir títulos
    }

    // Processa cada torrent
    for (const torrent of torrents) {
      const torrentMetadata = this.extractSeriesMetadata(torrent.title);
      let bestMatch = { 
  similarity: 0, 
  matchedTitle: '', 
  matchedLanguage: 'original' as 'original' | 'portuguese' 
};

      // PRIORIDADE: Português primeiro, depois inglês
      const titlesToTry = [];
      if (imdbTitles.portugueseTitle) {
        titlesToTry.push({ title: imdbTitles.portugueseTitle, language: 'portuguese' as const });
      }
      titlesToTry.push({ title: imdbTitles.originalTitle, language: 'original' as const });

      for (const { title: imdbTitle, language } of titlesToTry) {
        const matchResult = this.compareSingleTitle(
          torrent.title,
          imdbTitle,
          torrentMetadata,
          targetSeason,
          targetEpisode
        );

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
      } else {
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

  /**
   * Método de compatibilidade - versão síncrona com título direto
   */
  applyTitleFilterSync(
    torrents: any[],
    imdbTitle: string,
    requestId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): any[] {
    const startTime = Date.now();
    const results = {
      included: [] as any[],
      excluded: [] as any[],
      reasons: [] as string[]
    };

    this.logger.info('Aplicando filtro de título (sync)', {
      requestId,
      imdbTitle,
      targetSeason,
      targetEpisode,
      totalTorrents: torrents.length
    });

    for (const torrent of torrents) {
      const matches = this.doTitlesMatchSync(
        torrent.title,
        imdbTitle,
        targetSeason,
        targetEpisode
      );

      if (matches) {
        results.included.push(torrent);
        results.reasons.push(`✅ Incluído: "${torrent.title}" → "${imdbTitle}" S${targetSeason || '?'}E${targetEpisode || '?'}`);
      } else {
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

  /**
   * Método auxiliar para debug: testar um título específico
   */
  async testTitleMatch(
    torrentTitle: string,
    imdbId: string,
    targetSeason?: number,
    targetEpisode?: number
  ): Promise<TitleMatchResult> {
    return await this.doTitlesMatch(torrentTitle, imdbId, targetSeason, targetEpisode);
  }

  /**
   * Método auxiliar para debug: versão síncrona
   */
  testTitleMatchSync(
    torrentTitle: string,
    imdbTitle: string,
    targetSeason?: number,
    targetEpisode?: number
  ): {
    matches: boolean;
    normalizedTorrent: string;
    normalizedImdb: string;
    contains: boolean;
    contained: boolean;
    similarity: number;
    metadata: SeriesMetadata;
  } {
    const normTorrent = this.normalizeForComparison(torrentTitle);
    const normImdb = this.normalizeForComparison(imdbTitle);
    const metadata = this.extractSeriesMetadata(torrentTitle);

    const contains = normTorrent.includes(normImdb);
    const contained = normImdb.includes(normTorrent);
    const similarity = this.calculateSequenceSimilarity(normTorrent, normImdb);

    // Aplicar validação de temporada/episódio
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