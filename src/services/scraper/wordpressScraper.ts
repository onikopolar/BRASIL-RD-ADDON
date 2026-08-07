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

// ─── Configuração de rede ──────────────────────────────────────────────
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
  private readonly magnetCache = new Map<string, { nome: string | null; infoHash: string }>();
  private readonly POST_BATCH_SIZE = 3;
  private readonly PROTECTOR_BATCH_SIZE = 5;

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
    // A query agora já chega com a temporada (ex.: "rick and morty 4ª temporada")
    // Não removemos mais a informação de temporada – a responsabilidade é do chamador.
    const searchQuery = query.trim();
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

    // Processar posts em lotes paralelos
    for (let i = 0; i < relevantLinks.length; i += this.POST_BATCH_SIZE) {
      const batch = relevantLinks.slice(i, i + this.POST_BATCH_SIZE);
      const batchPromises = batch.map(link =>
        this.scrapePostHtml(link.url, link.title, site.name, type, queryWords)
          .then(r => r)
          .catch(() => [] as TorrentResult[])
      );
      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        results.push(...res);
      }
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

    // Extrair magnets dos protetores em lotes paralelos
    const allMagnets: { magnet: string; parentText: string; individualOriginalTitle?: string }[] = [];

    for (let i = 0; i < protectorLinks.length; i += this.PROTECTOR_BATCH_SIZE) {
      const batch = protectorLinks.slice(i, i + this.PROTECTOR_BATCH_SIZE);
      const batchPromises = batch.map(async (el: any) => {
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
        return { magnet, parentText, individualOriginalTitle };
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) allMagnets.push(r);
      }
    }

    // Processar todos os magnets em paralelo (com cache)
    const protectorResults: TorrentResult[] = [];
    if (allMagnets.length > 0) {
      const analyzed = await Promise.all(
        allMagnets.map(async ({ magnet, parentText, individualOriginalTitle }) => {
          const cached = this.magnetCache.get(magnet);
          let canonicalName: string | null = null;
          if (cached) {
            canonicalName = cached.nome;
          } else {
            try {
              const dados = await analisarMagnet(magnet);
              if (dados) {
                canonicalName = dados.nome;
                this.magnetCache.set(magnet, { nome: dados.nome, infoHash: dados.infoHash });
              }
            } catch {}
          }

          const title = canonicalName || postTitle;
          const quality = this.detectQuality(parentText, postTitle, html, magnet);
          if (!allowedQualities.has(quality)) return null;

          const size = infoBlock.size || this.extractSize(parentText);
          const language = this.extractLanguage(postTitle) || 'Desconhecido';
          const episode = this.extractEpisodeFromText(parentText);

          return {
            title: this.cleanTitle(title),
            htmlTitle: parentText || postTitle,
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
            originalTitle: individualOriginalTitle || globalOriginalTitle,
            year,
            canonicalName: canonicalName ?? undefined,
          } as TorrentResult;
        })
      );

      for (const r of analyzed) {
        if (r) protectorResults.push(r);
      }
    }

    return [...directMagnets, ...protectorResults];
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

    const batchSize = 5;
    for (let i = 0; i < magnetElements.length; i += batchSize) {
      const batch = magnetElements.slice(i, i + batchSize);
      const batchPromises = batch.map(async (el: any) => {
        const magnet = $(el).attr('href');
        if (!magnet) return null;

        const hrefPos = content.indexOf(magnet);
        if (hrefPos !== -1) {
          if (dualIndex !== null && hrefPos < dualIndex) return null;
          if (legendadoIndex !== null && hrefPos >= legendadoIndex) return null;
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
          if (!match) return null;
        }

        const parentText = $(el).parent().text().trim();
        const individualOriginalTitle = this.extractOriginalTitleFromContext(parentText) || globalOriginalTitle;

        const cached = this.magnetCache.get(magnet);
        let canonicalName: string | null = null;
        if (cached) {
          canonicalName = cached.nome;
        } else {
          try {
            const dados = await analisarMagnet(magnet);
            if (dados) {
              canonicalName = dados.nome;
              this.magnetCache.set(magnet, { nome: dados.nome, infoHash: dados.infoHash });
            }
          } catch {}
        }

        const title = canonicalName || postTitle;
        const quality = this.detectQuality(parentText, postTitle, html, magnet);
        if (!allowedQualities.has(quality)) return null;

        const size = this.extractSize(parentText);
        const language = this.extractLanguage(postTitle) || 'Desconhecido';
        const episode = this.extractEpisodeFromText(parentText);

        return {
          title: this.cleanTitle(title),
          htmlTitle: parentText || postTitle,
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
        } as TorrentResult;
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
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

  private async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await axios.get(protectorUrl, {
          ...htmlAxiosConfig,
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

  private extractCanonicalName(magnet: string): Promise<string | null> {
    return Promise.resolve(null);
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

  private extractEpisodeFromText(text: string): number | undefined {
    if (!text) return undefined;
    const match = text.match(/epis[oó]dio\s*(\d+)/i);
    if (match) return parseInt(match[1], 10);
    const altMatch = text.match(/\b(?:ep|e)\s*(\d+)\b/i);
    if (altMatch) return parseInt(altMatch[1], 10);
    return undefined;
  }
}