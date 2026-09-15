import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairRangeEpisodios, normalizarTexto, isCollectionTitle, temporadaAlvoNoRange, INDICADORES_INTERNACIONAL_TORRENTS } from '../../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

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

export type SectionType = 'DUAL' | 'LEGENDADO' | 'NONE';

// Seção contígua do HTML — [start, end). Cada header abre uma seção que vai
// até o próximo header (ou até o fim do conteúdo).
export type Section = {
  type: SectionType;
  start: number;
  end: number;
};

export type LinkContext = {
  linkText: string;
  parentText: string;
  fullContextText: string;
};

export type PostItem = { title: string; url: string };
export type ProtectorLink = { url: string; secao: SectionType } & LinkContext;
export type ExtractedMagnet = { magnet: string; link: LinkContext; secao: SectionType };

export type FrasesBusca = { frases: Set<string>; baseTitles: string[] };

export type PostMetadata = {
  quality?: string;
  size?: string;
  language?: string;
  originalTitle?: string;
  year?: number;
  years?: number[];
};

export { BASE_URL, PROVIDER, AXIOS_OPTS };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function dedupByMagnet(magnets: ExtractedMagnet[]): ExtractedMagnet[] {
  const vistos = new Set<string>();
  return magnets.filter(m => {
    if (vistos.has(m.magnet)) return false;
    vistos.add(m.magnet);
    return true;
  });
}

export class BludvScraper {
  public readonly qualityDetector: QualityDetector;
  public readonly BATCH_SIZE = 5;

