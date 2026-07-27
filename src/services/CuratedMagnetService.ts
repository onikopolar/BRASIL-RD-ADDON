import { Logger } from '../utils/logger.js';
import { CuratedMagnet, StreamRequest } from '../types/index.js';
import { EpisodeMatcher } from '../lib/episodeMatcher.js';

export class CuratedMagnetService {
  private magnets: Map<string, CuratedMagnet[]> = new Map();
  private logger: Logger;
  private episodeMatcher: EpisodeMatcher;
  private isInitialized: boolean = false;
  private initializationPromise: Promise<void>;

  constructor() {
    this.logger = new Logger('CuratedMagnetService');
    this.episodeMatcher = new EpisodeMatcher();
    this.logger.debug('CuratedMagnetService ready');
    
    this.initializationPromise = this.initializeDefaultMagnets().catch(error =>
      this.logger.error('Erro inicializando magnets', { error: error.message })
    );
    
    this.initializationPromise.then(() => {
      this.isInitialized = true;
    });
  }

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

  private getTotalMagnetsCount(): number {
    let total = 0;
    for (const magnets of this.magnets.values()) {
      total += magnets.length;
    }
    return total;
  }

  private async initializeDefaultMagnets(): Promise<void> {
    try {
      const fsModule = await import('fs-extra');
      const fs = (fsModule as any).default || fsModule;
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
              this.logger.warn('Ignorando magnet inválido', {
                title: magnet.title?.substring(0, 50),
                error: error instanceof Error ? error.message : 'Erro desconhecido'
              });
            }
          }
          
          this.logger.info('Default magnets initialized', { 
            loadedCount, 
            errorCount,
            totalMagnets: data.magnets.length,
            uniqueImdbIds: this.magnets.size
          });
          
