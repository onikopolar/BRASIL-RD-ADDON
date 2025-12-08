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
    // Versionamento Semântico v1.4.0 - FIX: Formato compatível com Stremio Web/Desktop
    this.logger.info('StreamFormatter v1.4.0 - Formato Stremio Web corrigido');
  }

  // Stream direto do Real-Debrid (formato Stremio)
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
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number // NOVO: Índice do arquivo para torrents múltiplos
  ): Stream {
    this.logger.debug('DIRECT_STREAM', { 
      quality: quality, 
      type: type, 
      season: season, 
      episode: episode,
      hasDirectLink: !!directLink 
    });

    // Formata título com episódio para séries
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

    // Formato CORRETO para Stremio Web (mesmo do Torrentio)
    const stream: Stream = {
      title: finalTitle,
      infoHash: extractHashFromMagnet(directLink) || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0 // Padrão: primeiro arquivo
    };

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        streamQuality: quality,
        ...behaviorHints
      };
    }

    this.logger.debug('DIRECT_STREAM_CRIADO', {
      title: finalTitle.substring(0, 40),
      infoHash: stream.infoHash ? `${stream.infoHash.substring(0, 8)}...` : 'none',
      fileIdx: stream.fileIdx
    });

    return stream;
  }

  // Stream lazy (magnet) - Formato Stremio corrigido
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
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number // NOVO: Índice do arquivo
  ): Stream {
    this.logger.debug('LAZY_STREAM', { 
      quality: quality, 
      type: type, 
      season: season, 
      episode: episode,
      hasMagnet: !!magnet 
    });

    const magnetHash = extractHashFromMagnet(magnet);
    
    // Formata título com episódio para séries
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

    // FORMATO CORRETO para Stremio Web/Desktop (igual ao Torrentio)
    const stream: Stream = {
      title: finalTitle,
      infoHash: magnetHash || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0 // Padrão: primeiro arquivo
    };

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        streamQuality: quality,
        ...behaviorHints
      };
    }

    // Adiciona metadata específica se for pacote
    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    this.logger.debug('LAZY_STREAM_CRIADO', {
      title: finalTitle.substring(0, 40),
      infoHash: stream.infoHash ? `${stream.infoHash.substring(0, 8)}...` : 'none',
      fileIdx: stream.fileIdx,
      format: 'stremio_web_compat'
    });

    return stream;
  }

  // Cria streams separados para cada qualidade (mantém compatibilidade)
  createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number // NOVO: Índice do arquivo
  ): Stream[] {
    const allQualities = this.extractAllQualities(torrent.title);
    
    this.logger.debug('MULTI_QUALITY_STREAMS_PROCESS', {
      torrentTitle: torrent.title.substring(0, 80),
      qualitiesFound: allQualities.length,
      qualities: allQualities,
      type: type,
      season: season,
      episode: episode,
      fileIdx: fileIdx
    });

    // Se não encontrou qualidades, usa detector padrão
    if (allQualities.length === 0) {
      const defaultQuality = this.qualityDetector.extractBestQuality(torrent.title);
      if (defaultQuality && defaultQuality !== 'unknown') {
        allQualities.push(defaultQuality);
      } else {
        allQualities.push('HD');
      }
    }

    const streams: Stream[] = [];
    const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
    const episodeTag = type === 'series' && season && episode 
      ? `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`
      : '';

    // Cria stream SEPARADO para cada qualidade
    for (const quality of allQualities) {
      // Título base mantido completo
      const baseTitle = torrent.title;
      
      // Nome do stream com qualidade específica
      const streamName = `Brasil RD (${quality})`;
      let streamTitle = streamName;
      
      // Adiciona episódio se for série
      if (type === 'series' && season !== undefined && episode !== undefined) {
        streamTitle += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
      }

      if (isAvailableOnRD && directLink) {
        // Stream direto do Real-Debrid (formato correto)
        streams.push(this.createDirectStream(
          streamTitle,
          streamName,
          baseTitle,
          directLink,
          quality,
          type,
          season,
          episode,
          {
            bingeGroup: `br-${request.id}-${quality}`,
            filename: this.sanitizeFilename(`${torrent.title} ${episodeTag}`)
          },
          metadata,
          fileIdx // Passa o fileIdx
        ));
      } else {
        // Stream lazy com magnet (formato correto)
        streams.push(this.createLazyStream(
          streamTitle,
          streamName,
          baseTitle,
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
          metadata,
          fileIdx // Passa o fileIdx
        ));
      }
      
      this.logger.debug('QUALITY_STREAM_CREATED', {
        quality: quality,
        type: type,
        season: season,
        episode: episode,
        hasDirectLink: !!(isAvailableOnRD && directLink),
        version: '1.4.0',
        fileIdx: fileIdx
      });
    }

    this.logger.info('STREAMS_CREATED_SUCCESS', {
      total: streams.length,
      qualities: allQualities,
      torrent: torrent.title.substring(0, 60),
      version: '1.4.0',
      streamFormat: 'stremio_web_compatible'
    });

    return streams;
  }

  // Extrai todas qualidades de um título (mantido da versão anterior)
  private extractAllQualities(title: string): string[] {
    const qualityPatterns = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi,
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi
    ];

    const foundQualities: Set<string> = new Set();
    const titleLower = title.toLowerCase();
    
    for (const pattern of qualityPatterns.slice(0, 5)) {
      const matches = titleLower.match(pattern);
      if (matches) {
        for (const match of matches) {
          const normalized = this.normalizeQuality(match);
          if (normalized) {
            foundQualities.add(normalized);
          }
        }
      }
    }
    
    for (const pattern of qualityPatterns.slice(5)) {
      const matches = titleLower.match(pattern);
      if (matches) {
        for (const match of matches) {
          const qualityMatches = match.match(/\d{3,4}p/gi);
          if (qualityMatches) {
            for (const qualityMatch of qualityMatches) {
              const normalized = this.normalizeQuality(qualityMatch);
              if (normalized) {
                foundQualities.add(normalized);
              }
            }
          }
        }
      }
    }
    
    const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
    let listMatch;
    while ((listMatch = listPattern.exec(titleLower)) !== null) {
      const normalized = this.normalizeQuality(listMatch[1]);
      if (normalized) {
        foundQualities.add(normalized);
      }
    }
    
    const result = Array.from(foundQualities);
    
    if (result.length === 0) {
      const defaultQuality = this.qualityDetector.extractBestQuality(title);
      if (defaultQuality && defaultQuality !== 'unknown') {
        result.push(defaultQuality);
      }
    }

    const qualityOrder = ['2160p', '1080p', '720p', 'HD', 'SD'];
    result.sort((a, b) => {
      const indexA = qualityOrder.indexOf(a);
      const indexB = qualityOrder.indexOf(b);
      return indexA - indexB;
    });

    return result;
  }

  // Normaliza nome da qualidade
  private normalizeQuality(quality: string): string {
    const qualityLower = quality.toLowerCase();
    
    if (qualityLower.includes('4k') || qualityLower.includes('2160p') || qualityLower.includes('uhd')) {
      return '2160p';
    } else if (qualityLower.includes('1080p') || qualityLower.includes('fullhd') || qualityLower.includes('full hd')) {
      return '1080p';
    } else if (qualityLower.includes('720p') || qualityLower.includes('hd') || qualityLower.includes('high definition')) {
      return '720p';
    } else if (qualityLower.includes('480p') || qualityLower.includes('sd') || qualityLower.includes('standard definition')) {
      return 'SD';
    } else if (qualityLower.includes('360p') || qualityLower.includes('low')) {
      return 'SD';
    } else if (qualityLower.includes('hd')) {
      return 'HD';
    }
    
    if (qualityLower.match(/\d{3,4}p/)) {
      return qualityLower;
    }
    
    return '';
  }

  // Métodos de compatibilidade (mantidos para não quebrar código existente)
  createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Stream {
    const qualities = this.extractAllQualities(torrent.title);
    const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      torrent.title,
      torrent.magnet,
      request.apiKey!,
      quality,
      'series',
      season,
      episode,
      {
        bingeGroup: `br-${request.id}-${quality}`,
        filename: this.sanitizeFilename(torrent.title)
      },
      undefined,
      fileIdx
    );
  }

  createMovieStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Stream {
    const qualities = this.extractAllQualities(torrent.title);
    const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      torrent.title,
      torrent.magnet,
      request.apiKey!,
      quality,
      'movie',
      undefined,
      undefined,
      {
        bingeGroup: `br-${request.id}-${quality}`,
        filename: this.sanitizeFilename(torrent.title)
      },
      undefined,
      fileIdx
    );
  }

  // Ordena streams por qualidade
  sortStreamsByQuality(streams: Stream[]): Stream[] {
    const qualityPriority: Record<string, number> = {
      '2160p': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };

    return streams.sort((a, b) => {
      const scoreA = this.calculateQualityScore(a.title || '');
      const scoreB = this.calculateQualityScore(b.title || '');
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  // Calcula score de qualidade
  private calculateQualityScore(name: string | undefined): number {
    if (!name) return 0;
    
    const quality = this.qualityDetector.extractBestQuality(name);
    const qualityPriority: Record<string, number> = {
      '2160p': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };
    
    return qualityPriority[quality] || 0;
  }

  // Sanitiza nome de arquivo
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  // Informações do formatter atualizado
  getStats() {
    return {
      versao: '1.4.0',
      feature: 'Formato compatível com Stremio Web/Desktop',
      fix: 'Remove campos não padrão (url, sources, description, status, magnet) - Mantém apenas title, infoHash, fileIdx',
      formatoCorreto: {
        camposObrigatorios: ['title', 'infoHash', 'fileIdx (opcional)'],
        camposOpcionais: ['behaviorHints'],
        camposRemovidos: ['url', 'sources', 'description', 'name', 'status', 'magnet']
      },
      compatibilidade: [
        'Stremio Web (100%)',
        'Stremio Desktop (100%)',
        'Stremio Mobile (100%)',
        'Stremio Android TV (100%)'
      ],
      ordenacao: '2160p > 1080p > 720p > HD > SD',
      nota: 'Formato igual ao Torrentio para máxima compatibilidade'
    };
  }
}