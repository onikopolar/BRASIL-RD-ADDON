import { Logger } from '../utils/logger.js';
import { CuratedMagnet, StreamRequest } from '../types/index.js';
import fs from 'fs-extra';

export class CuratedMagnetService {
  private magnets: Map<string, CuratedMagnet[]> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('CuratedMagnetService');
    this.initializeDefaultMagnets().catch(error => 
      this.logger.error('Error initializing default magnets', { error: error.message })
    );
  }

  private async initializeDefaultMagnets(): Promise<void> {
    try {
      const fs = await import('fs-extra');
      const path = await import('path');

      const magnetsPath = path.join(process.cwd(), 'data/magnets.json');
      
      if (await fs.pathExists(magnetsPath)) {
        const data = await fs.readJSON(magnetsPath);
        
        if (data.magnets && Array.isArray(data.magnets)) {
          let loadedCount = 0;
          data.magnets.forEach((magnet: any) => {
            try {
              this.addMagnet({
                ...magnet,
                addedAt: new Date(magnet.addedAt || Date.now())
              });
              loadedCount++;
            } catch (error) {
              this.logger.warn('Skipping invalid magnet during initialization', {
                title: magnet.title,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          });
          this.logger.info('Default magnets initialized', { loadedCount, totalMagnets: data.magnets.length });
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
    const { id, title, imdbId } = request;
    let results: CuratedMagnet[] = [];

    // Try to find magnets by IMDb ID (with base extraction)
    const searchId = imdbId || id;
    if (searchId) {
      const baseImdbId = this.extractBaseImdbId(searchId);
      
      if (this.magnets.has(baseImdbId)) {
        results = [...this.magnets.get(baseImdbId)!];
        this.logger.debug('Found magnets by IMDb ID', { 
          baseImdbId,
          originalId: searchId,
          count: results.length 
        });
      }
    }

    // Fallback to title search if no results by IMDb ID
    if (results.length === 0 && title) {
      this.logger.debug('Falling back to title search', { title });
      
      for (const magnets of this.magnets.values()) {
        const matching = magnets.filter(magnet =>
          magnet.title.toLowerCase().includes(title.toLowerCase())
        );
        results.push(...matching);
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
      resultsCount: results.length
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