import { Stream, StreamRequest } from '../types/index.js';
import { analisarMagnet, gerarUrlResolve } from '../magnet/magnetHelper.js';
import { QualityDetector } from '../lib/qualityDetector.js';
import { Logger } from '../utils/logger.js';

export class StreamFormatter {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;

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
    this.logger.debug('StreamFormatter ready');
  }

  private formatTitleCorreto(
    torrentTitle: string,
    seeds?: number,
    size?: string,
    language?: string,
    provider?: string
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

    if (provider) {
      segundaLinha += ` ⚙️ ${provider}`;
    }

    if (segundaLinha) {
      result += '\n' + segundaLinha;
    }

    const idiomaFormatado = this.formatarIdioma(language || 'PT-BR');
    result += '\n' + `🌐 ${idiomaFormatado}`;

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
      'legendado': 'Leg',

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

  private sanitizarNomeArquivo(nomeArquivo: string): string {
    return nomeArquivo
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  private extrairImdbIdDoRequest(request: StreamRequest): string | undefined {
    if (request.imdbId) return request.imdbId;
    const match = request.id?.match(/^(tt\d+)/);
    return match ? match[1] : undefined;
  }

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

  private async criarStreamsMultiplasQualidades(
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
    let tituloFonte = torrent.canonicalName || torrent.title;

    if (torrent.htmlTitle && torrent.htmlTitle.trim().length > 0) {
      const htmlClean = torrent.htmlTitle.trim();
      if (!tituloFonte.includes(htmlClean)) {
        const maxHtmlLen = 80;
        const htmlExcerpt = htmlClean.length > maxHtmlLen
          ? htmlClean.substring(0, maxHtmlLen) + '...'
          : htmlClean;
        tituloFonte = `${tituloFonte} (${htmlExcerpt})`;
      }
    }

    let qualidades: string[];
    if (torrent.quality && torrent.quality !== 'HD' && torrent.quality !== 'Desconhecido') {
      qualidades = [torrent.quality];
    } else {
      // Usa o QualityDetector (robusto) em vez de método local duplicado
      const todas = this.qualityDetector.extractAllQualities(tituloFonte);
      qualidades = todas.length > 0 ? todas : ['HD'];
    }

    const streams: Stream[] = [];
    const imdbIdFinal = imdbId || request.imdbId || this.extrairImdbIdDoRequest(request);

    for (const qualidade of qualidades) {
      const descricaoBase = `${tituloFonte}\n${torrent.seeders || 0} seeds | ${torrent.size || 'N/A'} | ${this.formatarIdioma(torrent.language || 'PT-BR')}`;
      const fileIdxParaStream = fileIdx ?? 0;

      if (disponivelNoRD && linkDireto) {
        streams.push(await this.criarStreamDireto(
          tituloFonte,
          descricaoBase,
          linkDireto,
          qualidade,
          tipo,
          temporada,
          episodio,
          {
            bingeGroup: `br-${request.id}-${qualidade}`,
            filename: this.sanitizarNomeArquivo(tituloFonte)
          },
          fileIdxParaStream
        ));
      } else {
        streams.push(await this.criarStreamLazy(
          tituloFonte,
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
            filename: this.sanitizarNomeArquivo(tituloFonte)
          },
          fileIdxParaStream,
          titles,
          imdbIdFinal
        ));
      }
    }

    return streams;
  }

  private async criarStreamLazy(
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
    fileIdx?: number,
    titles?: string[],
    imdbId?: string
  ): Promise<Stream> {
    this.logger.debug('MAGNET_CRU', {
      magnet: magnet.substring(0, 250),
      tamanho: magnet.length
    });

    const dadosMagnet = await analisarMagnet(magnet);
    const magnetHash = dadosMagnet?.infoHash;

    let qualidadeReal = qualidade;
    if (dadosMagnet?.nome) {
      const qualidadeDoMagnet = this.qualityDetector.extractQualityFromFilename(dadosMagnet.nome);
      if (qualidadeDoMagnet && qualidadeDoMagnet !== 'HD' && qualidadeDoMagnet !== 'Desconhecido') {
        qualidadeReal = qualidadeDoMagnet;
        this.logger.debug(`Qualidade do magnet (${qualidadeDoMagnet}) substitui a qualidade do scraper (${qualidade})`);
      }
    }

    const tituloComQualidadeReal = this.atualizarQualidadeNoTitulo(torrentTitle, qualidadeReal);

    const fileIdxFinal = fileIdx ?? 0;

    const seedsMatch = descricao.match(/(\d+)\s*seeds?/i);
    const sizeMatch = descricao.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    const idiomaDaDescricao = this.extrairIdiomaDaDescricao(descricao);

    const seeds = seedsMatch ? parseInt(seedsMatch[1]) : 0;
    const tamanho = sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : undefined;

    const tituloFinal = this.formatTitleCorreto(
      tituloComQualidadeReal,
      seeds,
      tamanho,
      idiomaDaDescricao,
      provider
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

    return stream;
  }

  private async criarStreamDireto(
    torrentTitle: string,
    descricao: string,
    linkDireto: string,
    qualidade: string,
    tipo?: 'movie' | 'series',
    temporada?: number,
    episodio?: number,
    behaviorHints?: any,
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
      'Torbox'
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

  private atualizarQualidadeNoTitulo(titulo: string, qualidade: string): string {
    const regexQualidade = new RegExp(`\\b${qualidade}\\b`, 'i');
    if (regexQualidade.test(titulo)) {
      return titulo;
    }

    const regexEntreParenteses = /\s*\(\s*(\d{3,4}p|4k|uhd|hd)\s*\)/i;
    if (regexEntreParenteses.test(titulo)) {
      return titulo.replace(regexEntreParenteses, ` (${qualidade})`);
    }

    return `${titulo} (${qualidade})`;
  }

  sortStreamsByQuality(streams: Stream[]): Stream[] {
    return this.ordenarStreamsPorQualidade(streams);
  }

  private ordenarStreamsPorQualidade(streams: Stream[]): Stream[] {
    const getTier = (s: Stream): number => {
      const q = (s.behaviorHints?.streamQuality || '').toLowerCase();
      if (q) {
        const normalized = this.qualityDetector.extractBestQuality(q);
        if (normalized && normalized !== 'unknown') {
          return this.qualityDetector.getQualityOrder(normalized);
        }
      }
      const match = (s.name || '').match(/\b(\d{3,4}p|4k|uhd|hd|sd)\b/i);
      if (match) {
        const normalized = this.qualityDetector.extractBestQuality(match[1]);
        if (normalized && normalized !== 'unknown') {
          return this.qualityDetector.getQualityOrder(normalized);
        }
      }
      return this.qualityDetector.getQualityOrder('HD');
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
      // Menor índice = melhor qualidade (2160p = 0)
      if (tierA !== tierB) return tierA - tierB;

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
}