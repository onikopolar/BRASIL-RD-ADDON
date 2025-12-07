import { Stream, StreamRequest } from '../types/index';
import { extractHashFromMagnet } from '../lib/magnetHelper';
import { QualityDetector } from '../lib/qualityDetector';
import { Logger } from '../utils/logger';
import { MetadataExtractor } from '../lib/title-filter/MetadataExtractor';
import { EnhancedSeriesMetadata } from '../lib/title-filter/interfaces';

export class StreamFormatter {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;
  private readonly metadataExtractor: MetadataExtractor;

  constructor() {
    this.logger = new Logger('StreamFormatter');
    this.qualityDetector = new QualityDetector();
    this.metadataExtractor = new MetadataExtractor();
    this.logger.info('StreamFormatter v1.0.6 inicializado');
  }

  createDirectStream(
    title: string,
    name: string,
    description: string,
    directLink: string,
    quality: string,
    type?: 'movie' | 'series',
    season?: number,
    episode?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata
  ): Stream {
    this.logger.debug('Criando stream DIRETO', {
      title,
      quality,
      type,
      season,
      episode,
      hasMetadata: !!metadata
    });

    let finalName = name;
    let finalTitle = title;
    
    if (type === 'series' && season !== undefined && episode !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      const episodeStr = episode.toString().padStart(2, '0');
      const episodeTag = ` S${seasonStr}E${episodeStr}`;
      
      if (!name.includes('S') && !name.includes('E')) {
        finalName = name + episodeTag;
      }
      if (!title.includes('S') && !title.includes('E')) {
        finalTitle = title + episodeTag;
      }
    }

    // Enriquecer descrição com metadados se disponível
    let finalDescription = description;
    if (metadata) {
      if (metadata.isCompleteSeason) {
        finalDescription += ' | ✅ Temporada Completa';
      }
      if (metadata.hasMultiEpisode) {
        finalDescription += ' | 📺 Múltiplos Episódios';
      }
      if (metadata.language && metadata.language !== 'unknown') {
        finalDescription += ` | 🌐 ${metadata.language}`;
      }
    }
    finalDescription += ' | INSTANTÂNEO';

    return {
      title: finalTitle,
      name: finalName,
      description: finalDescription,
      sources: [directLink],
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-direct-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        ...behaviorHints
      },
      status: 'ready',
      url: directLink
    };
  }

  createLazyStream(
    title: string,
    name: string,
    description: string,
    magnet: string,
    apiKey: string,
    quality: string,
    type?: 'movie' | 'series',
    season?: number,
    episode?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata
  ): Stream {
    this.logger.debug('Criando stream LAZY', {
      title,
      quality,
      type,
      season,
      episode,
      hasApiKey: !!apiKey,
      hasMetadata: !!metadata
    });

    const magnetHash = extractHashFromMagnet(magnet);
    const sources = magnetHash ? [`dht:${magnetHash}`] : [];
    const resolveUrl = this.generateLazyResolveUrl(magnet, apiKey, type, season, episode);
    
    let finalName = name;
    let finalTitle = title;
    
    if (type === 'series' && season !== undefined && episode !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      const episodeStr = episode.toString().padStart(2, '0');
      const episodeTag = ` S${seasonStr}E${episodeStr}`;
      
      if (!name.includes('S') && !name.includes('E')) {
        finalName = name + episodeTag;
      }
      if (!title.includes('S') && !title.includes('E')) {
        finalTitle = title + episodeTag;
      }
    }

    let finalDescription = description;
    
    // Enriquecer com metadados
    if (metadata) {
      if (metadata.isCompleteSeason) {
        finalDescription += ' | Temporada Completa';
      }
      if (metadata.isPackage) {
        finalDescription += ' | 📦 Pacote';
      }
      if (metadata.hasMultiEpisode) {
        finalDescription += ' | 📺 Múltiplos Episódios';
      }
      if (metadata.language && metadata.language !== 'unknown') {
        finalDescription += ` | 🌐 ${metadata.language}`;
      }
      if (metadata.source && metadata.source !== 'unknown') {
        finalDescription += ` | 🎞️ ${metadata.source}`;
      }
    }
    
    if (type === 'series') {
      finalDescription += ' | ⏳ Aguardando processamento...';
    }

    const stream: Stream = {
      title: finalTitle,
      name: finalName,
      description: finalDescription,
      sources: sources,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-lazy-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        ...behaviorHints
      },
      magnet: magnet,
      status: 'pending',
      infoHash: magnetHash || undefined,
      url: resolveUrl
    };

    // Adicionar flag de package se necessário
    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    return stream;
  }

  createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false
  ): Stream[] {
    const episodeTag = type === 'series' && season && episode 
      ? `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`
      : '';
    
    const allQualities = this.extractAllQualities(torrent.title);
    
    this.logger.debug('Criando múltiplos streams por qualidade', {
      torrentTitle: torrent.title,
      allQualities,
      type,
      episodeTag,
      hasMultipleQualities: allQualities.length > 1
    });

    if (allQualities.length <= 1) {
      const quality = allQualities[0] || this.qualityDetector.extractBestQuality(torrent.title);
      if (type === 'series') {
        return [this.createSeriesStream(torrent, request, directLink, season!, episode!, isAvailableOnRD)];
      } else {
        return [this.createMovieStream(torrent, request, directLink, isAvailableOnRD)];
      }
    }

    const streams: Stream[] = [];
    const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
    
    this.logger.debug('Metadados para múltiplas qualidades', {
      title: torrent.title.substring(0, 60),
      quality: metadata.quality,
      isPackage: metadata.isPackage,
      hasMultiEpisode: metadata.hasMultiEpisode
    });
    
    for (const quality of allQualities) {
      const baseTitle = this.extractCleanMovieTitle(torrent.title);
      const qualitySuffix = ` (${quality})`;
      
      let description = `${baseTitle}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)}`;
      if (episodeTag) {
        description += ` | ${episodeTag}`;
      }

      if (isAvailableOnRD && directLink) {
        streams.push(this.createDirectStream(
          `Brasil RD${qualitySuffix}`,
          `Brasil RD${qualitySuffix}`,
          description,
          directLink,
          quality,
          type,
          season,
          episode,
          {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
          },
          metadata
        ));
      } else {
        streams.push(this.createLazyStream(
          `Brasil RD${qualitySuffix}`,
          `Brasil RD${qualitySuffix}`,
          description,
          torrent.magnet,
          request.apiKey!,
          quality,
          type,
          season,
          episode,
          {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
          },
          metadata
        ));
      }
    }

    this.logger.info(`Criados ${streams.length} streams para múltiplas qualidades`, {
      torrentTitle: torrent.title,
      qualities: allQualities,
      type
    });

    return streams;
  }

  private extractAllQualities(title: string): string[] {
    const qualityPatterns = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi
    ];

    const foundQualities: string[] = [];
    const titleLower = title.toLowerCase();
    
    for (const pattern of qualityPatterns) {
      const matches = titleLower.match(pattern);
      if (matches) {
        for (const match of matches) {
          let normalizedQuality = match;
          
          if (match.includes('4k') || match.includes('2160p') || match.includes('uhd')) {
            normalizedQuality = '2160p';
          } else if (match.includes('1080p') || match.includes('fullhd') || match.includes('full hd')) {
            normalizedQuality = '1080p';
          } else if (match.includes('720p') || match.includes('hd') || match.includes('high definition')) {
            normalizedQuality = '720p';
          } else if (match.includes('480p') || match.includes('sd') || match.includes('standard definition')) {
            normalizedQuality = 'SD';
          } else if (match.includes('360p') || match.includes('low')) {
            normalizedQuality = 'SD';
          }
          
          if (!foundQualities.includes(normalizedQuality)) {
            foundQualities.push(normalizedQuality);
          }
        }
      }
    }

    if (foundQualities.length === 0) {
      const defaultQuality = this.qualityDetector.extractBestQuality(title);
      if (defaultQuality && defaultQuality !== 'unknown') {
        foundQualities.push(defaultQuality);
      }
    }

    const qualityOrder = ['2160p', '1080p', '720p', 'HD', 'SD'];
    foundQualities.sort((a, b) => {
      const indexA = qualityOrder.indexOf(a);
      const indexB = qualityOrder.indexOf(b);
      return indexA - indexB;
    });

    this.logger.debug('Qualidades extraídas do título', {
      title: title.substring(0, 60),
      foundQualities,
      total: foundQualities.length
    });

    return foundQualities;
  }

  createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false
  ): Stream {
    const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    const quality = this.qualityDetector.extractBestQuality(torrent.title);
    const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
    
    this.logger.debug('Metadados para série', {
      title: torrent.title.substring(0, 60),
      season: metadata.season,
      isCompleteSeason: metadata.isCompleteSeason,
      isPackage: metadata.isPackage
    });
    
    if (isAvailableOnRD && directLink) {
      return this.createDirectStream(
        `Brasil RD (${quality})`,
        `Brasil RD (${quality})`,
        `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`,
        directLink,
        quality,
        'series',
        season,
        episode,
        {
          bingeGroup: `br-${request.id}-${season}`,
          filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
        },
        metadata
      );
    }
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)} | ${episodeTag}`,
      torrent.magnet,
      request.apiKey!,
      quality,
      'series',
      season,
      episode,
      {
        bingeGroup: `br-${request.id}-${season}`,
        filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
      },
      metadata
    );
  }

  createMovieStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    isAvailableOnRD: boolean = false
  ): Stream {
    const quality = this.qualityDetector.extractBestQuality(torrent.title);
    const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
    
    this.logger.debug('Metadados para filme', {
      title: torrent.title.substring(0, 60),
      quality: metadata.quality,
      year: metadata.year,
      mediaType: metadata.mediaType
    });
    
    if (isAvailableOnRD && directLink) {
      return this.createDirectStream(
        `Brasil RD (${quality})`,
        `Brasil RD (${quality})`,
        `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)}`,
        directLink,
        quality,
        'movie',
        undefined,
        undefined,
        {
          bingeGroup: `br-${request.id}`,
          filename: this.sanitizeFilename(torrent.title)
        },
        metadata
      );
    }
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      `${this.extractCleanMovieTitle(torrent.title)}\n${torrent.seeders} seeds | ${torrent.size || 'Tamanho não especificado'} | ${this.formatLanguage(torrent.language)}`,
      torrent.magnet,
      request.apiKey!,
      quality,
      'movie',
      undefined,
      undefined,
      {
        bingeGroup: `br-${request.id}`,
        filename: this.sanitizeFilename(torrent.title)
      },
      metadata
    );
  }

  sortStreamsByQuality(streams: Stream[]): Stream[] {
    const qualityPriority: Record<string, number> = {
      '2160p': 5,
      '1080p': 4,
      '720p': 3,
      'HD': 2,
      'SD': 1
    };

    return streams.sort((a, b) => {
      const isDirectA = this.isDirectStream(a);
      const isDirectB = this.isDirectStream(b);
      
      if (isDirectA !== isDirectB) {
        return isDirectA ? -1 : 1;
      }
      
      const scoreA = this.calculateQualityScore(a.name || '');
      const scoreB = this.calculateQualityScore(b.name || '');
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  private isDirectStream(stream: Stream): boolean {
    return !!(
      stream.sources && 
      stream.sources.length > 0 && 
      stream.sources[0] && 
      !stream.sources[0].startsWith('dht:') &&
      stream.sources[0].startsWith('http')
    );
  }

  private calculateQualityScore(name: string | undefined): number {
    if (!name) return 0;
    
    const quality = this.qualityDetector.extractBestQuality(name);
    const qualityPriority: Record<string, number> = {
      '2160p': 5,
      '1080p': 4,
      '720p': 3,
      'HD': 2,
      'SD': 1
    };
    
    return qualityPriority[quality] || 0;
  }

  private extractCleanMovieTitle(fullTitle: string): string {
    const cleanTitle = fullTitle
      .replace(/(1080p|720p|4K|2160p|HD|WEB-DL|WEBRip|BluRay|H264|H265|x264|x265|AC3|DTS|DUAL|Dublado|Legendado|REMUX|UHD)/gi, '')
      .replace(/[.\-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\([^)]*\)/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .trim();
    
    return cleanTitle || fullTitle;
  }

  private formatLanguage(language: string): string {
    if (!language) return 'PT-BR';
    
    const langMap: Record<string, string> = {
      'pt-BR': 'PT-BR',
      'pt-BR,en': 'Dual audio PT-BR / EN',
      'en': 'EN',
      'dual': 'Dual audio',
      'multi': 'Multi language',
      'pt': 'Português',
      'pt-BR,en-US': 'Dual PT-BR/EN',
      'pt-BR,en-US,ja-JP': 'Multi PT-BR/EN/JP'
    };
    
    return langMap[language] || language;
  }

  private generateLazyResolveUrl(
    magnet: string, 
    apiKey: string,
    type?: 'movie' | 'series',
    season?: number,
    episode?: number
  ): string {
    const encodedMagnet = Buffer.from(magnet).toString('base64');
    const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
    const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
    
    let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}`;
    
    if (type === 'series') {
      if (season !== undefined) {
        url += `&season=${season}`;
      }
      if (episode !== undefined) {
        url += `&episode=${episode}`;
      }
      url += `&type=series`;
    } else if (type === 'movie') {
      url += `&type=movie`;
    }
    
    return url;
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  buildResolveUrl(
    magnet: string,
    apiKey: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number
  ): string {
    return this.generateLazyResolveUrl(magnet, apiKey, type, season, episode);
  }

  getStats() {
    return {
      version: '1.0.6',
      feature: 'Integração completa com MetadataExtractor',
      method: 'Metadados enriquecidos em todos os streams'
    };
  }
}