import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { allowedQualities } from './scraperConfigs.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairRangeEpisodios, normalizarTexto } from '../../titulos/TechnicalWords.js';

const logger = new Logger('BludvScraper');

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
const lookupCustomizado = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

const BASE_URL = 'https://bludvfilmes1.xyz';
const PROVIDER = 'BLUDV Filmes';
const AXIOS_OPTS = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export class BludvScraper {
  private readonly qualityDetector: QualityDetector;
  private readonly BATCH_SIZE = 5;

  constructor() {
    this.qualityDetector = new QualityDetector();
  }

  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[]
  ): Promise<TorrentResult[]> {
    try {
      // Usa diretamente a lista de queries fornecida pelo serviço principal.
      // Se não houver, usa a query original.
      const queriesParaBusca = searchQueries && searchQueries.length > 0
        ? searchQueries
        : [query];

      const allPosts: { title: string; url: string }[] = [];
      const seenUrls = new Set<string>();

      for (const q of queriesParaBusca) {
        logger.debug(`BLUDV: tentando busca com query "${q}"`);
        const posts = await this.searchPosts(q, targetSeason, searchQueries);

        // Adiciona apenas posts ainda não coletados
        for (const post of posts) {
          if (!seenUrls.has(post.url)) {
            seenUrls.add(post.url);
            allPosts.push(post);
          }
        }

        // Se já encontrou posts, para de tentar outras queries
        if (allPosts.length > 0) {
          logger.debug(`BLUDV: query "${q}" retornou ${posts.length} posts. Encerrando busca.`);
          break;
        }
      }

      if (!allPosts.length) return [];

      logger.info(
        `BLUDV HTML: ${allPosts.length} posts filtrados (usando ${queriesParaBusca.length} queries)` +
        (targetSeason !== undefined ? ` (temporada ${targetSeason})` : '')
      );

      const postResults = await Promise.all(
        allPosts.map(item =>
          this.scrapePost(item.url, type, targetSeason).catch(() => [] as TorrentResult[])
        )
      );
      return postResults.flat();
    } catch (err: any) {
      logger.warn(`BLUDV HTML falhou: ${err.code || err.message}`);
      return [];
    }
  }

  private async searchPosts(
    query: string,
    targetSeason?: number,
    searchQueries?: string[]
  ): Promise<{ title: string; url: string }[]> {
    const encoded = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/?s=${encoded}`;

    const res = await axios.get(searchUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);
    const items: { title: string; url: string }[] = [];

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      const text = ($(el).text() || '').trim();
      if (!href.includes('bludvfilmes')) return;

      const path = new URL(href).pathname;
      const segments = path.split('/').filter(Boolean);

      if (segments.length === 1 && segments[0].length > 20 && segments[0].includes('-')) {
        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${segments[0]}/`;
        if (!items.some(item => item.url === fullUrl)) {
          items.push({ title: text, url: fullUrl });
        }
      }
    });

    if (targetSeason !== undefined) {
      // Monta todas as frases possíveis a partir das queries oficiais
      const allQueries = new Set<string>([query, ...(searchQueries || [])]);
      const frases = new Set<string>();

      for (const q of allQueries) {
        const phrase = normalizarTexto(
          q
            .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
            .replace(/\btemporada\s*\d+\b/gi, '')
            .replace(/\bseason\s*\d+\b/gi, '')
            .replace(/\b\d{4}\b/g, '')
        );
        if (phrase) frases.add(phrase);
      }

      logger.debug(`[BLUDV] Frases possíveis: [${[...frases].join(' | ')}]`);

      const filtered = items.filter(item => {
        const range = extrairRangeEpisodios(item.title);
        if (range && range.season !== targetSeason) return false;

        const titleNormalizado = normalizarTexto(item.title);
        return [...frases].some(frase => titleNormalizado.includes(frase));
      });

      return filtered.slice(0, 5);
    }

    return items.slice(0, 5);
  }

  // ═══════════════════════════════════════════════════════════════
  //  EXTRAÇÃO DE QUALIDADE (prioridade: dn → linkText → contexto amplo → post)
  // ═══════════════════════════════════════════════════════════════

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

  /**
   * Limpa o título HTML combinando o episódio do contexto com a qualidade exata do link.
   * Se `qualityOverride` for fornecida, ela é usada diretamente.
   */
  private cleanHtmlTitle(contextText: string, linkText: string, qualityOverride?: string | null): string {
    const epPatterns = [
      /EPIS[OÓ]DIO\s+\d{1,3}\s+AO?\s+\d{1,3}/i,
      /EPIS[OÓ]DIO\s+\d{1,3}/i,
      /\bS\d{1,2}\s*E\d{1,3}/i,
      /\bE\d{1,3}/i
    ];

    let episode = '';
    for (const pattern of epPatterns) {
      const match = contextText.match(pattern);
      if (match) {
        episode = match[0];
        break;
      }
    }

    if (!episode) return '';

    let quality = qualityOverride || null;
    if (!quality) {
      quality = this.extractQualityFromText(linkText) || this.extractQualityFromText(contextText);
    }

    return quality ? `${episode}: ${quality}` : episode;
  }

  // ═══════════════════════════════════════════════════════════════
  //  SCRAPING DO POST
  // ═══════════════════════════════════════════════════════════════

  private async scrapePost(
    postUrl: string,
    type: 'movie' | 'series',
    targetSeason?: number
  ): Promise<TorrentResult[]> {
    const res = await axios.get(postUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);

    const contentHtml = $('.content').html() || $('body').html() || '';
    if (!contentHtml) return [];

    const postTitle =
      $('h1').first().text().trim() ||
      $('title').first().text().trim().replace(/\s*[-–]\s*BLUDV FILMES.*$/, '');

    if (targetSeason !== undefined) {
      const range = extrairRangeEpisodios(postTitle);
      if (range && range.season !== targetSeason) return [];
    }

    const metadata = this.extractPostMetadata($, contentHtml);

    const dualLinks = this.extractDualSectionProtectorLinks($, contentHtml);

    type LinkContext = {
      linkText: string;
      parentText: string;
      fullContextText: string;
    };
    let allMagnets: { magnet: string; link: LinkContext }[] = [];

    if (dualLinks.length > 0) {
      for (let i = 0; i < dualLinks.length; i += this.BATCH_SIZE) {
        const batch = dualLinks.slice(i, i + this.BATCH_SIZE);
        const batchPromises = batch.map(async (link) => {
          const magnet = await this.extractMagnetFromProtector(link.url);
          return { magnet, link };
        });
        const batchResults = await Promise.all(batchPromises);
        for (const result of batchResults) {
          if (result.magnet) {
            allMagnets.push({ magnet: result.magnet, link: result.link });
          }
        }
      }
    } else {
      const directLinks = this.extractDirectMagnets($, contentHtml);
      allMagnets = directLinks.map((item: {
        magnet: string;
        linkText: string;
        parentText: string;
        fullContextText: string;
      }) => ({
        magnet: item.magnet,
        link: {
          linkText: item.linkText,
          parentText: item.parentText,
          fullContextText: item.fullContextText,
        },
      }));
    }

    if (allMagnets.length === 0) return [];

    const analyzedMagnets = await Promise.all(
      allMagnets.map(async ({ magnet, link }) => {
        let canonicalName: string | undefined;
        try {
          const dados = await analisarMagnet(magnet);
          canonicalName = dados?.nome || undefined;
        } catch { }
        return { magnet, link, canonicalName };
      })
    );

    const results: TorrentResult[] = [];

    for (const { magnet, link, canonicalName } of analyzedMagnets) {
      const dnQuality = canonicalName ? this.extractQualityFromText(canonicalName) : null;
      const linkQuality = this.extractQualityFromText(link.linkText);
      const contextQuality = this.extractQualityFromText(link.fullContextText);

      let quality = dnQuality || linkQuality || contextQuality;
      if (!quality || !allowedQualities.has(quality)) {
        quality = this.qualityDetector.extractQualityFromFilename(postTitle);
        if (!quality || !allowedQualities.has(quality)) {
          quality = 'HD';
        }
      }

      let episode: number | undefined;
      const contextForEpisode = link.fullContextText || link.linkText;
      const epMatch = contextForEpisode.match(/EPISÓDIO\s*(\d+)/i);
      if (epMatch) episode = parseInt(epMatch[1], 10);

      let title: string;
      if (canonicalName) {
        title = canonicalName;
      } else {
        const cleanBase = postTitle
          .replace(/\s*[|]\s*(?:\d{3,4}p|4K|FULLHD|HD)\s*/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        if (episode) {
          title = `${cleanBase} - Episódio ${episode} (${quality})`;
        } else {
          title = `${cleanBase} (${quality})`;
        }
      }

      const size = metadata.size || 'Desconhecido';
      const language = metadata.language || 'Desconhecido';

      const cleanedHtmlTitle = this.cleanHtmlTitle(
        link.fullContextText || link.linkText,
        link.linkText,
        dnQuality || linkQuality || contextQuality
      );

      results.push({
        title: this.cleanTitle(title),
        htmlTitle: cleanedHtmlTitle || undefined,
        magnet,
        seeders: this.estimateSeeders(),
        leechers: 0,
        size,
        quality,
        provider: PROVIDER,
        language,
        type,
        relevanceScore: 0.85,
        sizeInBytes: this.parseSize(size),
        season: targetSeason,
        episode,
        lastUpdated: new Date(),
        confidence: 0.9,
        originalTitle: metadata.originalTitle,
        year: metadata.year,
        canonicalName,
      });
    }

    return results;
  }

  // ═══════════════════════════════════════════════════════════════
  //  LINKS DO PROTETOR (com contexto amplo)
  // ═══════════════════════════════════════════════════════════════

  private extractDualSectionProtectorLinks(
    $: any,
    contentHtml: string
  ): { url: string; linkText: string; parentText: string; fullContextText: string }[] {
    const allLinks = $('a[href*="systemads1.com"]').toArray();
    if (!allLinks.length) return [];

    const strongEls = $('.content strong, .content b').toArray();
    let dualPos = -1;
    let legendadoPos = contentHtml.length;

    for (let i = 0; i < strongEls.length; i++) {
      const text = $(strongEls[i]).text().trim();
      if (dualPos === -1 && /\b(?:DUAL\s+[ÁA]UDIO|DUBLADO)\b/i.test(text)) {
        const dualHtml = $(strongEls[i]).toString();
        dualPos = contentHtml.indexOf(dualHtml);
      }
      if (dualPos !== -1 && /\b(?:LEGENDADO|LEGENDADA)\b/i.test(text)) {
        const legendadoHtml = $(strongEls[i]).toString();
        const pos = contentHtml.indexOf(legendadoHtml);
        if (pos > dualPos) legendadoPos = pos;
        break;
      }
    }

    const mapLink = (el: any) => ({
      url: $(el).attr('href'),
      linkText: $(el).text().trim(),
      parentText: $(el).parent().text().trim(),
      fullContextText: this.getFullContextText($(el))
    });

    if (dualPos === -1) {
      const hasLegendado = strongEls.some((el: any) =>
        /\b(?:LEGENDADO|LEGENDADA)\b/i.test($(el).text().trim())
      );
      if (hasLegendado) return [];
      return allLinks.map(mapLink);
    }

    const result: { url: string; linkText: string; parentText: string; fullContextText: string }[] = [];
    for (const el of allLinks) {
      const linkHtml = $(el).toString();
      const linkPos = contentHtml.indexOf(linkHtml);
      if (linkPos > dualPos && linkPos < legendadoPos) {
        result.push(mapLink(el));
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  //  MAGNETS DIRETOS (fallback)
  // ═══════════════════════════════════════════════════════════════

  private extractDirectMagnets(
    $: any,
    contentHtml: string
  ): { magnet: string; linkText: string; parentText: string; fullContextText: string }[] {
    const allLinks = $('a[href^="magnet:"]').toArray();
    if (!allLinks.length) return [];

    const strongEls = $('.content strong, .content b').toArray();
    let dualPos = -1;
    let legendadoPos = contentHtml.length;

    for (let i = 0; i < strongEls.length; i++) {
      const text = $(strongEls[i]).text().trim();
      if (dualPos === -1 && /\b(?:DUAL\s+[ÁA]UDIO|DUBLADO)\b/i.test(text)) {
        const dualHtml = $(strongEls[i]).toString();
        dualPos = contentHtml.indexOf(dualHtml);
      }
      if (dualPos !== -1 && /\b(?:LEGENDADO|LEGENDADA)\b/i.test(text)) {
        const legendadoHtml = $(strongEls[i]).toString();
        const pos = contentHtml.indexOf(legendadoHtml);
        if (pos > dualPos) legendadoPos = pos;
        break;
      }
    }

    const mapLink = (el: any) => ({
      magnet: $(el).attr('href')?.trim(),
      linkText: $(el).text().trim(),
      parentText: $(el).parent().text().trim(),
      fullContextText: this.getFullContextText($(el))
    });

    if (dualPos === -1) {
      return allLinks.map(mapLink).filter((item: {
        magnet: string;
        linkText: string;
        parentText: string;
        fullContextText: string;
      }) => item.magnet);
    }

    const result: { magnet: string; linkText: string; parentText: string; fullContextText: string }[] = [];
    for (const el of allLinks) {
      const linkHtml = $(el).toString();
      const linkPos = contentHtml.indexOf(linkHtml);
      if (linkPos > dualPos && linkPos < legendadoPos) {
        const item = mapLink(el);
        if (item.magnet) result.push(item);
      }
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════

  private async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    try {
      const res = await axios.get(protectorUrl, {
        ...AXIOS_OPTS,
        timeout: 8000,
        maxRedirects: 5,
      });
      const html: string = res.data;
      const match = html.match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
      return match ? match[1] : null;
    } catch (err: any) {
      logger.warn(`Falha ao extrair magnet do protetor: ${err.message}`);
      return null;
    }
  }

  private extractPostMetadata($: any, _content: string): {
    quality?: string;
    size?: string;
    language?: string;
    originalTitle?: string;
    year?: number;
  } {
    const getMetaValue = (fieldName: string): string | undefined => {
      const em = $('em')
        .toArray()
        .find((el: any) => $(el).text().trim().toLowerCase() === fieldName.toLowerCase());
      if (!em) return undefined;
      const parentSpan = $(em).closest('span');
      if (!parentSpan.length) return undefined;
      const fullText = parentSpan.text().trim();
      const prefix = $(em).text().trim();
      return fullText.substring(fullText.indexOf(prefix) + prefix.length).trim() || undefined;
    };

    const originalTitleRaw = getMetaValue('Título Original:') || getMetaValue('Titulo Original:');
    const originalTitle =
      originalTitleRaw && originalTitleRaw.length >= 3
        ? originalTitleRaw.replace(/\(\d{4}\)$/, '').trim()
        : undefined;

    return {
      quality: getMetaValue('Qualidade:'),
      size: getMetaValue('Tamanho:'),
      language: getMetaValue('Áudio:'),
      originalTitle,
      year: this.parseYear(getMetaValue('Lançamento:')),
    };
  }

  private parseYear(value: string | undefined): number | undefined {
    if (!value) return undefined;
    const m = value.match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0]) : undefined;
  }

  private cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  private estimateSeeders(): number {
    return Math.floor(30 + Math.random() * 60);
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