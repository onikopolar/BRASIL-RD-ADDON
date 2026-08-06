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
import { INDICADORES_INTERNACIONAL_TORRENTS } from '../../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

const logger = new Logger('WordPressScraper');

// Força DNS público para bypass de bloqueios de operadora
dns.setServers(['8.8.8.8', '1.1.1.1']);

// Agente HTTPS customizado: resolve IP via Google DNS + conecta com SNI correto
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
  {
    name: 'Starck Oficial',
    baseUrl: 'https://www.starck-oficial.com',
    priority: 1,
    timeout: 15000,
  },
];

const htmlAxiosConfig = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export class WordPressScraper {
  private readonly qualityDetector: QualityDetector;

  constructor() {
    this.qualityDetector = new QualityDetector();
  }

  async search(query: string, type: 'movie' | 'series'): Promise<TorrentResult[]> {
    const results: TorrentResult[] = [];
    const activeSites = WP_SITES.filter(s => s.priority > 0).sort((a, b) => b.priority - a.priority);
    const promises = activeSites.map(site =>
      this.searchSite(site, query, type).then(r => r).catch(err => {
        logger.warn(`WP ${site.name} FALHOU`, { query: query.substring(0, 60), error: err.code || err.message });
        return [] as TorrentResult[];
      })
    );
    const arrays = await Promise.all(promises);
    arrays.forEach(arr => results.push(...arr));
    return results;
  }

  async searchSite(
    site: WordPressSite,
    query: string,
    type: 'movie' | 'series'
  ): Promise<TorrentResult[]> {
    const cleanQuery = query
      .replace(/\b\d+ª\s*(temporada|temp)\b/gi, '')
      .replace(/\btemporada\s*\d+\b/gi, '')
      .replace(/\bseason\s*\d+\b/gi, '')
      .replace(/\bs\d{2}\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const searchQuery = cleanQuery || query;
    const searchUrl = `${site.baseUrl}/?s=${encodeURIComponent(searchQuery)}`;
    logger.debug(`WP ${site.name}: buscando HTML "${searchUrl}"`);

    const response = await axios.get(searchUrl, htmlAxiosConfig);
    const $ = cheerio.load(response.data);

    const postLinks: { title: string; url: string }[] = [];
    const seenUrls = new Set<string>();
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 10) return;
      if (href.includes('/categoria/') || href.includes('/tag/') || href === '/' || href.includes('#')) return;
      if (seenUrls.has(href)) return;
      seenUrls.add(href);
      const fullUrl = href.startsWith('http') ? href : `${site.baseUrl}${href}`;
      postLinks.push({ title: text, url: fullUrl });
    });

    const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(de|do|da|dos|das|e|a|o|em|no|na|os|as|um|uma|the|of|and|or|in|on|at|to|for|is|it)$/i.test(w));
    const relevantLinks = postLinks.filter(link => {
      const lowerTitle = link.title.toLowerCase();
      if (/\blist[aã]o\b/i.test(lowerTitle)) return false;
      if (queryWords.length === 0) return true;
      return queryWords.some(w => lowerTitle.includes(w));
    }).slice(0, 5);

    logger.info(`WP ${site.name}: ${relevantLinks.length} posts relevantes na busca HTML para "${searchQuery}"`);

    const results: TorrentResult[] = [];
    for (const postLink of relevantLinks) {
      try {
        const extracted = await this.scrapePostHtml(postLink.url, postLink.title, site.name, type, queryWords);
        results.push(...extracted);
      } catch { /* ignora post que falhou */ }
    }
    return results;
  }

  private async scrapePostHtml(
    postUrl: string,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series',
    queryWords: string[]
  ): Promise<TorrentResult[]> {
    const response = await axios.get(postUrl, htmlAxiosConfig);
    const html = response.data;
    const $ = cheerio.load(html);

    const infoBlock = this.extractInfoBlock($, html);
    const globalOriginalTitle = infoBlock.originalTitle || undefined;
    const year = infoBlock.year;

    const content = $('.entry-content, .post-content, article').first().html() || html;
    const { dualIndex, legendadoIndex } = this.findSectionBoundaries($, content);

    const directMagnets = await this.processDirectMagnets($, content, dualIndex, legendadoIndex, postTitle, html, provider, type, globalOriginalTitle, year, queryWords);

    const protectorLinks = $('a[href*="systemads.net"], a[href*="systemads1.com"]').toArray();

    // ═══ PARALELIZAÇÃO: extrair magnets de todos os links de uma vez ═══
    const magnetPromises = protectorLinks.map(async (el) => {
      const protectorUrl = $(el).attr('href');
      if (!protectorUrl) return null;

      const hrefPos = content.indexOf(protectorUrl);
      if (hrefPos !== -1) {
        if (dualIndex !== null && hrefPos < dualIndex) return null;
        if (legendadoIndex !== null && hrefPos >= legendadoIndex) return null;
      }

      const magnet = await this.extractMagnetFromProtector(protectorUrl);
      if (!magnet) return null;

      const parentText = $(el).parent().text().trim();
      const individualOriginalTitle = this.extractOriginalTitleFromContext(parentText) || globalOriginalTitle;
      const canonicalName = await this.extractCanonicalName(magnet);
      const title = canonicalName || postTitle;
      const quality = this.detectQuality(parentText, postTitle, html, magnet);
      if (!allowedQualities.has(quality)) return null;

      const size = infoBlock.size || this.extractSize(parentText);
      const language = this.extractLanguage(postTitle) || 'Desconhecido';

      // ═══ EXTRAI EPISÓDIO DO CONTEXTO E PREENCHE htmlTitle ═══
      const episode = this.extractEpisodeFromText(parentText);

      return {
        title: this.cleanTitle(title),
        htmlTitle: parentText || postTitle, // <-- ADICIONADO: contexto HTML
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
        canonicalName,
      } as TorrentResult;
    });

    const protectorMagnets = (await Promise.all(magnetPromises)).filter(Boolean) as TorrentResult[];

    return [...directMagnets, ...protectorMagnets];
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
    year: number | undefined,
    queryWords: string[]
  ): Promise<TorrentResult[]> {
    const magnetElements = $('a[href^="magnet:"]').toArray();
    const results: TorrentResult[] = [];

    for (const el of magnetElements) {
      const magnet = $(el).attr('href');
      if (!magnet) continue;

      const hrefPos = content.indexOf(magnet);
      if (hrefPos !== -1) {
        if (dualIndex !== null && hrefPos < dualIndex) continue;
        if (legendadoIndex !== null && hrefPos >= legendadoIndex) continue;
      }

      if (queryWords.length > 0) {
        let contextText = '';
        let current = $(el).parent();
        for (let depth = 0; depth < 5; depth++) {
          const text = current.text().trim().toLowerCase();
          if (text.length > 20) {
            contextText = text;
            break;
          }
          current = current.parent();
        }
        if (!contextText) contextText = postTitle.toLowerCase();
        const match = queryWords.some(w => contextText.includes(w));
        if (!match) continue;
      }

      const parentText = $(el).parent().text().trim();
      const individualOriginalTitle = this.extractOriginalTitleFromContext(parentText) || globalOriginalTitle;

      const canonicalName = await this.extractCanonicalName(magnet);
      const title = canonicalName || postTitle;

      const quality = this.detectQuality(parentText, postTitle, html, magnet);
      if (!allowedQualities.has(quality)) continue;

      const size = this.extractSize(parentText);
      const language = this.extractLanguage(postTitle) || 'Desconhecido';

      // ═══ EXTRAI EPISÓDIO DO CONTEXTO E PREENCHE htmlTitle ═══
      const episode = this.extractEpisodeFromText(parentText);

      results.push({
        title: this.cleanTitle(title),
        htmlTitle: parentText || postTitle, // <-- ADICIONADO: contexto HTML
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
      });
    }

    return results;
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
    const articleText = $('article, .entry-content, .post-content').first().text() || html;
    const originalMatch = articleText.match(/Título\s+Original:\s*([^\n]+)/i);
    const translatedMatch = articleText.match(/Título\s+Traduzido:\s*([^\n]+)/i);
    const yearMatch = articleText.match(/Lançamento:\s*(\d{4})/i);
    const sizeMatch = articleText.match(/Tamanho:\s*([^\n]+)/i);

    return {
      originalTitle: originalMatch?.[1]?.trim(),
      translatedTitle: translatedMatch?.[1]?.trim(),
      year: yearMatch ? parseInt(yearMatch[1]) : undefined,
      size: sizeMatch?.[1]?.trim(),
    };
  }

  /**
   * Extrai magnet do protetor com retry e SEM referer fixo.
   * O referer fixo (comando1.com) estava bloqueando o acesso em alguns casos.
   */
  private async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await axios.get(protectorUrl, {
          ...htmlAxiosConfig,
          timeout: 12000,
          maxRedirects: 5,
          // SEM referer fixo – confia apenas nos headers padrão
        });
        const html: string = res.data;
        const match = html.match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
        if (match) return match[1];

        // Fallback: tenta encontrar DEST_URL em outras variações
        const altMatch = html.match(/DEST_URL\s*=\s*"([^"]+)"/);
        if (altMatch) return altMatch[1];

      } catch (err: any) {
        if (attempt < maxAttempts - 1) {
          // Aguarda 500ms antes de tentar novamente
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

  /** Método assíncrono que delega ao magnetHelper (parse-torrent) para obter o nome canônico */
  private async extractCanonicalName(magnet: string): Promise<string | null> {
    try {
      const dados = await analisarMagnet(magnet);
      return dados?.nome || null;
    } catch {
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
  }

  /** Método síncrono (fallback) usado apenas para detectQuality, para não exigir async */
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
    if (lower.includes('dual')) return 'Dual';
    if (lower.includes('dublado') || lower.includes('dublad')) return 'Dublado';
    if (LEGENDADO_REGEX.test(lower)) return 'Legendado';
    return 'Desconhecido';
  }

  private cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  private async extrairInfoHashDoMagnet(magnet: string): Promise<string | null> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : null;
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

  private findSectionBoundaries($: any, content: string): { dualIndex: number | null; legendadoIndex: number | null } {
    const selectors = ['h2', 'strong'];
    let dualIndex: number | null = null;
    let legendadoIndex: number | null = null;

    for (const sel of selectors) {
      const elements = $(sel);
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();
        if (dualIndex === null && /::\s*DUAL\s+[ÁA]UDIO\s*::/i.test(text)) {
          const html = $(elements[i]).toString();
          const pos = content.indexOf(html);
          if (pos !== -1) dualIndex = pos;
        }
        if (dualIndex !== null && legendadoIndex === null && /::\s*LEGENDADO\s*::/i.test(text)) {
          const html = $(elements[i]).toString();
          const pos = content.indexOf(html);
          if (pos !== -1 && pos > dualIndex) legendadoIndex = pos;
        }
      }
    }

    if (dualIndex === null) {
      for (const sel of selectors) {
        const elements = $(sel);
        for (let i = 0; i < elements.length; i++) {
          const text = $(elements[i]).text().trim();
          if (/\bDUAL\s+[ÁA]UDIO\b/i.test(text) && !/ADICIONADO/i.test(text)) {
            const html = $(elements[i]).toString();
            const pos = content.indexOf(html);
            if (pos !== -1) { dualIndex = pos; break; }
          }
        }
        if (dualIndex !== null) break;
      }
    }

    if (legendadoIndex === null) {
      for (const sel of selectors) {
        const elements = $(sel);
        for (let i = 0; i < elements.length; i++) {
          const text = $(elements[i]).text().trim();
          if (/\bLEGENDADO\b/.test(text) && !/:/.test(text)) {
            const html = $(elements[i]).toString();
            const pos = content.indexOf(html);
            if (pos !== -1 && (dualIndex === null || pos > dualIndex)) {
              legendadoIndex = pos;
              break;
            }
          }
        }
        if (legendadoIndex !== null) break;
      }
    }

    return { dualIndex, legendadoIndex };
  }

  /**
   * Extrai número do episódio de um texto (ex: "Episódio 01: 1080p" → 1)
   */
  private extractEpisodeFromText(text: string): number | undefined {
    if (!text) return undefined;
    const match = text.match(/epis[oó]dio\s*(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }
    // Fallback: tenta "EP 01" ou "E01"
    const altMatch = text.match(/\b(?:ep|e)\s*(\d+)\b/i);
    if (altMatch) {
      return parseInt(altMatch[1], 10);
    }
    return undefined;
  }
}