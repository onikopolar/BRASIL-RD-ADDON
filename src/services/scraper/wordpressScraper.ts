import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { CacheService } from '../../debrid/CacheService.js';
import { INDICADORES_INTERNACIONAL_TORRENTS, extrairRangeEpisodios, normalizarTexto, isCollectionTitle, temporadaAlvoNoRange, calcularTokensRuido, limparPorRaridade, extrairAno, TipoConteudo } from '../../titulos/TechnicalWords.js';
import { SimilarityCalculator } from '../../titulos/SimilarityCalculator.js';

// IDs via /wp-json/wp/v2/categories?slug=filmes|series — pré-filtro server-side por tipo.
const CAT_FILMES = 38;
const CAT_SERIES = 43;

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

const LEGENDADO_CABECALHO_REGEX = /\blegendad[ao]s?\b/i;
const QUALIDADE_PURA_REGEX = /^\s*(?:qualidade:?\s*)?(\d{3,4}p|4k|uhd|full\s*hd)\s*$/i;

const logger = new Logger('WordPressScraper');

dns.setServers(['8.8.8.8', '1.1.1.1']);

function decodeHtmlEntities(texto: string): string {
  if (!texto || (!texto.includes('&') && !texto.includes('&#'))) return texto;
  return texto
    .replace(/&#(\d+);/g, (_m, cod) => String.fromCharCode(parseInt(cod, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, cod) => String.fromCharCode(parseInt(cod, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    (dns as any).resolve4(hostname, (err: any, addresses: string[]) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0],
        port: options.port || 443,
        servername: hostname,
        rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined as any;
  }
}

const dnsAgent = new DnsAgent({ keepAlive: true });
export const agenteHttps = dnsAgent;

export function criarLookup() {
  return (hostname: string, _opts: any, cb: any) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      cb(null, addresses[0], 4);
    });
  };
}
export const lookupCustomizado = criarLookup();

export interface WordPressSite {
  name: string;
  baseUrl: string;
  priority: number;
  timeout: number;
}

export const WP_SITES: WordPressSite[] = [
  {
    name: 'Comando Torrents',
    baseUrl: 'https://comando1.com',
    priority: 2,
    timeout: 15000,
  },
];

export const jsonAxiosConfig = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export type MagnetCacheEntry = { nome: string | null; infoHash: string };
export type InfoBlock = {
  originalTitle?: string;
  translatedTitle?: string;
  year?: number;
  years?: number[];
  size?: string;
};

export type Secao = {
  tipo: 'DUAL' | 'LEGENDADO';
  start: number;
  end: number;
};

export type IdiomaFlags = {
  temNacional: boolean;
  temDual: boolean;
  temAudio: boolean;
  temDublado: boolean;
  temLegendado: boolean;
  temLegendaSubstantivo: boolean;
};

export type TamanhoNumerico = { valor: number; unidade: 'GB' | 'MB' | 'KB' };

export type ContextoLocalMagnet = {
  altDaImg: string | null;
  textoIrmaoAnterior: string | null;
  tituloIrmaoAnterior: string | null;
};

export class WordPressScraper {
  public readonly qualityDetector: QualityDetector;
  public readonly magnetCache: CacheService;
  public readonly similarity: SimilarityCalculator;
  public readonly POST_BATCH_SIZE = 3;
  public readonly PROTECTOR_BATCH_SIZE = 5;
  public readonly MAGNET_CACHE_TTL = 30 * 60 * 1000;

  constructor() {
    this.qualityDetector = new QualityDetector();
    this.magnetCache = new CacheService();
    this.similarity = SimilarityCalculator.getInstance();
  }

  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[],
    imdbId?: string,
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const queriesParaBusca = searchQueries && searchQueries.length > 0
      ? searchQueries
      : [query];

    const activeSites = WP_SITES.filter(s => s.priority > 0).sort((a, b) => b.priority - a.priority);

