import { Stream, StreamRequest } from '../types/index.js';
import { analisarMagnet, gerarUrlResolve } from '../magnet/magnetHelper.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { Logger } from '../utils/logger.js';
import { MetadataExtractor } from '../titulos/MetadataExtractor.js';
import { EnhancedSeriesMetadata } from '../titulos/interfaces.js';

export class StreamFormatter {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;
  private readonly metadataExtractor: MetadataExtractor;

  private static instance: StreamFormatter;

  public static getInstance(): StreamFormatter {
    if (!StreamFormatter.instance) {
      StreamFormatter.instance = new StreamFormatter();
    }
    return StreamFormatter.instance;
  }

  constructor() {
    this.logger = new Logger('StreamFormatter');
    this.qualityDetector = QualityDetector.getInstance();
    this.metadataExtractor = MetadataExtractor.getInstance();
    // Versionamento Semântico v2.0.0 - MAJOR: Formato de título corrigido igual Torrentio
    this.logger.debug('StreamFormatter ready'); // versão silenciosa
  }

  // Formato Torrentio-style com nossos emojis (identidade Brasil RD)
  // Linha 1: titulo completo do torrent
  // Linha 2: 🔗 seeds 💾 tamanho ⚙️ tracker (sem |, igual Torrentio)
  // Linha 3: 🌐 idioma + metadados + ⏳/🚀
  private formatTitleCorreto(
    torrentTitle: string,
    seeds?: number,
    size?: string,
    language?: string,
    tracker?: string,
    metadata?: EnhancedSeriesMetadata,
    isDirect: boolean = false
  ): string {
    // PRIMEIRA LINHA: Titulo canonico do magnet (dn do parse-torrent)
    // Nao precisa de regex de strip — o nome canonico ja eh limpo
    let result = torrentTitle.trim();
    
    // SEGUNDA LINHA: seeds, tamanho, tracker (estilo Torrentio, sem |)
    let segundaLinha = '';
    
    // 🔗 seeds
    if (seeds !== undefined && seeds > 0) {
      segundaLinha += `🔗 ${seeds}`;
    } else {
      segundaLinha += `🔗 0`;
    }
    
    // 💾 tamanho
    if (size) {
      segundaLinha += ` 💾 ${size}`;
    }
    
    // ⚙️ tracker
    if (tracker) {
      segundaLinha += ` ⚙️ ${tracker}`;
    }
    
    if (segundaLinha) {
      result += '\n' + segundaLinha;
    }
    
    // TERCEIRA LINHA: 🌐 idioma
    const terceiraParts: string[] = [];
    
    // 🌐 idioma na terceira linha
    const idiomaFormatado = this.formatarIdioma(language || 'PT-BR');
    terceiraParts.push(`🌐 ${idiomaFormatado}`);
    
    if (terceiraParts.length > 0) {
      result += '\n' + terceiraParts.join(' ');
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
  async criarStreamDireto(
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
  ): Promise<Stream> {
    /* DEBUG SILENCIOSO
    this.logger.debug('CRIANDO_STREAM_DIRETO', { 
      qualidade: qualidade, 
      tipo: tipo, 
      temporada: temporada, 
      episodio: episodio 
    });
    */

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
      'Torbox', // Tracker fixo para stream direto
      metadata,
      true // isDirect
    );

    // Stream no formato Stremio
    const stream: Stream = {
      name: `Brasil RD\n${qualidade}`,
      title: tituloFinal, // Título com 2-3 linhas e \n
      infoHash: (await analisarMagnet(linkDireto))?.infoHash || undefined,
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
        preferredAudioLanguage: 'por',
        ...behaviorHints
      };
    }

    /* DEBUG SILENCIOSO
    this.logger.debug('STREAM_DIRETO_CRIADO', {
      titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      formato: 'torrentio_com_titulo_correto'
    });
    */

    return stream;
  }

