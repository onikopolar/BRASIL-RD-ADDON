import { Logger } from '../utils/logger';
import { CuratedMagnet, StreamRequest } from '../types/index';
import { EpisodeMatcher } from '../lib/episodeMatcher';

export class CuratedMagnetService {
  private magnets: Map<string, CuratedMagnet[]> = new Map();
  private logger: Logger;
  private episodeMatcher: EpisodeMatcher;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void>;

  constructor() {
    this.logger = new Logger('CuratedMagnetService');
    this.episodeMatcher = new EpisodeMatcher();
    
    // Armazena a promessa de inicialização para poder aguardar depois
    this.initializationPromise = this.initializeDefaultMagnets().catch(error =>
      this.logger.error('Error initializing default magnets', { error: error.message })
    );
    
    // Marca como inicializado quando a promessa resolver
    this.initializationPromise.then(() => {
      this.isInitialized = true;
      this.logger.info('CuratedMagnetService completamente inicializado', {
        totalMagnets: this.getTotalMagnetsCount()
      });
    });
  }

  // Método para aguardar a inicialização
  async waitForInitialization(): Promise<void> {
    if (this.isInitialized) {
      return;
    }
    
    this.logger.debug('Aguardando inicialização do CuratedMagnetService...');
    await this.initializationPromise;
    this.logger.debug('CuratedMagnetService pronto para uso', {
      totalMagnets: this.getTotalMagnetsCount()
    });
  }

  // Método auxiliar para contar magnets
  private getTotalMagnetsCount(): number {
    let total = 0;
    for (const magnets of this.magnets.values()) {
      total += magnets.length;
    }
    return total;
  }

