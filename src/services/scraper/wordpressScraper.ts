import axios from 'axios';
import * as cheerio from 'cheerio';
import * as tunnel from 'tunnel';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { allowedQualities } from './scraperConfigs.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { INDICADORES_INTERNACIONAL_TORRENTS, extrairRangeEpisodios, normalizarTexto } from '../../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

const logger = new Logger('WordPressScraper');

dns.setServers(['8.8.8.8', '1.1.1.1']);

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

function criarLookup() {
  return (hostname: string, _opts: any, cb: any) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      cb(null, addresses[0], 4);
    });
  };
}
export const lookupCustomizado = criarLookup();

interface WordPressSite {
  name: string;
  baseUrl: string;
  priority: number;
  timeout: number;
  requiresProxy?: boolean;
}

function createProxyAgent(proxyUrl: string): any {
  const url = new URL(proxyUrl);
  const host = url.hostname;
  const port = parseInt(url.port) || (url.protocol === 'https:' ? 443 : 8118);
  if (url.protocol === 'https:') {
    return tunnel.httpsOverHttps({ proxy: { host, port } });
  }
  return tunnel.httpsOverHttp({ proxy: { host, port } });
}

const WP_SITES: WordPressSite[] = [
  {
    name: 'Comando Torrents',
    baseUrl: 'https://comando1.com',
    priority: 2,
    timeout: 15000,
  },
];

