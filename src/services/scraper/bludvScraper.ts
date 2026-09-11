import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairRangeEpisodios, normalizarTexto, isCollectionTitle, INDICADORES_INTERNACIONAL_TORRENTS } from '../../titulos/TechnicalWords.js';

const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

const logger = new Logger('BludvScraper');

// Força Google/Cloudflare no lookup — o DNS do site é instável em alguns ambientes.
dns.setServers(['8.8.8.8', '1.1.1.1']);

// Agent HTTPS que resolve o domínio manualmente e conecta no IP com SNI correto.
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

export type SectionBoundaries = {
  dualPos: number;
  legendadoPos: number;
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

// Remove magnets duplicados mantendo a ordem de entrada.
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

    // Quando a busca não acha nada, o WordPress marca o body com search-no-results
    // e enche a página com posts recentes como fallback. Nada ali é resultado real.
    if ($('body').hasClass('search-no-results')) {
      logger.debug('[BLUDV] busca sem resultados (search-no-results)');
      return [];
    }

    const items: PostItem[] = [];
    const urlsVistas = new Set<string>();

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();

      // Links com capa têm text() vazio — o título real está no alt da <img>.
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
      if (range && range.season !== targetSeason) return false;
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
      if (range && range.season !== targetSeason) return [];
    }

    const metadata = this.extractPostMetadata($);

    // Acha os cabeçalhos de seção (DUAL / LEGENDADO) uma vez só e usa pra filtrar tudo.
    const boundaries = this.findSectionBoundaries($, contentHtml);
    logger.debug(`[BLUDV] boundaries: dualPos=${boundaries.dualPos}, legendadoPos=${boundaries.legendadoPos}`);

    // Se o post só tem seção LEGENDADO (sem DUAL), ignora — não queremos legendado.
    if (boundaries.dualPos === -1 && boundaries.legendadoPos !== -1) {
      logger.debug('[BLUDV] post apenas legendado — descartado');
      return [];
    }

    // Magnets diretos no HTML (<center> com <a href="magnet:...">).
    const directMagnets = this.extractDirectMagnets($, contentHtml, boundaries);
    logger.debug(`[BLUDV] magnets diretos na seção válida: ${directMagnets.length}`);

    // Magnets atrás de protetor (systemads1.com) — resolvidos um a um.
    const protectorLinks = this.extractProtectorLinks($, contentHtml, boundaries);
    logger.debug(`[BLUDV] protector links na seção válida: ${protectorLinks.length}`);

    const protectorMagnets = await this.resolverMagnetsDoProtetor(protectorLinks);

    // Junta tudo e dedup por URL do magnet.
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

      const quality = this.resolverQualidade(canonicalName, link, postTitle, metadata.quality);
      const { episode, episodeRangeText } = this.resolverEpisodio(canonicalName, link);
      const language = this.resolverIdioma(secao, metadata.language);

      const originalTitleFinal = metadata.originalTitle || cleanTitleFromPost;
      const displayTitle = originalTitleFinal || canonicalName || postTitle;

      const size = metadata.size || 'Desconhecido';

      const cleanedHtmlTitle = episodeRangeText
        ? `${episodeRangeText}: ${quality}`
        : this.cleanHtmlTitle(link.fullContextText || link.linkText, link.linkText, quality);

      results.push({
        title: this.cleanTitle(displayTitle),
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
        originalTitle: originalTitleFinal ?? undefined,
        year: metadata.year,
        years: metadata.years,
        canonicalName,
        imdbConfirmed,
      });
    }

    return results;
  }

  // Percorre os <strong>/<b> dentro do conteúdo e acha as posições dos cabeçalhos
  // "DUAL ÁUDIO" (ou similar) e "LEGENDADO". Rejeita trailers e textos longos.
  findSectionBoundaries($: any, contentHtml: string): SectionBoundaries {
    const strongEls = $('.content strong, .content b').toArray();
    let dualPos = -1;
    let legendadoPos = -1;

    for (const el of strongEls) {
      const texto = $(el).text().trim();
      if (!texto) continue;

      const tipo = this.detectSectionType(texto);
      if (tipo === 'NONE') continue;

      const pos = contentHtml.indexOf($(el).toString());
      if (pos === -1) continue;

      if (tipo === 'DUAL' && dualPos === -1) {
        dualPos = pos;
      } else if (tipo === 'LEGENDADO' && dualPos !== -1 && pos > dualPos && legendadoPos === -1) {
        legendadoPos = pos;
        break;
      }
    }

    return { dualPos, legendadoPos };
  }

  // Classifica um <strong>/<b> como cabeçalho de seção.
  // Rejeita trailers, CTAs e textos longos que contenham a keyword por acaso.
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

  // Dado o offset de um elemento no HTML, diz em qual seção ele cai.
  getSectionForPosition(pos: number, boundaries: SectionBoundaries): SectionType {
    const { dualPos, legendadoPos } = boundaries;

    // Sem cabeçalhos: aceita tudo como "sem seção definida".
    if (dualPos === -1 && legendadoPos === -1) return 'NONE';

    // Só legendado no post: nada presta.
    if (dualPos === -1) return 'LEGENDADO';

    // Antes do cabeçalho DUAL: nada presta.
    if (pos < dualPos) return 'NONE';

    // Depois do cabeçalho LEGENDADO: é legendado.
    if (legendadoPos !== -1 && pos >= legendadoPos) return 'LEGENDADO';

    return 'DUAL';
  }

  // Extrai magnets diretos do HTML, filtrando por seção.
  // Estrutura típica: <center><span>...1080p (2.88 GB)</span><br><a href="magnet:...">Magnet-Link</a></center>
  extractDirectMagnets($: any, contentHtml: string, boundaries: SectionBoundaries): ExtractedMagnet[] {
    const resultados: ExtractedMagnet[] = [];

    for (const centerEl of $('center').toArray()) {
      const magnetLink = $(centerEl).find('a[href^="magnet:"]').first();
      if (!magnetLink.length) continue;

      const magnet = magnetLink.attr('href')?.trim();
      if (!magnet) continue;

      const pos = contentHtml.indexOf($(centerEl).toString());
      const secao = this.getSectionForPosition(pos, boundaries);
      if (secao === 'LEGENDADO') continue;

      const spanText = $(centerEl).find('span').first().text().trim();
      const ctx = this.buildLinkContext($, magnetLink[0]);

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

    // Fallback: se a estrutura <center> mudou, varre todos os magnets diretos.
    if (resultados.length === 0) {
      for (const el of $('a[href^="magnet:"]').toArray() as any[]) {
        const magnet = $(el).attr('href')?.trim();
        if (!magnet) continue;

        const pos = contentHtml.indexOf($(el).toString());
        const secao = this.getSectionForPosition(pos, boundaries);
        if (secao === 'LEGENDADO') continue;

        resultados.push({
          magnet,
          link: this.buildLinkContext($, el),
          secao,
        });
      }
    }

    return resultados;
  }

  // Extrai links de protetor (systemads1.com), filtrando por seção.
  extractProtectorLinks($: any, contentHtml: string, boundaries: SectionBoundaries): ProtectorLink[] {
    const allLinks = $('a[href*="systemads1.com"]').toArray();
    if (!allLinks.length) return [];

    const result: ProtectorLink[] = [];
    for (const el of allLinks) {
      const pos = contentHtml.indexOf($(el).toString());
      if (pos === -1) continue;

      const secao = this.getSectionForPosition(pos, boundaries);
      if (secao === 'LEGENDADO') continue;

      result.push({
        url: $(el).attr('href') as string,
        secao,
        ...this.buildLinkContext($, el),
      });
    }
    return result;
  }

  // Resolve os links do protetor em lotes, devolvendo os magnets prontos.
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

  // Decide o idioma final do stream: seção tem prioridade sobre o metadata.
  resolverIdioma(secao: SectionType, metaLanguage?: string): string {
    if (secao === 'DUAL') return 'Dual';
    if (secao === 'LEGENDADO') return 'Legendado';

    // Sem seção: usa metadata do post, normalizando formatos compostos.
    if (!metaLanguage) return 'Desconhecido';

    const lower = metaLanguage.toLowerCase();
    if (lower.includes('|')) return 'Dual'; // "Português | Inglês" = dual
    if (lower.includes('nacional')) return 'Nacional';
    if (lower.includes('dual')) return 'Dual';
    if (lower.includes('dublado') || lower.includes('dublad')) return 'Dublado';
    if (LEGENDADO_REGEX.test(lower)) return 'Legendado';
    return metaLanguage;
  }

  resolverQualidade(
    canonicalName: string | undefined,
    link: LinkContext,
    postTitle: string,
    metadataQuality?: string
  ): string {
    const candidatos = [
      metadataQuality,
      canonicalName,
      link.linkText,
      link.fullContextText,
      link.parentText,
    ];

    for (const texto of candidatos) {
      if (!texto) continue;
      const quality = this.qualityDetector.extractBestQuality(texto);
      if (quality && this.qualityDetector.isValidQuality(quality)) return quality;
    }

    const doTitulo = this.qualityDetector.extractBestQuality(postTitle);
    return (doTitulo && this.qualityDetector.isValidQuality(doTitulo)) ? doTitulo : 'HD';
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
      return { episode: ep, episodeRangeText: `Episódio ${ep}` };
    }

    return {};
  }

  formatarRange(range: { episodeStart: number; episodeEnd: number } | null | undefined): { episode: number; episodeRangeText: string } | null {
    if (!range || range.episodeStart <= 0) return null;
    const texto = range.episodeEnd > range.episodeStart
      ? `Episódio ${range.episodeStart}-${range.episodeEnd}`
      : `Episódio ${range.episodeStart}`;
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
    let originalTitle: string | undefined;
    if (originalTitleRaw && originalTitleRaw.length >= 3) {
      originalTitle = originalTitleRaw.split('|')[0].replace(/\(\d{4}\)$/, '').trim();
    }

    const yearRaw = getMetaValue('Lançamento:');
    let years: number[] = [];
    if (yearRaw) {
      years = yearRaw.match(/\b(19|20)\d{2}\b/g)?.map(y => parseInt(y)) || [];
    }

    return {
      quality: getMetaValue('Qualidade:'),
      size: getMetaValue('Tamanho:'),
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

  // Sobe pelos ancestrais buscando o primeiro nó com só UMA menção de qualidade.
  // Duas ou mais = container grande, não serve como contexto individual.
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

  estimateSeeders(): number {
    return Math.floor(30 + Math.random() * 60);
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