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
    // Versionamento Semântico v2.0.0 - MAJOR: Formato de título corrigido igual Torrentio
    this.logger.info('StreamFormatter v2.0.0 inicializado - Título usa formato Torrentio com emojis originais');
  }

  // Formato corrigido: Primeira linha = título completo do torrent (igual Torrentio RD)
  // Segunda linha = nossos emojis originais
  private formatTitleCorreto(
    torrentTitle: string, // Título COMPLETO do torrent (não modificado)
    seeds?: number,
    size?: string,
    language?: string,
    tracker?: string,
    metadata?: EnhancedSeriesMetadata,
    isDirect: boolean = false
  ): string {
    // PRIMEIRA LINHA: Título completo do torrent (igual Torrentio RD faz)
    // Mantém EXATAMENTE como o torrent se chama
    let result = torrentTitle.trim();
    
    // SEGUNDA LINHA: Nossos emojis originais (mantidos)
    let segundaLinha = '';
    
    // 🔗 seeds (nosso emoji oficial)
    if (seeds !== undefined && seeds > 0) {
      segundaLinha += `🔗 ${seeds}`;
    } else {
      segundaLinha += `🔗 0`;
    }
    
    // 💾 tamanho (nosso emoji oficial)
    if (size) {
      segundaLinha += ` | 💾 ${size}`;
    }
    
    // 🌐 idioma (nosso emoji oficial)
    const idiomaFormatado = this.formatarIdioma(language || 'PT-BR');
    segundaLinha += ` | 🌐 ${idiomaFormatado}`;
    
    // ⚙️ tracker (nosso emoji oficial)
    if (tracker) {
      segundaLinha += ` | ⚙️ ${tracker}`;
    }
    
    // Adiciona segunda linha com \n
    if (segundaLinha) {
      result += '\n' + segundaLinha;
    }
    
    // TERCEIRA LINHA: Metadados especiais (máximo 3 emojis, nossos originais)
    let terceiraLinha = '';
    const emojisMetadados: string[] = [];
    
    if (metadata) {
      if (metadata.isCompleteSeason) {
        emojisMetadados.push('📦'); // Pacote completo
      }
      if (metadata.isPackage) {
        emojisMetadados.push('🎬'); // Pacote de episódios
      }
      if (metadata.hasMultiEpisode) {
        emojisMetadados.push('👥'); // Múltiplos episódios
      }
      if (metadata.source && metadata.source !== 'unknown') {
        emojisMetadados.push('🎞️'); // Fonte (BluRay, WEB-DL, etc)
      }
      if (metadata.codec && metadata.codec !== 'unknown') {
        emojisMetadados.push('🔧'); // Codec (H264, H265, etc)
      }
    }
    
    if (isDirect) {
      emojisMetadados.push('🚀'); // Stream direto do Real-Debrid
    } else {
      emojisMetadados.push('⏳'); // Stream lazy (aguardando)
    }
    
    // Limita a 3 emojis como fazemos normalmente
    const emojisLimitados = emojisMetadados.slice(0, 3);
    terceiraLinha = emojisLimitados.join(' ');
    
    // Adiciona terceira linha com \n
    if (terceiraLinha) {
      result += '\n' + terceiraLinha;
    }
    
    return result;
  }

  // Formata idioma mantendo nossos padrões
  private formatarIdioma(idioma: string): string {
    if (!idioma) return 'PT-BR';
    
    const idiomaNormalizado = idioma.toLowerCase().trim();
    
    const mapaIdiomas: Record<string, string> = {
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
    
    if (mapaIdiomas[idiomaNormalizado]) {
      return mapaIdiomas[idiomaNormalizado];
    }
    
    for (const [chave, valor] of Object.entries(mapaIdiomas)) {
      if (idiomaNormalizado.includes(chave)) {
        return valor;
      }
    }
    
    return idioma.toUpperCase();
  }

  // Extrai tracker do magnet (mantido)
  private extrairTracker(magnet: string): string {
    if (!magnet) return 'Torrent';
    
    if (magnet.includes('thepiratebay')) return 'ThePirateBay';
    if (magnet.includes('1337x')) return '1337x';
    if (magnet.includes('rarbg')) return 'RARBG';
    if (magnet.includes('torrentgalaxy')) return 'TorrentGalaxy';
    if (magnet.includes('magnetdl')) return 'MagnetDL';
    
    return 'Torrent';
  }

  // Stream direto do Real-Debrid - FORMATO CORRIGIDO
  criarStreamDireto(
    torrentTitle: string, // Título COMPLETO do torrent
    descricao: string,
    linkDireto: string,
    qualidade: string,
    tipo?: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number
  ): Stream {
    this.logger.debug('CRIANDO_STREAM_DIRETO', { 
      qualidade: qualidade, 
      tipo: tipo, 
      temporada: temporada, 
      episodio: episodio 
    });

    // Extrai informações da descrição para usar nos emojis
    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);
    
    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
    
    // Formata título NO FORMATO CORRETO: linha1=título torrent, linha2=nossos emojis
    const tituloFinal = this.formatTitleCorreto(
      torrentTitle, // Título COMPLETO do torrent (não modificado)
      seeds,
      tamanho,
      idiomaDaDescricao,
      'RealDebrid', // Tracker fixo para stream direto
      metadata,
      true // isDirect
    );

    // Stream no formato Stremio
    const stream: Stream = {
      title: tituloFinal, // Título com 2-3 linhas e \n
      infoHash: extractHashFromMagnet(linkDireto) || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0,
      url: linkDireto
    };

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
        filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
        streamQuality: qualidade,
        ...behaviorHints
      };
    }

    this.logger.debug('STREAM_DIRETO_CRIADO', {
      titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      formato: 'torrentio_com_titulo_correto'
    });

    return stream;
  }

  // Stream lazy (magnet) - FORMATO CORRIGIDO
  criarStreamLazy(
    torrentTitle: string, // Título COMPLETO do torrent
    descricao: string,
    magnet: string,
    apiKey: string,
    qualidade: string,
    tipo?: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number
  ): Stream {
    this.logger.debug('CRIANDO_STREAM_LAZY', { 
      qualidade: qualidade, 
      tipo: tipo, 
      temporada: temporada, 
      episodio: episodio 
    });

    const magnetHash = extractHashFromMagnet(magnet);
    
    // Extrai informações da descrição para usar nos emojis
    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);
    const tracker = this.extrairTracker(magnet);
    
    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;
    
    // Formata título NO FORMATO CORRETO: linha1=título torrent, linha2=nossos emojis
    const tituloFinal = this.formatTitleCorreto(
      torrentTitle, // Título COMPLETO do torrent (não modificado)
      seeds,
      tamanho,
      idiomaDaDescricao,
      tracker,
      metadata,
      false // isDirect
    );

    // Gera URL de resolve
    let resolveUrl = '';
    try {
      const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
      resolveUrl = generateLazyResolveUrl(
        magnet,
        apiKey,
        filename,
        fileIdx || 0,
        tipo,
        temporada,
        episodio
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

    // Stream no formato Stremio
    const stream: Stream = {
      title: tituloFinal,
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
        bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
        filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
        streamQuality: qualidade,
        ...behaviorHints
      };
    }

    // Adiciona metadata de pacote se for o caso
    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    this.logger.debug('STREAM_LAZY_CRIADO', {
      titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      formato: 'torrentio_com_titulo_correto_e_url'
    });

    return stream;
  }

  // Extrai idioma da descrição
  private extrairIdiomaDaDescricao(descricao: string): string {
    const padroesIdioma = [
      /(PT-BR|Dual|EN|Multi|ES|FR)/i,
      /(portuguese|english|spanish|french)/i,
      /(dublado|legendado|subtitled)/i
    ];
    
    for (const padrao of padroesIdioma) {
      const match = descricao.match(padrao);
      if (match) {
        return match[1];
      }
    }
    
    return 'PT-BR';
  }

  // Cria streams separados para cada qualidade - MÉTODO PRINCIPAL CORRIGIDO
  criarStreamsMultiplasQualidades(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    tipo: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Stream[] {
    const todasQualidades = this.extrairTodasQualidades(torrent.title);
    
    this.logger.debug('PROCESSANDO_MULTIPLAS_QUALIDADES', {
      titulo_torrent: torrent.title.substring(0, 80),
      qualidades_encontradas: todasQualidades.length,
      tipo: tipo,
      temporada: temporada,
      episodio: episodio
    });

    // Se não encontrou qualidades, usa detector padrão
    if (todasQualidades.length === 0) {
      const qualidadePadrao = this.qualityDetector.extractBestQuality(torrent.title);
      if (qualidadePadrao && qualidadePadrao !== 'unknown') {
        todasQualidades.push(qualidadePadrao);
      } else {
        todasQualidades.push('HD');
      }
    }

    const streams: Stream[] = [];
    const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
    const tagEpisodio = tipo === 'series' && temporada && episodio 
      ? `S${temporada.toString().padStart(2, '0')}E${episodio.toString().padStart(2, '0')}`
      : '';

    // Cria stream SEPARADO para cada qualidade
    for (const qualidade of todasQualidades) {
      // DESCRIÇÃO base com seeds, tamanho e idioma
      const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
      
      // NOME do stream com qualidade específica
      const nomeStream = `Brasil RD (${qualidade})`;
      
      // TÍTULO COMPLETO do torrent (não modificado)
      const tituloCompletoTorrent = torrent.title;
      
      if (disponivelNoRD && linkDireto) {
        // Stream direto do Real-Debrid
        streams.push(this.criarStreamDireto(
          tituloCompletoTorrent, // TÍTULO COMPLETO DO TORRENT
          descricaoBase,
          linkDireto,
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(`${torrent.title} ${tagEpisodio}`)
          },
          metadata,
          fileIdx
        ));
      } else {
        // Stream lazy com magnet
        streams.push(this.criarStreamLazy(
          tituloCompletoTorrent, // TÍTULO COMPLETO DO TORRENT
          descricaoBase,
          torrent.magnet,
          request.apiKey!,
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(`${torrent.title} ${tagEpisodio}`)
          },
          metadata,
          fileIdx
        ));
      }
      
      this.logger.debug('QUALIDADE_STREAM_CRIADA', {
        qualidade: qualidade,
        tipo: tipo,
        temporada: temporada,
        episodio: episodio,
        tem_link_direto: !!(disponivelNoRD && linkDireto),
        formato: 'torrentio_corrigido'
      });
    }

    this.logger.info('STREAMS_CRIADOS_COM_SUCESSO', {
      total: streams.length,
      qualidades: todasQualidades,
      torrent: torrent.title.substring(0, 60),
      streams_com_url: streams.filter(s => s.url).length,
      streams_sem_url: streams.filter(s => !s.url).length,
      versao: '2.0.0',
      formato: 'torrentio_corrigido_com_url'
    });

    return streams;
  }

  // Extrai todas qualidades de um título
  private extrairTodasQualidades(titulo: string): string[] {
    const padroesQualidade = [
      /\b(2160p|4k|uhd)\b/gi,
      /\b(1080p|fullhd|full hd)\b/gi,
      /\b(720p|hd|high definition)\b/gi,
      /\b(480p|sd|standard definition)\b/gi,
      /\b(360p|low)\b/gi,
      /(\d{3,4}p)\s*\/\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[eE]\s*(\d{3,4}p)/gi,
      /(\d{3,4}p)\s*[ou]\s*(\d{3,4}p)/gi
    ];

    const qualidadesEncontradas: Set<string> = new Set();
    const tituloLower = titulo.toLowerCase();
    
    for (const padrao of padroesQualidade.slice(0, 5)) {
      const matches = tituloLower.match(padrao);
      if (matches) {
        for (const match of matches) {
          const normalizada = this.normalizarQualidade(match);
          if (normalizada) {
            qualidadesEncontradas.add(normalizada);
          }
        }
      }
    }
    
    for (const padrao of padroesQualidade.slice(5)) {
      const matches = tituloLower.match(padrao);
      if (matches) {
        for (const match of matches) {
          const qualityMatches = match.match(/\d{3,4}p/gi);
          if (qualityMatches) {
            for (const qualityMatch of qualityMatches) {
              const normalizada = this.normalizarQualidade(qualityMatch);
              if (normalizada) {
                qualidadesEncontradas.add(normalizada);
              }
            }
          }
        }
      }
    }
    
    const listPattern = /(\d{3,4}p|4k|uhd|hd)(?:\s*,\s*|\s+e\s+|\s+ou\s+)/gi;
    let listMatch;
    while ((listMatch = listPattern.exec(tituloLower)) !== null) {
      const normalizada = this.normalizarQualidade(listMatch[1]);
      if (normalizada) {
        qualidadesEncontradas.add(normalizada);
      }
    }
    
    const resultado = Array.from(qualidadesEncontradas);
    
    if (resultado.length === 0) {
      const qualidadePadrao = this.qualityDetector.extractBestQuality(titulo);
      if (qualidadePadrao && qualidadePadrao !== 'unknown') {
        resultado.push(qualidadePadrao);
      }
    }

    const ordemQualidade = ['2160p', '1080p', '720p', 'HD', 'SD'];
    resultado.sort((a, b) => {
      const indexA = ordemQualidade.indexOf(a);
      const indexB = ordemQualidade.indexOf(b);
      return indexA - indexB;
    });

    return resultado;
  }

  // Normaliza nome da qualidade
  private normalizarQualidade(qualidade: string): string {
    const qualidadeLower = qualidade.toLowerCase();
    
    if (qualidadeLower.includes('4k') || qualidadeLower.includes('2160p') || qualidadeLower.includes('uhd')) {
      return '2160p';
    } else if (qualidadeLower.includes('1080p') || qualidadeLower.includes('fullhd') || qualidadeLower.includes('full hd')) {
      return '1080p';
    } else if (qualidadeLower.includes('720p') || qualidadeLower.includes('hd') || qualidadeLower.includes('high definition')) {
      return '720p';
    } else if (qualidadeLower.includes('480p') || qualidadeLower.includes('sd') || qualidadeLower.includes('standard definition')) {
      return 'SD';
    } else if (qualidadeLower.includes('360p') || qualidadeLower.includes('low')) {
      return 'SD';
    } else if (qualidadeLower.includes('hd')) {
      return 'HD';
    }
    
    if (qualidadeLower.match(/\d{3,4}p/)) {
      return qualidadeLower;
    }
    
    return '';
  }

  // Métodos de compatibilidade (mantidos)
  criarStreamSerie(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    temporada: number,
    episodio: number,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Stream {
    const qualidades = this.extrairTodasQualidades(torrent.title);
    const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
    
    return this.criarStreamLazy(
      torrent.title, // Título COMPLETO do torrent
      descricaoBase,
      torrent.magnet,
      request.apiKey!,
      qualidade,
      'series',
      temporada,
      episodio,
      {
        bingeGroup: `br-${request.id}-${qualidade}`,
        filename: this.sanitizarNomeArquivo(torrent.title)
      },
      undefined,
      fileIdx
    );
  }

  criarStreamFilme(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Stream {
    const qualidades = this.extrairTodasQualidades(torrent.title);
    const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
    
    return this.criarStreamLazy(
      torrent.title, // Título COMPLETO do torrent
      descricaoBase,
      torrent.magnet,
      request.apiKey!,
      qualidade,
      'movie',
      undefined,
      undefined,
      {
        bingeGroup: `br-${request.id}-${qualidade}`,
        filename: this.sanitizarNomeArquivo(torrent.title)
      },
      undefined,
      fileIdx
    );
  }

  // Ordena streams por qualidade
  ordenarStreamsPorQualidade(streams: Stream[]): Stream[] {
    const prioridadeQualidade: Record<string, number> = {
      '2160p': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };

    return streams.sort((a, b) => {
      const scoreA = this.calcularScoreQualidade(a.title || '');
      const scoreB = this.calcularScoreQualidade(b.title || '');
      
      if (scoreB !== scoreA) {
        return scoreB - scoreA;
      }
      
      return (a.title || '').localeCompare(b.title || '');
    });
  }

  // Calcula score de qualidade
  private calcularScoreQualidade(nome: string | undefined): number {
    if (!nome) return 0;
    
    const qualidade = this.qualityDetector.extractBestQuality(nome);
    const prioridadeQualidade: Record<string, number> = {
      '2160p': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };
    
    return prioridadeQualidade[qualidade] || 0;
  }

  // Sanitiza nome de arquivo
  private sanitizarNomeArquivo(nomeArquivo: string): string {
    return nomeArquivo
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  // Método público mantendo compatibilidade (usa o novo formato internamente)
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
    return this.criarStreamsMultiplasQualidades(
      torrent,
      request,
      directLink,
      type,
      season,
      episode,
      isAvailableOnRD,
      fileIdx
    );
  }

  // Métodos públicos mantidos para compatibilidade
  createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Stream {
    return this.criarStreamSerie(
      torrent,
      request,
      directLink,
      season,
      episode,
      isAvailableOnRD,
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
    return this.criarStreamFilme(
      torrent,
      request,
      directLink,
      isAvailableOnRD,
      fileIdx
    );
  }

  sortStreamsByQuality(streams: Stream[]): Stream[] {
    return this.ordenarStreamsPorQualidade(streams);
  }

  // Informações do formatter atualizado
  getStats() {
    return {
      versao: '2.0.0',
      feature: 'Formato de título corrigido igual Torrentio RD',
      linha1: 'Título COMPLETO do torrent (igual Torrentio RD)',
      linha2: '🔗 seeds | 💾 tamanho | 🌐 idioma | ⚙️ tracker (nossos emojis)',
      linha3: '📦 🎬 👥 🎞️ 🔧 🚀 ⏳ (máximo 3 emojis)',
      emojis_originais: '🔗 💾 🌐 ⚙️ 📦 🎬 👥 🎞️ 🔧 🚀 ⏳',
      compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100%',
      correcao: 'Título agora usa formato igual Torrentio RD'
    };
  }
}