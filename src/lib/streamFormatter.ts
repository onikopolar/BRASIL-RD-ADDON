import { Stream, StreamRequest } from '../types/index';
import { extractHashFromMagnet, generateLazyResolveUrl } from '../lib/magnetHelper';
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
    // Versionamento Semantico v1.6.0 - FIX: URL em streams lazy
    this.logger.info('StreamFormatter v1.6.0 inicializado - Fix URL streams lazy Torrentio RD');
  }

  // Formato Torrentio: 3 linhas com \n 
  private formatTorrentioStyleTitle(
    baseTitle: string,
    metadata?: EnhancedSeriesMetadata,
    isDirect: boolean = false,
    seeds?: number,
    size?: string,
    language?: string,
    tracker?: string
  ): string {
    // Linha 1: Titulo principal (igual Torrentio)
    let result = baseTitle;
    
    // Linha 2: Informacoes 
    let line2 = '';
    
    // 🔗 seeds (nosso emoji)
    if (seeds !== undefined && seeds > 0) {
      line2 += `🔗 ${seeds}`;
    } else {
      line2 += `🔗 0`;
    }
    
    // 💾 tamanho (nosso emoji)
    if (size) {
      line2 += ` | 💾 ${size}`;
    }
    
    // 🌐 idioma (nosso emoji) 
    const formattedLanguage = this.formatLanguage(language || 'PT-BR');
    line2 += ` | 🌐 ${formattedLanguage}`;
    
    // ⚙️ tracker (igual Torrentio) 
    if (tracker) {
      line2 += ` | ⚙️ ${tracker}`;
    }
    
    // Adiciona linha 2 com \n
    if (line2) {
      result += '\n' + line2;
    }
    
    // Linha 3: Metadata (max 3)
    let line3 = '';
    const metadataItems: string[] = [];
    
    if (metadata) {
      if (metadata.isCompleteSeason) {
        metadataItems.push('📦');
      }
      if (metadata.isPackage) {
        metadataItems.push('🎬'); 
      }
      if (metadata.hasMultiEpisode) {
        metadataItems.push('👥'); 
      }
      if (metadata.source && metadata.source !== 'unknown') {
        metadataItems.push(`🎞️`); 
      }
      if (metadata.codec && metadata.codec !== 'unknown') {
        metadataItems.push(`🔧`); 
      }
    }
    
    if (isDirect) {
      metadataItems.push('🚀'); 
    } else {
      metadataItems.push('⏳'); 
    }
    
    // Limita a 3 itens como Torrentio faz
    const limitedItems = metadataItems.slice(0, 3);
    line3 = limitedItems.join(' ');
    
    // Adiciona linha 3 com \n
    if (line3) {
      result += '\n' + line3;
    }
    
    return result;
  }

  // Formata idioma (mantido)
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

  // Extrai tracker do magnet (simples)
  private extractTracker(magnet: string): string {
    if (!magnet) return 'Magnet';
    
    // Tenta extrair tracker comum
    if (magnet.includes('thepiratebay')) return 'ThePirateBay';
    if (magnet.includes('1337x')) return '1337x';
    if (magnet.includes('rarbg')) return 'RARBG';
    if (magnet.includes('torrentgalaxy')) return 'TorrentGalaxy';
    if (magnet.includes('magnetdl')) return 'MagnetDL';
    
    return 'Torrent';
  }

  // Stream direto do Real-Debrid (FORMATO TORRENTIO)
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
    fileIdx?: number
  ): Stream {
    this.logger.debug('CRIANDO_STREAM_DIRETO', { 
      qualidade: quality, 
      tipo: type, 
      temporada: season, 
      episodio: episode
    });

    // Formata titulo com episodio para series
    let finalTitle = title;
    
    if (type === 'series' && season !== undefined && episode !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      const episodeStr = episode.toString().padStart(2, '0');
      const episodeTag = ` S${seasonStr}E${episodeStr}`;
      
      if (!title.includes('S') && !title.includes('E')) {
        finalTitle = title + episodeTag;
      }
    }

    // Extrai informacoes da descricao
    const seedsMatch = description.match(/(\d+)\s*seeds?/i);
    const sizeMatch = description.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const languageFromDesc = this.extractLanguageFromDescription(description);
    
    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
    
    // Formata no estilo Torrentio
    finalTitle = this.formatTorrentioStyleTitle(
      finalTitle,
      metadata,
      true, // isDirect
      seeds,
      size,
      languageFromDesc,
      'RealDebrid' // Tracker fixo para direto
    );

    // Formato CORRETO para Stremio Web (igual Torrentio)
    const stream: Stream = {
      title: finalTitle, // COM \n como Torrentio
      infoHash: extractHashFromMagnet(directLink) || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0,
      url: directLink // URL ja é direto
    };

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle.split('\n')[0]), // Pega primeira linha
        streamQuality: quality,
        ...behaviorHints
      };
    }

    this.logger.debug('STREAM_DIRETO_CRIADO', {
      titulo: finalTitle.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      formato: 'torrentio_style'
    });

    return stream;
  }

  // Stream lazy (magnet) - FORMATO TORRENTIO COM URL DE RESOLVE
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
    fileIdx?: number
  ): Stream {
    this.logger.debug('CRIANDO_STREAM_LAZY', { 
      qualidade: quality, 
      tipo: type, 
      temporada: season, 
      episodio: episode
    });

    const magnetHash = extractHashFromMagnet(magnet);
    
    // Formata titulo com episodio para series
    let finalTitle = title;
    
    if (type === 'series' && season !== undefined && episode !== undefined) {
      const seasonStr = season.toString().padStart(2, '0');
      const episodeStr = episode.toString().padStart(2, '0');
      const episodeTag = ` S${seasonStr}E${episodeStr}`;
      
      if (!title.includes('S') && !title.includes('E')) {
        finalTitle = title + episodeTag;
      }
    }

    // Extrai informacoes da descricao
    const seedsMatch = description.match(/(\d+)\s*seeds?/i);
    const sizeMatch = description.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const languageFromDesc = this.extractLanguageFromDescription(description);
    const tracker = this.extractTracker(magnet);
    
    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const size = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
    
    // Formata no estilo Torrentio 
    finalTitle = this.formatTorrentioStyleTitle(
      finalTitle,
      metadata,
      false, // isDirect
      seeds,
      size,
      languageFromDesc,
      tracker
    );

    // Gera URL de resolve no formato Torrentio
    let resolveUrl = '';
    try {
      const filename = this.sanitizeFilename(finalTitle.split('\n')[0] + '.mkv');
      resolveUrl = generateLazyResolveUrl(
        magnet,
        apiKey,
        filename,
        fileIdx || 0,
        type,
        season,
        episode
      );
      
      this.logger.debug('URL_LAZY_GERADA', {
        formato: 'torrentio_rd',
        url_preview: resolveUrl.substring(0, 100),
        filename: filename,
        fileIdx: fileIdx || 0
      });
    } catch (error) {
      this.logger.error('ERRO_GERAR_URL_LAZY', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }

    // FORMATO CORRETO para Stremio Web/Desktop (igual Torrentio)
    const stream: Stream = {
      title: finalTitle, // COM \n como Torrentio
      infoHash: magnetHash || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0
    };

    // Adiciona URL se foi gerada com sucesso
    if (resolveUrl) {
      stream.url = resolveUrl;
    }

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${type || 'movie'}-${quality}`,
        filename: this.sanitizeFilename(finalTitle.split('\n')[0]), // Pega primeira linha
        streamQuality: quality,
        ...behaviorHints
      };
    }

    // Adiciona metadata especifica se for pacote
    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    this.logger.debug('STREAM_LAZY_CRIADO', {
      titulo: finalTitle.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      formato: 'torrentio_style_com_url'
    });

    return stream;
  }

  // Extrai idioma da descricao
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

  // Cria streams separados para cada qualidade
  createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Stream[] {
    const allQualities = this.extractAllQualities(torrent.title);
    
    this.logger.debug('PROCESSANDO_MULTIPLAS_QUALIDADES', {
      titulo_torrent: torrent.title.substring(0, 80),
      qualidades_encontradas: allQualities.length,
      tipo: type,
      temporada: season,
      episodio: episode
    });

    // Se nao encontrou qualidades, usa detector padrao
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
      // Titulo base
      const baseTitle = torrent.title;
      
      // Descricao base com seeds, size e language
      const baseDesc = `${baseTitle}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'PT-BR')}`;
      
      // Nome do stream com qualidade especifica
      const streamName = `Brasil RD (${quality})`;
      let streamTitle = streamName;
      
      // Adiciona episodio se for serie
      if (type === 'series' && season !== undefined && episode !== undefined) {
        streamTitle += ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
      }

      if (isAvailableOnRD && directLink) {
        // Stream direto do Real-Debrid
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
          metadata,
          fileIdx
        ));
      } else {
        // Stream lazy com magnet
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
          metadata,
          fileIdx
        ));
      }
      
      this.logger.debug('QUALIDADE_STREAM_CRIADA', {
        qualidade: quality,
        tipo: type,
        temporada: season,
        episodio: episode,
        tem_link_direto: !!(isAvailableOnRD && directLink),
        formato: 'torrentio'
      });
    }

    this.logger.info('STREAMS_CRIADOS_COM_SUCESSO', {
      total: streams.length,
      qualidades: allQualities,
      torrent: torrent.title.substring(0, 60),
      streams_com_url: streams.filter(s => s.url).length,
      streams_sem_url: streams.filter(s => !s.url).length,
      versao: '1.6.0',
      formato: 'torrentio_com_url'
    });

    return streams;
  }

  // Extrai todas qualidades de um titulo (mantido)
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

  // Metodos de compatibilidade (mantidos)
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
    
    const baseDesc = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'PT-BR')}`;
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      baseDesc,
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
    
    const baseDesc = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatLanguage(torrent.language || 'PT-BR')}`;
    
    return this.createLazyStream(
      `Brasil RD (${quality})`,
      `Brasil RD (${quality})`,
      baseDesc,
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

  // Informacoes do formatter atualizado
  getStats() {
    return {
      versao: '1.6.0',
      feature: 'Fix URL streams lazy Torrentio RD',
      formato: 'title com \n (3 linhas) como Torrentio',
      linha1: 'Titulo + episodio',
      linha2: '🔗 seeds | 💾 tamanho | 🌐 idioma | ⚙️ tracker',
      linha3: '📦 🎬 👥 🎞️ 🔧 🚀 ⏳ (max 3 emojis)',
      emojis_nossos: '🔗 💾 🌐 📦 🎬 👥 🎞️ 🔧 🚀 ⏳',
      compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100% (igual Torrentio)',
      fix: 'URL em streams lazy para resolver via Real-Debrid'
    };
  }
}