import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import {
  extrairRangeEpisodios,
  extrairAno,
  normalizarTexto,
  isCollectionTitle,
  temporadaAlvoNoRange,
  calcularTokensRuido,
  limparPorRaridade,
  EpisodeRange,
  TipoConteudo,
} from '../../titulos/TechnicalWords.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { SimilarityCalculator } from '../../titulos/SimilarityCalculator.js';

const logger = new Logger('HdrScraper');

export const HDR_BASE = 'https://hdrtorrents.net';

export interface HdrTorrent {
  title: string;
  htmlTitle?: string;
  magnet: string;
  infoHash: string;
  seeders: number;
  size: string;
  language: string;
  originalTitle?: string;
  year?: number;
  years?: number[];
  canonicalName?: string;
  imdbConfirmed?: boolean;
  season?: number;
  episode?: number;
}

// Headers de navegador real — o WAF do HDR bloqueia 403 se faltar Sec-Fetch-* ou Accept-Language.
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Connection': 'keep-alive',
};

export const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: BROWSER_HEADERS,
};

// Sessão do HDR — token CSRF + cookie PHPSESSID. Renova em 30min ou quando o servidor devolve 403.
export interface HdrSession {
  token: string;
  cookie: string;
  criadaEm: number;
}

export const SESSION_TTL = 30 * 60 * 1000;
export let sessaoCache: HdrSession | null = null;

// Extrai cookies do header set-cookie (axios devolve array ou string).
export function extrairCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return '';
  const lista = Array.isArray(setCookie) ? setCookie : [setCookie];
  return lista.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

// Abre a home do HDR, extrai token CSRF e PHPSESSID. Reutiliza enquanto estiver dentro do TTL.
export async function obterSessao(forcar = false): Promise<HdrSession> {
  if (!forcar && sessaoCache && (Date.now() - sessaoCache.criadaEm) < SESSION_TTL) {
    return sessaoCache;
  }

  const res = await axios.get(`${HDR_BASE}/`, {
    ...axiosConfig,
    headers: BROWSER_HEADERS,
  });

  const token = res.data.match(/name="token"\s+value="([^"]+)"/)?.[1];
  if (!token) {
    throw new Error('HDR: token CSRF não encontrado na home');
  }

  const cookie = extrairCookies(res.headers['set-cookie']);
  sessaoCache = { token, cookie, criadaEm: Date.now() };

  logger.debug('HDR: sessão renovada', {
    token: token.substring(0, 8) + '...',
    temCookie: !!cookie,
  });

  return sessaoCache;
}

// Usado pelos testes pra zerar sessão entre cenários.
export function limparSessao(): void {
  sessaoCache = null;
}

// Instância única do SimilarityCalculator — mesma régua do TitleFilter.
export const similarity = SimilarityCalculator.getInstance();

export function detectSeasonRange(text: string): EpisodeRange | null {
  const range = extrairRangeEpisodios(text);
  if (range) return range;

  const seasonMatch = text.match(/(\d+)\s*ª\s*TEMPORADA/i) || text.match(/Season\s+(\d+)/i);
  if (seasonMatch) {
    const s = parseInt(seasonMatch[1]);
    return { seasonStart: s, seasonEnd: s, episodeStart: 0, episodeEnd: 0 };
  }
  return null;
}

export function passaFiltroTemporada(textos: string[], targetSeason?: number, mediaType?: TipoConteudo): boolean {
  if (targetSeason === undefined) return true;

  for (const t of textos) {
    if (!t) continue;
    const range = detectSeasonRange(t);
    if (range) return temporadaAlvoNoRange(range, targetSeason);
  }

  return textos.some(t => isCollectionTitle(t, mediaType));
}

export function extractLanguage(parentText: string): string {
  const t = parentText.toLowerCase();
  if (t.includes('dual') && /áudio|audio/.test(t)) return 'Dual Áudio';
  if (/dublado|dublada|dublagem/.test(t)) return 'Dublado';
  if (/legendado|legendada/.test(t)) return 'Legendado';
  if (/nacional/.test(t)) return 'Nacional';
  return '';
}

