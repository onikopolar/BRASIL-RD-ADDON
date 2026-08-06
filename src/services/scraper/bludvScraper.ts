// Scraper dedicado do BLUDV — HTML scraping direto (sem WordPress API)
// Extrai magnets, Áudio:, Qualidade:, Tamanho: e episódios do conteúdo do post
// Agora suporta protetor de links systemads1.com/videosad.net
// canonicalName extraído via magnetHelper (analisarMagnet)
// Qualidade extraída do texto do link (ex: <a>1080p</a>)
// episodeContext contém o texto do pai com "EPISÓDIO XX" para validação

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
import { extrairRangeEpisodios } from '../../titulos/TechnicalWords.js';

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

const BASE_URL = 'https://bludvfilmes.xyz';
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

  constructor() {
    this.qualityDetector = new QualityDetector();
  }

  /**
   * Busca principal – aceita targetSeason para filtrar na busca
   */
  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number
  ): Promise<TorrentResult[]> {
    try {
      const postItems = await this.searchPosts(query, targetSeason);
      if (!postItems.length) return [];

      logger.info(
        `BLUDV HTML: ${postItems.length} posts filtrados para "${query}"${
          targetSeason !== undefined ? ` (temporada ${targetSeason})` : ''
        }`
      );

      const postResults = await Promise.all(
        postItems.map(item =>
          this.scrapePost(item.url, type, targetSeason).catch(() => [] as TorrentResult[])
        )
      );
      return postResults.flat();
    } catch (err: any) {
      logger.warn(`BLUDV HTML falhou: ${err.code || err.message}`);
      return [];
    }
  }

  /**
   * Busca na página de resultados e retorna { title, url }[] já filtrado por temporada
   */
  private async searchPosts(
    query: string,
    targetSeason?: number
  ): Promise<{ title: string; url: string }[]> {
    const encoded = encodeURIComponent(query);
    const searchUrl = `${BASE_URL}/?s=${encoded}`;

    const res = await axios.get(searchUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);
    const items: { title: string; url: string }[] = [];

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      const text = ($(el).text() || '').trim();
      if (!href.includes('bludvfilmes.xyz')) return;

      const path = href.replace(/^https?:\/\/bludvfilmes\.xyz/, '').replace(/\/$/, '');
      const segments = path.split('/').filter(Boolean);

      if (segments.length === 1 && segments[0].length > 20 && segments[0].includes('-')) {
        const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${segments[0]}/`;
        if (!items.some(item => item.url === fullUrl)) {
          items.push({ title: text, url: fullUrl });
        }
      }
    });

    // Filtro por temporada
    if (targetSeason !== undefined) {
      const queryWords = query
        .toLowerCase()
        .split(/\s+/)
        .filter(w => w.length > 2);

      const filtered = items.filter(item => {
        const range = extrairRangeEpisodios(item.title);
        if (range && range.season !== targetSeason) return false;

        if (queryWords.length > 0) {
          const titleLower = item.title.toLowerCase();
          const hasRelevantWord = queryWords.some(word => titleLower.includes(word));
          if (!hasRelevantWord) return false;
        }
        return true;
      });

      return filtered.slice(0, 5);
    }

    return items.slice(0, 5);
  }

  /**
   * Raspa uma página de post e extrai os magnets da seção DUAL.
   * A qualidade é extraída do texto do link (ex: <a>1080p</a>), fallback para postTitle.
   * O título é construído individualmente removendo a lista de qualidades múltiplas.
   * O campo episodeContext é preenchido com o texto do pai que contém "EPISÓDIO".
   */
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

    // Extrai links com o texto da tag <a> e o contexto do pai
    const dualLinks = this.extractDualSectionProtectorLinks($, contentHtml);
    if (!dualLinks.length) return [];

    // Processa cada link individualmente
    const results: TorrentResult[] = [];

    for (const link of dualLinks) {
      // 1. Qualidade via texto do link (fonte primária)
      let quality = this.qualityDetector.extractQualityFromFilename(link.linkText);
      if (!quality || !allowedQualities.has(quality)) {
        // Fallback: tenta extrair do título do post
        quality = this.qualityDetector.extractQualityFromFilename(postTitle);
        if (!quality || !allowedQualities.has(quality)) {
          quality = 'HD'; // Fallback final
        }
      }

      // 2. Extrai número do episódio do contexto (parentText) — MAIS CONFIÁVEL
      let episode: number | undefined;
      // Prioriza o parentText (que tem "EPISÓDIO XX") e depois o linkText
      const contextForEpisode = link.parentText || link.linkText;
      const epMatch = contextForEpisode.match(/EPISÓDIO\s*(\d+)/i);
      if (epMatch) episode = parseInt(epMatch[1], 10);

      // 3. Obtém magnet do protetor
      const magnet = await this.extractMagnetFromProtector(link.url);
      if (!magnet) continue;

      // 4. Tenta obter canonicalName via magnetHelper (apenas para título)
      let canonicalName: string | undefined;
      try {
        const dados = await analisarMagnet(magnet);
        canonicalName = dados?.nome || undefined;
      } catch {}

      // ─── CONSTRÓI TÍTULO INDIVIDUAL ──────────────────────────────
      let title: string;
      if (canonicalName) {
        title = canonicalName;
      } else {
        // Remove a lista de qualidades múltiplas do postTitle (ex: "720p | 1080p | 2160p 4K")
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

      results.push({
        title: this.cleanTitle(title),
        htmlTitle: link.parentText || link.linkText, // contexto com "EPISÓDIO"
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

  /**
   * Extrai os links do protetor (systemads1.com) que estão dentro da seção DUAL.
   * Retorna array com { url, linkText, parentText } onde linkText é o conteúdo da tag <a>,
   * e parentText é o texto do elemento pai (contém "EPISÓDIO").
   */
  private extractDualSectionProtectorLinks($: any, contentHtml: string): { url: string; linkText: string; parentText: string }[] {
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

    if (dualPos === -1) {
      const hasLegendado = strongEls.some((el: any) =>
        /\b(?:LEGENDADO|LEGENDADA)\b/i.test($(el).text().trim())
      );
      if (hasLegendado) return [];
      // Fallback: todos os links (sem DUAL identificado)
      return allLinks.map((el: any) => ({
        url: $(el).attr('href'),
        linkText: $(el).text().trim(),
        parentText: $(el).parent().text().trim(),
      }));
    }

    const result: { url: string; linkText: string; parentText: string }[] = [];
    for (const el of allLinks) {
      const linkHtml = $(el).toString();
      const linkPos = contentHtml.indexOf(linkHtml);
      if (linkPos > dualPos && linkPos < legendadoPos) {
        result.push({
          url: $(el).attr('href'),
          linkText: $(el).text().trim(),
          parentText: $(el).parent().text().trim(),
        });
      }
    }
    return result;
  }

  /**
   * Acessa o protetor de links e extrai o magnet da variável DEST_URL.
   */
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

  // ═══ Helpers ═══
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