    for (const q of queriesParaBusca) {
      logger.debug(`search query="${q}"`);
      const resultados = await Promise.all(
        activeSites.map(site =>
          this.searchSite(site, q, type, targetSeason, searchQueries, imdbId, mediaType).catch(err => {
            logger.warn(`site falhou`, { site: site.name, query: q, error: err.code || err.message });
            return [] as TorrentResult[];
          })
        )
      ).then(arrays => arrays.flat());

      if (resultados.length > 0) {
        logger.debug(`query "${q}" retornou ${resultados.length}`);
        return resultados;
      }
    }

    return [];
  }

  async searchSite(
    site: WordPressSite,
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[],
    imdbId?: string,
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const searchQuery = query.trim();
    const catId = type === 'movie' ? CAT_FILMES : CAT_SERIES;
    const searchUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(searchQuery)}&per_page=20&_fields=id,title,link&categories=${catId}`;
    logger.debug(`GET posts search="${searchQuery}" cat=${catId}`);

    const response = await axios.get(searchUrl, jsonAxiosConfig);
    const posts = response.data;

    const postItems: { id: number; title: string; url: string }[] = [];

    for (const post of posts) {
      if (!post.id || !post.title?.rendered || !post.link) continue;

      const titleBruto = post.title.rendered as string;
      const titleLimpo = decodeHtmlEntities(titleBruto);

      postItems.push({
        id: post.id,
        title: titleLimpo,
        url: post.link,
      });
    }

    const queryRange = extrairRangeEpisodios(searchQuery);
    const querySeason = targetSeason ?? queryRange?.seasonStart;

    const frases = this.montarFrasesDeBusca(searchQuery, searchQueries);
    const tokensRuido = calcularTokensRuido(postItems.map(p => p.title));

    const relevantPosts = postItems.filter(post =>
      this.postRelevante(post, querySeason, frases, site.name, tokensRuido, mediaType)
    );

    logger.debug(`posts API=${postItems.length} relevantes=${relevantPosts.length} season=${querySeason ?? '-'}`);

    const results: TorrentResult[] = [];

    for (let i = 0; i < relevantPosts.length; i += this.POST_BATCH_SIZE) {
      const batch = relevantPosts.slice(i, i + this.POST_BATCH_SIZE);
      const batchPromises = batch.map(post =>
        this.scrapePostApi(post.id, post.title, site.name, type, imdbId, mediaType)
          .catch(err => {
            logger.warn(`post falhou`, { post: post.title.substring(0, 50), error: err.message });
            return [] as TorrentResult[];
          })
      );
      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        results.push(...res);
      }
    }

    if (querySeason) {
      for (const r of results) {
        if (r.season === undefined) r.season = querySeason;
      }
    }

    logger.debug(`site=${site.name} total=${results.length}`);
    return results;
  }

  montarFrasesDeBusca(searchQuery: string, searchQueries?: string[]): Set<string> {
    const allQueries = new Set<string>([searchQuery, ...(searchQueries || [])]);
    const frases = new Set<string>();

    for (const q of allQueries) {
      const phrase = normalizarTexto(
        q
          .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
          .replace(/\btemporada\s*\d+\b/gi, '')
          .replace(/\bseason\s*\d+\b/gi, '')
      );
      if (phrase) frases.add(phrase);
    }

    return frases;
  }

  postRelevante(
    post: { title: string },
    querySeason: number | undefined,
    frases: Set<string>,
    siteName: string,
    tokensRuido: Set<string>,
    mediaType?: TipoConteudo
  ): boolean {
    const lowerTitle = post.title.toLowerCase();

    if (/\blist[aã]o\b/i.test(lowerTitle)) return false;

    if (querySeason) {
      const range = extrairRangeEpisodios(post.title);
      if (!temporadaAlvoNoRange(range, querySeason)) return false;
    }

    const tituloLimpo = limparPorRaridade(post.title, tokensRuido);
    const resultado = this.similarity.compararComTitulos([...frases], tituloLimpo);

    // Só FILME usa collection no pré-filtro.
    // Série: "1ª Temporada Completa" é só uma temporada, não pack.
    // Deixar collection ativo em série aceitava spin-off (Dragon Ball Super).
    const ehSerie = mediaType === 'series' || mediaType === 'tv';
    const isCollection = !ehSerie && isCollectionTitle(post.title, mediaType);

    if (!resultado.match && !isCollection) {
      logger.debug(`post rejeitado`, { score: resultado.score.toFixed(2), titulo: post.title.substring(0, 60) });
      return false;
    }

    if (!resultado.match && isCollection) {
      logger.debug(`coleção aceita pré-filtro`, { titulo: post.title.substring(0, 60), mediaType: mediaType ?? '-' });
      return true;
    }

    logger.debug(`post aceito`, { score: resultado.score.toFixed(2), nivel: resultado.nivel, titulo: post.title.substring(0, 60) });
    return true;
  }

  classificarTextoIdioma(texto: string): IdiomaFlags {
    const t = normalizarTexto(texto);
    return {
      temNacional: /\bnacional\b/.test(t),
      temDual: /\bdual\b/.test(t),
      temAudio: /\baudio\b/.test(t),
      temDublado: /\bdublado\b|\bdublada\b|\bdublagem\b/.test(t),
      temLegendado: LEGENDADO_CABECALHO_REGEX.test(texto),
      temLegendaSubstantivo: /\blegenda\b/i.test(texto),
    };
  }

  extractQualityFromText(text: string): string | null {
    if (!text) return null;
    const q = this.qualityDetector.extractBestQuality(text);
    return (q && q !== 'HD') ? q : null;
  }

  getFullContextText($el: any): string {
    let current = $el.parent();
    for (let depth = 0; depth < 4; depth++) {
      const text = current.text().trim();
      if (text.length > 10 && /\b(\d{3,4}p|4k|uhd)\b/i.test(text)) {
        return text;
      }
      current = current.parent();
    }
    return $el.parent().text().trim();
  }

  cleanHtmlTitle(parentText: string, linkText: string, qualityOverride?: string | null): string {
    if (!parentText) return '';

    const epPatterns = [
      /Epis[oó]dio\s+\d{1,3}\s+ao?\s+\d{1,3}/i,
      /Epis[oó]dio\s+\d{1,3}/i,
      /\bS\d{1,2}\s*E\d{1,3}/i,
      /\bE\d{1,3}/i
    ];

    let episode = '';
    for (const pattern of epPatterns) {
      const match = parentText.match(pattern);
      if (match) {
        episode = match[0];
        break;
      }
    }

    if (!episode) return '';

    let quality = qualityOverride || null;
    if (!quality && linkText) {
      quality = this.extractQualityFromText(linkText);
    }

    return quality ? `${episode}: ${quality}` : episode;
  }

  // Rótulo do magnet: <strong>/<b> no mesmo <p> antes do <a>, senão no <p> anterior.
  private extrairContextoLocal($: any, el: any): ContextoLocalMagnet {
    const $el = $(el);
    const altDaImg = ($el.find('img').attr('alt') || '').trim() || null;

    let textoIrmaoAnterior: string | null = null;
    let tituloIrmaoAnterior: string | null = null;

    const $pai = $el.parent();

    const $rotulo = $pai.find('strong, b').first();
    if ($rotulo.length) {
      const idxRotulo = $rotulo.index();
      const idxLink = $el.index();
      if (idxRotulo !== -1 && idxLink !== -1 && idxRotulo < idxLink) {
        const texto = $rotulo.text().replace(/\s+/g, ' ').trim();
        if (texto) {
          if (QUALIDADE_PURA_REGEX.test(texto)) textoIrmaoAnterior = texto;
          if (this.pareceTituloDeItem(texto)) tituloIrmaoAnterior = texto;
        }
      }
    }

    if (!textoIrmaoAnterior && !tituloIrmaoAnterior) {
      let irmao = $pai.prev();
      for (let passo = 0; passo < 3 && irmao.length; passo++) {
        const texto = irmao.text().replace(/\s+/g, ' ').trim();
        if (texto) {
          if (QUALIDADE_PURA_REGEX.test(texto)) textoIrmaoAnterior = texto;
          if (this.pareceTituloDeItem(texto)) tituloIrmaoAnterior = texto;
          break;
        }
        irmao = irmao.prev();
      }
    }

    return { altDaImg, textoIrmaoAnterior, tituloIrmaoAnterior };
  }

  private pareceTituloDeItem(texto: string): boolean {
    if (texto.length < 3 || texto.length > 150) return false;
    if (!/[a-zA-ZÀ-ÿ]/.test(texto)) return false;
    if (QUALIDADE_PURA_REGEX.test(texto)) return false;
    if (/^(assistir|baixar|download|ver|trailer|sinopse|informa[çc]|caso haja|k-lite|codec)/i.test(texto)) return false;
    if (/^\d+\s*(gb|mb|kb|kbps|mbps|gbps)$/i.test(texto)) return false;
    return true;
  }

  private resolverQualidadeEspecifica(
    canonicalName: string | null,
    ctxLocal: ContextoLocalMagnet,
    linkText: string,
    fullContextText: string,
    parentText: string,
    postTitle: string,
    html: string
  ): { qualidade: string; fonte: string } {
    if (canonicalName) {
      const q = this.extractQualityFromText(canonicalName);
      if (q) return { qualidade: q, fonte: 'canonicalName' };
    }

    if (ctxLocal.altDaImg) {
      const q = this.extractQualityFromText(ctxLocal.altDaImg);
      if (q) return { qualidade: q, fonte: 'altDaImg' };
    }

    if (ctxLocal.textoIrmaoAnterior) {
      const q = this.extractQualityFromText(ctxLocal.textoIrmaoAnterior);
      if (q) return { qualidade: q, fonte: 'textoIrmaoAnterior' };
    }

    const qLink = this.extractQualityFromText(linkText);
    if (qLink) return { qualidade: qLink, fonte: 'linkText' };

    const qCtx = this.extractQualityFromText(fullContextText);
    if (qCtx) return { qualidade: qCtx, fonte: 'fullContextText' };

    const qParent = this.extractQualityFromText(parentText);
    if (qParent) return { qualidade: qParent, fonte: 'parentText' };

    const qPost = this.extractQualityFromText(postTitle);
    if (qPost) return { qualidade: qPost, fonte: 'postTitle' };

    const qHtml = this.extractQualityFromText(html);
    if (qHtml) return { qualidade: qHtml, fonte: 'html' };

    return { qualidade: 'HD', fonte: 'fallback' };
  }

  detectSectionType(text: string): 'DUAL' | 'LEGENDADO' | 'OUTRO' {
    const t = normalizarTexto(text).trim();

    if (/^(assistir|baixar|download|ver|trailer)\b/i.test(t)) return 'OUTRO';

    const pareceCabecalho = /^versao\b/i.test(t) || t.length <= 25;
    if (!pareceCabecalho) return 'OUTRO';

    const f = this.classificarTextoIdioma(text);
    const temDualCompleto = f.temDual && f.temAudio;
    const temLegendadoCabecalho = f.temLegendado;

    if (temLegendadoCabecalho && !temDualCompleto && !f.temDublado) return 'LEGENDADO';
    if ((temDualCompleto || f.temDublado || f.temNacional) && !temLegendadoCabecalho) return 'DUAL';
    return 'OUTRO';
  }

  findSections($: any, content: string): Secao[] {
    const selectors = ['strong', 'b'];
    const cabecalhos: Array<{ tipo: 'DUAL' | 'LEGENDADO'; pos: number }> = [];

    for (const sel of selectors) {
      const elements = $(sel);
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (!text) continue;

        const tipo = this.detectSectionType(text);
        if (tipo === 'OUTRO') continue;

        const pos = content.indexOf($(elements[i]).toString());
        if (pos === -1) continue;

        cabecalhos.push({ tipo, pos });
      }
    }

    cabecalhos.sort((a, b) => a.pos - b.pos);

    const secoes: Secao[] = [];
    for (let i = 0; i < cabecalhos.length; i++) {
      const cab = cabecalhos[i];
      const proximo = cabecalhos[i + 1];
      secoes.push({
        tipo: cab.tipo,
        start: cab.pos,
        end: proximo ? proximo.pos : content.length,
      });
    }

    return secoes;
  }

  findSectionBoundaries($: any, content: string): { dualIndex: number | null; legendadoIndex: number | null } {
    const secoes = this.findSections($, content);
    return {
      dualIndex: secoes.find(s => s.tipo === 'DUAL')?.start ?? null,
      legendadoIndex: secoes.find(s => s.tipo === 'LEGENDADO')?.start ?? null,
    };
  }

  private secaoDaPosicao(pos: number, secoes: Secao[]): Secao | null {
    for (const s of secoes) {
      if (pos >= s.start && pos < s.end) return s;
    }
    return null;
  }

  async scrapePostApi(
    postId: number,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series',
    imdbId?: string,
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const postUrl = `https://comando1.com/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content`;
    const response = await axios.get(postUrl, jsonAxiosConfig);
    const post = response.data;

    const titleRenderedBruto = post.title?.rendered || postTitle;
    const titleRendered = decodeHtmlEntities(titleRenderedBruto);

    const contentHtml = post.content?.rendered || '';

    if (!contentHtml) {
      logger.warn(`post sem conteúdo`, { postId });
      return [];
    }

    let imdbConfirmed = false;
    if (imdbId) {
      const imdbIdDoPost = contentHtml.match(/imdb\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d+)/i)?.[1] || null;
      if (imdbIdDoPost) {
        const isCollection = isCollectionTitle(titleRendered, mediaType);
        if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
          return [];
        }
        if (!isCollection) {
          imdbConfirmed = true;
        }
      }
    }

    const $ = cheerio.load(contentHtml);
    const html = $.html();

    const infoBlock = this.extractInfoBlock($, html);
    // Prioriza o título traduzido. Se não tiver, cai pro original.
    const globalOriginalTitle = infoBlock.translatedTitle || infoBlock.originalTitle || undefined;
    const year = infoBlock.year;
    const years = infoBlock.years || (infoBlock.year ? [infoBlock.year] : undefined);

    logger.debug(`info`, {
      provider,
      postId,
      isCollection: isCollectionTitle(titleRendered, mediaType),
      originalTitle: globalOriginalTitle || '-',
      year: year ?? '-',
      years: years?.join(',') || '-',
      size: infoBlock.size || '-'
    });

    const secoes = this.findSections($, html);

    logger.debug(`seções`, {
      provider,
      postId,
      mapa: secoes.map(s => `${s.tipo}[${s.start}-${s.end}]`).join(' ') || '(nenhuma)'
    });

    const temDual = secoes.some(s => s.tipo === 'DUAL');
    const temLegendado = secoes.some(s => s.tipo === 'LEGENDADO');
    if (!temDual && temLegendado) {
      logger.debug(`post apenas legendado descartado`, { postId });
      return [];
    }

    const secoesValidas = secoes.filter(s => s.tipo === 'DUAL');
    if (secoesValidas.length === 0) {
      const todos = $('a[href^="magnet:"]').toArray() as any[];
      logger.debug(`sem seções, processando todos`, { postId, magnets: todos.length });
      const results = await this.processarMagnets(todos, $, html, titleRendered, provider, type, globalOriginalTitle, year, years, mediaType);
      if (imdbConfirmed) for (const r of results) r.imdbConfirmed = true;
      return results;
    }

    const magnetElements = $('a[href^="magnet:"]').toArray() as any[];
    const magnetsPorSecao: Record<string, number> = { DUAL: 0, LEGENDADO: 0, NONE: 0 };
    const magnetsValidos: any[] = [];

    for (const el of magnetElements) {
      const pos = html.indexOf($(el).toString());

      if (pos === -1) {
        magnetsPorSecao.NONE++;
        continue;
      }

      const secao = this.secaoDaPosicao(pos, secoes);
      if (!secao) {
        magnetsPorSecao.NONE++;
        continue;
      }
      if (secao.tipo === 'LEGENDADO') {
        magnetsPorSecao.LEGENDADO++;
        continue;
      }
      magnetsPorSecao.DUAL++;
      magnetsValidos.push(el);
    }

    logger.debug(`magnets por seção`, {
      postId,
      DUAL: magnetsPorSecao.DUAL,
      LEGENDADO: magnetsPorSecao.LEGENDADO,
      NONE: magnetsPorSecao.NONE
    });

    const results = await this.processarMagnets(magnetsValidos, $, html, titleRendered, provider, type, globalOriginalTitle, year, years, mediaType);

    if (imdbConfirmed) for (const r of results) r.imdbConfirmed = true;
    return results;
  }
  private async processarMagnets(
    elements: any[],
    $: any,
    html: string,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined,
    years?: number[],
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const results: TorrentResult[] = [];
    const batchSize = 5;

    for (let i = 0; i < elements.length; i += batchSize) {
      const batch = elements.slice(i, i + batchSize);
      const batchPromises = batch.map(async (el: any) => {
        const magnet = $(el).attr('href');
        if (!magnet) return null;

        const parentText = $(el).parent().text().trim();
        const linkText = $(el).text().trim();
        const fullContextText = this.getFullContextText($(el));
        const ctxLocal = this.extrairContextoLocal($, el);

        return this.processMagnetItem(magnet, parentText, linkText, fullContextText, ctxLocal, postTitle, html, provider, type, globalOriginalTitle, year, years, mediaType);
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
  }

  async processMagnetItem(
    magnet: string,
    parentText: string,
    linkText: string,
    fullContextText: string,
    ctxLocal: ContextoLocalMagnet,
    postTitle: string,
    html: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined,
    years?: number[],
    mediaType?: TipoConteudo
  ): Promise<TorrentResult | null> {
    const dados = await this.analisarMagnetComCache(magnet, provider);
    const canonicalName = dados?.nome ?? null;

    const { qualidade: quality, fonte: fonteQualidade } = this.resolverQualidadeEspecifica(
      canonicalName,
      ctxLocal,
      linkText,
      fullContextText,
      parentText,
      postTitle,
      html
    );

    if (!this.qualityDetector.isValidQuality(quality)) {
      logger.warn(`qualidade inválida`, { provider, quality, fonte: fonteQualidade });
      return null;
    }

    const sizeParent = this.extractSize(parentText);
    const sizePost = this.extractSize(postTitle);
    const size = sizeParent || sizePost;

    const language = this.extractLanguage(postTitle) || this.extractLanguage(parentText) || 'Desconhecido';
    const episode = this.extractEpisodeFromText(parentText);
    const cleanedHtmlTitle = this.cleanHtmlTitle(parentText, linkText, quality);

    const isPostCollection = isCollectionTitle(postTitle, mediaType);

    let originalTitleFinal: string | undefined;
    let displayTitle: string;
    let fonteOriginal: 'html' | 'dn' | 'post' = 'post';

    if (isPostCollection) {
      const ctxOriginal = this.extractOriginalTitleFromContext(parentText);
      if (ctxLocal.tituloIrmaoAnterior) {
        originalTitleFinal = ctxLocal.tituloIrmaoAnterior;
        fonteOriginal = 'html';
      } else if (canonicalName?.trim()) {
        originalTitleFinal = canonicalName.trim();
        fonteOriginal = 'dn';
      } else if (ctxOriginal) {
        originalTitleFinal = ctxOriginal;
        fonteOriginal = 'html';
      } else if (globalOriginalTitle) {
        originalTitleFinal = globalOriginalTitle;
        fonteOriginal = 'html';
      } else {
        const pt = this.extractTitleFromPostTitle(postTitle);
        if (pt) { originalTitleFinal = pt; fonteOriginal = 'post'; }
      }
      displayTitle = originalTitleFinal || postTitle;
    } else {
      const ctxOriginal = this.extractOriginalTitleFromContext(parentText);
      if (ctxOriginal) {
        originalTitleFinal = ctxOriginal;
        fonteOriginal = 'html';
      } else if (globalOriginalTitle) {
        originalTitleFinal = globalOriginalTitle;
        fonteOriginal = 'html';
      } else {
        const pt = this.extractTitleFromPostTitle(postTitle);
        if (pt) { originalTitleFinal = pt; fonteOriginal = 'post'; }
      }
      displayTitle = this.extractTitleFromPostTitle(postTitle) || canonicalName || postTitle;
    }

    // Ano: rótulo do item > dn > year do post. Preserva array pra coleções com range.
    const anosDoItem = originalTitleFinal ? extrairAno(originalTitleFinal) : undefined;
    const anosDoDnFallback = fonteOriginal !== 'dn' && canonicalName ? extrairAno(canonicalName) : undefined;

    const anosResolvidos =
      (anosDoItem && anosDoItem.length > 0) ? anosDoItem :
        (anosDoDnFallback && anosDoDnFallback.length > 0) ? anosDoDnFallback :
          undefined;

    const yearFinal = anosResolvidos ? anosResolvidos[0] : year;
    const yearsFinal = anosResolvidos ?? (yearFinal !== undefined ? [yearFinal] : years);

    const fonteAno: 'html' | 'dn' | 'post' | 'nenhum' =
      (anosDoItem && anosDoItem.length > 0) ? fonteOriginal :
        (anosDoDnFallback && anosDoDnFallback.length > 0) ? 'dn' :
          year !== undefined ? 'post' : 'nenhum';

    const canonicalFinal = canonicalName || this.sintetizarCanonicalName(
      originalTitleFinal || postTitle,
      yearsFinal,
      quality
    );

    return {
      title: this.cleanTitle(displayTitle),
      htmlTitle: cleanedHtmlTitle || undefined,
      magnet,
      seeders: 0,
      leechers: 0,
      size,
      quality,
      provider,
      language,
      type,
      relevanceScore: 0.8,
      sizeInBytes: this.parseSize(size),
      season: undefined,
      episode,
      lastUpdated: new Date(),
      confidence: 0.85,
      originalTitle: originalTitleFinal ?? undefined,
      year: yearFinal,
      years: yearsFinal,
      canonicalName: canonicalFinal,
    };
  }

  private limparTituloBase(titulo: string): string {
    return titulo
      .replace(/[*]+/g, '')
      .replace(/[?!,;:]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private sintetizarCanonicalName(base: string, years: number[] | undefined, quality: string): string {
    const baseLimpo = this.limparTituloBase(base);
    const anos = years && years.length > 0
      ? (years.length === 1 ? `${years[0]}` : `${years[0]}-${years[years.length - 1]}`)
      : null;
    return [baseLimpo, anos, quality].filter(Boolean).join(' ').trim();
  }

  extractTitleFromPostTitle(postTitle: string): string | null {
    if (!postTitle) return null;
    const limpo = postTitle
      .replace(/\bTorrent\b.*$/i, '')
      .replace(/\s+[–|-]\s+.*$/, '')
      .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-DL|DUAL|Dublado|Legendado)\b.*$/i, '')
      .trim();

    return limpo || null;
  }

  extractOriginalTitleFromContext(contextText: string): string | null {
    const match = contextText.match(/T[ií]tulo\s+Original:\s*([^\n]+)/i);
    if (!match?.[1]) return null;
    return this.limparTituloBase(match[1].trim()) || null;
  }

  extractInfoBlock($: any, html: string): InfoBlock {
    const articleText = $.root().text() || html;
    const titleText = articleText;

    const originalMatch = articleText.match(/T[ií]tulo\s+Original\s*:\s*([^\n]+)/i);
    const translatedMatch = articleText.match(/T[ií]tulo\s+Traduzido\s*:\s*([^\n]+)/i);

    const yearMatch = articleText.match(/Ano de Lançamento\s*:\s*([^\n]+)/i) || articleText.match(/Lançamento\s*:?\s*([^\n]+)/i);
    let years: number[] = [];
    if (yearMatch) {
      const rawYears = yearMatch[1].match(/\b(19|20)\d{2}\b/g) || [];
      years = rawYears.map((y: string) => parseInt(y));
    } else {
      const titleYears = titleText.match(/\b(19|20)\d{2}\b/g) || [];
      years = titleYears
        .map((y: string) => parseInt(y))
        .filter((y: number) => y >= 1950 && y <= 2030);
    }

    const sizeMatch = articleText.match(/Tamanho:\s*([^\n]+)/i);

    const originalLimpo = originalMatch?.[1]?.trim()
      ? this.limparTituloBase(originalMatch[1].trim())
      : undefined;
    const translatedLimpo = translatedMatch?.[1]?.trim()
      ? this.limparTituloBase(translatedMatch[1].trim())
      : undefined;
    const altImagem = ($('img[alt]').first().attr('alt') || '').trim();

    const originalTitle = this.escolherOriginalLatino(originalLimpo, translatedLimpo, altImagem);

    return {
      originalTitle,
      translatedTitle: translatedLimpo,
      year: years.length > 0 ? years[0] : undefined,
      years,
      size: sizeMatch?.[1]?.trim(),
    };
  }

  private escolherOriginalLatino(
    original: string | undefined,
    translated: string | undefined,
    alt: string
  ): string | undefined {
    if (this.ehLatino(original)) return original;
    if (this.ehLatino(translated)) return translated;
    if (this.ehLatino(alt)) return alt;
    return original;
  }

  private ehLatino(texto: string | undefined): boolean {
    if (!texto) return false;
    const letras = texto.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    return letras.length / Math.max(texto.length, 1) > 0.6;
  }

  async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await axios.get(protectorUrl, {
          ...jsonAxiosConfig,
          timeout: 12000,
          maxRedirects: 5,
        });
        const html: string = res.data;
        const match = html.match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
        if (match) return match[1];
        const altMatch = html.match(/DEST_URL\s*=\s*"([^"]+)"/);
        if (altMatch) return altMatch[1];
      } catch (err: any) {
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        logger.warn(`protetor falhou`, { url: protectorUrl.substring(0, 50), error: err.message });
      }
    }
    return null;
  }

  extractCanonicalNameSync(magnet: string): string | null {
    const dnMatch = magnet.match(/[&?]dn=([^&]+)/i);
    if (dnMatch) {
      try {
        return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
      } catch {
        return dnMatch[1];
      }
    }
    return null;
  }

  extrairTamanhoNumerico(text: string): TamanhoNumerico | null {
    if (!text) return null;
    const m = text.match(/([\d,.]+)\s*(GB|MB|KB)/i);
    if (!m) return null;
    const valor = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const unidade = m[2].toUpperCase() as 'GB' | 'MB' | 'KB';
    return { valor, unidade };
  }

  extractSize(text: string): string {
    const t = this.extrairTamanhoNumerico(text);
    if (!t || t.unidade === 'KB') return 'Desconhecido';
    return `${t.valor} ${t.unidade}`;
  }

  parseSize(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'Desconhecido' || sizeStr === '–') return 0;
    const t = this.extrairTamanhoNumerico(sizeStr);
    if (!t) return 0;
    const multiplicador = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[t.unidade];
    return Math.round(t.valor * multiplicador);
  }

  extractLanguage(title: string): string {
    if (!title) return 'Desconhecido';
    const f = this.classificarTextoIdioma(title);
    if (f.temDual) return 'Dual';
    if (f.temDublado) return 'Dublado';
    if (f.temNacional) return 'Nacional';
    if (f.temLegendado || f.temLegendaSubstantivo) return 'Legendado';
    return 'Desconhecido';
  }

  cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  async analisarMagnetComCache(magnet: string, provider: string): Promise<MagnetCacheEntry | null> {
    const cached = this.magnetCache.get<MagnetCacheEntry>(magnet);
    if (cached) return cached;

    try {
      const dados = await analisarMagnet(magnet);
      if (dados) {
        const entry: MagnetCacheEntry = { nome: dados.nome, infoHash: dados.infoHash };
        this.magnetCache.set(magnet, entry, this.MAGNET_CACHE_TTL);
        return entry;
      }
    } catch (err: any) {
      logger.warn(`magnet análise falhou`, { provider, error: err.message });
    }
    return null;
  }

  extractEpisodeFromText(text: string): number | undefined {
    if (!text) return undefined;
    const range = extrairRangeEpisodios(text);
    return range?.episodeStart || undefined;
  }
}