// Leitura genérica de <dl class="item-specs">... — layout novo do HDR.
export function parseSpecsList($: any): Record<string, string> {
  const specs: Record<string, string> = {};
  $('dl.item-specs > div').each((_i: number, el: any) => {
    const dt = $(el).find('dt').first();
    const dd = $(el).find('dd').first();
    if (!dt.length || !dd.length) return;
    const rotulo = normalizarTexto(dt.text().trim());
    const valor = dd.text().replace(/\s+/g, ' ').trim();
    if (rotulo && valor) specs[rotulo] = valor;
  });
  return specs;
}

// Remove sufixos do título original — "We Bare Bears - Complete S01", "Temporada Completa", etc.
export function limparTituloOriginal(titulo: string): string {
  return titulo
    .replace(/\s*[-–—]\s*(complete|completa?)\s*s\d{1,2}$/i, '')
    .replace(/\s*temporada\s+completa\s*(s\d{1,2})?$/i, '')
    .replace(/\s*complete\s+season\s*\d*$/i, '')
    .replace(/\s*s\d{1,2}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Origem de cada metadado — usado no log pra saber se o JSON-LD do post está funcionando.
export type OrigemMetadado = 'jsonld' | 'html' | 'none';

// Metadados ricos do post em JSON-LD (TVSeries/Movie) — fonte estruturada, sem regex.
// Tem alternateName (título original) e datePublished (ano) que o HTML repete, mas em formato mais estável.
export function extrairMetadadosDoJsonLd(blocks: any[]): { originalTitleBruto?: string; year?: number } {
  const meta = blocks.find(b => b && (b['@type'] === 'TVSeries' || b['@type'] === 'Movie'));
  if (!meta) return {};

  const out: { originalTitleBruto?: string; year?: number } = {};

  if (typeof meta.alternateName === 'string' && meta.alternateName.trim()) {
    out.originalTitleBruto = meta.alternateName.trim();
  }

  if (typeof meta.datePublished === 'string') {
    const y = meta.datePublished.match(/\b(19|20)\d{2}\b/);
    if (y) out.year = parseInt(y[0]);
  }

  return out;
}

// Metadados do post — JSON-LD primeiro (estruturado), HTML só pra complementar o que falta.
// Devolve a origem de title e year pra log/observabilidade.
export function extractHdrMetadata($: any, jsonLdBlocks?: any[]): {
  originalTitle?: string;
  originalTitleBruto?: string;
  year?: number;
  language?: string;
  quality?: string;
  size?: string;
  format?: string;
  duration?: string;
  origem: { title: OrigemMetadado; year: OrigemMetadado };
} {
  const result: {
    originalTitle?: string;
    originalTitleBruto?: string;
    year?: number;
    language?: string;
    quality?: string;
    size?: string;
    format?: string;
    duration?: string;
    origem: { title: OrigemMetadado; year: OrigemMetadado };
  } = { origem: { title: 'none', year: 'none' } };

  // 1. JSON-LD primeiro — se tiver, é a fonte mais estável pra título original e ano.
  if (jsonLdBlocks && jsonLdBlocks.length > 0) {
    const meta = extrairMetadadosDoJsonLd(jsonLdBlocks);
    if (meta.originalTitleBruto) {
      result.originalTitleBruto = meta.originalTitleBruto;
      result.originalTitle = limparTituloOriginal(meta.originalTitleBruto);
      result.origem.title = 'jsonld';
    }
    if (meta.year) {
      result.year = meta.year;
      result.origem.year = 'jsonld';
    }
  }

  // 2. HTML — completa o que o JSON-LD não trouxe + campos que só existem no HTML (quality, size, format, duration).
  // Layout ANTIGO: <p><b>Rótulo</b> Valor<br>...</p>
  const paragrafo = $('p').filter((_i: number, el: any) => /T[íi]tulo\s+Original/i.test($(el).text())).first();

  if (paragrafo.length) {
    paragrafo.find('b').each((_i: number, el: any) => {
      const rotulo = $(el).text().trim();
      const html = $(el).parent().html() || '';
      const elHtml = $(el).toString();
      const idx = html.indexOf(elHtml);
      if (idx === -1) return;

      const after = html.substring(idx + elHtml.length);
      const match = after.match(/^[:\s]*(.*?)(?:<br>|<b>|$)/i);
      if (!match) return;
      const valor = match[1].replace(/<[^>]+>/g, '').trim();

      if (/t[íi]tulo\s+original/i.test(rotulo) && !result.originalTitleBruto) {
        result.originalTitleBruto = valor;
        result.originalTitle = limparTituloOriginal(valor);
        result.origem.title = 'html';
      } else if (/lan[çc]amento/i.test(rotulo) && result.year === undefined) {
        const yearMatch = valor.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
          result.year = parseInt(yearMatch[0]);
          result.origem.year = 'html';
        }
      } else if (/idiomas?/i.test(rotulo)) {
        result.language = valor;
      }
    });

    // Se JSON-LD não trouxe, tenta o <a> depois do link IMDb no parágrafo.
    if (!result.originalTitle) {
      const tituloBase = extrairTituloBasePosImdb($, paragrafo);
      const originalFinal = tituloBase || result.originalTitleBruto;
      if (originalFinal) {
        result.originalTitle = limparTituloOriginal(originalFinal);
        result.origem.title = 'html';
      }
    }

    const specsFallback = parseSpecsList($);
    result.quality = result.quality || specsFallback['qualidade'];
    result.size = result.size || specsFallback['tamanho'];
    result.format = result.format || specsFallback['formato'];
    result.duration = result.duration || specsFallback['duracao'] || specsFallback['duração'];

    return result;
  }

  // Layout NOVO: <dl class="item-specs">
  const specs = parseSpecsList($);
  if (Object.keys(specs).length === 0) return result;

  if (specs['titulo original'] && !result.originalTitleBruto) {
    result.originalTitleBruto = specs['titulo original'];
    result.originalTitle = limparTituloOriginal(specs['titulo original']);
    result.origem.title = 'html';
  }
  if (specs['lancamento'] && result.year === undefined) {
    const yearMatch = specs['lancamento'].match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
      result.year = parseInt(yearMatch[0]);
      result.origem.year = 'html';
    }
  }
  if (specs['idiomas']) {
    result.language = specs['idiomas'];
  }
  if (specs['qualidade']) result.quality = specs['qualidade'];
  if (specs['tamanho']) result.size = specs['tamanho'].trim();
  if (specs['formato']) result.format = specs['formato'];
  if (specs['duracao']) result.duration = specs['duracao'];
  if (specs['duração']) result.duration = specs['duração'];

  return result;
}

