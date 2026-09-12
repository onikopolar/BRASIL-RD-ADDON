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
import { INDICADORES_INTERNACIONAL_TORRENTS, extrairRangeEpisodios, normalizarTexto, isCollectionTitle } from '../../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

// Cabeçalho de seção precisa do particípio ("legendado"/"legendada"), não do substantivo
// ("legenda"). O substantivo aparece em rótulos tipo "Legenda: PT-BR" e links pro opensubtitles.
const LEGENDADO_CABECALHO_REGEX = /\blegendad[ao]s?\b/i;

// Irmão anterior só conta como marcador de qualidade se for qualidade pura
// "720p" casa, "A Era do Gelo 1-4 720p/1080p" não casa
const QUALIDADE_PURA_REGEX = /^\s*(?:qualidade:?\s*)?(\d{3,4}p|4k|uhd|full\s*hd)\s*$/i;

const logger = new Logger('WordPressScraper');

dns.setServers(['8.8.8.8', '1.1.1.1']);

// Mexi aqui porque a API do WP retorna entidades HTML cruas (&#8211;, &amp;, &nbsp;) no title.rendered
// Sem decodificar, títulos com endash apareciam como "A Era do Gelo 2 &#8211; (2005)" no stream final
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
export type SectionBoundaries = { dualIndex: number | null; legendadoIndex: number | null };
export type IdiomaFlags = {
  temNacional: boolean;
  temDual: boolean;
  temAudio: boolean;
  temDublado: boolean;
  temLegendado: boolean;
  temLegendaSubstantivo: boolean;
};
export type TamanhoNumerico = { valor: number; unidade: 'GB' | 'MB' | 'KB' };

// Contexto local de um link de magnet, extraído no momento em que o elemento está na mão
export type ContextoLocalMagnet = {
  altDaImg: string | null;
  textoIrmaoAnterior: string | null;
};

export class WordPressScraper {
  public readonly qualityDetector: QualityDetector;
  public readonly magnetCache: CacheService;
  public readonly POST_BATCH_SIZE = 3;
  public readonly PROTECTOR_BATCH_SIZE = 5;
  public readonly MAGNET_CACHE_TTL = 30 * 60 * 1000; // 30min