  private async initializeDefaultMagnets(): Promise<void> {
    try {
      const fs = await import('fs-extra');
      const path = await import('path');

      const magnetsPath = path.join(process.cwd(), 'data/magnets.json');

      if (await fs.pathExists(magnetsPath)) {
        const data = await fs.readJson(magnetsPath);

        if (data.magnets && Array.isArray(data.magnets)) {
          let loadedCount = 0;
          let errorCount = 0;
          
          this.logger.debug('Iniciando carregamento de magnets do JSON...', {
            totalMagnets: data.magnets.length
          });
          
          for (const magnet of data.magnets) {
            try {
              this.addMagnetInternal({
                ...magnet,
                addedAt: new Date(magnet.addedAt || Date.now())
              });
              loadedCount++;
            } catch (error) {
              errorCount++;
              this.logger.warn('Skipping invalid magnet during initialization', {
                title: magnet.title?.substring(0, 50),
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }
          
          this.logger.info('Default magnets initialized', { 
            loadedCount, 
            errorCount,
            totalMagnets: data.magnets.length,
            uniqueImdbIds: this.magnets.size
          });
          
          // Log dos IMDb IDs carregados
          const imdbIds = Array.from(this.magnets.keys());
          this.logger.debug('IMDb IDs carregados do JSON:', { imdbIds });
        } else {
          this.logger.warn('Invalid magnets.json structure - magnets array not found');
        }
      } else {
        this.logger.info('No magnets.json found - starting with empty catalog');
      }
    } catch (error) {
      this.logger.error('Failed to initialize default magnets', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Extracts base IMDb ID from Stremio format
   * Examples:
   * - "tt1942683:1:1" -> "tt1942683" (series episode)
   * - "tt0317219" -> "tt0317219" (movie)
   */
  private extractBaseImdbId(fullId: string): string {
    if (!fullId || typeof fullId !== 'string') {
      return fullId;
    }

    // Extract base ID (part before first colon)
    const baseId = fullId.split(':')[0];

    // Validate IMDb ID format (starts with 'tt' followed by digits)
    if (/^tt\d+$/.test(baseId)) {
      return baseId;
    }

    return fullId;
  }

  /**
   * Validates magnet data structure
   */
  private validateMagnet(magnet: CuratedMagnet): void {
    const requiredFields = ['imdbId', 'title', 'magnet', 'quality', 'seeds'];
    const missingFields = requiredFields.filter(field => !magnet[field as keyof CuratedMagnet]);

    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(', ')}`);
    }

    if (!magnet.magnet.startsWith('magnet:?')) {
      throw new Error('Invalid magnet link format');
    }

    if (!magnet.imdbId.startsWith('tt')) {
      throw new Error('Invalid IMDb ID format');
    }

    const validQualities = ['4K', '1080p', '720p', 'SD'] as const;
    if (!validQualities.includes(magnet.quality as any)) {
      throw new Error(`Invalid quality: ${magnet.quality}. Must be one of: ${validQualities.join(', ')}`);
    }

    if (magnet.seeds < 0) {
      throw new Error('Seeds count cannot be negative');
    }
  }

  /**
   * Checks if a magnet matches a specific episode
   * Nova lógica baseada no TitleFilter - aceita temporadas completas
   */
  private doesMagnetMatchEpisode(magnetTitle: string, targetSeason: number, targetEpisode: number): boolean {
    const title = magnetTitle.toLowerCase();
    
    // ==================== 1. TEMPORADA COMPLETA ====================
    const completeSeasonPatterns = [
        /(\d+)\s*(?:ª|a|°|o)?\s*temporada\s*(?:completa|inteira)/i,
        /temporada\s*(\d+)\s*(?:completa|inteira)/i,
        /season\s*(\d+)\s*(?:complete|full)/i,
        /s(\d+)\s*(?:complete|full)/i
    ];

    for (const pattern of completeSeasonPatterns) {
        const match = title.match(pattern);
        if (match) {
            const seasonFromTitle = parseInt(match[1]);
            // Se for a mesma temporada, aceita qualquer episódio
            if (!isNaN(seasonFromTitle) && seasonFromTitle === targetSeason) {
                return true;
            }
        }
    }

    // ==================== 2. APENAS TEMPORADA (sem episódio) ====================
    const seasonOnlyPatterns = [
        /(\d+)\s*(?:ª|a|°|o)?\s*temporada/i,
        /temporada\s*(\d+)/i,
        /season\s*(\d+)/i,
        /s(\d+)\b(?!e\d)/i
    ];

    for (const pattern of seasonOnlyPatterns) {
        const match = title.match(pattern);
        if (match) {
            const seasonFromTitle = parseInt(match[1]);
            if (!isNaN(seasonFromTitle) && seasonFromTitle === targetSeason) {
                // Se encontrou apenas temporada (sem episódio), aceita
                return true;
            }
        }
    }

    // ==================== 3. EPISÓDIO ESPECÍFICO ====================
    const magnetEpisodeInfo = this.episodeMatcher.extractEpisodeInfo(magnetTitle);
    
    // Verifica se as temporadas batem
    if (magnetEpisodeInfo.season !== targetSeason) {
        return false;
    }

    // Verifica se tem episódio específico
    if (magnetEpisodeInfo.episode !== 0) {
        // Check for episode ranges (e.g., "E01-02-03")
        const rangeMatch = magnetTitle.match(/E(\d+)(?:-(\d+))?(?:-(\d+))?(?:-(\d+))?/i);
        
        if (rangeMatch) {
            // Get all episode numbers from the range
            const episodesInRange: number[] = [];
            
            for (let i = 1; i < rangeMatch.length; i++) {
                if (rangeMatch[i]) {
                    const ep = parseInt(rangeMatch[i]);
                    if (!isNaN(ep)) {
                        episodesInRange.push(ep);
                    }
                }
            }

            // Check if target episode is in the range
            if (episodesInRange.length > 0) {
                return episodesInRange.includes(targetEpisode);
            }
        }

        // Regular single episode match
        return magnetEpisodeInfo.episode === targetEpisode;
    }

    // Se chegou aqui, é uma temporada sem especificação de episódio
    // Aceita para qualquer episódio da temporada
    return true;
  }

  // Método interno para adicionar magnet (usado durante inicialização)
  private addMagnetInternal(magnet: CuratedMagnet): void {
    this.validateMagnet(magnet);

    const baseImdbId = this.extractBaseImdbId(magnet.imdbId);

    if (!this.magnets.has(baseImdbId)) {
      this.magnets.set(baseImdbId, []);
    }

    const existingMagnets = this.magnets.get(baseImdbId)!;
    const existingIndex = existingMagnets.findIndex(m => m.magnet === magnet.magnet);

    if (existingIndex === -1) {
      existingMagnets.push({
        ...magnet,
        imdbId: baseImdbId // Normalize IMDb ID
      });
    } else {
      existingMagnets[existingIndex] = {
        ...magnet,
        imdbId: baseImdbId // Normalize IMDb ID
      };
    }
  }

  // Método público para adicionar magnet
  addMagnet(magnet: CuratedMagnet): void {
    try {
      this.validateMagnet(magnet);

      const baseImdbId = this.extractBaseImdbId(magnet.imdbId);

      if (!this.magnets.has(baseImdbId)) {
        this.magnets.set(baseImdbId, []);
      }

      const existingMagnets = this.magnets.get(baseImdbId)!;
      const existingIndex = existingMagnets.findIndex(m => m.magnet === magnet.magnet);

      if (existingIndex === -1) {
        existingMagnets.push({
          ...magnet,
          imdbId: baseImdbId // Normalize IMDb ID
        });
        this.logger.info('Magnet added successfully', {
          title: magnet.title,
          imdbId: baseImdbId,
          quality: magnet.quality
        });
      } else {
        existingMagnets[existingIndex] = {
          ...magnet,
          imdbId: baseImdbId // Normalize IMDb ID
        };
        this.logger.info('Magnet updated successfully', {
          title: magnet.title,
          imdbId: baseImdbId
        });
      }
    } catch (error) {
      this.logger.error('Failed to add magnet', {
        title: magnet.title,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  removeMagnet(imdbId: string, magnetLink: string): boolean {
    const baseImdbId = this.extractBaseImdbId(imdbId);
    const magnets = this.magnets.get(baseImdbId);

    if (!magnets) {
      this.logger.debug('No magnets found for IMDb ID', { imdbId: baseImdbId });
      return false;
    }

    const initialLength = magnets.length;
    const filteredMagnets = magnets.filter(m => m.magnet !== magnetLink);

    if (filteredMagnets.length === 0) {
      this.magnets.delete(baseImdbId);
    } else {
      this.magnets.set(baseImdbId, filteredMagnets);
    }

    const removed = initialLength !== filteredMagnets.length;

    if (removed) {
      this.logger.info('Magnet removed successfully', {
        imdbId: baseImdbId,
        magnetsRemaining: filteredMagnets.length
      });
    } else {
      this.logger.debug('Magnet not found for removal', { imdbId: baseImdbId });
    }

    return removed;
  }

  searchMagnets(request: StreamRequest): CuratedMagnet[] {
    this.logger.debug('=== SEARCH MAGNETS START ===', {
      requestId: request.id,
      imdbId: request.imdbId,
      type: request.type,
      totalImdbIdsInCatalog: this.magnets.size,
      totalMagnets: this.getTotalMagnetsCount()
    });

    const { id, title, imdbId, type } = request;
    let results: CuratedMagnet[] = [];

    // Try to find magnets by IMDb ID (with base extraction)
    const searchId = imdbId || id;
    if (searchId) {
      const baseImdbId = this.extractBaseImdbId(searchId);
      
      this.logger.debug('Procurando por IMDb ID:', {
        originalId: searchId,
        baseImdbId: baseImdbId,
        hasInCatalog: this.magnets.has(baseImdbId)
      });

      if (this.magnets.has(baseImdbId)) {
        results = [...this.magnets.get(baseImdbId)!];
        this.logger.debug('Found magnets by IMDb ID', {
          baseImdbId,
          originalId: searchId,
          count: results.length,
          titles: results.map(r => r.title.substring(0, 30))
        });

        // FILTRO POR EPISÓDIO PARA SÉRIES
        if (type === 'series' && results.length > 0) {
          try {
            const extractedInfo = this.episodeMatcher.extractEpisodeFromRequest(searchId);
            
            // Extrair informações de episódio de forma compatível
            let season = 0;
            let episode = 0;
            
            if (extractedInfo && typeof extractedInfo === 'object') {
              // Adaptar para diferentes formatos de retorno
              season = (extractedInfo as any).season || 
                      (extractedInfo as any).seasonNumber || 
                      0;
              episode = (extractedInfo as any).episode || 
                       (extractedInfo as any).episodeNumber || 
                       0;
              
              // Verificar validade de forma flexível
              const isValid = season > 0 && episode > 0;
              
              if (isValid) {
                this.logger.debug('Filtrando por episódio específico', {
                  season,
                  episode,
                  totalAntes: results.length
                });

                // Filtrar magnets que correspondem ao episódio (nova lógica)
                const filteredResults = results.filter(magnet => 
                  this.doesMagnetMatchEpisode(magnet.title, season, episode)
                );

                this.logger.debug('Resultados após filtro de episódio', {
                  antes: results.length,
                  depois: filteredResults.length,
                  episodiosEncontrados: filteredResults.map(r => r.title.substring(0, 30))
                });

                results = filteredResults;

                // ✅ ADICIONAR SEASON/EPISODE AOS MAGNETS FILTRADOS
                results = results.map(magnet => ({
                  ...magnet,
                  season,
                  episode
                }));
              }
            }
          } catch (error) {
            this.logger.warn('Erro ao extrair informações de episódio', {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }
      } else {
        this.logger.debug('IMDb ID não encontrado no catálogo', { baseImdbId });
      }
    }

    // Fallback to title search if no results by IMDb ID
    if (results.length === 0 && title) {
      this.logger.debug('Falling back to title search', { title });

      for (const [imdbIdKey, magnets] of this.magnets.entries()) {
        const matching = magnets.filter(magnet =>
          magnet.title.toLowerCase().includes(title.toLowerCase())
        );
        if (matching.length > 0) {
          results.push(...matching);
          this.logger.debug('Found by title search', {
            imdbId: imdbIdKey,
            matches: matching.length
          });
        }
      }

      if (results.length > 0) {
        this.logger.debug('Found magnets by title search', {
          title,
          count: results.length
        });
      }
    }

    this.logger.debug('Magnet search completed', {
      requestId: id,
      searchId,
      title,
      resultsCount: results.length,
      totalImdbIdsInCatalog: this.magnets.size,
      hasSeasonEpisode: results.some(r => r.season !== undefined)
    });

    return this.sortByQualityAndSeeds(results);
  }

  private sortByQualityAndSeeds(magnets: CuratedMagnet[]): CuratedMagnet[] {
    const qualityScore: Record<string, number> = {
      '4K': 4,
      '1080p': 3,
      '720p': 2,
      'SD': 1
    };

    return magnets.sort((a, b) => {
      // Sort by quality (descending)
      const qualityA = qualityScore[a.quality] || 0;
      const qualityB = qualityScore[b.quality] || 0;

      if (qualityB !== qualityA) {
        return qualityB - qualityA;
      }

      // Then by seeds (descending)
      if (b.seeds !== a.seeds) {
        return b.seeds - a.seeds;
      }

      // Finally by title (ascending)
      return a.title.localeCompare(b.title);
    });
  }

  getAllMagnets(): CuratedMagnet[] {
    const allMagnets: CuratedMagnet[] = [];

    for (const magnets of this.magnets.values()) {
      allMagnets.push(...magnets);
    }

    return allMagnets;
  }

  getMagnetsByImdbId(imdbId: string): CuratedMagnet[] {
    const baseImdbId = this.extractBaseImdbId(imdbId);
    return this.magnets.get(baseImdbId) || [];
  }

  getStats(): { totalMagnets: number; uniqueTitles: number; catalogSize: number } {
    let totalMagnets = 0;

    for (const magnets of this.magnets.values()) {
      totalMagnets += magnets.length;
    }

    return {
      totalMagnets,
      uniqueTitles: this.magnets.size,
      catalogSize: this.magnets.size
    };
  }

  clearAllMagnets(): void {
    const previousSize = this.magnets.size;
    this.magnets.clear();

    this.logger.info('All magnets cleared', {
      previousCatalogSize: previousSize
    });
  }
}