export function extrairTituloBasePosImdb($: any, paragrafo: any): string | null {
  const imdbLink = paragrafo.find('a[href*="imdb.com/title/"]').first();
  if (!imdbLink.length) return null;

  const parentHtml = paragrafo.html() || '';
  const imdbHtml = imdbLink.toString();
  const idxImdb = parentHtml.indexOf(imdbHtml);
  if (idxImdb === -1) return null;

  const afterImdb = parentHtml.substring(idxImdb + imdbHtml.length);
  const nextLinkMatch = afterImdb.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
  if (nextLinkMatch) {
    return nextLinkMatch[2].trim();
  }
  return null;
}

export function extrairDnDoMagnet(magnet: string): string | undefined {
  const m = magnet.match(/[&?]dn=([^&]+)/i);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch {
    return m[1];
  }
}

// Encontra o container de texto do magnet — layout novo (.download-row) ou antigo (<p>).
export function getContainerText($: any, el: any): string {
  const row = $(el).closest('.download-row');
  if (row.length) {
    const nome = row.find('.download-name').first().text().trim();
    return nome || row.text().replace(/\s+/g, ' ').trim();
  }

  const parentP = $(el).closest('p');
  if (parentP.length) return parentP.text().trim();

  return $(el).text().trim();
}

// Classifica cabeçalho de seção — cobre "VERSÃO MKV DUAL ÁUDIO", "VERSÃO MP4 LEGENDADO", "::DUBLADO::".
export function classificarSecao(texto: string): 'DUAL' | 'LEGENDADO' | 'NONE' {
  const t = normalizarTexto(texto).trim();
  if (!t || t.length > 60) return 'NONE';
  if (/^(trailer|assistir|baixar|download|ver)\b/i.test(t)) return 'NONE';

  const temDual = /\bdual\b/.test(t) && /\baudio\b/.test(t);
  const temDublado = /\bdublado\b|\bdublada\b|\bdublagem\b|\bnacional\b/.test(t);
  const temLegendado = /\blegendado\b|\blegendada\b/.test(t);

  if (temLegendado && !temDual && !temDublado) return 'LEGENDADO';
  if ((temDual || temDublado) && !temLegendado) return 'DUAL';
  return 'NONE';
}

