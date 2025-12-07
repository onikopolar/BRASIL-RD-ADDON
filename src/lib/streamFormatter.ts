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
    // Versionamento Semântico v1.3.3 - URLs únicas por qualidade
    this.logger.info('StreamFormatter v1.3.3 - URLs únicas por qualidade');
  }

  // Stream direto já pronto no Real-Debrid
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
    this.logger.debug('DIRECT', { qualidade: quality, tipo: type, temporada: season, episodio: episode });

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

    const finalDescription = this.format3x3Description(description, metadata, true, type, season, episode);

    return {
      title: finalTitle,
      name: finalName,
      description: finalDescription,
      sources: [directLink],
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-direct-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        streamQuality: quality,
        ...behaviorHints
      },
      status: 'ready',
      url: directLink
    };
  }

  // Stream lazy que precisa processar via magnet
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
    this.logger.debug('LAZY', { qualidade: quality, tipo: type, temporada: season, episodio: episode });

    const magnetHash = extractHashFromMagnet(magnet);
    const sources = magnetHash ? [`dht:${magnetHash}`] : [];
    
    // VERSÃO 1.3.3: URL DE RESOLVE INCLUI QUALIDADE
    const resolveUrl = this.generateLazyResolveUrl(magnet, apiKey, quality, type, season, episode);
    
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

    const finalDescription = this.format3x3Description(description, metadata, false, type, season, episode);

    const stream: Stream = {
      title: finalTitle,
      name: finalName,
      description: finalDescription,
      sources: sources,
      behaviorHints: {
        notWebReady: false,
        bingeGroup: `br-lazy-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle),
        streamQuality: quality,
        ...behaviorHints
      },
      magnet: magnet,
      status: 'pending',
      infoHash: magnetHash || undefined,
      url: resolveUrl  // URL ÚNICA POR QUALIDADE
    };

    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    return stream;
  }

  // Formato 3x3 para descrição do stream
  private format3x3Description(
    baseDescription: string,
    metadata?: EnhancedSeriesMetadata,
    isDirect: boolean = false,
    type?: 'movie' | 'series',
    season?: number,
    episode?: number
  ): string {
    const lines = baseDescription.split('\n');
    const contentTitle = lines[0] || 'Sem título';
    
    const seedsMatch = baseDescription.match(/(\d+)\s*seeds?/i);
    const sizeMatch = baseDescription.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    
    const languageFromDesc = this.extractLanguageFromDescription(baseDescription);
    const formattedLanguage = this.formatLanguage(languageFromDesc);
    
    const seeds = seedsMatch ? seedsMatch[1] : '0';
    const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : 'N/A';
    
    let result = contentTitle;
    
    let topLine = '';
    topLine += `🔗 ${seeds}`;
    topLine += ` | 💾 ${size}`;
    topLine += ` | 🌐 ${formattedLanguage}`;
    
    if (type === 'series' && season !== undefined && episode !== undefined) {
      const episodeTag = `S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
      topLine += ` | 📺 ${episodeTag}`;
    }
    
    result += '\n' + topLine;
    
    let bottomLine = '';
    const metadataItems: string[] = [];
    
    if (metadata) {
      if (metadata.isCompleteSeason) {
        metadataItems.push('📦 Completa');
      }
      if (metadata.isPackage) {
        metadataItems.push('🎬 Pacote');
      }
      if (metadata.hasMultiEpisode) {
        metadataItems.push('👥 Múltiplos');
      }
      if (metadata.source && metadata.source !== 'unknown') {
        metadataItems.push(`🎞️ ${metadata.source}`);
      }
      if (metadata.codec && metadata.codec !== 'unknown') {
        metadataItems.push(`🔧 ${metadata.codec}`);
      }
    }
    
    if (isDirect) {
      metadataItems.push('🚀 Instantâneo');
    } else {
      metadataItems.push('⏳ Processando');
    }
    
    const limitedItems = metadataItems.slice(0, 3);
    bottomLine = limitedItems.join(' | ');
    
    if (bottomLine) {
      result += '\n' + bottomLine;
    }
    
    return result;
  }

  // Extrai idioma da descrição
  private extractLanguageFromDescription(description: string): string {
    const languagePatterns = [
      /(PT-BR|Dual|EN|Multi|ES|FR)/i,
      /(portuguese|english|spanish|french)/i,
      /(dublado|legendado|subtitled)/i
    ];
    
    for (const pattern of languagePatterns) {
      const match = description.match(pattern);
      if (match) {
        return match[1];
      }
    }
    
    return 'PT-BR';
  }

  // Cria streams separados para cada qualidade encontrada no torrent
  createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false
  ): Stream[] {
    const allQualities = this.extractAllQualities(torrent.title);
    
    this.logger.debug('MULTI_QUALITY_STREAMS', {
      torrentTitle: torrent.title.substring(0, 80),
      qualidadesEncontradas: allQualities.length,
      qualidades: allQualities,
      tipo: type,
      temporada: season,
      episodio: episode
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
      // TÍTULO ORIGINAL mantido completo
      const baseTitle = torrent.title;
      
      // Descrição base mantendo todas informações
      const baseDesc = `${baseTitle}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`;
      
      // Nome do stream com qualidade específica
      const streamName = `Brasil RD (${quality})`;
      let streamTitle = streamName;
      
      // Adiciona episódio se for série
      if (type === 'series' && season !== undefined && episode !== undefined) {
        streamTitle += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
      }

      if (isAvailableOnRD && directLink) {
        // Stream direto com link do RD
        streams.push(this.createDirectStream(
          streamTitle,
          streamName,
          baseDesc,
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
        // Stream lazy com magnet - VERSÃO 1.3.3: URL única por qualidade
        streams.push(this.createLazyStream(
          streamTitle,
          streamName,
          baseDesc,
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
      
      this.logger.debug('QUALITY_STREAM_CRIADO', {
        qualidade: quality,
        tipo: type,
        temporada: season,
        episodio: episode,
        temLinkDireto: !!(isAvailableOnRD && directLink),
        versao: '1.3.3'
      });
    }

    this.logger.info('STREAMS_CRIADOS', {
      total: streams.length,
      qualidades: allQualities,
      torrent: torrent.title.substring(0, 60),
      versao: '1.3.3'
    });

    return streams;
  }

  // Extrai todas qualidades de um título
  private extractAllQualities(title: string): string[] {
    const qualityPatterns = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi,
      // Padrões com múltiplas qualidades
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,  // 720p/1080p
      /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi, // 720p e 1080p
      /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi  // 720p ou 1080p
    ];

    const foundQualities: Set<string> = new Set();
    const titleLower = title.toLowerCase();
    
    // Primeiro procura por qualidades individuais
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
    
    // Procura por padrões de múltiplas qualidades (720p/1080p)
    for (const pattern of qualityPatterns.slice(5)) {
      const matches = titleLower.match(pattern);
      if (matches) {
        for (const match of matches) {
          // Extrai todas as qualidades do padrão
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
    
    // Procura por qualidades em listas (720p, 1080p, 4K)
    const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
    let listMatch;
    while ((listMatch = listPattern.exec(titleLower)) !== null) {
      const normalized = this.normalizeQuality(listMatch[1]);
      if (normalized) {
        foundQualities.add(normalized);
      }
    }
    
    const result = Array.from(foundQualities);
    
    // Se não encontrou nada, tenta detector padrão
    if (result.length === 0) {
      const defaultQuality = this.qualityDetector.extractBestQuality(title);
      if (defaultQuality && defaultQuality !== 'unknown') {
        result.push(defaultQuality);
      }
    }

    // Ordena por hierarquia
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
    
    // Mantém formato original se for 720p, 1080p, etc
    if (qualityLower.match(/\d{3,4}p/)) {
      return qualityLower;
    }
    
    return '';
  }

  // Cria stream para série (mantido para compatibilidade)
  createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false
  ): Stream {
    const qualities = this.extractAllQualities(torrent.title);
    const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`,
      torrent.magnet,
      request.apiKey!,
      quality,
      'series',
      season,
      episode,
      {
        bingeGroup: `br-${request.id}-${quality}`,
        filename: this.sanitizeFilename(torrent.title)
      }
    );
  }

  // Cria stream para filme (mantido para compatibilidade)
  createMovieStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    isAvailableOnRD: boolean = false
  ): Stream {
    const qualities = this.extractAllQualities(torrent.title);
    const quality = qualities.length > 0 ? qualities[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language)}`,
      torrent.magnet,
      request.apiKey!,
      quality,
      'movie',
      undefined,
      undefined,
      {
        bingeGroup: `br-${request.id}-${quality}`,
        filename: this.sanitizeFilename(torrent.title)
      }
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

  // Verifica se stream é direto
  private isDirectStream(stream: Stream): boolean {
    return !!(
      stream.sources && 
      stream.sources.length > 0 && 
      stream.sources[0] && 
      !stream.sources[0].startsWith('dht:') &&
      stream.sources[0].startsWith('http')
    );
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

  // Formata idioma
  private formatLanguage(language: string): string {
    if (!language) return 'PT-BR';
    
    const normalizedLang = language.toLowerCase().trim();
    
    const langMap: Record<string, string> = {
      'pt-br': 'PT-BR',
      'pt': 'PT-BR',
      'portuguese': 'PT-BR',
      'brazilian': 'PT-BR',
      'dublado': 'PT-BR',
      
      'en': 'EN',
      'english': 'EN',
      'eng': 'EN',
      'legendado': 'EN',
      
      'dual': 'Dual',
      'dual audio': 'Dual',
      'dualaudio': 'Dual',
      'pt-br,en': 'Dual',
      'pt-br,en-us': 'Dual',
      'portuguese,english': 'Dual',
      'dublado,legendado': 'Dual',
      
      'multi': 'Multi',
      'multilanguage': 'Multi',
      'pt-br,en-us,ja-jp': 'Multi',
      'portuguese,english,japanese': 'Multi',
      
      'es': 'ES',
      'spanish': 'ES',
      'esp': 'ES',
      
      'fr': 'FR',
      'french': 'FR'
    };
    
    if (langMap[normalizedLang]) {
      return langMap[normalizedLang];
    }
    
    for (const [key, value] of Object.entries(langMap)) {
      if (normalizedLang.includes(key)) {
        return value;
      }
    }
    
    return language.toUpperCase();
  }

  // Gera URL para resolve lazy - VERSÃO 1.3.3: Inclui qualidade na URL
  private generateLazyResolveUrl(
    magnet: string, 
    apiKey: string,
    quality: string,
    type?: 'movie' | 'series',
    season?: number,
    episode?: number
  ): string {
    const encodedMagnet = Buffer.from(magnet).toString('base64');
    const domain = process.env.RAILWAY_STATIC_URL || "localhost:7000";
    const protocol = process.env.RAILWAY_STATIC_URL ? "https" : "http";
    
    // VERSÃO 1.3.3: QUALIDADE INCLUÍDA NA URL
    let url = `${protocol}://${domain}/resolve/${encodedMagnet}?apiKey=${encodeURIComponent(apiKey)}&quality=${encodeURIComponent(quality)}`;
    
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

  // Sanitiza nome de arquivo
  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  // Construtor de URL resolve público - ATUALIZADO para v1.3.3
  buildResolveUrl(
    magnet: string,
    apiKey: string,
    quality: string,
    type: 'movie' | 'series',
    season?: number,
    episode?: number
  ): string {
    return this.generateLazyResolveUrl(magnet, apiKey, quality, type, season, episode);
  }

  // Informações do formatter - ATUALIZADO para v1.3.3
  getStats() {
    return {
      versão: '1.3.3',
      feature: 'Streams separados por qualidade',
      fix: 'URLs únicas por qualidade (resolve deduplicação)',
      formato: [
        'Linha 1: Título COMPLETO do torrent',
        'Linha 2: 🔗 seeds | 💾 tamanho | 🌐 idioma | 📺 episódio',
        'Linha 3: 📦🎬👥🎞️🔧🚀⏳ (max 3)'
      ],
      ordenação: '2160p(100) > 1080p(80) > 720p(60) > HD(40) > SD(20)',
      melhorias: [
        'Cria stream SEPARADO para cada qualidade encontrada',
        'Detecta padrões como 720p/1080p, 720p e 1080p, 720p ou 1080p',
        'Usuário escolhe qualidade desejada',
        'BehaviorHint streamQuality marca qualidade de cada stream',
        'URL de resolve INCLUI qualidade (evita deduplicação)',
        'Mesma magnet, diferentes URLs por qualidade'
      ]
    };
  }
}