  // Stream lazy (magnet) - FORMATO CORRIGIDO
  async criarStreamLazy(
    torrentTitle: string, // Título COMPLETO do torrent
    descricao: string,
    magnet: string,
    apiKey: string,
    provider: string,
    qualidade: string,
    tipo?: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    behaviorHints?: any,
    metadata?: EnhancedSeriesMetadata,
    fileIdx?: number
  ): Promise<Stream> {
    /* DEBUG SILENCIOSO
    this.logger.debug('CRIANDO_STREAM_LAZY', { 
      qualidade: qualidade, 
      tipo: tipo, 
      temporada: temporada, 
      episodio: episodio 
    });
    */

    const dadosMagnet = await analisarMagnet(magnet);
    const magnetHash = dadosMagnet?.infoHash;
    
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
      provider,       // FONTE DO SCRAPER (Comando, BLUDV, TorrentIndexer...)
      metadata,
      false // isDirect
    );

    // Gera URL de resolve
    let resolveUrl = '';
    try {
      const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
      resolveUrl = await gerarUrlResolve(
        magnet,
        apiKey,
        filename,
        fileIdx || 0,
        tipo,
        temporada,
        episodio,
        qualidade,
        magnetHash // evita re-parse — já temos do analisarMagnet acima
      );
      
      /* DEBUG SILENCIOSO
      this.logger.debug('URL_LAZY_GERADA', {
        formato: 'torrentio_rd',
        url_preview: resolveUrl.substring(0, 100),
        filename: filename,
        fileIdx: fileIdx || 0
      });
      */
    } catch (error) {
      this.logger.error('ERRO_GERAR_URL_LAZY', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }

    // Stream lazy resolve — infoHash só se NÃO tiver URL (evita P2P no Stremio Web)
    const stream: Stream = {
      name: `Brasil RD\n${qualidade}`,
      title: tituloFinal,
      fileIdx: fileIdx !== undefined ? fileIdx : 0
    };

    if (resolveUrl) {
      stream.url = resolveUrl;
    } else {
      stream.infoHash = magnetHash || undefined;
    }

    // Adiciona behaviorHints se fornecido
    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
        filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
        streamQuality: qualidade,
        preferredAudioLanguage: 'por',
        ...behaviorHints
      };
    }

    // Adiciona metadata de pacote se for o caso
    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    /* DEBUG SILENCIOSO
    this.logger.debug('STREAM_LAZY_CRIADO', {
      titulo: tituloFinal.substring(0, 80).replace(/\n/g, '\\n'),
      infoHash: stream.infoHash ? 'sim' : 'nao',
      fileIdx: stream.fileIdx,
      tem_url: !!stream.url,
      fonte: provider,
      formato: 'torrentio_com_titulo_correto_e_url'
    });
    */

    return stream;
  }

  // Extrai idioma da descrição
  private extrairIdiomaDaDescricao(descricao: string): string {
    const padroesIdioma = [
      /\b(PT-BR|Dual|EN|Multi|ES|FR)\b/i,
      /\b(portuguese|english|spanish|french)\b/i,
      /\b(dublado|legendado|subtitled)\b/i
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
  async criarStreamsMultiplasQualidades(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    tipo: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream[]> {
    // NOME CANÔNICO do parse-torrent (dn) como fonte principal; scraper title só como fallback
    const tituloFonte = torrent.canonicalName || torrent.title;
    const todasQualidades = this.extrairTodasQualidades(tituloFonte);
    
    /* DEBUG SILENCIOSO
    this.logger.debug('PROCESSANDO_MULTIPLAS_QUALIDADES', {
      titulo_torrent: tituloFonte.substring(0, 80),
      qualidades_encontradas: todasQualidades.length,
      tipo: tipo,
      temporada: temporada,
      episodio: episodio
    });
    */

    // Se não encontrou qualidades, usa detector padrão
    if (todasQualidades.length === 0) {
      const qualidadePadrao = this.qualityDetector.extractBestQuality(tituloFonte);
      if (qualidadePadrao && qualidadePadrao !== 'unknown') {
        todasQualidades.push(qualidadePadrao);
      } else {
        todasQualidades.push('HD');
      }
    }

    const streams: Stream[] = [];
    const metadata = this.metadataExtractor.extractEnhancedMetadata(tituloFonte);
    const tagEpisodio = tipo === 'series' && temporada && episodio 
      ? `S${temporada.toString().padStart(2, '0')}E${episodio.toString().padStart(2, '0')}`
      : '';

    // Cria stream SEPARADO para cada qualidade
    for (const qualidade of todasQualidades) {
      // DESCRIÇÃO base com seeds, tamanho e idioma
      const descricaoBase = `${tituloFonte}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
      
      // NOME do stream com qualidade específica
      const nomeStream = `Brasil RD (${qualidade})`;
      
      // TÍTULO COMPLETO do torrent (não modificado)
      const tituloCompletoTorrent = tituloFonte;
      
      if (disponivelNoRD && linkDireto) {
        // Stream direto do Real-Debrid
        streams.push(await this.criarStreamDireto(
          tituloCompletoTorrent, // TÍTULO COMPLETO DO TORRENT
          descricaoBase,
          linkDireto,
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(`${tituloFonte} ${tagEpisodio}`)
          },
          metadata,
          fileIdx
        ));
      } else {
        // Stream lazy com magnet
        streams.push(await this.criarStreamLazy(
          tituloCompletoTorrent, // TÍTULO COMPLETO DO TORRENT
          descricaoBase,
          torrent.magnet,
          request.apiKey!,
          torrent.provider || 'Torrent',  // fonte do scraper
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(`${tituloFonte} ${tagEpisodio}`)
          },
          metadata,
          fileIdx
        ));
      }
      
      /* DEBUG SILENCIOSO
      this.logger.debug('QUALIDADE_STREAM_CRIADA', {
        qualidade: qualidade,
        tipo: tipo,
        temporada: temporada,
        episodio: episodio,
        tem_link_direto: !!(disponivelNoRD && linkDireto),
        formato: 'torrentio_corrigido'
      });
      */
    }

    /* DEBUG SILENCIOSO
    this.logger.info('STREAMS_CRIADOS_COM_SUCESSO', {
      total: streams.length,
      qualidades: todasQualidades,
      torrent: tituloFonte.substring(0, 60),
      streams_com_url: streams.filter(s => s.url).length,
      streams_sem_url: streams.filter(s => !s.url).length,
      versao: '2.0.0',
      formato: 'torrentio_corrigido_com_url'
    });
    */

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
  async criarStreamSerie(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    temporada: number,
    episodio: number,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    const qualidades = this.extrairTodasQualidades(torrent.title);
    const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
    
    return await this.criarStreamLazy(
      torrent.title, // Título COMPLETO do torrent
      descricaoBase,
      torrent.magnet,
      request.apiKey!,
      torrent.provider || 'Torrent',
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

  async criarStreamFilme(
    torrent: any,
    request: StreamRequest,
    linkDireto: string | null,
    disponivelNoRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    const qualidades = this.extrairTodasQualidades(torrent.title);
    const qualidade = qualidades.length > 0 ? qualidades[0] : this.qualityDetector.extractBestQuality(torrent.title);
    
    const descricaoBase = `${torrent.title}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
    
    return await this.criarStreamLazy(
      torrent.title, // Título COMPLETO do torrent
      descricaoBase,
      torrent.magnet,
      request.apiKey!,
      torrent.provider || 'Torrent',
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

  // Ordena streams por qualidade → seeders (dentro da mesma qualidade)
  // 4K com 10 seeds > 4K com 5 seeds > 4K com 0 seeds > 1080p com 10 seeds > ...
  ordenarStreamsPorQualidade(streams: Stream[]): Stream[] {
    // Tier de qualidade: quanto maior, melhor (espaçamento de 1000 permite sub-ordenação)
    const tierQualidade = (q: string): number => {
      const ql = q.toLowerCase();
      if (ql.includes('2160p') || ql.includes('4k') || ql.includes('uhd')) return 5000;
      if (ql.includes('1080p') || ql.includes('fullhd') || ql.includes('full hd')) return 4000;
      if (ql.includes('720p')) return 3000;
      if (ql.includes('hd')) return 2000;
      if (ql.includes('480p') || ql.includes('sd')) return 1000;
      return 0;
    };

    // Detecta qualidade REAL do stream (título + behaviorHints)
    const detectarQualidade = (s: Stream): string => {
      // behaviorHints é a fonte mais confiável
      const bh = s.behaviorHints?.streamQuality;
      if (bh && tierQualidade(bh) > 0) return bh;
      // Fallback: extrai do título
      const doTitulo = this.qualityDetector.extractBestQuality(s.title || '');
      if (doTitulo && tierQualidade(doTitulo) > 0) return doTitulo;
      // Último fallback: procura padrão NNNNp no título
      const match = (s.title || '').match(/(\d{3,4})p/i);
      return match ? match[0] : '';
    };

    // Extrai seeders — tenta 🔗 pattern, fallback pra regex genérico
    const extrairSeeds = (s: Stream): number => {
      const t = s.title || '';
      // Formato novo: "🔗 42 seeds"
      const m1 = t.match(/🔗\s*(\d+)/);
      if (m1) return parseInt(m1[1]);
      // Formato antigo: "42 seeds" solto
      const m2 = t.match(/(\d+)\s*seeds?/i);
      if (m2) return parseInt(m2[1]);
      return 0;
    };

    return streams.sort((a, b) => {
      const qualA = detectarQualidade(a);
      const qualB = detectarQualidade(b);
      const tierA = tierQualidade(qualA);
      const tierB = tierQualidade(qualB);

      // 1. Qualidade primeiro (tiers distantes)
      if (tierA !== tierB) return tierB - tierA;

      // 2. Mesma qualidade: seeders (mais seeds primeiro)
      const seedsA = extrairSeeds(a);
      const seedsB = extrairSeeds(b);
      if (seedsA !== seedsB) return seedsB - seedsA;

      // 3. Mesmos seeders: tamanho (maior primeiro)
      const sizeA = this.extrairTamanhoDoTitulo(a.title);
      const sizeB = this.extrairTamanhoDoTitulo(b.title);
      if (sizeA !== sizeB) return sizeB - sizeA;

      return (a.title || '').localeCompare(b.title || '');
    });
  }

  // Extrai tamanho em GB da linha 2 do titulo (formato: "💾 4.31 GB ...")
  private extrairTamanhoDoTitulo(title?: string): number {
    if (!title) return 0;
    const lines = title.split('\n');
    if (lines.length >= 2) {
      const match = lines[1].match(/💾\s*([\d.]+)\s*(GB|MB)/i);
      if (match) {
        const value = parseFloat(match[1]);
        return match[2].toUpperCase() === 'MB' ? value / 1024 : value;
      }
    }
    return 0;
  }

  // Sanitiza nome de arquivo
  private sanitizarNomeArquivo(nomeArquivo: string): string {
    return nomeArquivo
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  // Método público mantendo compatibilidade (usa o novo formato internamente)
  async createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream[]> {
    return await this.criarStreamsMultiplasQualidades(
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
  async createSeriesStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    season: number,
    episode: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    return await this.criarStreamSerie(
      torrent,
      request,
      directLink,
      season,
      episode,
      isAvailableOnRD,
      fileIdx
    );
  }

  async createMovieStream(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    isAvailableOnRD: boolean = false,
    fileIdx?: number
  ): Promise<Stream> {
    return await this.criarStreamFilme(
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
      versao: '2.1.0',
      feature: 'Formato Torrentio-style com identidade Brasil RD',
      linha1: 'Titulo completo do torrent',
      linha2: '🔗 seeds 💾 tamanho ⚙️ tracker (sem |, estilo Torrentio)',
      linha3: '🌐 idioma + metadados + ⏳/🚀 status',
      name: 'Brasil RD\\n{qualidade} (como Torrentio)',
      emojis_originais: '🔗 💾 ⚙️ 🌐 ⏳ 🚀',
      compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100%'
    };
  }
}