  constructor() {
    this.qualityDetector = new QualityDetector();
  }

  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[],
    imdbId?: string
  ): Promise<TorrentResult[]> {
    try {
      const queriesParaBusca = searchQueries && searchQueries.length > 0 ? searchQueries : [query];
      const frasesBusca = this.montarFrasesDeBusca(query, searchQueries);

      const allPosts: PostItem[] = [];
      const seenUrls = new Set<string>();

      for (const q of queriesParaBusca) {
        logger.debug(`BLUDV: tentando busca com query "${q}"`);
        const posts = await this.searchPosts(q, targetSeason, frasesBusca);

        for (const post of posts) {
          if (!seenUrls.has(post.url)) {
            seenUrls.add(post.url);
            allPosts.push(post);
          }
        }

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
          this.scrapePost(item.url, type, targetSeason, imdbId).catch(() => [] as TorrentResult[])
        )
      );
      return postResults.flat();
    } catch (err: any) {
      logger.warn(`BLUDV HTML falhou: ${err.code || err.message}`);
      return [];
    }
  }

  async searchPosts(
    query: string,
    targetSeason: number | undefined,
    frasesBusca: FrasesBusca
  ): Promise<PostItem[]> {
    const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(query)}`;
    const res = await axios.get(searchUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);

    if ($('body').hasClass('search-no-results')) {
      logger.debug('[BLUDV] busca sem resultados (search-no-results)');
      return [];
    }

    const items: PostItem[] = [];
    const urlsVistas = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();

      const text = ($(el).text() || '').trim()
        || ($(el).find('img').attr('alt') || '').trim()
        || ($(el).find('img').attr('title') || '').trim();

      if (!href.includes('bludvfilmes')) return;

      let path: string;
      try { path = new URL(href).pathname; } catch { return; }
      const segments = path.split('/').filter(Boolean);

      if (segments.length !== 1 || segments[0].length <= 20 || !segments[0].includes('-')) return;

      const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${segments[0]}/`;

      if (urlsVistas.has(fullUrl)) return;
      urlsVistas.add(fullUrl);

      items.push({ title: text, url: fullUrl });
    });

    return items.filter(item => this.postRelevante(item, targetSeason, frasesBusca)).slice(0, 5);
  }

  postRelevante(item: PostItem, targetSeason: number | undefined, frasesBusca: FrasesBusca): boolean {
    const lowerTitle = item.title.toLowerCase();

    if (LEGENDADO_REGEX.test(lowerTitle) && !/dual|dublado|dublada/i.test(lowerTitle)) {
      logger.debug(`[BLUDV] post legendado ignorado: "${item.title.substring(0, 50)}"`);
      return false;
    }

    if (/\blist[aã]o\b/i.test(lowerTitle)) return false;

    if (targetSeason !== undefined) {
      const range = extrairRangeEpisodios(item.title);
      if (!temporadaAlvoNoRange(range, targetSeason)) return false;
    }

    const titleNormalizado = normalizarTexto(item.title);
    const match = [...frasesBusca.frases].some(frase => titleNormalizado.includes(frase));
    const isCollection = isCollectionTitle(titleNormalizado) &&
      frasesBusca.baseTitles.some(base => titleNormalizado.includes(base));

    if (!match && !isCollection) {
      logger.debug(`[BLUDV] post ignorado (frase não encontrada): "${item.title.substring(0, 50)}"`);
      return false;
    }

    return true;
  }

  async scrapePost(
    postUrl: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    imdbId?: string
  ): Promise<TorrentResult[]> {
    const res = await axios.get(postUrl, AXIOS_OPTS);
    const $ = cheerio.load(res.data);

    const contentHtml = $('.content').html() || $('body').html() || '';
    if (!contentHtml) return [];

    const postTitle =
      $('h1').first().text().trim() ||
      $('title').first().text().trim().replace(/\s*[-–]\s*BLUDV FILMES.*$/, '');

    let imdbConfirmed = false;
    if (imdbId) {
      const imdbIdDoPost = res.data.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
      if (imdbIdDoPost) {
        const isCollection = isCollectionTitle(postTitle);
        if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) return [];
        if (!isCollection) imdbConfirmed = true;
      }
    }

    if (targetSeason !== undefined) {
      const range = extrairRangeEpisodios(postTitle);
      if (!temporadaAlvoNoRange(range, targetSeason)) return [];
    }

    const metadata = this.extractPostMetadata($);

    // Monta as seções contíguas a partir dos headers. Cada header abre uma seção
    // [start, end) que vai até o próximo header (ou até o fim do conteúdo).
    const sections = this.findSections($, contentHtml);

    // Log objetivo: só o nome de cada seção e o range.
    logger.debug(
      `[BLUDV] seções | ${sections.map(s => `${s.type}[${s.start}-${s.end}]`).join(' ')}`
    );

    // Se só existem seções LEGENDADO (nenhuma DUAL), descarta o post inteiro.
    const temDual = sections.some(s => s.type === 'DUAL');
    if (!temDual) {
      logger.debug('[BLUDV] post sem nenhuma seção DUAL — descartado');
      return [];
    }

    const directMagnets = this.extractDirectMagnets($, contentHtml, sections);
    const protectorLinks = this.extractProtectorLinks($, contentHtml, sections);

    // Contagem por seção de origem — visibilidade de onde cada magnet caiu.
    const dirDual = directMagnets.filter(m => m.secao === 'DUAL').length;
    const proDual = protectorLinks.filter(l => l.secao === 'DUAL').length;
    logger.debug(
      `[BLUDV] magnets | diretos DUAL=${dirDual} | protetores DUAL=${proDual}`
    );

    const protectorMagnets = await this.resolverMagnetsDoProtetor(protectorLinks);

    const allMagnets = dedupByMagnet([...directMagnets, ...protectorMagnets]);

    if (allMagnets.length === 0) return [];

    const analyzedMagnets = await Promise.all(
      allMagnets.map(async ({ magnet, link, secao }) => {
        let canonicalName: string | undefined;
        try {
          const dados = await analisarMagnet(magnet);
          canonicalName = dados?.nome || undefined;
        } catch { }
        return { magnet, link, canonicalName, secao };
      })
    );

    const results: TorrentResult[] = [];
    const magnetsVistos = new Set<string>();
    const cleanTitleFromPost = this.extractTitleFromPostTitle(postTitle);

    for (const { magnet, link, canonicalName, secao } of analyzedMagnets) {
      if (magnetsVistos.has(magnet)) continue;
      magnetsVistos.add(magnet);

      const { qualidade: quality, fonte: fonteQualidade } = this.resolverQualidadeComFonte(
        canonicalName,
        link,
        postTitle,
        metadata.quality
      );
      const { episode, episodeRangeText } = this.resolverEpisodio(canonicalName, link);
      const language = this.resolverIdioma(secao, metadata.language);

      const originalTitleFinal = metadata.originalTitle || cleanTitleFromPost;
      const displayTitle = originalTitleFinal || canonicalName || postTitle;

      const canonicalFinal = canonicalName || this.sintetizarCanonicalName(
        originalTitleFinal || postTitle,
        metadata.years,
        quality
      );

      logger.debug(
        `[BLUDV] QUALIDADE | magnet=${magnet.substring(0, 40)}... | qualidade=${quality} | fonte=${fonteQualidade} | secao=${secao}`
      );

      const size = metadata.size
        || this.extrairTamanhoDoContexto(link.fullContextText)
        || this.extrairTamanhoDoContexto(link.parentText)
        || 'Desconhecido';

      const cleanedHtmlTitle = episodeRangeText
        ? `${episodeRangeText}: ${quality}`
        : this.cleanHtmlTitle(link.fullContextText || link.linkText, link.linkText, quality);

      results.push({
        title: this.cleanTitle(displayTitle),
        htmlTitle: cleanedHtmlTitle || undefined,
        magnet,
        seeders: 0,
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
        originalTitle: originalTitleFinal ?? undefined,
        year: metadata.year,
        years: metadata.years,
        canonicalName: canonicalFinal,
        imdbConfirmed,
      });
    }

    return results;
  }

  private extrairTamanhoDoContexto(texto: string | undefined): string | undefined {
    if (!texto) return undefined;
    const m = texto.match(/([\d.,]+)\s*(GB|MB|KB)\b/i);
    return m ? m[0] : undefined;
  }

  private sintetizarCanonicalName(base: string, years: number[] | undefined, quality: string): string {
    const anos = years && years.length > 0
      ? (years.length === 1
          ? `${years[0]}`
          : `${years[0]}-${years[years.length - 1]}`)
      : null;

    return [base, anos, quality].filter(Boolean).join(' ').trim();
  }

  // Monta seções contíguas do HTML a partir dos headers DUAL/LEGENDADO.
  // Cada header abre uma seção [start, end) que vai até o próximo header (ou fim).
  // Conteúdo antes do primeiro header vira uma seção NONE.
  findSections($: any, contentHtml: string): Section[] {
    const strongEls = $('.content strong, .content b').toArray();
    const headers: { pos: number; type: 'DUAL' | 'LEGENDADO' }[] = [];

    for (const el of strongEls) {
      const texto = $(el).text().trim();
      if (!texto) continue;

      const tipo = this.detectSectionType(texto);
      if (tipo === 'NONE') continue;

      const pos = contentHtml.indexOf($(el).toString());
      if (pos === -1) continue;

      headers.push({ pos, type: tipo });
    }

    headers.sort((a, b) => a.pos - b.pos);

    const contentLength = contentHtml.length;
    const sections: Section[] = [];

    if (headers.length === 0) {
      // Sem headers, todo o conteúdo é NONE.
      return [{ type: 'NONE', start: 0, end: contentLength }];
    }

    // Conteúdo antes do primeiro header vira seção NONE.
    if (headers[0].pos > 0) {
      sections.push({ type: 'NONE', start: 0, end: headers[0].pos });
    }

    for (let i = 0; i < headers.length; i++) {
      const start = headers[i].pos;
      const end = i + 1 < headers.length ? headers[i + 1].pos : contentLength;
      sections.push({ type: headers[i].type, start, end });
    }

    return sections;
  }

  // Devolve a seção que contém a posição. Retorna null se a posição cai fora
  // de todas as seções (não deveria acontecer, mas é defensivo).
  findSectionForPosition(pos: number, sections: Section[]): Section | null {
    for (const s of sections) {
      if (pos >= s.start && pos < s.end) return s;
    }
    return null;
  }

  detectSectionType(text: string): SectionType {
    const t = normalizarTexto(text).trim();

    if (/^(trailer|assistir|baixar|download|ver)\b/i.test(t)) return 'NONE';
    if (t.length > 60) return 'NONE';

    const hasNacional = /\bnacional\b/.test(t);
    const hasDual = /\bdual\b/.test(t) && /\baudio\b/.test(t);
    const hasDublado = /\bdublado\b|\bdublada\b|\bdublagem\b/.test(t);
    const hasLegendado = /\blegendado\b|\blegendada\b/.test(t);

    if (hasLegendado && !hasDual && !hasDublado && !hasNacional) return 'LEGENDADO';
    if ((hasDual || hasDublado || hasNacional) && !hasLegendado) return 'DUAL';
    return 'NONE';
  }

  // Extrai magnets diretos. Cada magnet é classificado pela sua PRÓPRIA posição
  // no HTML, não pela posição do container — evita que o <center> externo
  // (que envolve múltiplas seções) contamine a classificação.
  extractDirectMagnets($: any, contentHtml: string, sections: Section[]): ExtractedMagnet[] {
    const resultados: ExtractedMagnet[] = [];
    const stats: Record<SectionType, number> = { DUAL: 0, LEGENDADO: 0, NONE: 0 };

    // Pré-calcula a posição de cada <center> para reaproveitar no spanText.
    const centerSpanCache = new Map<any, string>();
    for (const centerEl of $('center').toArray()) {
      centerSpanCache.set(centerEl, $(centerEl).find('span').first().text().trim());
    }

    // Itera todos os <a href="magnet:"> dentro do conteúdo.
    const allMagnetAnchors = $('a[href^="magnet:"]').toArray();

    for (const el of allMagnetAnchors) {
      const magnet = $(el).attr('href')?.trim();
      if (!magnet) continue;

      const pos = contentHtml.indexOf($(el).toString());
      if (pos === -1) continue;

      const section = this.findSectionForPosition(pos, sections);
      const secao: SectionType = section?.type ?? 'NONE';
      stats[secao]++;

      if (secao !== 'DUAL') continue;

      // Monta contexto. Se o <a> tem um <center> ancestral, usa o span dele.
      const $el = $(el);
      const closestCenter = $el.closest('center').get(0);
      const spanText = closestCenter ? (centerSpanCache.get(closestCenter) ?? '') : '';
      const ctx = this.buildLinkContext($, el);

      resultados.push({
        magnet,
        link: {
          linkText: ctx.linkText,
          parentText: ctx.parentText,
          fullContextText: spanText || ctx.fullContextText,
        },
        secao,
      });
    }

    // Log interno (uma linha) — quantos magnets de cada tipo foram vistos.
    logger.debug(
      `[BLUDV] magnets por seção | DUAL=${stats.DUAL} LEGENDADO=${stats.LEGENDADO} NONE=${stats.NONE}`
    );

    return resultados;
  }

  extractProtectorLinks($: any, contentHtml: string, sections: Section[]): ProtectorLink[] {
    const allLinks = $('a[href*="systemads1.com"]').toArray();
    if (!allLinks.length) return [];

    const result: ProtectorLink[] = [];
    for (const el of allLinks) {
      const pos = contentHtml.indexOf($(el).toString());
      if (pos === -1) continue;

      const section = this.findSectionForPosition(pos, sections);
      const secao: SectionType = section?.type ?? 'NONE';
      if (secao !== 'DUAL') continue;

      result.push({
        url: $(el).attr('href') as string,
        secao,
        ...this.buildLinkContext($, el),
      });
    }
    return result;
  }

  async resolverMagnetsDoProtetor(links: ProtectorLink[]): Promise<ExtractedMagnet[]> {
    const resultado: ExtractedMagnet[] = [];
    for (let i = 0; i < links.length; i += this.BATCH_SIZE) {
      const batch = links.slice(i, i + this.BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (link) => {
          const magnet = await this.extractMagnetFromProtector(link.url);
          if (!magnet) return null;
          return {
            magnet,
            link: {
              linkText: link.linkText,
              parentText: link.parentText,
              fullContextText: link.fullContextText,
            },
            secao: link.secao,
          } as ExtractedMagnet;
        })
      );
      for (const r of batchResults) {
        if (r) resultado.push(r);
      }
    }
    return resultado;
  }

  resolverIdioma(secao: SectionType, metaLanguage?: string): string {
    if (secao === 'DUAL') return 'Dual';
    if (secao === 'LEGENDADO') return 'Legendado';

    if (!metaLanguage) return 'Desconhecido';

    const lower = metaLanguage.toLowerCase();
    if (lower.includes('|')) return 'Dual';
    if (lower.includes('nacional')) return 'Nacional';
    if (lower.includes('dual')) return 'Dual';
    if (lower.includes('dublado') || lower.includes('dublad')) return 'Dublado';
    if (LEGENDADO_REGEX.test(lower)) return 'Legendado';
    return metaLanguage;
  }

  private resolverQualidadeComFonte(
    canonicalName: string | undefined,
    link: LinkContext,
    postTitle: string,
    metadataQuality?: string
  ): { qualidade: string; fonte: string } {
    if (canonicalName) {
      const q = this.qualityDetector.extractBestQuality(canonicalName);
      if (q && this.qualityDetector.isValidQuality(q)) return { qualidade: q, fonte: 'canonicalName' };
    }

    if (link.fullContextText) {
      const q = this.qualityDetector.extractBestQuality(link.fullContextText);
      if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD') return { qualidade: q, fonte: 'fullContextText' };
    }

    if (link.linkText) {
      const q = this.qualityDetector.extractBestQuality(link.linkText);
      if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD') return { qualidade: q, fonte: 'linkText' };
    }

    if (link.parentText) {
      const q = this.qualityDetector.extractBestQuality(link.parentText);
      if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD') return { qualidade: q, fonte: 'parentText' };
    }

    if (metadataQuality) {
      const q = this.qualityDetector.extractBestQuality(metadataQuality);
      if (q && this.qualityDetector.isValidQuality(q)) return { qualidade: q, fonte: 'metadataQuality' };
    }

    if (postTitle) {
      const q = this.qualityDetector.extractBestQuality(postTitle);
      if (q && this.qualityDetector.isValidQuality(q)) return { qualidade: q, fonte: 'postTitle' };
    }

    return { qualidade: 'HD', fonte: 'fallback' };
  }

  resolverQualidade(
    canonicalName: string | undefined,
    link: LinkContext,
    postTitle: string,
    metadataQuality?: string
  ): string {
    return this.resolverQualidadeComFonte(canonicalName, link, postTitle, metadataQuality).qualidade;
  }

  resolverEpisodio(
    canonicalName: string | undefined,
    link: LinkContext
  ): { episode?: number; episodeRangeText?: string } {
    if (canonicalName) {
      const r = this.formatarRange(extrairRangeEpisodios(canonicalName));
      if (r) return r;
    }

    const contexto = link.fullContextText || link.linkText;
    const r = this.formatarRange(extrairRangeEpisodios(contexto));
    if (r) return r;

    const epMatch = contexto.match(/EPISÓDIO\s*(\d+)/i);
    if (epMatch) {
      const ep = parseInt(epMatch[1], 10);
      return { episode: ep, episodeRangeText: `Episódio ${pad2(ep)}` };
    }

    return {};
  }

  formatarRange(range: { episodeStart: number; episodeEnd: number } | null | undefined): { episode: number; episodeRangeText: string } | null {
    if (!range || range.episodeStart <= 0) return null;
    const texto = range.episodeEnd > range.episodeStart
      ? `Episódios ${pad2(range.episodeStart)}-${pad2(range.episodeEnd)}`
      : `Episódio ${pad2(range.episodeStart)}`;
    return { episode: range.episodeStart, episodeRangeText: texto };
  }

  montarFrasesDeBusca(query: string, searchQueries?: string[]): FrasesBusca {
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

    const baseTitles = [...frases].map(frase =>
      normalizarTexto(frase.replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim())
    ).filter(Boolean);

    return { frases, baseTitles };
  }

  extractTitleFromPostTitle(postTitle: string): string | null {
    if (!postTitle) return null;
    return postTitle
      .replace(/\bTorrent\b.*$/i, '')
      .replace(/\s*[–|-]\s*.*$/, '')
      .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-DL|DUAL|Dublado|Legendado)\b.*$/i, '')
      .trim() || null;
  }

  extractPostMetadata($: any): PostMetadata {
    const getMetaValue = (fieldName: string): string | undefined => {
      const target = fieldName.toLowerCase().replace(/:$/, '').trim();

      const label = $('em, b').toArray().find((el: any) => {
        const t = $(el).text().trim().toLowerCase().replace(/:$/, '').trim();
        return t === target;
      });
      if (!label) return undefined;

      const $label = $(label);

      const parentSpan = $label.closest('span');
      if (parentSpan.length) {
        const fullText = parentSpan.text().trim();
        const prefix = $label.text().trim();
        const idx = fullText.indexOf(prefix);
        if (idx !== -1) {
          const after = fullText.substring(idx + prefix.length).trim();
          if (after) return after;
        }
      }

      const $parent = $label.parent();
      const parentHtml = $parent.html() || '';
      const labelHtml = $label.toString();
      const idxHtml = parentHtml.indexOf(labelHtml);
      if (idxHtml !== -1) {
        const after = parentHtml.substring(idxHtml + labelHtml.length);
        const match = after.match(/^[:\s]*(.*?)(?:<br|<b|<\/p|$)/i);
        if (match) {
          const valor = match[1].replace(/<[^>]+>/g, '').trim();
          if (valor) return valor;
        }
      }

      return undefined;
    };

    const originalTitleRaw = getMetaValue('Título Original:') || getMetaValue('Titulo Original:');
    let originalTitle: string | undefined;
    if (originalTitleRaw && originalTitleRaw.length >= 3) {
      originalTitle = originalTitleRaw.split('|')[0].replace(/\(\d{4}\)$/, '').trim();
    }

    const yearRaw = getMetaValue('Lançamento:');
    let years: number[] = [];
    if (yearRaw) {
      years = yearRaw.match(/\b(19|20)\d{2}\b/g)?.map(y => parseInt(y)) || [];
    }

    const sizeRaw = getMetaValue('Tamanho:');
    let size: string | undefined;
    if (sizeRaw) {
      const tamanhos = sizeRaw.match(/([\d.,]+)\s*(GB|MB|KB)/gi) || [];
      if (tamanhos.length === 1) size = tamanhos[0];
    }

    return {
      quality: getMetaValue('Qualidade:'),
      size,
      language: getMetaValue('Áudio:'),
      originalTitle,
      year: years.length > 0 ? years[0] : undefined,
      years,
    };
  }

  buildLinkContext($: any, el: any): LinkContext {
    const $el = $(el);
    return {
      linkText: $el.text().trim(),
      parentText: $el.parent().text().trim(),
      fullContextText: this.getFullContextText($el),
    };
  }

  async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    try {
      const res = await axios.get(protectorUrl, { ...AXIOS_OPTS, timeout: 8000, maxRedirects: 5 });
      const match = (res.data as string).match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
      return match ? match[1] : null;
    } catch (err: any) {
      logger.warn(`Falha ao extrair magnet do protetor: ${err.message}`);
      return null;
    }
  }

  getFullContextText($el: any): string {
    const prevSpan = $el.parent().prev('span');
    if (prevSpan.length) {
      const text = prevSpan.text().trim();
      if (text) return text;
    }

    let current = $el.parent();
    for (let depth = 0; depth < 4; depth++) {
      const text = current.text().trim();
      if (text.length > 10) {
        const matches = text.match(/\b(2160p|1080p|720p|480p|4K|HD)\b/gi);
        if (matches && matches.length === 1) return text;
      }
      current = current.parent();
    }

    return $el.parent().text().trim();
  }

  cleanHtmlTitle(contextText: string, linkText: string, qualityOverride?: string | null): string {
    const epPatterns = [
      /EPIS[OÓ]DIO\s+\d{1,3}\s+AO?\s+\d{1,3}/i,
      /EPIS[OÓ]DIO\s+\d{1,3}/i,
      /\bS\d{1,2}\s*E\d{1,3}/i,
      /\bE\d{1,3}/i
    ];

    let episode = '';
    for (const pattern of epPatterns) {
      const match = contextText.match(pattern);
      if (match) { episode = match[0]; break; }
    }

    if (!episode) return '';

    let quality = qualityOverride || null;
    if (!quality) {
      quality = this.qualityDetector.extractBestQuality(linkText) || this.qualityDetector.extractBestQuality(contextText);
    }

    return quality ? `${episode}: ${quality}` : episode;
  }

  cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  parseSize(sizeStr: string): number {
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