export interface SearchResultItem {
  title: string;
  postUrl: string;
}

// Monta a URL de busca — espaços viram "+", não "%20", porque o WAF bloqueia 403 com %20.
export function montarUrlBusca(query: string, token: string): string {
  const termo = encodeURIComponent(query.trim()).replace(/%20/g, '+');
  return `${HDR_BASE}/pesquisa/${termo}/?hp_bot_check=&token=${token}`;
}

// GET com cookie + headers de navegador. Renova sessão e retenta uma vez em caso de 403.
export async function fetchComSessao(url: string, tentativa = 0): Promise<string> {
  const sessao = await obterSessao(tentativa > 0);

  try {
    const res = await axios.get(url, {
      ...axiosConfig,
      headers: {
        ...BROWSER_HEADERS,
        'Cookie': sessao.cookie,
        'Referer': `${HDR_BASE}/`,
      },
    });
    return res.data;
  } catch (err: any) {
    const status = err.response?.status;
    if (status === 403 && tentativa === 0) {
      logger.debug('HDR: 403 detectado, renovando sessão e retentando');
      sessaoCache = null;
      return fetchComSessao(url, 1);
    }
    throw err;
  }
}

// Lê todos os blocos JSON-LD da página. Devolve blocos válidos + contagem de malformados.
export function parseJsonLdBlocks($: any): { blocks: any[]; malformados: number } {
  const blocks: any[] = [];
  let malformados = 0;
  $('script[type="application/ld+json"]').each((_i: number, el: any) => {
    const raw = $(el).text().trim();
    if (!raw) return;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      malformados++;
    }
  });
  return { blocks, malformados };
}

// Converte o mediaType do catalog pro @type do JSON-LD do HDR — 'tv' é o rótulo do TMDB pra série.
// Devolve null quando o tipo não foi declarado (aceita os dois, comportamento antigo).
export function mapearTipoEsperado(mediaType?: TipoConteudo): string | null {
  if (mediaType === 'series' || mediaType === 'tv') return 'TVSeries';
  if (mediaType === 'movie') return 'Movie';
  return null;
}

// Pré-filtro via JSON-LD: o HDR expõe os 20 resultados da busca num bloco CollectionPage (SEO).
// Não dependemos de classes CSS — o schema muda menos que o layout.
export async function searchHdrLinks(query: string, targetSeason?: number, mediaType?: TipoConteudo): Promise<SearchResultItem[]> {
  const t0 = Date.now();
  try {
    const sessao = await obterSessao();
    const url = montarUrlBusca(query, sessao.token);

    const html = await fetchComSessao(url);
    const $ = cheerio.load(html);

    const { blocks, malformados } = parseJsonLdBlocks($);
    if (malformados > 0) {
      logger.warn('HDR: JSON-LD malformado', { query: query.substring(0, 40), malformados });
    }

    const collectionPage = blocks.find(b => b && b['@type'] === 'CollectionPage');
    if (!collectionPage) {
      logger.warn('HDR: JSON-LD sem CollectionPage', {
        query: query.substring(0, 40),
        blocos: blocks.map(b => b?.['@type'] ?? '?').join(','),
      });
      return [];
    }

    const items = collectionPage.mainEntity?.itemListElement;
    if (!Array.isArray(items) || items.length === 0) {
      logger.warn('HDR: CollectionPage sem itens', { query: query.substring(0, 40) });
      return [];
    }

    const tipoEsperado = mapearTipoEsperado(mediaType);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();
    let cortadosPorTipo = 0;

    for (const entry of items) {
      const title: string | undefined = entry?.item?.name || entry?.name;
      const rawUrl: string | undefined = entry?.item?.url || entry?.url;
      if (!title || !rawUrl) continue;

      // Corta item incompatível com o tipo do catalog ANTES de abrir o post.
      // Sem similarity, sem magnet, sem HTML — economia de requests ao HDR.
      if (tipoEsperado && entry?.item?.['@type'] !== tipoEsperado) {
        cortadosPorTipo++;
        continue;
      }

      const absoluteHref = rawUrl.startsWith('http') ? rawUrl : `${HDR_BASE}${rawUrl}`;
      if (seen.has(absoluteHref)) continue;
      seen.add(absoluteHref);

      if (!passaFiltroTemporada([title], targetSeason, mediaType)) continue;

      results.push({ title, postUrl: absoluteHref });
    }

    // Resumo por query: total de itens, cortados por tipo, e os que sobraram após filtro de temporada.
    logger.debug(`HDR: "${query.substring(0, 40)}" JSON-LD | ${items.length} itens, ${cortadosPorTipo} cortados por tipo, ${results.length} pós-temporada (${Date.now() - t0}ms)`);

    return results.slice(0, 40);
  } catch (err: any) {
    logger.warn('HDR busca falhou', {
      query: query.substring(0, 50),
      status: err.response?.status || '-',
      error: err.message,
    });
    return [];
  }
}

