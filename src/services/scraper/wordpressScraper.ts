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

// Funcao lookup customizada: usa dns.resolve4 para bypassar DNS do sistema
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
  // HTTP proxy (mais comum: Privoxy, Squid, etc)
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

/** Config do axios reutilizada em todas as requisições HTML */
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
      this.searchSite(site, query, type).then(r => {
        return r;
      }).catch(err => {
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

    // Extrai links de posts da página de busca
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

    // Filtra links que parecem posts reais (têm parte do query no título)
    const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(de|do|da|dos|das|e|a|o|em|no|na|os|as|um|uma|the|of|and|or|in|on|at|to|for|is|it)$/i.test(w));
    const relevantLinks = postLinks.filter(link => {
      const lowerTitle = link.title.toLowerCase();
      if (/\blist[aã]o\b/i.test(lowerTitle)) return false; // pula listões
      if (queryWords.length === 0) return true;
      return queryWords.some(w => lowerTitle.includes(w));
    }).slice(0, 8); // limita a 8 posts para não sobrecarregar

    logger.info(`WP ${site.name}: ${relevantLinks.length} posts relevantes na busca HTML para "${searchQuery}"`);

    const results: TorrentResult[] = [];

    for (const postLink of relevantLinks) {
      try {
        const extracted = await this.scrapePostHtml(postLink.url, postLink.title, site.name, type, queryWords);
        results.push(...extracted);
      } catch {
        // ignora post que falhou
      }
    }

    return results;
  }

  /** Acessa o HTML completo de um post e extrai todos os magnets */
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

    // Extrai metadados do HTML bruto (título original, ano)
    const rawMeta = this.extractMetadataFromRawHtml(html);
    const originalTitle = rawMeta.originalTitle;
    const year = rawMeta.year;

    // ═══ Encontra limites DUAL/LEGENDADO ═══
    const content = $('.entry-content, .post-content, article').first().html() || html;
    const { dualIndex, legendadoIndex } = this.findSectionBoundaries($, content);

    const magnetElements = $('a[href^="magnet:"]').toArray();
    const results: TorrentResult[] = [];

    for (const el of magnetElements) {
      const magnet = $(el).attr('href');
      if (!magnet) continue;

      // Filtro DUAL/LEGENDADO
      const hrefPos = content.indexOf(magnet);
      if (hrefPos !== -1) {
        if (dualIndex !== null && hrefPos < dualIndex) continue;
        if (legendadoIndex !== null && hrefPos >= legendadoIndex) continue;
      }

      // Filtro de palavras-chave (BUSCA EM ANCESTRAIS)
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
        // fallback: usa o título do post se não achou nada
        if (!contextText) contextText = postTitle.toLowerCase();
        const match = queryWords.some(w => contextText.includes(w));
        if (!match) continue;
      }

      const quality = this.detectQuality($(el).parent().text(), postTitle, html);
      if (!allowedQualities.has(quality)) continue;

      const infoHash = await this.extrairInfoHashDoMagnet(magnet);
      const size = this.extractSize($(el).parent().text());
      const language = this.extractLanguage(postTitle) || 'Desconhecido';

      results.push({
        title: this.cleanTitle(postTitle),
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
        lastUpdated: new Date(),
        confidence: 0.85,
        originalTitle,
        year,
      });
    }

    return results;
  }

  /** Extrai metadados do HTML completo usando regex simples */
  private extractMetadataFromRawHtml(html: string): { originalTitle?: string; year?: number } {
    const originalMatch = html.match(/Título\s+Original[:\s<]+\s*([^<\n]+)/i);
    const yearMatch = html.match(/(?:Ano\s+de\s+)?Lançamento[:\s<]+\s*(\d{4})/i);
    return {
      originalTitle: originalMatch?.[1]?.trim() || undefined,
      year: yearMatch ? parseInt(yearMatch[1]) : undefined,
    };
  }

  private detectQuality(parentText: string, postTitle: string, fullHtml: string): string {
    let quality = this.qualityDetector.extractQualityFromFilename(parentText);
    if (quality === 'HD') quality = this.qualityDetector.extractQualityFromFilename(postTitle);
    if (quality === 'HD') quality = this.qualityDetector.extractQualityFromFilename(fullHtml);
    return quality || 'HD';
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
}