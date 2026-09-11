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

  //  API PÚBLICA

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
    const imdbIdFinal = imdbId ?? request.imdbId ?? this.extrairImdbIdDoRequest(request);
    return this.criarStreamsMultiplasQualidades(
      torrent, request, directLink, type,
      season, episode, isAvailableOnRD, fileIdx, titles, imdbIdFinal
    );
  }

  sortStreamsByQuality(streams: Stream[]): Stream[] {
    return this.ordenarStreamsPorQualidade(streams);
  }

  //  HELPERS DE EXTRAÇÃO

  private extrairImdbIdDoRequest(request: StreamRequest): string | undefined {
    if (request.imdbId) return request.imdbId;
    const match = request.id?.match(/^(tt\d+)/);
    return match ? match[1] : undefined;
  }

  //  FORMATAÇÃO DE IDIOMA

  private formatarIdioma(idioma: string): string {
    // Fallback direto para PT-BR em casos vazios/nulos
    if (!idioma || typeof idioma !== 'string') return 'PT-BR';

    // Normaliza: minúsculas, sem acento, trim
    const normalizado = idioma
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

    // Rejeita valores suspeitos que vêm de registros antigos do banco
    const invalidos = ['desconhecido', 'unknown', 'undefined', 'null', 'n/a', 'na', ''];
    if (invalidos.includes(normalizado)) return 'PT-BR';

    const mapa: Record<string, string> = {
      'pt-br': 'PT-BR',
      'pt': 'PT-BR',
      'portugues': 'PT-BR',
      'portuguese': 'PT-BR',
      'brazilian': 'PT-BR',
      'dublado': 'PT-BR',
      'dublada': 'PT-BR',
      'nacional': 'PT-BR',

      'en': 'EN',
      'english': 'EN',
      'eng': 'EN',
      'legendado': 'Leg',
      'legendada': 'Leg',
      'leg': 'Leg',
      'subtitled': 'Leg',

      'dual': 'Dual',
      'dual audio': 'Dual',
      'dualaudio': 'Dual',

      'multi': 'Multi',
      'multilanguage': 'Multi',

      'es': 'ES',
      'esp': 'ES',
      'espanhol': 'ES',
      'espanol': 'ES',
      'spanish': 'ES',

      'fr': 'FR',
      'frances': 'FR',
      'french': 'FR',
    };

    // Match exato
    if (mapa[normalizado]) return mapa[normalizado];

    // Match por palavra inteira (evita 'portugues' → 'es' via includes)
    for (const [chave, valor] of Object.entries(mapa)) {
      const escaped = chave.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`(^|\\s)${escaped}(\\s|$)`);
      if (regex.test(normalizado)) return valor;
    }

    // Fallback final: nunca devolve texto cru ao usuário
    return 'PT-BR';
  }

  //  MONTAGEM DE TÍTULO

  private formatTitleCorreto(
    torrentTitle: string,
    seeds: number,
    size: string | undefined,
    language: string,
    provider: string
  ): string {
    const linhas: string[] = [torrentTitle.trim()];

    const linhaInfos: string[] = [`🔗 ${seeds}`];
    if (size) linhaInfos.push(`💾 ${size}`);
    if (provider) linhaInfos.push(`⚙️ ${provider}`);
    linhas.push(linhaInfos.join(' '));

    linhas.push(`🌐 ${this.formatarIdioma(language)}`);

    return linhas.join('\n');
  }

  private sanitizarNomeArquivo(nomeArquivo: string): string {
    return nomeArquivo
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  private montarBehaviorHints(
    tipo: 'movie' | 'series' | undefined,
    qualidade: string,
    tituloFinal: string,
    extras?: any
  ): any {
    return {
      notWebReady: false,
      bingeGroup: `br-${tipo || 'movie'}-${qualidade}`,
      filename: this.sanitizarNomeArquivo(tituloFinal.split('\n')[0]),
      streamQuality: qualidade,
      preferredAudioLanguage: 'por',
      ...extras,
    };
  }

  //  CRIAÇÃO DE STREAMS

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

    const qualidades = this.determinarQualidades(torrent, tituloFonte);
    const fileIdxParaStream = fileIdx ?? 0;

    // Metadados comuns extraídos uma única vez
    const seeds = torrent.seeders || 0;
    const tamanho = torrent.size;
    const idiomaBruto = torrent.language || 'PT-BR';

    const streams: Stream[] = [];
    for (const qualidade of qualidades) {
      const stream = (disponivelNoRD && linkDireto)
        ? await this.criarStreamDireto({
          tituloFonte,
          linkDireto,
          qualidade,
          tipo,
          temporada,
          episodio,
          fileIdx: fileIdxParaStream,
          seeds,
          tamanho,
          idiomaBruto,
        })
        : await this.criarStreamLazy({
          tituloFonte,
          magnet: torrent.magnet,
          apiKey: request.apiKey!,
          provider: torrent.provider || 'Torrent',
          qualidade,
          tipo,
          temporada,
          episodio,
          fileIdx: fileIdxParaStream,
          titles,
          imdbId,
          seeds,
          tamanho,
          idiomaBruto,
          requestId: request.id,
        });
      streams.push(stream);
    }

    return streams;
  }

  private determinarQualidades(torrent: any, tituloFonte: string): string[] {
    if (torrent.quality && torrent.quality !== 'HD' && torrent.quality !== 'Desconhecido') {
      return [torrent.quality];
    }
    const todas = this.qualityDetector.extractAllQualities(tituloFonte);
    return todas.length > 0 ? todas : ['HD'];
  }

  // ── Criação do stream (caminho lazy) ────────────────────────────

  private async criarStreamLazy(params: {
    tituloFonte: string;
    magnet: string;
    apiKey: string;
    provider: string;
    qualidade: string;
    tipo?: 'movie' | 'series';
    temporada?: number;
    episodio?: number;
    fileIdx: number;
    titles?: string[];
    imdbId?: string;
    seeds: number;
    tamanho?: string;
    idiomaBruto: string;
    requestId: string;
  }): Promise<Stream> {
    const {
      tituloFonte, magnet, apiKey, provider, qualidade,
      tipo, temporada, episodio, fileIdx, titles, imdbId,
      seeds, tamanho, idiomaBruto, requestId,
    } = params;

    const dadosMagnet = await analisarMagnet(magnet);
    const magnetHash = dadosMagnet?.infoHash;

    const qualidadeReal = this.determinarQualidadeReal(qualidade, dadosMagnet?.nome);

    const tituloComQualidade = this.atualizarQualidadeNoTitulo(tituloFonte, qualidadeReal);
    const tituloFinal = this.formatTitleCorreto(
      tituloComQualidade, seeds, tamanho, idiomaBruto, provider
    );

    let resolveUrl = '';
    try {
      const filename = this.sanitizarNomeArquivo(tituloFinal.split('\n')[0] + '.mkv');
      resolveUrl = await gerarUrlResolve(
        magnet, apiKey, filename, fileIdx,
        tipo, temporada, episodio, qualidadeReal,
        magnetHash, titles, imdbId
      );
    } catch (error) {
      this.logger.error('ERRO_GERAR_URL_LAZY', {
        requestId,
        error: error instanceof Error ? error.message : 'Erro desconhecido',
      });
    }

    const stream: Stream = {
      name: `Brasil RD\n${qualidadeReal}`,
      title: tituloFinal,
      fileIdx,
    };

    if (resolveUrl) stream.url = resolveUrl;
    else stream.infoHash = magnetHash || undefined;

    stream.behaviorHints = this.montarBehaviorHints(
      tipo, qualidadeReal, tituloFinal,
      { bingeGroup: `br-${requestId}-${qualidadeReal}` }
    );

    return stream;
  }

  // ── Criação do stream (caminho direto) ──────────────────────────

  private async criarStreamDireto(params: {
    tituloFonte: string;
    linkDireto: string;
    qualidade: string;
    tipo?: 'movie' | 'series';
    temporada?: number;
    episodio?: number;
    fileIdx: number;
    seeds: number;
    tamanho?: string;
    idiomaBruto: string;
  }): Promise<Stream> {
    const {
      tituloFonte, linkDireto, qualidade,
      tipo, temporada, episodio, fileIdx,
      seeds, tamanho, idiomaBruto,
    } = params;

    const tituloFinal = this.formatTitleCorreto(
      tituloFonte, seeds, tamanho, idiomaBruto, 'Torbox'
    );

    const stream: Stream = {
      name: `Brasil RD\n${qualidade}`,
      title: tituloFinal,
      infoHash: (await analisarMagnet(linkDireto))?.infoHash || undefined,
      fileIdx,
      url: linkDireto,
    };

    stream.behaviorHints = this.montarBehaviorHints(tipo, qualidade, tituloFinal);

    return stream;
  }

  private determinarQualidadeReal(qualidadeScraper: string, nomeMagnet?: string | null): string {
    if (!nomeMagnet) return qualidadeScraper;
    const qualidadeDoMagnet = this.qualityDetector.extractQualityFromFilename(nomeMagnet);
    if (qualidadeDoMagnet && qualidadeDoMagnet !== 'HD' && qualidadeDoMagnet !== 'Desconhecido') {
      this.logger.debug(`Qualidade do magnet (${qualidadeDoMagnet}) substitui a do scraper (${qualidadeScraper})`);
      return qualidadeDoMagnet;
    }
    return qualidadeScraper;
  }

  private atualizarQualidadeNoTitulo(titulo: string, qualidade: string): string {
    const regexQualidade = new RegExp(`\\b${qualidade}\\b`, 'i');
    if (regexQualidade.test(titulo)) return titulo;

    const regexEntreParenteses = /\s*\(\s*(\d{3,4}p|4k|uhd|hd)\s*\)/i;
    if (regexEntreParenteses.test(titulo)) {
      return titulo.replace(regexEntreParenteses, ` (${qualidade})`);
    }

    return `${titulo} (${qualidade})`;
  }

  //  ORDENAÇÃO

  private ordenarStreamsPorQualidade(streams: Stream[]): Stream[] {
    return streams.sort((a, b) => {
      const tierA = this.getTier(a);
      const tierB = this.getTier(b);
      if (tierA !== tierB) return tierA - tierB;

      const seedsA = this.extrairSeeds(a);
      const seedsB = this.extrairSeeds(b);
      if (seedsA !== seedsB) return seedsB - seedsA;

      const sizeA = this.extrairTamanhoDoTitulo(a.title);
      const sizeB = this.extrairTamanhoDoTitulo(b.title);
      if (sizeA !== sizeB) return sizeB - sizeA;

      return (a.title || '').localeCompare(b.title || '');
    });
  }

  private getTier(s: Stream): number {
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
  }

  private extrairSeeds(s: Stream): number {
    const t = s.title || '';
    const m1 = t.match(/🔗\s*(\d+)/);
    if (m1) return parseInt(m1[1]);
    const m2 = t.match(/(\d+)\s*seeds?/i);
    if (m2) return parseInt(m2[1]);
    return 0;
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