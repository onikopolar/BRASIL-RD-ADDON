import { Stream, StreamRequest } from '../types/index';
import { extractHashFromMagnet } from '../lib/magnetHelper';
import { Logger } from '../utils/logger';

export class StreamFormatter {
  private readonly logger: Logger;

  constructor() {
    this.logger = new Logger('StreamFormatter');
  }

  /**
   * Cria um stream com link DIRETO para conteúdo já disponível no Real-Debrid
   */
  createDirectStream(
    title: string,
    name: string,
    description: string,
    directLink: string,
    quality: string,
    type?: 'movie' | 'series',
    season?: number,
    episode?: number,
    behaviorHints?: any
  ): Stream {
    this.logger.debug('Criando stream DIRETO', {
      title,
      quality,
      type,
      season,
      episode,
      directLinkLength: directLink.length
    });

    let finalName = name;
    let finalTitle = title;
    
    // Adicionar SxxExx ao nome para séries
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

    return {
      title: finalTitle,
      name: finalName,
      description: description + ' | ✅ INSTANTÂNEO',
      // ✅ LINK DIRETO no sources (o que o Stremio precisa!)
      sources: [directLink],
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-direct-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        ...behaviorHints
      },
      // Status indica que é link direto
      status: 'ready',
      url: directLink // Opcional: manter URL direta também
    };
  }

  /**
   * Cria um stream LAZY (magnet) para conteúdo que precisa ser baixado
   */
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
    behaviorHints?: any
  ): Stream {
    this.logger.debug('Criando stream LAZY', {
      title,
      quality,
      type,
      season,
      episode,
      hasApiKey: !!apiKey
    });

    const magnetHash = extractHashFromMagnet(magnet);
    const sources = magnetHash ? [`dht:${magnetHash}`] : [];
    
    // Gerar URL de resolução com season/episode
    const resolveUrl = this.generateLazyResolveUrl(magnet, apiKey, type, season, episode);
    
    let finalName = name;
    let finalTitle = title;
    
    // Adicionar SxxExx ao nome para séries
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

    // Adicionar indicador de processamento se for série
    let finalDescription = description;
    if (type === 'series') {
      finalDescription += ' | ⏳ Aguardando processamento...';
    }

    return {
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
  }

  /**
   * Cria stream para série (especializado)
   */
  createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null, // null se não disponível
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false
  ): Stream {
    const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    const quality = this.extractQualityFromFilename(torrent.title);
    
    // Se já disponível no RD e temos link direto
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
        }
      );
    }
    
    // Se não disponível, criar lazy stream
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
      }
    );
  }

  /**
   * Ordena streams por qualidade (melhor primeiro)
   */
  sortStreamsByQuality(streams: Stream[]): Stream[] {
    const qualityPriority: Record<string, number> = {
      '2160p': 5,
      '1080p': 4,
      '720p': 3,
      'HD': 2,
      'SD': 1
    };

    return streams.sort((a, b) => {
      // Primeiro por tipo (diretos primeiro)
      const isDirectA = this.isDirectStream(a);
      const isDirectB = this.isDirectStream(b);
      
      if (isDirectA !== isDirectB) {
        return isDirectA ? -1 : 1;
      }
      
      // Depois por qualidade
      const scoreA = this.calculateQualityScore(a.name || '');
      const scoreB = this.calculateQualityScore(b.name || '');
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      // Por fim por nome
      return (a.name || '').localeCompare(b.name || '');
    });
  }

  /**
   * Verifica se um stream é direto (já disponível)
   */
  private isDirectStream(stream: Stream): boolean {
    // Stream direto tem link direto no sources e não começa com 'dht:'
    return !!(
      stream.sources && 
      stream.sources.length > 0 && 
      stream.sources[0] && 
      !stream.sources[0].startsWith('dht:') &&
      stream.sources[0].startsWith('http')
    );
  }

  /**
   * Calcula score de qualidade baseado no nome
   */
  private calculateQualityScore(name: string | undefined): number {
    if (!name) return 0;
    
    const quality = this.extractQualityFromStreamName(name);
    const qualityPriority: Record<string, number> = {
      '2160p': 5,
      '1080p': 4,
      '720p': 3,
      'HD': 2,
      'SD': 1
    };
    
    return qualityPriority[quality] || 0;
  }

  /**
   * Extrai qualidade do nome do stream
   */
  private extractQualityFromStreamName(name: string): string {
    const patterns = [
      { pattern: /\b2160p\b/i, quality: '2160p' },
      { pattern: /\b4k\b/i, quality: '2160p' },
      { pattern: /\b1080p\b/i, quality: '1080p' },
      { pattern: /\b720p\b/i, quality: '720p' },
      { pattern: /\bhd\b/i, quality: 'HD' },
      { pattern: /\bsd\b/i, quality: 'SD' }
    ];

    const cleanName = name.toLowerCase();
    for (const { pattern, quality } of patterns) {
      if (pattern.test(cleanName)) {
        return quality;
      }
    }

    return 'HD';
  }

  /**
   * Extrai qualidade do nome do arquivo
   */
  private extractQualityFromFilename(filename: string): string {
    return this.extractQualityFromStreamName(filename);
  }

  /**
   * Limpa título do filme/série
   */
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

  /**
   * Formata linguagem para exibição
   */
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

  /**
   * Gera URL de resolução para streams lazy
   */
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
    
    // Adicionar parâmetros de season/episode para séries
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

  /**
   * Sanitiza nome de arquivo
   */
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  /**
   * Constrói URL para o endpoint /resolve (para uso externo)
   */
  buildResolveUrl(
    magnet: string,
    apiKey: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number
  ): string {
    return this.generateLazyResolveUrl(magnet, apiKey, type, season, episode);
  }
}