export async function extractMagnetsFromPost(
  html: string,
  postTitle: string,
  postUrl?: string,
  targetSeason?: number,
  mediaType?: TipoConteudo
): Promise<HdrTorrent[]> {
  const $ = cheerio.load(html);
  const results: HdrTorrent[] = [];

  const h1Title = $('h1').first().text().replace(/Torrent.*$/i, '').trim();
  const titleTag = $('title').text().replace(/Torrent.*$/i, '').trim();
  const pageTitle = h1Title || titleTag || postTitle;

  // Parseia o JSON-LD uma vez e repassa pro extractHdrMetadata — evita reparsear.
  const { blocks: jsonLdBlocks } = parseJsonLdBlocks($);
  const metadata = extractHdrMetadata($, jsonLdBlocks);

  // originalTitle SEMPRE vem do metadado do post (JSON-LD/HTML).
  // Nunca do dn do magnet — dn é nome de arquivo do uploader, pode ser coleção,
  // spin-off ou lixo. Comparar isso contra o TMDB gera falso positivo.
  const tituloDoPost = metadata.originalTitle || metadata.originalTitleBruto;

  const sectionHeaders: Array<{ pos: number; type: 'DUAL' | 'LEGENDADO' }> = [];
  $('h1, h2, h3, h4, h5, h6, strong, b').each((_i: number, el: any) => {
    const texto = $(el).text().trim();
    if (!texto) return;
    const tipo = classificarSecao(texto);
    if (tipo === 'NONE') return;
    const pos = html.indexOf($(el).toString());
    if (pos === -1) return;
    sectionHeaders.push({ pos, type: tipo });
  });
  sectionHeaders.sort((a, b) => a.pos - b.pos);

  const detectarSecaoPorPosicao = (pos: number): 'DUAL' | 'LEGENDADO' | 'NONE' => {
    let secao: 'DUAL' | 'LEGENDADO' | 'NONE' = 'NONE';
    for (const sh of sectionHeaders) {
      if (pos > sh.pos) secao = sh.type;
      else break;
    }
    return secao;
  };

  const rawLinks: {
    href: string;
    containerText: string;
    linkText: string;
    qualityMatch?: string;
    sizeMatch?: string;
  }[] = [];

  const totalAnchors = $('a[href^="magnet:"]').length;

  $('a[href^="magnet:"]').each((_i: number, el: any) => {
    const href = $(el).attr('href');
    if (!href) return;

    const containerText = getContainerText($, el);
    const linkText = $(el).text().trim();

    const posMagnet = html.indexOf($(el).toString());
    const secaoPosicional = posMagnet !== -1 ? detectarSecaoPorPosicao(posMagnet) : 'NONE';
    if (secaoPosicional === 'LEGENDADO') return;

    const isLegendado = /legendado|legendada|legenda/i.test(containerText);
    const isDualOuDublado = /dual\s*áudio|dual\s*audio|dublado|dublada|dublagem|nacional/i.test(containerText);
    if (isLegendado && !isDualOuDublado) return;

    if (!passaFiltroTemporada([containerText, postTitle, pageTitle], targetSeason, mediaType)) return;

    const qualityMatch = containerText.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
    let sizeMatch = containerText.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];

    if (!sizeMatch) {
      const dn = extrairDnDoMagnet(href);
      if (dn) sizeMatch = dn.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];
    }

    rawLinks.push({ href, containerText, linkText, qualityMatch, sizeMatch });
  });

  for (const raw of rawLinks) {
    try {
      const hashMatch = raw.href.match(/btih:([a-zA-Z0-9]+)/i);
      let infoHash = hashMatch ? hashMatch[1].toLowerCase() : '';

      if (!infoHash) {
        logger.warn(`HDR: magnet sem infoHash`, { magnet: raw.href.substring(0, 60) });
        continue;
      }

      let canonicalName: string | undefined;

      try {
        const dados = await analisarMagnet(raw.href);
        canonicalName = dados?.nome ?? undefined;
        if (dados?.infoHash && dados.infoHash.toLowerCase() !== infoHash) {
          infoHash = dados.infoHash.toLowerCase();
        }
      } catch {
        canonicalName = undefined;
      }

      // originalTitle sempre do metadado do post — nunca do dn.
      const originalTitle = tituloDoPost;

      // Ano/anos: extrai do containerText. Se não tiver, usa metadata.
      const anosDoMagnet = extrairAno(raw.containerText);
      const years = (anosDoMagnet && anosDoMagnet.length > 0) ? anosDoMagnet : undefined;
      const year = years ? years[0] : metadata.year;

      const language = extractLanguage(raw.containerText) || metadata.language || extractLanguage(pageTitle);

      const range =
        detectSeasonRange(raw.containerText) ??
        detectSeasonRange(postTitle) ??
        detectSeasonRange(pageTitle);

      const rangeEp = extrairRangeEpisodios(raw.containerText);
      let episodeStart = rangeEp?.episodeStart ?? undefined;

      if (episodeStart === undefined && canonicalName) {
        const rangeCanonical = extrairRangeEpisodios(canonicalName);
        episodeStart = rangeCanonical?.episodeStart ?? undefined;
      }

      const episode = episodeStart;

      const qualityMatch = raw.qualityMatch || metadata.quality?.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
      const sizeMatch = raw.sizeMatch || metadata.size?.trim();

      const seasonLabel = range && range.seasonStart > 0
        ? (range.seasonStart === range.seasonEnd
          ? `${range.seasonStart}ª Temporada`
          : `${range.seasonStart}ª à ${range.seasonEnd}ª Temporada`)
        : '';

      const magnetTitle = seasonLabel
        ? `${pageTitle} - ${seasonLabel}${episode ? ` Episódio ${episode}` : ''}${language ? ` [${language}]` : ''}${qualityMatch ? ` ${qualityMatch}` : ''}`
        : [pageTitle, episode ? `Episódio ${episode}` : '', language ? `[${language}]` : '', qualityMatch].filter(Boolean).join(' ');

      const htmlTitleLimpo = raw.containerText
        .replace(/MAGNET LINK/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || undefined;

      results.push({
        title: magnetTitle,
        htmlTitle: htmlTitleLimpo,
        magnet: raw.href,
        infoHash,
        seeders: 0,
        size: sizeMatch || '',
        language,
        originalTitle,
        year,
        years,
        canonicalName,
        season: range?.seasonStart && range.seasonStart > 0 ? range.seasonStart : undefined,
        episode,
      });
    } catch (err) {
      logger.warn(`HDR: erro ao processar magnet`, { magnet: raw.href.substring(0, 60), error: (err as Error).message });
    }
  }

  logger.debug(`HDR extract | "${postTitle.substring(0, 40)}" | anchors=${totalAnchors} rawLinks=${rawLinks.length} magnets=${results.length}`);

  if (results.length > 0) {
    logger.debug(`HDR post | "${postTitle.substring(0, 40)}" | title=${metadata.origem.title} year=${metadata.origem.year} | ${results.length} magnets`);
  }

  return results;
}