          const imdbIds = Array.from(this.magnets.keys());
          this.logger.debug('IMDb IDs carregados do JSON:', { imdbIds });
        } else {
          this.logger.warn('Estrutura inválida do magnets.json - array magnets não encontrado');
        }
      } else {
        this.logger.info('Nenhum magnets.json encontrado - iniciando com catálogo vazio');
      }
    } catch (error) {
      this.logger.error('Falha ao inicializar magnets padrão', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      throw error;
    }
  }

  private extractBaseImdbId(fullId: string): string {
    if (!fullId || typeof fullId !== 'string') {
      return fullId;
    }

    const baseId = fullId.split(':')[0];

    if (/^tt\d+$/.test(baseId)) {
      return baseId;
    }

    return fullId;
  }

  private validateMagnet(magnet: CuratedMagnet): void {
    const requiredFields = ['imdbId', 'title', 'magnet', 'quality', 'seeds'];
    const missingFields = requiredFields.filter(field => !magnet[field as keyof CuratedMagnet]);

    if (missingFields.length > 0) {
      throw new Error(`Campos obrigatórios faltando: ${missingFields.join(', ')}`);
    }

    if (!magnet.magnet.startsWith('magnet:?')) {
      throw new Error('Formato de link magnet inválido');
    }

    if (!magnet.imdbId.startsWith('tt')) {
      throw new Error('Formato de IMDb ID inválido');
    }

    const validQualities = ['4K', '1080p', '720p', 'SD'] as const;
    if (!validQualities.includes(magnet.quality as any)) {
      throw new Error(`Qualidade inválida: ${magnet.quality}. Deve ser: ${validQualities.join(', ')}`);
    }

    if (magnet.seeds < 0) {
      throw new Error('Contagem de seeds não pode ser negativa');
    }
  }

  private doesMagnetMatchEpisode(magnetTitle: string, targetSeason: number, targetEpisode: number): boolean {
    const title = magnetTitle.toLowerCase();
    
    // 1. TEMPORADA COMPLETA
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
            if (!isNaN(seasonFromTitle) && seasonFromTitle === targetSeason) {
                return true;
            }
        }
    }

    // 2. APENAS TEMPORADA (sem episódio)
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
                return true;
            }
        }
    }

    // 3. EPISÓDIO ESPECÍFICO
    const magnetEpisodeInfo = this.episodeMatcher.extractEpisodeInfo(magnetTitle);
    
    if (magnetEpisodeInfo.season !== targetSeason) {
        return false;
    }

    if (magnetEpisodeInfo.episode !== 0) {
        // Verifica faixa de episódios (ex: "E01-02-03")
        const rangeMatch = magnetTitle.match(/E(\d+)(?:-(\d+))?(?:-(\d+))?(?:-(\d+))?/i);
        
        if (rangeMatch) {
            const episodesInRange: number[] = [];
            
            for (let i = 1; i < rangeMatch.length; i++) {
                if (rangeMatch[i]) {
                    const ep = parseInt(rangeMatch[i]);
                    if (!isNaN(ep)) {
                        episodesInRange.push(ep);
                    }
                }
            }

            if (episodesInRange.length > 0) {
                return episodesInRange.includes(targetEpisode);
            }
        }

        return magnetEpisodeInfo.episode === targetEpisode;
    }

    return true;
  }

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
        imdbId: baseImdbId
      });
    } else {
      existingMagnets[existingIndex] = {
        ...magnet,
        imdbId: baseImdbId
      };
    }
  }

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
          imdbId: baseImdbId
        });
        this.logger.info('Magnet adicionado com sucesso', {
          title: magnet.title,
          imdbId: baseImdbId,
          quality: magnet.quality
        });
      } else {
        existingMagnets[existingIndex] = {
          ...magnet,
          imdbId: baseImdbId
        };
        this.logger.info('Magnet atualizado com sucesso', {
          title: magnet.title,
          imdbId: baseImdbId
        });
      }
    } catch (error) {
      this.logger.error('Falha ao adicionar magnet', {
        title: magnet.title,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      throw error;
    }
  }

  removeMagnet(imdbId: string, magnetLink: string): boolean {
    const baseImdbId = this.extractBaseImdbId(imdbId);
    const magnets = this.magnets.get(baseImdbId);

    if (!magnets) {
      this.logger.debug('Nenhum magnet encontrado para IMDb ID', { imdbId: baseImdbId });
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
      this.logger.info('Magnet removido com sucesso', {
        imdbId: baseImdbId,
        magnetsRemaining: filteredMagnets.length
      });
    } else {
      this.logger.debug('Magnet não encontrado para remoção', { imdbId: baseImdbId });
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

    // Busca por IMDb ID
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

        // FIX: CORREÇÃO CRÍTICA - Verificar se é série E se TEM SEASON/EPISODE na request
        if (type === 'series' && results.length > 0) {
          // Extrair season/episode do ID da request (ex: "tt11247158:2:5")
          const seasonEpisodeMatch = searchId.match(/^tt\d+:(\d+):(\d+)$/);
          
          if (seasonEpisodeMatch) {
            const season = parseInt(seasonEpisodeMatch[1]);
            const episode = parseInt(seasonEpisodeMatch[2]);
            
            if (season > 0 && episode > 0) {
              this.logger.debug('Filtrando por episódio específico (formato Stremio)', {
                season,
                episode,
                totalAntes: results.length
              });

              // Filtrar magnets que correspondem ao episódio
              const filteredResults = results.filter(magnet => 
                this.doesMagnetMatchEpisode(magnet.title, season, episode)
              );

              this.logger.debug('Resultados após filtro de episódio', {
                antes: results.length,
                depois: filteredResults.length,
                episodiosEncontrados: filteredResults.map(r => r.title.substring(0, 30))
              });

              results = filteredResults;

              // Adicionar season/episode aos magnets filtrados
              results = results.map(magnet => ({
                ...magnet,
                season,
                episode
              }));
            } else {
              this.logger.debug('Season ou episode inválido no formato Stremio', {
                searchId,
                season,
                episode
              });
            }
          } else {
            this.logger.debug('Formato Stremio não encontrado, pulando filtro de episódio', {
              searchId
            });
          }
        }
      } else {
        this.logger.debug('IMDb ID não encontrado no catálogo', { baseImdbId });
      }
    }

    // Fallback para busca por título
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
      const qualityA = qualityScore[a.quality] || 0;
      const qualityB = qualityScore[b.quality] || 0;

      if (qualityB !== qualityA) {
        return qualityB - qualityA;
      }

      if (b.seeds !== a.seeds) {
        return b.seeds - a.seeds;
      }

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

  getStats(): { totalMagnets: number; uniqueTitles: number; catalogSize: number; version: string } {
    let totalMagnets = 0;

    for (const magnets of this.magnets.values()) {
      totalMagnets += magnets.length;
    }

    return {
      totalMagnets,
      uniqueTitles: this.magnets.size,
      catalogSize: this.magnets.size,
      version: '1.0.0'
    };
  }

  clearAllMagnets(): void {
    const previousSize = this.magnets.size;
    this.magnets.clear();

    this.logger.info('Todos os magnets limpos', {
      previousCatalogSize: previousSize
    });
  }
}