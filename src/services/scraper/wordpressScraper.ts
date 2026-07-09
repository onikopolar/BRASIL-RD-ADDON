import axios, { AxiosRequestConfig } from 'axios';
import * as cheerio from 'cheerio';
import * as tunnel from 'tunnel';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger';
import { TorrentResult } from './torrentTypes';
import { QualityDetector } from '../../lib/qualityDetector';
import { allowedQualities } from './scraperConfigs';

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

interface WordPressSite {
  name: string;
  baseUrl: string;
  priority: number;
  timeout: number;
  requiresProxy?: boolean;
}

// PROXY_URL no .env:
//   http://localhost:8118  → HTTP proxy (Privoxy, Squid)
//   https://localhost:8443 → HTTPS proxy
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
    name: 'BLUDV Filmes',
    baseUrl: 'https://bludvfilmes.xyz',
    priority: 10,
    timeout: 15000,
  },
  {
    name: 'Comando Torrents',
    baseUrl: 'https://comando1.com',
    priority: 8,
    timeout: 15000,
  },
];

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
        logger.warn(`❌ WP ${site.name} FALHOU`, { query: query.substring(0, 60), error: err.code || err.message });
        return [] as TorrentResult[];
      })
    );
    const arrays = await Promise.all(promises);
    arrays.forEach(arr => results.push(...arr));

    return results;
  }

  private async searchSite(
    site: WordPressSite,
    query: string,
    type: 'movie' | 'series'
  ): Promise<TorrentResult[]> {
    const encodedQuery = encodeURIComponent(query);
    const apiUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodedQuery}&per_page=15&_fields=id,title,link,content,date`;

    const config: AxiosRequestConfig = {
      timeout: site.timeout,
      httpsAgent: dnsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    };

    // Proxy opcional (ex: Tor + Privoxy) — substitui o DNS agent
    const proxyUrl = process.env.PROXY_URL;
    if (proxyUrl && site.requiresProxy) {
      try {
        config.httpsAgent = createProxyAgent(proxyUrl);
      } catch {
        logger.warn(`Proxy mal configurado: ${proxyUrl}`);
      }
    }

    const response = await axios.get(apiUrl, config);

    if (!Array.isArray(response.data)) return [];

    const results: TorrentResult[] = [];
    for (const post of response.data) {
      try {
        const extracted = this.extractMagnetsFromPost(post, site.name, type);
        results.push(...extracted);
      } catch {
        // Post individual com problema, ignora
      }
    }

    return results;
  }

  private extractMagnetsFromPost(
    post: any,
    provider: string,
    type: 'movie' | 'series'
  ): TorrentResult[] {
    const title = post.title?.rendered || '';
    const content = post.content?.rendered || '';
    if (!content) return [];

    const $ = cheerio.load(content);
    const results: TorrentResult[] = [];

    // Encontra todos os links magnet no conteúdo
    const magnetLinks = $('a[href^="magnet:"]');
    if (!magnetLinks.length) return [];

    // Extrai metadata do conteúdo HTML
    const metadata = this.extractPostMetadata($, content);
    const seriesInfo = this.extractSeriesEpisodes($, content, title);

    magnetLinks.each((_, el) => {
      const magnet = $(el).attr('href');
      if (!magnet) return;

      // Tenta extrair o nome do episódio do texto próximo ao magnet
      const episodeLabel = this.extractEpisodeLabel($, el);

      // Determina o título final
      let resultTitle = this.buildResultTitle(title, episodeLabel, seriesInfo, type);

      const quality = this.qualityDetector.extractQualityFromFilename(resultTitle)
        || metadata.quality
        || this.extractQualityFromTitle(title);

      if (!allowedQualities.has(quality)) return;

      const infoHash = this.extractInfoHash(magnet);
      const size = metadata.size || 'Desconhecido';
      const language = metadata.language || this.extractLanguage(title) || 'Desconhecido';
      const season = seriesInfo?.season;

      results.push({
        title: this.cleanTitle(resultTitle),
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
        season,
        lastUpdated: new Date(post.date || Date.now()),
        confidence: 0.85,
      });
    });

    return results;
  }

  private extractPostMetadata($: any, content: string): {
    quality?: string;
    size?: string;
    language?: string;
  } {
    const text = $('body').text() || $.text() || content.replace(/<[^>]+>/g, '');

    const qualityMatch = text.match(/Qualidade[:\s]*([^\n<]+)/i);
    const sizeMatch = text.match(/Tamanho[:\s]*([^\n<]+)/i);
    const audioMatch = text.match(/Áudio[:\s]*([^\n<]+)/i);

    return {
      quality: qualityMatch ? qualityMatch[1].trim() : undefined,
      size: sizeMatch ? sizeMatch[1].trim() : undefined,
      language: audioMatch ? audioMatch[1].trim() : undefined,
    };
  }

  private extractSeriesEpisodes(
    $: any,
    content: string,
    title: string
  ): { season?: number; episodes: Map<string, string> } | null {
    const episodes = new Map<string, string>();

    // Procura padrões como "EPISÓDIO 01:", "Episódio 1:", "E01:", etc.
    const episodePatterns = [
      /EPIS[ÓO]DIO\s*(\d{1,2})\s*:?\s*/gi,
      /Epis[óo]dio\s*(\d{1,2})\s*:?\s*/gi,
    ];

    for (const pattern of episodePatterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const epNum = match[1].padStart(2, '0');
        // Pega o texto entre este episódio e o próximo (ou fim)
        const nextIdx = content.indexOf(match[0], match.index + match[0].length);
        const segmentEnd = content.indexOf('EPIS', nextIdx > 0 ? nextIdx : match.index + 50);
        const segment = content.substring(match.index, segmentEnd > 0 ? segmentEnd : match.index + 200);
        episodes.set(epNum, segment);
      }
      if (episodes.size > 0) break;
    }

    // Extrai season do título
    const seasonMatch = title.match(/(\d+)\s*[ªa°]\s*temporada/i);
    const season = seasonMatch ? parseInt(seasonMatch[1]) : undefined;

    return episodes.size > 0 ? { season, episodes } : null;
  }

  private extractEpisodeLabel($: any, magnetEl: any): string {
    // Procura texto significativo próximo ao elemento magnet
    const $el = $(magnetEl);
    const parentText = $el.parent().text().trim();
    const prevText = $el.prev().text().trim();

    // Tenta extrair "Episódio XX" ou "EPISÓDIO XX"
    const epMatch = parentText.match(/(?:EPIS[ÓO]DIO|Epis[óo]dio)\s*(\d{1,2})/i);
    if (epMatch) {
      return `E${epMatch[1].padStart(2, '0')}`;
    }

    return prevText || '';
  }

  private buildResultTitle(
    postTitle: string,
    episodeLabel: string,
    seriesInfo: { season?: number; episodes: Map<string, string> } | null,
    type: 'movie' | 'series'
  ): string {
    // Remove HTML do título do post
    let cleanTitle = postTitle.replace(/<[^>]+>/g, '').trim();

    // Remove "Torrent" do título (mantém ano para match)
    cleanTitle = cleanTitle.replace(/\bTorrent\b/gi, '').trim();
    // Extrai e preserva o ano para ajudar no matching
    const yearMatch = cleanTitle.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : '';
    cleanTitle = cleanTitle.replace(/\(\d{4}\)/, '').trim();
    // Recoloca o ano no final se existir
    if (year) cleanTitle = `${cleanTitle} ${year}`;

    if (type === 'series' && episodeLabel) {
      // Se tem season info, adiciona Sxx
      if (seriesInfo?.season) {
        const sTag = `S${String(seriesInfo.season).padStart(2, '0')}`;
        return `${cleanTitle} ${sTag}${episodeLabel}`;
      }
      return `${cleanTitle} ${episodeLabel}`;
    }

    return cleanTitle;
  }

  private extractInfoHash(magnet: string): string | null {
    const match = magnet.match(/btih:([a-fA-F0-9]{40})/);
    return match ? match[1].toLowerCase() : null;
  }

  private extractQualityFromTitle(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('2160p') || lower.includes('4k')) return '2160p';
    if (lower.includes('1080p') || lower.includes('full hd')) return '1080p';
    if (lower.includes('720p')) return '720p';
    return 'HD';
  }

  private extractLanguage(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('dual')) return 'Dual';
    if (lower.includes('dublado')) return 'Dublado';
    if (lower.includes('legendado')) return 'Legendado';
    return 'Desconhecido';
  }

  private cleanTitle(title: string): string {
    return title
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private estimateSeeders(provider: string): number {
    // Seeds estimados por provider (ordem de grandeza realista)
    const base: Record<string, number> = {
      'BLUDV Filmes': 50,
      default: 20,
    };
    const baseSeeds = base[provider] || base.default;
    // Variação de ±40%
    return Math.floor(baseSeeds * (0.6 + Math.random() * 0.8));
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
}