// Busca um único post do HDR: faz o GET, valida IMDb (se aplicável) e extrai os magnets.
export async function processarPostHdr(
  item: SearchResultItem,
  imdbId: string | undefined,
  targetSeason: number | undefined,
  mediaType?: TipoConteudo
): Promise<{ torrents: HdrTorrent[]; imdbConfirmed: boolean }> {
  // Cada busca consome o par token+cookie — renovar antes do GET do post.
  limparSessao();

  let html: string;
  try {
    html = await fetchComSessao(item.postUrl);
  } catch (err) {
    logger.debug(`HDR post falhou | "${item.title.substring(0, 40)}" | ${(err as Error).message}`);
    return { torrents: [], imdbConfirmed: false };
  }

  let imdbConfirmed = false;
  if (imdbId) {
    const imdbIdDoPost = html.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
    if (imdbIdDoPost) {
      const isCollection = isCollectionTitle(item.title, mediaType);
      if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
        logger.debug(`HDR imdb mismatch | "${item.title.substring(0, 40)}" | post=${imdbIdDoPost} alvo=${imdbId}`);
        return { torrents: [], imdbConfirmed: false };
      }
      if (!isCollection) {
        imdbConfirmed = true;
      }
    }
  }

  const torrents = await extractMagnetsFromPost(html, item.title, item.postUrl, targetSeason, mediaType);
  if (torrents.length === 0) {
    logger.debug(`HDR post vazio | "${item.title.substring(0, 40)}" | html=${html.length}b`);
  }
  return { torrents, imdbConfirmed };
}

