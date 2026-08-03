import axios, { AxiosRequestConfig } from 'axios';
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

// Legendado indicators extraídos da fonte única (TechnicalWords)
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
// Axios/Node usa dns.lookup() (DNS do SO) antes de delegar ao httpsAgent.
// Com lookup customizado, forçamos dns.resolve4 (Google DNS via setServers).
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
        logger.warn(` WP ${site.name} FALHOU`, { query: query.substring(0, 60), error: err.code || err.message });
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
    // WordPress search é ruinzinho com números e caracteres especiais.
    // "Rick Morty Temporada 4" não acha "4ª Temporada".
    // Solução: usa query limpa (sem season/episode) e deixa o filtro pós-processar.
    const cleanQuery = query
      .replace(/\b\d+ª\s*(temporada|temp)\b/gi, '')
      .replace(/\btemporada\s*\d+\b/gi, '')
      .replace(/\bseason\s*\d+\b/gi, '')
      .replace(/\bs\d{2}\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchQuery = cleanQuery || query; // fallback pro original se limpar tudo
    const encodedQuery = encodeURIComponent(searchQuery);
    const apiUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodedQuery}&per_page=15&_fields=id,title,link,content,excerpt,date`;

    // DNS bypass + Crawlee-style anti-bot headers
    const response = await axios.get(apiUrl, {
      timeout: site.timeout,
      httpsAgent: dnsAgent,
      lookup: lookupCustomizado,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="150"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
      validateStatus: (s) => s < 500,
    });

    if (!Array.isArray(response.data)) return [];

    const totalMagnets = response.data.reduce((sum: number, p: any) => sum + ((p.content?.rendered || '').match(/magnet:/g) || []).length, 0);
    logger.info(`WP ${site.name}: ${totalMagnets} magnets em N/A para "${searchQuery}"`);

    const results: TorrentResult[] = [];
    const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(de|do|da|dos|das|e|a|o|em|no|na|os|as|um|uma|the|of|and|or|in|on|at|to|for|is|it)$/i.test(w));
    for (const post of response.data) {
      try {
        const postTitle = (post.title?.rendered || '').toLowerCase();
        
        // Pula posts "Listão" — compilações genéricas sem labels individuais nos magnets
        if (/\blist[aã]o\b/i.test(postTitle)) {
          logger.debug(`WP ${site.name}: pulando post listão "${(post.title?.rendered || '').substring(0, 50)}"`);
          continue;
        }
        
        // Post é relevante se título contém palavras da query.
        // Queries curtas (≤2 palavras): exige match no TÍTULO (excerpt é ruidoso).
        // Queries longas: título OU excerpt bastam.
        const postExcerpt = (post.excerpt?.rendered || '').toLowerCase();
        let postIsRelevant: boolean;
        if (queryWords.length === 0) {
          postIsRelevant = true;
        } else if (queryWords.length <= 2) {
          // Query curta: pelo menos UMA palavra no TÍTULO (ignora excerpt)
          postIsRelevant = queryWords.some(w => postTitle.includes(w));
        } else {
          // Query longa: basta UMA palavra no título OU excerpt
          postIsRelevant = queryWords.some(w => postTitle.includes(w) || postExcerpt.includes(w));
        }
        const extracted = await this.extractMagnetsFromPost(post, site.name, type, queryWords, postIsRelevant);
        results.push(...extracted);
      } catch {
        // Post individual com problema, ignora
      }
    }

    return results;
  }

  private async extractMagnetsFromPost(
    post: any,
    provider: string,
    type: 'movie' | 'series',
    queryWords?: string[],
    postIsRelevant: boolean = false
  ): Promise<TorrentResult[]> {
    const title = post.title?.rendered || '';
    const content = post.content?.rendered || '';
    if (!content) return [];

    const $ = cheerio.load(content);
    const results: TorrentResult[] = [];

    // Links diretos de magnet
    let magnetLinks = $('a[href^="magnet:"]');
    
    // Se não achou magnets, procura links de redirect (systemads.net, etc)
    if (!magnetLinks.length) {
      const redirectLinks = $('a[href*="systemads.net"], a[href*="link.tl"], a[href*="encurta.net"], a[href*="filmedl.com"]');
      if (redirectLinks.length) {
        logger.debug(`WP: ${redirectLinks.length} redirects encontrados, resolvendo...`);
        const resolvedMagnets: { el: any; magnet: string }[] = [];
        
        for (let i = 0; i < redirectLinks.length; i++) {
          const el = redirectLinks[i];
          const redirectUrl = $(el).attr('href');
          if (!redirectUrl) continue;
          try {
            const resolved = await this.resolveRedirectToMagnet(redirectUrl);
            if (resolved) {
              resolvedMagnets.push({ el, magnet: resolved });
            }
          } catch { /* skip redirects que falham */ }
        }
        
        if (resolvedMagnets.length) {
          // Reconstrói o HTML substituindo os links de redirect por magnet:
          let modifiedContent = content;
          for (const { el, magnet } of resolvedMagnets) {
            const originalHref = $(el).attr('href');
            if (originalHref) {
              modifiedContent = modifiedContent.replace(originalHref, magnet);
            }
          }
          // Recarrega com os magnets injetados
          const $modified = cheerio.load(modifiedContent);
          magnetLinks = $modified('a[href^="magnet:"]');
          logger.info(`WP: ${resolvedMagnets.length} magnets resolvidos de redirects`);
        }
      }
    }

    if (!magnetLinks.length) return [];

  // ═══ FILTRO ANTI-LEGENDADO: só processa magnets entre DUAL ÁUDIO e LEGENDADO ═══
    // Comando estrutura: :: DUAL ÁUDIO :: → magnets → :: LEGENDADO :: → magnets (ignorar)
    const { dualIndex, legendadoIndex } = this.findSectionBoundaries($, content);
    if (legendadoIndex !== null) {
      logger.debug(`WP: limite LEGENDADO encontrado — ignorando magnets após posição HTML ${legendadoIndex}`);
    }

    const metadata = this.extractPostMetadata($, content);
    const seriesInfo = this.extractSeriesEpisodes($, content, title);

    const elementos = magnetLinks.toArray();
    // Posts genéricos (Listão) podem ter 700+ magnets — limita para não processar tudo
    const MAX_GENERIC_MAGNETS = 50;
    let scannedGeneric = 0;

    for (const el of elementos) {
      // Se post não é relevante e já escaneamos muitos magnets, para
      if (!postIsRelevant && scannedGeneric >= MAX_GENERIC_MAGNETS) break;
      if (!postIsRelevant) scannedGeneric++;

      const magnet = $(el).attr('href');
      if (!magnet) continue;

      // ═══ Pula magnets FORA da seção DUAL (antes do DUAL ou depois do LEGENDADO) ═══
      if (legendadoIndex !== null || dualIndex !== null) {
        if (el.startIndex !== undefined) {
          if (dualIndex !== null && el.startIndex < dualIndex) continue; // antes do DUAL
          if (legendadoIndex !== null && el.startIndex >= legendadoIndex) continue; // depois do LEGENDADO
        } else {
          const hrefPos = content.indexOf(magnet);
          if (hrefPos !== -1) {
            if (dualIndex !== null && hrefPos < dualIndex) continue;
            if (legendadoIndex !== null && hrefPos >= legendadoIndex) continue;
          }
        }
      }

      // Filtra por query: se post é relevante (título bate), extrai tudo.
      // Se post é genérico (ex: "Listão"), filtra cada magnet pelo texto ao redor.
      if (!postIsRelevant && queryWords && queryWords.length > 0) {
        const contextText = ($(el).parent().text() + ' ' + ($(el).prev().text() || '')).toLowerCase();
        const match = queryWords.some(w => contextText.includes(w));
        if (!match) continue;
      }

      const episodeLabel = this.extractEpisodeLabel($, el);

      let resultTitle = this.buildResultTitle(title, episodeLabel, seriesInfo, type);

      // Tenta detectar qualidade do título, do corpo do post e do magnet
      let quality = this.qualityDetector.extractQualityFromFilename(resultTitle);
      
      // Se não achou no título, procura no corpo inteiro do post (onde pode ter "4K", "2160p", etc)
      if (quality === 'HD') {
        const bodyQuality = this.qualityDetector.extractQualityFromFilename(content);
        if (bodyQuality && bodyQuality !== 'HD') quality = bodyQuality;
      }
      
      // Se ainda não achou, procura no texto próximo ao magnet
      if (quality === 'HD') {
        const magnetText = $(el).parent().text() || '';
        const magnetQuality = this.qualityDetector.extractQualityFromFilename(magnetText);
        if (magnetQuality && magnetQuality !== 'HD') quality = magnetQuality;
      }
      
      // Fallbacks antigos
      if (quality === 'HD' && metadata.quality) {
        quality = this.qualityDetector.extractQualityFromFilename(metadata.quality) || quality;
      }
      if (quality === 'HD') {
        quality = this.extractQualityFromTitle(title) || quality;
      }

      if (!allowedQualities.has(quality)) continue;

      const infoHash = await this.extrairInfoHashDoMagnet(magnet);
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
        originalTitle: metadata.originalTitle,
        year: metadata.year,
      });
    }

    return results;
  }

  // ═══ Extrai metadados do post via DOM estruturado ═══
  // Comando: <b>Título Original:</b> The Menu<br />
  // Starck:  <span>Nome Original:</span><span>The Menu</span>
  private extractPostMetadata($: any, _content: string): {
    quality?: string;
    size?: string;
    language?: string;
    originalTitle?: string;
    year?: number;
  } {
    // Helper: extrai valor de um campo do metadata pelo texto do <b>/<strong>
    const getMetaValue = (fieldNames: string[]): string | undefined => {
      for (const name of fieldNames) {
        const el = $('b, strong').toArray().find((el: any) => {
          const t = $(el).text().trim().toLowerCase();
          return t === name.toLowerCase() || t === (name + ':').toLowerCase();
        });
        if (!el) continue;
        const parentHtml = $(el).parent().html() || '';
        const elHtml = $(el).toString();
        const idx = parentHtml.indexOf(elHtml);
        if (idx === -1) continue;
        const after = parentHtml.substring(idx + elHtml.length);

        // Tenta texto direto após a tag (ex: <b>Lançamento:</b> 2024<br>)
        const endIdx = after.indexOf('<');
        const directValue = (endIdx !== -1 ? after.substring(0, endIdx) : after).replace(/^[:\s]+/, '').trim();
        if (directValue && directValue.length >= 2) return directValue;

        // Fallback: valor dentro de <a> (ex: <b>Lançamento:</b> <a href="...">2024</a>)
        const linkMatch = after.match(/<a\b[^>]*>([^<]+)<\/a>/i);
        if (linkMatch?.[1]?.trim().length >= 2) return linkMatch[1].trim();
      }
      return undefined;
    };

    // Starck: <span>Nome Original:</span><span>The Menu</span>
    const starckOrig = $('span').toArray().find((el: any) => /Nome\s+Original/i.test($(el).text()));
    const starckTitle = starckOrig ? $(starckOrig).next('span').text().trim() : undefined;

    const originalTitleRaw = starckTitle
      || getMetaValue(['Título Original', 'Titulo Original']);
    const originalTitle = (originalTitleRaw && originalTitleRaw.length >= 3)
      ? originalTitleRaw.replace(/\(\d{4}\)$/, '').trim()
      : undefined;

    return {
      quality: getMetaValue(['Qualidade']),
      size: getMetaValue(['Tamanho']),
      language: getMetaValue(['Áudio', 'Idioma']),
      originalTitle,
      year: this.parseYear(getMetaValue(['Lançamento'])),
    };
  }

  private parseYear(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const m = value.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : undefined;
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

  // Segue um link de redirect (systemads.net, etc) para achar o magnet real
  private async resolveRedirectToMagnet(redirectUrl: string): Promise<string | null> {
    try {
      // ═══ Starck: filmedl.com/?id=BASE64 — magnet no próprio URL ═══
      if (redirectUrl.includes('filmedl.com')) {
        const idMatch = redirectUrl.match(/[?&]id=([^&]+)/i);
        if (idMatch) {
          const decoded = decodeURIComponent(idMatch[1]);
          const magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
          if (magnet.startsWith('magnet:?')) return magnet;
        }
        return null;
      }

      // Não segue redirects automaticamente — queremos pegar o Location header
      const resp = await axios.get(redirectUrl, {
        timeout: 8000,
        maxRedirects: 0,
        validateStatus: (s) => s < 400,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html',
        },
        httpsAgent: agenteHttps,
        lookup: lookupCustomizado,
      });

      // 1. Tenta achar magnet no Location header
      const location = resp.headers['location'] || resp.headers['Location'];
      if (location && location.startsWith('magnet:')) {
        return location;
      }

      // 2. Tenta extrair magnet do HTML da página de redirect
      const html: string = resp.data || '';
      const magnetMatch = html.match(/magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"'\s<>]*/);
      if (magnetMatch) return magnetMatch[0];

      // 3. Tenta achar um meta refresh ou link pra magnet
      const metaMatch = html.match(/<meta[^>]+url=(magnet:[^"'\s]+)/i);
      if (metaMatch) return metaMatch[1];

      return null;
    } catch {
      return null;
    }
  }

  private async extrairInfoHashDoMagnet(magnet: string): Promise<string | null> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : null;
  }

  private extractQualityFromTitle(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('2160p') || lower.includes('4k') || lower.includes('uhd')) return '2160p';
    if (lower.includes('1080p') || lower.includes('full hd')) return '1080p';
    if (lower.includes('720p')) return '720p';
    return 'HD';
  }

  private extractLanguage(title: string): string {
    const lower = title.toLowerCase();
    if (lower.includes('dual')) return 'Dual';
    if (lower.includes('dublado') || lower.includes('dublad')) return 'Dublado';
    if (LEGENDADO_REGEX.test(lower)) return 'Legendado';
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

  /** Encontra os limites da seção DUAL ÁUDIO no HTML.
   *  Comando estrutura real:
   *    <h2>:: DUAL ÁUDIO ::</h2>   ← dualIndex (início da coleta)
   *      ...magnets DUAL...
   *    <h2>:: LEGENDADO ::</h2>    ← legendadoIndex (fim da coleta)
   *      ...magnets LEGENDADO (ignorados)...
   *
   *  NÃO confunde com metadados ("Legenda: Português") nem títulos de post.
   */
  private findSectionBoundaries($: any, content: string): { dualIndex: number | null; legendadoIndex: number | null } {
    // Procura APENAS em h2 e strong — são os marcadores de seção reais
    const selectors = ['h2', 'strong'];
    let dualIndex: number | null = null;
    let legendadoIndex: number | null = null;

    for (const sel of selectors) {
      const elements = $(sel);
      for (let i = 0; i < elements.length; i++) {
        const text = $(elements[i]).text().trim();

        // Detecta :: DUAL ÁUDIO :: como início da seção
        if (dualIndex === null && /::\s*DUAL\s+[ÁA]UDIO\s*::/i.test(text)) {
          const html = $(elements[i]).toString();
          const pos = content.indexOf(html);
          if (pos !== -1) dualIndex = pos;
        }

        // Detecta :: LEGENDADO :: como fim da seção (apenas depois do DUAL)
        if (dualIndex !== null && legendadoIndex === null && /::\s*LEGENDADO\s*::/i.test(text)) {
          const html = $(elements[i]).toString();
          const pos = content.indexOf(html);
          if (pos !== -1 && pos > dualIndex) legendadoIndex = pos;
        }
      }
    }

    // Fallback: se não achou :: DUAL ÁUDIO ::, procura qualquer DUAL em h2/strong
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

    // Fallback legendado: procura :: LEGENDADO :: ou LEGENDADO standalone em h2/strong
    if (legendadoIndex === null) {
      for (const sel of selectors) {
        const elements = $(sel);
        for (let i = 0; i < elements.length; i++) {
          const text = $(elements[i]).text().trim();
          // Só match se for "LEGENDADO" standalone (não "Legenda:" que é metadata)
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

  /** @deprecated — substituído por findSectionBoundaries */
  private findLegendadoBoundary($: any, content: string): number | null {
    return this.findSectionBoundaries($, content).legendadoIndex;
  }
}