  constructor() {
    this.qualityDetector = new QualityDetector();
    this.magnetCache = new CacheService();
  }

  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[],
    imdbId?: string
  ): Promise<TorrentResult[]> {
    const queriesParaBusca = searchQueries && searchQueries.length > 0
      ? searchQueries
      : [query];

    const activeSites = WP_SITES.filter(s => s.priority > 0).sort((a, b) => b.priority - a.priority);

    for (const q of queriesParaBusca) {
      logger.debug(`WordPress: tentando busca com query "${q}"`);
      const resultados = await Promise.all(
        activeSites.map(site =>
          this.searchSite(site, q, type, targetSeason, searchQueries, imdbId).catch(err => {
            logger.warn(`WP ${site.name} FALHOU com query "${q.substring(0, 60)}"`, { error: err.code || err.message });
            return [] as TorrentResult[];
          })
        )
      ).then(arrays => arrays.flat());

      if (resultados.length > 0) {
        logger.debug(`WordPress: query "${q}" retornou ${resultados.length} torrents. Encerrando busca.`);
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
    imdbId?: string
  ): Promise<TorrentResult[]> {
    const searchQuery = query.trim();
    const searchUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(searchQuery)}&per_page=20&_fields=id,title,link`;
    logger.debug(`WP ${site.name}: buscando API "${searchUrl}"`);

    const response = await axios.get(searchUrl, jsonAxiosConfig);
    const posts = response.data;

    const postItems: { id: number; title: string; url: string }[] = [];

    for (const post of posts) {
      if (!post.id || !post.title?.rendered || !post.link) continue;

      // Mexi aqui porque title.rendered vem com entidades HTML cruas da API do WP
      const titleBruto = post.title.rendered as string;
      const titleLimpo = decodeHtmlEntities(titleBruto);

      if (titleBruto !== titleLimpo) {
        logger.debug(`WP ${site.name}: DECODE_TITLE | bruto="${titleBruto.substring(0, 60)}" | limpo="${titleLimpo.substring(0, 60)}"`);
      }

      postItems.push({
        id: post.id,
        title: titleLimpo,
        url: post.link,
      });
    }

    const queryRange = extrairRangeEpisodios(searchQuery);
    const querySeason = targetSeason ?? queryRange?.seasonStart;
    if (querySeason) {
      logger.debug(`WP ${site.name}: temporada detectada na query: ${querySeason}`);
    }

    const { frases, baseTitles } = this.montarFrasesDeBusca(searchQuery, searchQueries);

    const relevantPosts = postItems.filter(post =>
      this.postRelevante(post, querySeason, frases, baseTitles, site.name)
    );

    logger.info(`WP ${site.name}: ${relevantPosts.length} posts relevantes na API para "${searchQuery}"`);

    const results: TorrentResult[] = [];

    for (let i = 0; i < relevantPosts.length; i += this.POST_BATCH_SIZE) {
      const batch = relevantPosts.slice(i, i + this.POST_BATCH_SIZE);
      logger.debug(`WP ${site.name}: processando lote ${Math.floor(i / this.POST_BATCH_SIZE) + 1}/${Math.ceil(relevantPosts.length / this.POST_BATCH_SIZE)} (${batch.length} posts)`);
      const batchPromises = batch.map(post =>
        this.scrapePostApi(post.id, post.title, site.name, type, imdbId)
          .then(r => {
            logger.debug(`WP ${site.name}: post concluído: ${post.title.substring(0, 50)}`);
            return r;
          })
          .catch(err => {
            logger.warn(`WP ${site.name}: post falhou: ${post.title.substring(0, 50)} - ${err.message}`);
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
        if (r.season === undefined) {
          r.season = querySeason;
        }
      }
    }

    return results;
  }

  montarFrasesDeBusca(searchQuery: string, searchQueries?: string[]): { frases: Set<string>; baseTitles: string[] } {
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

    const baseTitles = [...frases].map(frase =>
      normalizarTexto(frase.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim())
    ).filter(Boolean);

    return { frases, baseTitles };
  }

  postRelevante(
    post: { title: string },
    querySeason: number | undefined,
    frases: Set<string>,
    baseTitles: string[],
    siteName: string
  ): boolean {
    const lowerTitle = post.title.toLowerCase();

    if (/\blist[aã]o\b/i.test(lowerTitle)) return false;

    if (querySeason) {
      const seasonPatterns = [
        new RegExp(`\\b${querySeason}\\s*[ªº°]?\\s*temporada\\b`, 'i'),
        new RegExp(`\\btemporada\\s*${querySeason}\\b`, 'i'),
        new RegExp(`\\bseason\\s*${querySeason}\\b`, 'i'),
      ];
      if (!seasonPatterns.some(p => p.test(lowerTitle))) return false;
    }

    const titleNormalizado = normalizarTexto(post.title);
    const match = [...frases].some(frase => titleNormalizado.includes(frase));
    const isCollection = isCollectionTitle(titleNormalizado) &&
      baseTitles.some(base => titleNormalizado.includes(base));

    if (!match && !isCollection) {
      logger.debug(`WP ${siteName}: post ignorado (frase não encontrada): "${post.title.substring(0, 50)}"`);
      return false;
    }

    return true;
  }

  // Classifica texto em flags de idioma. Separa "legendado/legendada" (particípio, cabeçalho)
  // de "legenda" (substantivo, rótulo de metadado ou link de site externo).
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

  // Extrai o contexto local do link do magnet no momento em que ele está na mão.
  // Duas fontes específicas do Comando Torrents:
  //   - alt da <img> dentro do <a> (Zodíaco)
  //   - texto do irmão anterior quando é qualidade pura, tipo <p><strong>720p</strong></p> (Ice Age)
  private extrairContextoLocal($: any, el: any): ContextoLocalMagnet {
    const $el = $(el);

    const altDaImg = ($el.find('img').attr('alt') || '').trim() || null;

    let textoIrmaoAnterior: string | null = null;
    const irmao = $el.parent().prev();
    if (irmao.length) {
      const texto = irmao.text().trim();
      if (texto && QUALIDADE_PURA_REGEX.test(texto)) {
        textoIrmaoAnterior = texto;
      }
    }

    return { altDaImg, textoIrmaoAnterior };
  }

  // Resolve a qualidade específica DESTE magnet, olhando em ordem do mais específico ao mais genérico.
  // Mexi aqui porque o WP Comando guarda qualidade em lugares diferentes por post:
  // Zodíaco guarda no alt da img, Ice Age guarda num <p><strong>720p</strong></p> antes do link.
  private resolverQualidadeEspecifica(
    canonicalName: string | null,
    ctxLocal: ContextoLocalMagnet,
    linkText: string,
    fullContextText: string,
    parentText: string,
    postTitle: string,
    html: string
  ): { qualidade: string; fonte: string } {
    // 1. canonicalName do próprio magnet (dn=). ESSA É A FONTE DE VERDADE.
    if (canonicalName) {
      const q = this.extractQualityFromText(canonicalName);
      if (q) return { qualidade: q, fonte: 'canonicalName' };
    }

    // 2. alt da imagem dentro do link (Zodíaco)
    if (ctxLocal.altDaImg) {
      const q = this.extractQualityFromText(ctxLocal.altDaImg);
      if (q) return { qualidade: q, fonte: 'altDaImg' };
    }

    // 3. Irmão anterior com qualidade pura (Ice Age)
    if (ctxLocal.textoIrmaoAnterior) {
      const q = this.extractQualityFromText(ctxLocal.textoIrmaoAnterior);
      if (q) return { qualidade: q, fonte: 'textoIrmaoAnterior' };
    }

    // 4. linkText
    const qLink = this.extractQualityFromText(linkText);
    if (qLink) return { qualidade: qLink, fonte: 'linkText' };

    // 5. fullContextText (ancestral que tenha UMA única menção)
    const qCtx = this.extractQualityFromText(fullContextText);
    if (qCtx) return { qualidade: qCtx, fonte: 'fullContextText' };

    // 6. parentText
    const qParent = this.extractQualityFromText(parentText);
    if (qParent) return { qualidade: qParent, fonte: 'parentText' };

    // 7. postTitle
    const qPost = this.extractQualityFromText(postTitle);
    if (qPost) return { qualidade: qPost, fonte: 'postTitle' };

    // 8. HTML inteiro
    const qHtml = this.extractQualityFromText(html);
    if (qHtml) return { qualidade: qHtml, fonte: 'html' };

    return { qualidade: 'HD', fonte: 'fallback' };
  }

  async scrapePostApi(
    postId: number,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series',
    imdbId?: string
  ): Promise<TorrentResult[]> {
    logger.debug(`WP ${provider}: iniciando scraping do post API "${postTitle.substring(0, 60)}"`);
    const postUrl = `https://comando1.com/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content`;
    const response = await axios.get(postUrl, jsonAxiosConfig);
    const post = response.data;

    // Mexi aqui porque o title.rendered do fetch completo também vem com entidades HTML cruas
    const titleRenderedBruto = post.title?.rendered || postTitle;
    const titleRendered = decodeHtmlEntities(titleRenderedBruto);

    if (titleRenderedBruto !== titleRendered) {
      logger.debug(`WP ${provider}: DECODE_TITLE_FULL | bruto="${titleRenderedBruto.substring(0, 60)}" | limpo="${titleRendered.substring(0, 60)}"`);
    }

    const contentHtml = post.content?.rendered || '';

    if (!contentHtml) {
      logger.warn(`WP ${provider}: conteúdo vazio para post ${postId}`);
      return [];
    }

    let imdbConfirmed = false;
    if (imdbId) {
      const imdbIdDoPost = contentHtml.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
      if (imdbIdDoPost) {
        const isCollection = isCollectionTitle(titleRendered);
        if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
          return [];
        }
        if (!isCollection) {
          imdbConfirmed = true;
        }
      }
    }

    const $ = cheerio.load(contentHtml);
    const html = contentHtml;

    const infoBlock = this.extractInfoBlock($, html);
    const globalOriginalTitle = infoBlock.originalTitle || undefined;
    const year = infoBlock.year;
    const years = infoBlock.years || (infoBlock.year ? [infoBlock.year] : undefined);

    // DEBUG: revela o que o infoBlock achou — usado pra rastrear de onde vem o "size global"
    logger.debug(
      `WP INFO_BLOCK | provider=${provider}` +
      ` | size="${infoBlock.size || '-'}"` +
      ` | originalTitle="${(infoBlock.originalTitle || '-').substring(0, 50)}"` +
      ` | year=${infoBlock.year ?? '-'}` +
      ` | years=[${infoBlock.years?.join(',') ?? '-'}]`
    );

    const content = html;
    const { dualIndex, legendadoIndex } = this.findSectionBoundaries($, content);

    if (dualIndex === null && legendadoIndex !== null) {
      logger.debug(`WP ${provider}: sem seção DUAL (apenas legendado) — post "${titleRendered.substring(0, 50)}" ignorado`);
      return [];
    }

    logger.debug(`WP ${provider}: processando magnets diretos...`);
    const directMagnets = await this.processDirectMagnets($, content, dualIndex, legendadoIndex, titleRendered, html, provider, type, globalOriginalTitle, year, years);
    logger.debug(`WP ${provider}: ${directMagnets.length} magnets diretos encontrados`);

    const protectorLinks = $('a[href*="systemads.net"], a[href*="systemads1.com"]').toArray();
    logger.debug(`WP ${provider}: ${protectorLinks.length} links de protetor encontrados`);

    const protectorResults = await this.processProtectorLinks($, content, dualIndex, legendadoIndex, titleRendered, html, provider, type, globalOriginalTitle, year, infoBlock, protectorLinks, years);

    const seenInfoHashes = new Set<string>();
    const all = [...directMagnets, ...protectorResults].filter(r => {
      const hash = r.magnet.match(/btih:([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (hash && seenInfoHashes.has(hash)) return false;
      if (hash) seenInfoHashes.add(hash);
      return true;
    });

    logger.debug(`WP ${provider}: post concluído, total de torrents: ${all.length} (diretos: ${directMagnets.length}, protetores: ${protectorResults.length})`);
    if (imdbConfirmed) {
      for (const r of all) r.imdbConfirmed = true;
    }
    return all;
  }

  // Um elemento está "dentro da seção válida" quando:
  // - não há nenhuma seção (aceita tudo), ou
  // - há seção DUAL e o elemento vem depois dela e antes de LEGENDADO (se existir).
  estaEntreSecoes(pos: number, dualIndex: number | null, legendadoIndex: number | null): boolean {
    if (dualIndex === null && legendadoIndex === null) return true;
    if (dualIndex === null) return false;
    if (pos < dualIndex) return false;
    if (legendadoIndex !== null && pos >= legendadoIndex) return false;
    return true;
  }

  async processDirectMagnets(
    $: any,
    content: string,
    dualIndex: number | null,
    legendadoIndex: number | null,
    postTitle: string,
    html: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined,
    years?: number[]
  ): Promise<TorrentResult[]> {
    const magnetElements = $('a[href^="magnet:"]').toArray();

    const filteredElements = (dualIndex === null && legendadoIndex === null)
      ? magnetElements
      : magnetElements.filter((el: any) => {
        const hrefPos = content.indexOf($(el).toString());
        if (hrefPos === -1) return true;
        return this.estaEntreSecoes(hrefPos, dualIndex, legendadoIndex);
      });

    // DEBUG: quantos parentTexts únicos existem?
    // Se for 1 pra N magnets → todos no mesmo <p> → size/qualidade vazam entre eles.
    const parentTextsUnicos = new Set<string>(
      filteredElements.map((el: any) => String($(el).parent().text().trim()))
    );
    const parentPreview = [...parentTextsUnicos]
      .slice(0, 3)
      .map((t: string) => t.substring(0, 60).replace(/\s+/g, ' '));

    const results: TorrentResult[] = [];

    const batchSize = 5;
    for (let i = 0; i < filteredElements.length; i += batchSize) {
      const batch = filteredElements.slice(i, i + batchSize);
      const batchPromises = batch.map(async (el: any) => {
        const magnet = $(el).attr('href');
        if (!magnet) return null;

        const parentText = $(el).parent().text().trim();
        const linkText = $(el).text().trim();
        const fullContextText = this.getFullContextText($(el));
        const ctxLocal = this.extrairContextoLocal($, el);
        return this.processMagnetItem(magnet, parentText, linkText, fullContextText, ctxLocal, postTitle, html, provider, type, globalOriginalTitle, year, years);
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
  }

  async processProtectorLinks(
    $: any,
    content: string,
    dualIndex: number | null,
    legendadoIndex: number | null,
    postTitle: string,
    html: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined,
    infoBlock: { size?: string; originalTitle?: string; year?: number },
    protectorLinks: any[],
    years?: number[]
  ): Promise<TorrentResult[]> {
    const results: TorrentResult[] = [];

    const filteredLinks = protectorLinks.filter((el: any) => {
      const linkPos = content.indexOf($(el).toString());
      if (linkPos === -1) return false;
      return this.estaEntreSecoes(linkPos, dualIndex, legendadoIndex);
    });

    for (let i = 0; i < filteredLinks.length; i += this.PROTECTOR_BATCH_SIZE) {
      const batch = filteredLinks.slice(i, i + this.PROTECTOR_BATCH_SIZE);
      const batchPromises = batch.map(async (el: any) => {
        const protectorUrl = $(el).attr('href');
        if (!protectorUrl) return null;

        logger.debug(`WP ${provider}: extraindo magnet do protetor ${protectorUrl.substring(0, 50)}...`);
        const magnet = await this.extractMagnetFromProtector(protectorUrl);
        if (!magnet) {
          logger.warn(`WP ${provider}: magnet NULO do protetor ${protectorUrl.substring(0, 50)}`);
          return null;
        }
        logger.debug(`WP ${provider}: magnet obtido do protetor: ${magnet.substring(0, 60)}...`);

        const parentText = $(el).parent().text().trim();
        const linkText = $(el).text().trim();
        const fullContextText = this.getFullContextText($(el));
        const ctxLocal = this.extrairContextoLocal($, el);

        return this.processMagnetItem(magnet, parentText, linkText, fullContextText, ctxLocal, postTitle, html, provider, type, globalOriginalTitle, year, years);
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
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
      logger.warn(`WP ${provider}: erro ao analisar magnet: ${err.message}`);
    }
    return null;
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
    years?: number[]
  ): Promise<TorrentResult | null> {
    const dados = await this.analisarMagnetComCache(magnet, provider);
    const canonicalName = dados?.nome ?? null;

    // Mexi aqui pra delegar toda a detecção pro QualityDetector numa cadeia clara de prioridade
    // Antes a qualidade vinha só de linkText/contextQuality/detectQuality e não pegava alt da img nem irmão anterior
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
      logger.warn(`WP ${provider}: qualidade "${quality}" NÃO permitida | fonte=${fonteQualidade}`);
      return null;
    }

    // DEBUG: rastreia size e qualidade por magnet. Ajuda a saber se o size do post
    // está vazando pra todos os magnets ou se cada um tem seu valor individual.
    const sizeParent = this.extractSize(parentText);
    const sizePost = this.extractSize(postTitle);
    const size = sizeParent || sizePost;

    const parentPreview = parentText.substring(0, 100).replace(/\s+/g, ' ');
    logger.debug(
      `WP ITEM_DEBUG | provider=${provider}` +
      ` | magnet=${magnet.substring(0, 20)}...` +
      ` | quality="${quality}" (fonte=${fonteQualidade})` +
      ` | dn="${(canonicalName || '').substring(0, 70)}"` +
      ` | size_parent="${sizeParent}" | size_post="${sizePost}" | size_final="${size}"` +
      ` | parentPreview="${parentPreview}"`
    );

    const language = this.extractLanguage(postTitle) || this.extractLanguage(parentText) || 'Desconhecido';
    const episode = this.extractEpisodeFromText(parentText);
    const cleanedHtmlTitle = this.cleanHtmlTitle(parentText, linkText, quality);

    const cleanTitleFromPost = this.extractTitleFromPostTitle(postTitle);

    const originalTitleFinal = this.extractOriginalTitleFromContext(parentText) || globalOriginalTitle || cleanTitleFromPost;
    const displayTitle = cleanTitleFromPost || canonicalName || postTitle;

    // Mexi aqui porque magnet sem dn= deixava canonicalName vazio, e aí a stream caía no title genérico do post
    // Se veio do magnet, preserva; se não, sintetiza com originalTitle + anos + qualidade
    const canonicalFinal = canonicalName || this.sintetizarCanonicalName(
      originalTitleFinal || postTitle,
      years,
      quality
    );

    if (!canonicalName) {
      logger.debug(`WP ${provider}: canonicalName sintetizado | post="${postTitle.substring(0, 40)}" | canon="${canonicalFinal}"`);
    }

    // Log rastreável da qualidade escolhida — ajuda a saber qual fonte ganhou em cada magnet
    logger.debug(`WP QUALIDADE | provider=${provider} | magnet=${magnet.substring(0, 40)}... | qualidade=${quality} | fonte=${fonteQualidade}`);

    return {
      title: this.cleanTitle(displayTitle),
      htmlTitle: cleanedHtmlTitle || undefined,
      magnet,
      seeders: this.estimateSeeders(provider),
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
      year,
      years: years ?? (year ? [year] : undefined),
      canonicalName: canonicalFinal,
    };
  }

  // Mexi aqui pra limpar caracteres soltos no fim do título base antes de compor o canonical
  // "Ice Age*" vira "Ice Age", "A Era do Gelo !" vira "A Era do Gelo"
  private limparTituloBase(titulo: string): string {
    return titulo
      .replace(/[*]+/g, '')
      .replace(/[?!,;:]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Mexi aqui pra montar nome descritivo quando o magnet não traz dn= próprio
  // Formato: "Título Base <anos> <qualidade>", tipo "A Era do Gelo 2 2006 720p"
  private sintetizarCanonicalName(base: string, years: number[] | undefined, quality: string): string {
    const baseLimpo = this.limparTituloBase(base);

    const anos = years && years.length > 0
      ? (years.length === 1
        ? `${years[0]}`
        : `${years[0]}-${years[years.length - 1]}`)
      : null;

    return [baseLimpo, anos, quality].filter(Boolean).join(' ').trim();
  }

  // Mexi aqui porque o regex antigo (\s*[–|-]\s*) cortava "1-4" no hífen sem espaços,
  // transformando "A Era do Gelo 1-4 (2012) – BluRay..." em "A Era do Gelo 1"
  // Agora só corta quando o separador tem espaços em volta, preservando ranges tipo 1-4
  extractTitleFromPostTitle(postTitle: string): string | null {
    if (!postTitle) return null;
    const original = postTitle;
    const limpo = postTitle
      .replace(/\bTorrent\b.*$/i, '')
      .replace(/\s+[–|-]\s+.*$/, '')
      .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-DL|DUAL|Dublado|Legendado)\b.*$/i, '')
      .trim();

    if (original !== limpo) {
      logger.debug(`WP EXTRACT_TITLE | post="${original.substring(0, 60)}" | extraido="${limpo.substring(0, 60)}"`);
    }

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

    // Mexi aqui porque "Ice Age*" virava título base sujo no canonicalName sintetizado
    const originalBruto = originalMatch?.[1]?.trim();
    const originalTitle = originalBruto ? this.limparTituloBase(originalBruto) : undefined;

    return {
      originalTitle,
      translatedTitle: translatedMatch?.[1]?.trim(),
      year: years.length > 0 ? years[0] : undefined,
      years,
      size: sizeMatch?.[1]?.trim(),
    };
  }

  async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        logger.debug(`WP Protetor: tentativa ${attempt + 1} para ${protectorUrl.substring(0, 50)}`);
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
        logger.warn(`Falha ao extrair magnet do protetor (tentativa ${attempt + 1}): ${err.message}`);
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

  // Extrai valor + unidade de um texto tipo "3.12 GB". Fonte única para
  // extractSize (formata) e parseSize (converte pra bytes).
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
    // "legenda" sozinho (substantivo) não basta — pode ser rótulo de metadado.
    if (f.temLegendado || f.temLegendaSubstantivo) return 'Legendado';
    return 'Desconhecido';
  }

  cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  estimateSeeders(provider: string): number {
    const base: Record<string, number> = { 'Comando Torrents': 50, default: 20 };
    return Math.floor((base[provider] || base.default) * (0.6 + Math.random() * 0.8));
  }

  // Cabeçalho de seção: começa com "VERSÃO" ou é bem curto. Rejeita trailers, CTAs
  // e rótulos de metadado (substantivo "legenda" sem particípio).
  detectSectionType(text: string): 'DUAL' | 'LEGENDADO' | 'OUTRO' {
    const t = normalizarTexto(text).trim();

    if (/^(assistir|baixar|download|ver|trailer)\b/i.test(t)) return 'OUTRO';

    const pareceCabecalho = /^versao\b/i.test(t) || t.length <= 25;
    if (!pareceCabecalho) return 'OUTRO';

    const f = this.classificarTextoIdioma(text);
    const temDualCompleto = f.temDual && f.temAudio;

    // Só aceita LEGENDADO se tiver o particípio "legendado"/"legendada".
    // "legenda" sozinho é substantivo e costuma ser rótulo de metadado ou link.
    const temLegendadoCabecalho = f.temLegendado;

    if (temLegendadoCabecalho && !temDualCompleto && !f.temDublado) return 'LEGENDADO';
    if ((temDualCompleto || f.temDublado || f.temNacional) && !temLegendadoCabecalho) return 'DUAL';
    return 'OUTRO';
  }

  findSectionBoundaries($: any, content: string): SectionBoundaries {
    const selectors = ['strong', 'b'];
    let dualIndex: number | null = null;
    let legendadoIndex: number | null = null;

    for (const sel of selectors) {
      const elements = $(sel);
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (!text) continue;

        const sectionType = this.detectSectionType(text);
        if (sectionType === 'OUTRO') continue;

        const pos = content.indexOf($(elements[i]).toString());
        if (pos === -1) continue;

        if (sectionType === 'DUAL' && dualIndex === null) {
          dualIndex = pos;
        } else if (sectionType === 'LEGENDADO' && legendadoIndex === null && dualIndex !== null && pos > dualIndex) {
          legendadoIndex = pos;
          return { dualIndex, legendadoIndex };
        }
      }
    }

    return { dualIndex, legendadoIndex };
  }

  // Wrapper sobre extrairRangeEpisodios — mantém a assinatura antiga (só o número).
  extractEpisodeFromText(text: string): number | undefined {
    if (!text) return undefined;
    const range = extrairRangeEpisodios(text);
    return range?.episodeStart || undefined;
  }
}