export async function searchHdr(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[],
  targetYear?: number,
  imdbId?: string,
  mediaType?: TipoConteudo
): Promise<HdrTorrent[]> {
  const startTime = Date.now();

  const queriesParaBusca = searchQueries && searchQueries.length > 0 ? [...searchQueries] : [query];

  const frasesValidas = queriesParaBusca.map(f => normalizarTexto(f)).filter(Boolean);

  try {
    const allResults: HdrTorrent[] = [];
    const seenInfoHashes = new Set<string>();
    const seenPostUrls = new Set<string>();
    let queriesComResultado = 0;

    for (const q of queriesParaBusca) {
      const t0 = Date.now();

      // HDR invalida token+cookie após 1 busca — renova a sessão antes de cada query.
      // Sem isso, a 2ª query em diante cai na home (fallback) e devolve lixo.
      limparSessao();

      const links = await searchHdrLinks(q, targetSeason, mediaType);

      if (links.length === 0) {
        logger.debug(`HDR: "${q.substring(0, 40)}" | 0 links (${Date.now() - t0}ms)`);
        continue;
      }

      const tokensRuido = calcularTokensRuido(links.map(l => l.title));

      // Só FILME usa collection no pré-filtro.
      // Série: "1ª Temporada Completa" é só uma temporada, não pack.
      // Deixar collection ativo em série aceitava spin-off (Dragon Ball Super).
      const ehSerie = mediaType === 'series' || mediaType === 'tv';

      const filtrados = links.filter(link => {
        const tituloLimpo = limparPorRaridade(link.title, tokensRuido);
        const resultado = similarity.compararComTitulos(frasesValidas, tituloLimpo);
        const isCollection = !ehSerie && isCollectionTitle(link.title, mediaType);

        if (!resultado.match && !isCollection) {
          logger.debug(`HDR rejeitado | "${link.title.substring(0, 50)}" | score=${resultado.score.toFixed(2)} nivel=${resultado.nivel}`);
          return false;
        }
        return true;
      });

      if (filtrados.length === 0) {
        logger.debug(`HDR: "${q.substring(0, 40)}" | ${links.length} links, 0 relevantes (${Date.now() - t0}ms)`);
        continue;
      }

      const novos = filtrados.filter(item => {
        if (seenPostUrls.has(item.postUrl)) return false;
        seenPostUrls.add(item.postUrl);
        return true;
      });

      if (novos.length === 0) {
        logger.debug(`HDR: "${q.substring(0, 40)}" | ${links.length} links, ${filtrados.length} relevantes, 0 novos (${Date.now() - t0}ms)`);
        continue;
      }

      const respostas = await Promise.all(
        novos.map(item => processarPostHdr(item, imdbId, targetSeason, mediaType))
      );

      let magnetsDaQuery = 0;
      for (const { torrents, imdbConfirmed } of respostas) {
        for (const r of torrents) {
          if (imdbConfirmed) r.imdbConfirmed = true;
          if (!seenInfoHashes.has(r.infoHash)) {
            seenInfoHashes.add(r.infoHash);
            allResults.push(r);
            magnetsDaQuery++;
          }
        }
      }

      if (magnetsDaQuery > 0) queriesComResultado++;

      logger.debug(`HDR: "${q.substring(0, 40)}" | ${links.length} links, ${filtrados.length} relevantes, ${novos.length} novos, ${magnetsDaQuery} magnets (${Date.now() - t0}ms)`);
    }

    const duration = Date.now() - startTime;
    logger.info(`HDR: ${allResults.length} magnets em ${duration}ms | queries=${queriesParaBusca.length} comResultado=${queriesComResultado}`);
    return allResults;
  } catch (err: any) {
    logger.error('HDR erro', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}