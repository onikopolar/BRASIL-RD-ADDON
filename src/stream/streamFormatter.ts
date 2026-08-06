// src/stream/streamFormatter.ts – CORREÇÃO: usa quality do torrent, não reextrai
// Sem lógica de fileIdx para packs (não é possível extrair lista de arquivos de magnet puro)

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
    this.logger.debug('StreamFormatter ready');
  }

  private formatTitleCorreto(
    torrentTitle: string,
    seeds?: number,
    size?: string,
    language?: string,
    tracker?: string,
    metadata?: EnhancedSeriesMetadata,
    isDirect: boolean = false
  ): string {
    let result = torrentTitle.trim();

    let segundaLinha = '';

    if (seeds !== undefined && seeds > 0) {
      segundaLinha += `🔗 ${seeds}`;
    } else {
      segundaLinha += `🔗 0`;
    }

    if (size) {
      segundaLinha += ` 💾 ${size}`;
    }

    if (tracker) {
      segundaLinha += ` ⚙️ ${tracker}`;
    }

    if (segundaLinha) {
      result += '\n' + segundaLinha;
    }

    const terceiraParts: string[] = [];
    const idiomaFormatado = this.formatarIdioma(language || 'PT-BR');
    terceiraParts.push(`🌐 ${idiomaFormatado}`);

    if (terceiraParts.length > 0) {
      result += '\n' + terceiraParts.join(' ');
    }

    return result;
  }

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

  private extrairTracker(magnet: string): string {
    if (!magnet) return 'Torrent';

    if (magnet.includes('thepiratebay')) return 'ThePirateBay';
    if (magnet.includes('1337x')) return '1337x';
    if (magnet.includes('rarbg')) return 'RARBG';
    if (magnet.includes('torrentgalaxy')) return 'TorrentGalaxy';
    if (magnet.includes('magnetdl')) return 'MagnetDL';

    return 'Torrent';
  }

  async criarStreamDireto(
    torrentTitle: string,
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
    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);

    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;

    const tituloFinal = this.formatTitleCorreto(
      torrentTitle,
      seeds,
      tamanho,
      idiomaDaDescricao,
      'Torbox',
      metadata,
      true
    );

    const stream: Stream = {
      name: `Brasil RD\n${qualidade}`,
      title: tituloFinal,
      infoHash: (await analisarMagnet(linkDireto))?.infoHash || undefined,
      fileIdx: fileIdx !== undefined ? fileIdx : 0,
      url: linkDireto
    };

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

    return stream;
  }

  // Stream lazy (magnet) - agora sem lógica de seleção de arquivos
  async criarStreamLazy(
    torrentTitle: string,
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
    fileIdx?: number,
    titles?: string[],
    imdbId?: string
  ): Promise<Stream> {
    const dadosMagnet = await analisarMagnet(magnet);
    const magnetHash = dadosMagnet?.infoHash;

    // ═══ EXTRAI QUALIDADE DO MAGNET (dn) ═══
    let qualidadeReal = qualidade;
    if (dadosMagnet?.nome) {
      const qualidadeDoMagnet = this.qualityDetector.extractQualityFromFilename(dadosMagnet.nome);
      if (qualidadeDoMagnet && qualidadeDoMagnet !== 'HD' && qualidadeDoMagnet !== 'Desconhecido') {
        qualidadeReal = qualidadeDoMagnet;
        this.logger.debug(`Qualidade do magnet (${qualidadeDoMagnet}) substitui a qualidade do scraper (${qualidade})`);
      }
    }

    // Usa fileIdx passado ou 0 (não há seleção inteligente)
    const fileIdxFinal = fileIdx ?? 0;

    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);

    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;

    const tituloFinal = this.formatTitleCorreto(
      torrentTitle,
      seeds,
      tamanho,
      idiomaDaDescricao,
      provider,
      metadata,
      false
    );

    let resolveUrl = '';
    try {
      const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
      resolveUrl = await gerarUrlResolve(
        magnet,
        apiKey,
        filename,
        fileIdxFinal,
        tipo,
        temporada,
        episodio,
        qualidadeReal,
        magnetHash,
        titles,
        imdbId
      );
    } catch (error) {
      this.logger.error('ERRO_GERAR_URL_LAZY', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
    }

    const stream: Stream = {
      name: `Brasil RD\n${qualidadeReal}`,
      title: tituloFinal,
      fileIdx: fileIdxFinal
    };

    if (resolveUrl) {
      stream.url = resolveUrl;
    } else {
      stream.infoHash = magnetHash || undefined;
    }

    if (behaviorHints) {
      stream.behaviorHints = {
        notWebReady: false,
        bingeGroup: `br-${tipo || 'movie'}-${qualidadeReal}`,
        filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
        streamQuality: qualidadeReal,
        preferredAudioLanguage: 'por',
        ...behaviorHints
      };
    }

    if (metadata?.isPackage && stream.behaviorHints) {
      (stream.behaviorHints as any).packageContent = true;
    }

    return stream;
  }

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
    fileIdx?: number,
    titles?: string[],
    imdbId?: string
  ): Promise<Stream[]> {
    const tituloFonte = torrent.canonicalName || torrent.title;
    
    // ═══ CORREÇÃO: usa a qualidade já extraída, não reextrai do título ═══
    let qualidades: string[];
    if (torrent.quality && torrent.quality !== 'HD' && torrent.quality !== 'Desconhecido') {
      qualidades = [torrent.quality];
    } else {
      const todas = this.extrairTodasQualidades(tituloFonte);
      qualidades = todas.length > 0 ? todas : ['HD'];
    }

    const streams: Stream[] = [];
    const metadata = this.metadataExtractor.extractEnhancedMetadata(tituloFonte);
    const tagEpisodio = tipo === 'series' && temporada && episodio
      ? `S${temporada.toString().padStart(2, '0')}E${episodio.toString().padStart(2, '0')}`
      : '';

    const imdbIdFinal = imdbId || request.imdbId || this.extrairImdbIdDoRequest(request);

    for (const qualidade of qualidades) {
      const descricaoBase = `${tituloFonte}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
      const tituloCompletoTorrent = tituloFonte;

      // Sempre usa fileIdx passado (ou 0)
      const fileIdxParaStream = fileIdx ?? 0;

      if (disponivelNoRD && linkDireto) {
        streams.push(await this.criarStreamDireto(
          tituloCompletoTorrent,
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
          fileIdxParaStream
        ));
      } else {
        streams.push(await this.criarStreamLazy(
          tituloCompletoTorrent,
          descricaoBase,
          torrent.magnet,
          request.apiKey!,
          torrent.provider || 'Torrent',
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(`${tituloFonte} ${tagEpisodio}`)
          },
          metadata,
          fileIdxParaStream,
          titles,
          imdbIdFinal
        ));
      }
    }

    return streams;
  }

  /**
   * Extrai imdbId do request caso não esteja definido no campo direto.
   * Exemplo: request.id = "tt2861424:9:10" -> "tt2861424"
   */
  private extrairImdbIdDoRequest(request: StreamRequest): string | undefined {
    if (request.imdbId) return request.imdbId;
    const match = request.id?.match(/^(tt\d+)/);
    return match ? match[1] : undefined;
  }

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

    const imdbId = request.imdbId || this.extrairImdbIdDoRequest(request);

    return await this.criarStreamLazy(
      torrent.title,
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
      fileIdx,
      undefined,
      imdbId
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

    const imdbId = request.imdbId || this.extrairImdbIdDoRequest(request);

    return await this.criarStreamLazy(
      torrent.title,
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
      fileIdx,
      undefined,
      imdbId
    );
  }

  ordenarStreamsPorQualidade(streams: Stream[]): Stream[] {
    const tierMap: Record<string, number> = {
      '2160p': 5000, '4k': 5000, 'uhd': 5000,
      '1080p': 4000, 'fullhd': 4000,
      '720p': 3000, 'hd': 2000,
      '480p': 1000, 'sd': 1000
    };

    const getTier = (s: Stream): number => {
      const q = (s.behaviorHints?.streamQuality || '').toLowerCase();
      if (tierMap[q]) return tierMap[q];
      const match = (s.name || '').match(/\b(\d{3,4}p|4k|uhd|hd|sd)\b/i);
      if (match) return tierMap[match[1].toLowerCase()] || 0;
      return 0;
    };

    const extrairSeeds = (s: Stream): number => {
      const t = s.title || '';
      const m1 = t.match(/🔗\s*(\d+)/);
      if (m1) return parseInt(m1[1]);
      const m2 = t.match(/(\d+)\s*seeds?/i);
      if (m2) return parseInt(m2[1]);
      return 0;
    };

    return streams.sort((a, b) => {
      const tierA = getTier(a);
      const tierB = getTier(b);
      if (tierA !== tierB) return tierB - tierA;

      const seedsA = extrairSeeds(a);
      const seedsB = extrairSeeds(b);
      if (seedsA !== seedsB) return seedsB - seedsA;

      const sizeA = this.extrairTamanhoDoTitulo(a.title);
      const sizeB = this.extrairTamanhoDoTitulo(b.title);
      if (sizeA !== sizeB) return sizeB - sizeA;

      return (a.title || '').localeCompare(b.title || '');
    });
  }

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

  private sanitizarNomeArquivo(nomeArquivo: string): string {
    return nomeArquivo
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  // Método público principal (compatível com chamadas antigas)
  async createMultipleQualityStreams(
    torrent: any,
    request: StreamRequest,
    directLink: string | null,
    type: 'movie' | 'series',
    season?: number,
    episode?: number,
    isAvailableOnRD: boolean = false,
    fileIdx?: number,
    titles?: string[],
    imdbId?: string
  ): Promise<Stream[]> {
    return await this.criarStreamsMultiplasQualidades(
      torrent,
      request,
      directLink,
      type,
      season,
      episode,
      isAvailableOnRD,
      fileIdx,
      titles,
      imdbId ?? request.imdbId ?? this.extrairImdbIdDoRequest(request)
    );
  }

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

  getStats() {
    return {
      versao: '2.1.0',
      feature: 'Qualidade corrigida via magnet dn quando disponível',
      linha1: 'Titulo completo do torrent',
      linha2: '🔗 seeds 💾 tamanho ⚙️ tracker',
      linha3: '🌐 idioma + metadados',
      name: 'Brasil RD\\n{qualidade}',
      emojis_originais: '🔗 💾 ⚙️ 🌐 ⏳ 🚀',
      compatibilidade: 'Stremio Web/Desktop/Mobile/TV 100%'
    };
  }
}