const jsonAxiosConfig = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export class WordPressScraper {
  private readonly qualityDetector: QualityDetector;
  private readonly magnetCache = new Map<string, { nome: string | null; infoHash: string }>();
  private readonly POST_BATCH_SIZE = 3;
  private readonly PROTECTOR_BATCH_SIZE = 5;

  constructor() {
    this.qualityDetector = new QualityDetector();
  }

  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[]
  ): Promise<TorrentResult[]> {
    const queriesParaBusca = searchQueries && searchQueries.length > 0
      ? searchQueries
      : [query];

    const activeSites = WP_SITES.filter(s => s.priority > 0).sort((a, b) => b.priority - a.priority);

    for (const q of queriesParaBusca) {
      logger.debug(`WordPress: tentando busca com query "${q}"`);
      const resultados = await Promise.all(
        activeSites.map(site =>
          this.searchSite(site, q, type, targetSeason, searchQueries).catch(err => {
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
    searchQueries?: string[]
  ): Promise<TorrentResult[]> {
    const searchQuery = query.trim();
    const searchUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(searchQuery)}&per_page=10&_fields=id,title,link`;
    logger.debug(`WP ${site.name}: buscando API "${searchUrl}"`);

    const response = await axios.get(searchUrl, jsonAxiosConfig);
    const posts = response.data;

    const postItems: { id: number; title: string; url: string }[] = [];

    for (const post of posts) {
      if (!post.id || !post.title?.rendered || !post.link) continue;
      postItems.push({
        id: post.id,
        title: post.title.rendered,
        url: post.link,
      });
    }

    const queryRange = extrairRangeEpisodios(searchQuery);
    const querySeason = targetSeason ?? queryRange?.season;
    if (querySeason) {
      logger.debug(`WP ${site.name}: temporada detectada na query: ${querySeason}`);
    }

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

    logger.debug(`WP ${site.name}: frases possíveis: [${[...frases].join(' | ')}]`);

    const relevantPosts = postItems.filter(post => {
      const lowerTitle = post.title.toLowerCase();
      if (/\blist[aã]o\b/i.test(lowerTitle)) return false;

      if (querySeason) {
        const seasonPatterns = [
          new RegExp(`\\b${querySeason}\\s*[ªº°]?\\s*temporada\\b`, 'i'),
          new RegExp(`\\btemporada\\s*${querySeason}\\b`, 'i'),
          new RegExp(`\\bseason\\s*${querySeason}\\b`, 'i'),
        ];
        if (!seasonPatterns.some(p => p.test(lowerTitle))) {
          return false;
        }
      }

      const titleNormalizado = normalizarTexto(post.title);
      const match = [...frases].some(frase => titleNormalizado.includes(frase));
      if (!match) {
        logger.debug(`WP ${site.name}: post ignorado (frase não encontrada): "${post.title.substring(0, 50)}"`);
        return false;
      }

      return true;
    }).slice(0, 5);

    logger.info(`WP ${site.name}: ${relevantPosts.length} posts relevantes na API para "${searchQuery}"`);

    const results: TorrentResult[] = [];

    for (let i = 0; i < relevantPosts.length; i += this.POST_BATCH_SIZE) {
      const batch = relevantPosts.slice(i, i + this.POST_BATCH_SIZE);
      logger.debug(`WP ${site.name}: processando lote ${Math.floor(i / this.POST_BATCH_SIZE) + 1}/${Math.ceil(relevantPosts.length / this.POST_BATCH_SIZE)} (${batch.length} posts)`);
      const batchPromises = batch.map(post =>
        this.scrapePostApi(post.id, post.title, site.name, type)
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

  private extractQualityFromText(text: string): string | null {
    const match = text.match(/\b(\d{3,4}p|4K|HD)\b/i);
    return match ? match[1].toLowerCase() : null;
  }

  private getFullContextText($el: any): string {
    let current = $el.parent();
    for (let depth = 0; depth < 4; depth++) {
      const text = current.text().trim();
      if (text.length > 10 && /\b\d{3,4}p\b/i.test(text)) {
        return text;
      }
      current = current.parent();
    }
    return $el.parent().text().trim();
  }

  private cleanHtmlTitle(parentText: string, linkText: string, qualityOverride?: string | null): string {
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
      const match = linkText.match(/\b(\d{3,4}p|4K|HD)\b/i);
      quality = match ? match[1].toLowerCase() : null;
    }

    return quality ? `${episode}: ${quality}` : episode;
  }

  private async scrapePostApi(
    postId: number,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series'
  ): Promise<TorrentResult[]> {
    logger.debug(`WP ${provider}: iniciando scraping do post API "${postTitle.substring(0, 60)}"`);
    const postUrl = `https://comando1.com/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content`;
    const response = await axios.get(postUrl, jsonAxiosConfig);
    const post = response.data;
    const titleRendered = post.title?.rendered || postTitle;
    const contentHtml = post.content?.rendered || '';

    if (!contentHtml) {
      logger.warn(`WP ${provider}: conteúdo vazio para post ${postId}`);
      return [];
    }

    const $ = cheerio.load(contentHtml);
    const html = contentHtml;

    const infoBlock = this.extractInfoBlock($, html);
    const globalOriginalTitle = infoBlock.originalTitle || undefined;
    const year = infoBlock.year;

    const content = html;
    const { dualIndex, legendadoIndex } = this.findSectionBoundaries($, content);

    if (dualIndex === null && legendadoIndex !== null) {
      logger.debug(`WP ${provider}: sem seção DUAL (apenas legendado) — post "${titleRendered.substring(0, 50)}" ignorado`);
      return [];
    }

    logger.debug(`WP ${provider}: processando magnets diretos...`);
    const directMagnets = await this.processDirectMagnets($, content, dualIndex, legendadoIndex, titleRendered, html, provider, type, globalOriginalTitle, year);
    logger.debug(`WP ${provider}: ${directMagnets.length} magnets diretos encontrados`);

    const protectorLinks = $('a[href*="systemads.net"], a[href*="systemads1.com"]').toArray();
    logger.debug(`WP ${provider}: ${protectorLinks.length} links de protetor encontrados`);

    const protectorResults = await this.processProtectorLinks($, content, dualIndex, legendadoIndex, titleRendered, html, provider, type, globalOriginalTitle, year, infoBlock, protectorLinks);

    const seenInfoHashes = new Set<string>();
    const all = [...directMagnets, ...protectorResults].filter(r => {
      const hash = r.magnet.match(/btih:([a-z0-9]+)/i)?.[1]?.toLowerCase();
      if (hash && seenInfoHashes.has(hash)) return false;
      if (hash) seenInfoHashes.add(hash);
      return true;
    });

    logger.debug(`WP ${provider}: post concluído, total de torrents: ${all.length} (diretos: ${directMagnets.length}, protetores: ${protectorResults.length})`);
    return all;
  }

  private async processDirectMagnets(
    $: any,
    content: string,
    dualIndex: number | null,
    legendadoIndex: number | null,
    postTitle: string,
    html: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined
  ): Promise<TorrentResult[]> {
    const magnetElements = $('a[href^="magnet:"]').toArray();

    const filteredElements = (dualIndex === null && legendadoIndex === null)
      ? magnetElements
      : magnetElements.filter((el: any) => {
        const elementHtml = $(el).toString();
        const hrefPos = content.indexOf(elementHtml);
        if (hrefPos === -1) return true;
        if (dualIndex !== null && hrefPos < dualIndex) return false;
        if (legendadoIndex !== null && hrefPos >= legendadoIndex) return false;
        return true;
      });

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
        return this.processMagnetItem(magnet, parentText, linkText, fullContextText, postTitle, html, provider, type, globalOriginalTitle, year);
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
  }

  private async processProtectorLinks(
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
    protectorLinks: any[]
  ): Promise<TorrentResult[]> {
    const results: TorrentResult[] = [];

    const filteredLinks = protectorLinks.filter((el: any) => {
      if (dualIndex === null && legendadoIndex === null) return true;
      const linkHtml = $(el).toString();
      const linkPos = content.indexOf(linkHtml);
      if (linkPos === -1) return false;
      if (dualIndex !== null && linkPos < dualIndex) return false;
      if (legendadoIndex !== null && linkPos >= legendadoIndex) return false;
      return true;
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

        return this.processMagnetItem(magnet, parentText, linkText, fullContextText, postTitle, html, provider, type, globalOriginalTitle, year);
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
  }

  private async processMagnetItem(
    magnet: string,
    parentText: string,
    linkText: string,
    fullContextText: string,
    postTitle: string,
    html: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined
  ): Promise<TorrentResult | null> {
    const cached = this.magnetCache.get(magnet);
    let canonicalName: string | null = null;
    let infoHash: string | undefined;

    if (cached) {
      canonicalName = cached.nome;
      infoHash = cached.infoHash;
    } else {
      try {
        const dados = await analisarMagnet(magnet);
        if (dados) {
          canonicalName = dados.nome;
          infoHash = dados.infoHash;
          this.magnetCache.set(magnet, { nome: dados.nome, infoHash: dados.infoHash });
        }
      } catch (err: any) {
        logger.warn(`WP ${provider}: erro ao analisar magnet: ${err.message}`);
      }
    }

    const dnQuality = canonicalName ? this.extractQualityFromText(canonicalName) : null;
    const linkQuality = this.extractQualityFromText(linkText);
    const contextQuality = this.extractQualityFromText(fullContextText);

    const quality = dnQuality || linkQuality || contextQuality || this.detectQuality(parentText, postTitle, html, magnet);

    if (!allowedQualities.has(quality)) {
      logger.warn(`WP ${provider}: qualidade "${quality}" NÃO permitida`);
      return null;
    }

    const size = this.extractSize(parentText) || this.extractSize(postTitle);
    const language = this.extractLanguage(postTitle) || this.extractLanguage(parentText) || 'Desconhecido';
    const episode = this.extractEpisodeFromText(parentText);
    const cleanedHtmlTitle = this.cleanHtmlTitle(parentText, linkText, dnQuality || linkQuality);

    const individualOriginalTitle = this.extractOriginalTitleFromContext(parentText) || globalOriginalTitle;
    const title = canonicalName || postTitle;

    return {
      title: this.cleanTitle(title),
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
      originalTitle: individualOriginalTitle,
      year,
      canonicalName: canonicalName ?? undefined,
    };
  }

  private extractOriginalTitleFromContext(contextText: string): string | null {
    const match = contextText.match(/T[ií]tulo\s+Original:\s*([^\n]+)/i);
    return match?.[1]?.trim() || null;
  }

  private extractInfoBlock($: any, html: string): {
    originalTitle?: string;
    translatedTitle?: string;
    year?: number;
    size?: string;
  } {
    const articleText = $.root().text() || html;
    const titleText = articleText;

    // Corrigido para aceitar "Titulo Original" sem acento
    const originalMatch = articleText.match(/T[ií]tulo\s+Original:\s*([^\n]+)/i);
    const translatedMatch = articleText.match(/T[ií]tulo\s+Traduzido:\s*([^\n]+)/i);

    let yearMatch = articleText.match(/Ano de Lançamento:\s*(\d{4})/i) || articleText.match(/Lançamento\s*:?\s*(\d{4})/i);
    if (!yearMatch) {
      yearMatch = titleText.match(/\((\d{4})\)/);
    }
    if (!yearMatch) {
      yearMatch = titleText.match(/\b(19|20)\d{2}\b/);
    }

    const sizeMatch = articleText.match(/Tamanho:\s*([^\n]+)/i);

    return {
      originalTitle: originalMatch?.[1]?.trim(),
      translatedTitle: translatedMatch?.[1]?.trim(),
      year: yearMatch ? parseInt(yearMatch[1]) : undefined,
      size: sizeMatch?.[1]?.trim(),
    };
  }

  private async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
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
        if (match) {
          return match[1];
        }
        const altMatch = html.match(/DEST_URL\s*=\s*"([^"]+)"/);
        if (altMatch) {
          return altMatch[1];
        }
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

  private detectQuality(parentText: string, postTitle: string, fullHtml: string, magnet?: string): string {
    if (magnet) {
      const canonicalName = this.extractCanonicalNameSync(magnet);
      if (canonicalName) {
        const q = this.qualityDetector.extractQualityFromFilename(canonicalName);
        if (q && q !== 'HD' && allowedQualities.has(q)) return q;
      }
    }
    let quality = this.qualityDetector.extractQualityFromFilename(parentText);
    if (quality === 'HD') quality = this.qualityDetector.extractQualityFromFilename(postTitle);
    if (quality === 'HD') quality = this.qualityDetector.extractQualityFromFilename(fullHtml);
    return quality || 'HD';
  }

  private extractCanonicalNameSync(magnet: string): string | null {
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

  private extractSize(text: string): string {
    const m = text.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    return m ? `${m[1]} ${m[2]}` : 'Desconhecido';
  }

  private extractLanguage(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('nacional')) return 'Nacional';
    if (lower.includes('dual')) return 'Dual';
    if (lower.includes('dublado') || lower.includes('dublad')) return 'Dublado';
    if (LEGENDADO_REGEX.test(lower)) return 'Legendado';
    return 'Desconhecido';
  }

  private cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  private estimateSeeders(provider: string): number {
    const base: Record<string, number> = { 'BLUDV Filmes': 50, default: 20 };
    return Math.floor((base[provider] || base.default) * (0.6 + Math.random() * 0.8));
  }

  private parseSize(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'Desconhecido' || sizeStr === '–') return 0;
    const match = sizeStr.match(/([\d,.]+)\s*(GB|MB|KB)/i);
    if (!match) return 0;
    const num = parseFloat(match[1].replace(',', '.'));
    const unit = match[2].toUpperCase();
    if (unit === 'GB') return num * 1024 * 1024 * 1024;
    if (unit === 'MB') return num * 1024 * 1024;
    if (unit === 'KB') return num * 1024;
    return 0;
  }

  private detectSectionType(text: string): 'DUAL' | 'LEGENDADO' | 'OUTRO' {
    const t = text.toLowerCase();
    const hasNacional = /\bnacional\b/.test(t);
    const hasDual = /\bdual\b/.test(t) && (/\báudio\b|\baudio\b|\bdublado\b|\bdublagem\b/.test(t));
    const hasDublado = /\bdublado\b|\bdublada\b|\bdublagem\b/.test(t);
    const hasLegendado = /\blegendado\b|\blegendada\b|\blegenda\b/.test(t);

    if (hasLegendado && !hasDual && !hasDublado) return 'LEGENDADO';
    if ((hasDual || hasDublado || hasNacional) && !hasLegendado) return 'DUAL';
    return 'OUTRO';
  }

  private findSectionBoundaries($: any, content: string): { dualIndex: number | null; legendadoIndex: number | null } {
    const selectors = ['strong', 'b'];
    let dualIndex: number | null = null;
    let legendadoIndex: number | null = null;

    for (const sel of selectors) {
      const elements = $(sel);
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (!text || text.length > 30) continue;

        const sectionType = this.detectSectionType(text);
        if (sectionType === 'OUTRO') continue;

        const html = $(elements[i]).toString();
        const pos = content.indexOf(html);
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

  private extractEpisodeFromText(text: string): number | undefined {
    if (!text) return undefined;
    const match = text.match(/epis[oó]dio\s*(\d+)/i);
    if (match) return parseInt(match[1], 10);
    const altMatch = text.match(/\b(?:ep|e)\s*(\d+)\b/i);
    if (altMatch) return parseInt(altMatch[1], 10);
    return undefined;
  }
}