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
  EpisodeRange,
  TipoConteudo,
} from '../../titulos/TechnicalWords.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { SimilarityCalculator } from '../../titulos/SimilarityCalculator.js';

const logger = new Logger('HdrScraper');

export const HDR_BASE = 'https://hdrtorrents.net';

const FONTE = 'hdr';

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

export function truncar(texto: string, max = 40): string {
  return texto.substring(0, max);
}

// Negative cache
export const NEGATIVE_DEFAULT_TTL_MS = 30 * 60 * 1000;
export const NEGATIVE_MAX_ENTRIES = 5000;

interface NegativeEntry {
  ts: number;
  ttlMs: number;
  hits: number;
}

const negativeStore = new Map<string, NegativeEntry>();

export function negativeCacheKey(
  source: string,
  query: string,
  extra?: Record<string, unknown>
): string {
  const q = query.trim().toLowerCase();
  const e = extra ? JSON.stringify(extra) : '';
  return `${source}|${q}|${e}`;
}

export function negativeCacheIsBlocked(key: string): boolean {
  const entry = negativeStore.get(key);
  if (!entry) return false;
  if (Date.now() - entry.ts > entry.ttlMs) {
    negativeStore.delete(key);
    return false;
  }
  entry.hits++;
  return true;
}

export function negativeCacheMark(key: string, ttlMs = NEGATIVE_DEFAULT_TTL_MS): void {
  if (negativeStore.size >= NEGATIVE_MAX_ENTRIES) {
    const first = negativeStore.keys().next().value;
    if (first) negativeStore.delete(first);
  }
  negativeStore.set(key, { ts: Date.now(), ttlMs, hits: 0 });
}

export function negativeCacheClear(): void {
  negativeStore.clear();
}

export function negativeCacheStats() {
  const agora = Date.now();
  return {
    size: negativeStore.size,
    maxEntries: NEGATIVE_MAX_ENTRIES,
    defaultTtlMs: NEGATIVE_DEFAULT_TTL_MS,
    entries: Array.from(negativeStore.entries()).map(([key, v]) => ({
      key,
      ageMs: agora - v.ts,
      ttlMs: v.ttlMs,
      expiraEmMs: Math.max(0, v.ttlMs - (agora - v.ts)),
      hits: v.hits,
    })),
  };
}

// Circuit breaker
export type BreakerState = 'closed' | 'open' | 'half-open';

export const BREAKER_JANELA_MS = 5 * 60 * 1000;
export const BREAKER_LIMITE_ERROS = 5;
export const BREAKER_COOLDOWN_MS = 15 * 60 * 1000;

interface BreakerEntry {
  erros: number;
  ultimaFalha: number;
  abertoEm: number;
  estado: BreakerState;
}

const breakerStore = new Map<string, BreakerEntry>();

function getBreaker(fonte: string): BreakerEntry {
  let e = breakerStore.get(fonte);
  if (!e) {
    e = { erros: 0, ultimaFalha: 0, abertoEm: 0, estado: 'closed' };
    breakerStore.set(fonte, e);
  }
  return e;
}

export function breakerStatus(fonte: string): BreakerState {
  return getBreaker(fonte).estado;
}

export function breakerPodeUsar(fonte: string): boolean {
  const e = getBreaker(fonte);
  if (e.estado === 'closed') return true;

  if (e.estado === 'open') {
    if (Date.now() - e.abertoEm > BREAKER_COOLDOWN_MS) {
      e.estado = 'half-open';
      logger.debug(`HDR: circuit breaker half-open | fonte=${fonte}`);
      return true;
    }
    return false;
  }

  return true;
}

export function breakerRegistrarSucesso(fonte: string): void {
  const e = getBreaker(fonte);
  if (e.estado !== 'closed') {
    logger.info(`HDR: circuit breaker FECHADO | fonte=${fonte}`);
  }
  e.erros = 0;
  e.estado = 'closed';
  e.abertoEm = 0;
}

export function breakerRegistrarFalha(fonte: string): void {
  const e = getBreaker(fonte);
  const agora = Date.now();

  if (agora - e.ultimaFalha > BREAKER_JANELA_MS) e.erros = 0;
  e.erros++;
  e.ultimaFalha = agora;

  if (e.estado === 'half-open') {
    e.estado = 'open';
    e.abertoEm = agora;
    logger.warn(`HDR: circuit breaker REABERTO após falha no half-open | fonte=${fonte}`, { erros: e.erros });
    return;
  }

  if (e.erros >= BREAKER_LIMITE_ERROS && e.estado === 'closed') {
    e.estado = 'open';
    e.abertoEm = agora;
    logger.warn(`HDR: circuit breaker ABERTO | fonte=${fonte}`, {
      erros: e.erros,
      cooldownMs: BREAKER_COOLDOWN_MS,
    });
  }
}

export function breakerReset(fonte?: string): void {
  if (fonte) breakerStore.delete(fonte);
  else breakerStore.clear();
}

export function breakerStats() {
  const agora = Date.now();
  return {
    windowMs: BREAKER_JANELA_MS,
    threshold: BREAKER_LIMITE_ERROS,
    cooldownMs: BREAKER_COOLDOWN_MS,
    entries: Array.from(breakerStore.entries()).map(([fonte, e]) => ({
      fonte,
      estado: e.estado,
      erros: e.erros,
      ultimaFalhaMs: e.ultimaFalha ? agora - e.ultimaFalha : null,
      abertoEmMs: e.abertoEm ? agora - e.abertoEm : null,
      cooldownRestanteMs: e.estado === 'open'
        ? Math.max(0, BREAKER_COOLDOWN_MS - (agora - e.abertoEm))
        : null,
    })),
  };
}

export function classificarErroFonte(err: any): 'fonte' | 'item' {
  const status = err?.response?.status;
  if (!status) return 'fonte';
  if (status >= 500) return 'fonte';
  if (status === 403 || status === 429) return 'fonte';
  return 'item';
}

// Parsing
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

export function limparTituloOriginal(titulo: string): string {
  return titulo
    .replace(/\s*[-–—]\s*(complete|completa?)\s*s\d{1,2}$/i, '')
    .replace(/\s*temporada\s+completa\s*(s\d{1,2})?$/i, '')
    .replace(/\s*complete\s+season\s*\d*$/i, '')
    .replace(/\s*s\d{1,2}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Metadata
export type OrigemMetadado = 'jsonld' | 'html' | 'none';

export interface HdrMetadata {
  originalTitle?: string;
  originalTitleBruto?: string;
  year?: number;
  language?: string;
  quality?: string;
  size?: string;
  format?: string;
  duration?: string;
  origem: { title: OrigemMetadado; year: OrigemMetadado };
}

function criarMetadadoVazio(): HdrMetadata {
  return { origem: { title: 'none', year: 'none' } };
}

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

function aplicarJsonLd(result: HdrMetadata, jsonLdBlocks?: any[]): void {
  if (!jsonLdBlocks || jsonLdBlocks.length === 0) return;

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

function extrairValorDeBold($: any, el: any): string | null {
  const html = $(el).parent().html() || '';
  const elHtml = $(el).toString();
  const idx = html.indexOf(elHtml);
  if (idx === -1) return null;

  const after = html.substring(idx + elHtml.length);
  const match = after.match(/^[:\s]*(.*?)(?:<br>|<b>|$)/i);
  if (!match) return null;

  return match[1].replace(/<[^>]+>/g, '').trim();
}

function aplicarParagrafo(result: HdrMetadata, $: any, paragrafo: any): void {
  paragrafo.find('b').each((_i: number, el: any) => {
    const rotulo = $(el).text().trim();
    const valor = extrairValorDeBold($, el);
    if (valor === null) return;

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
}

function aplicarSpecs(result: HdrMetadata, specs: Record<string, string>): void {
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
  if (specs['idiomas']) result.language = specs['idiomas'];
  if (specs['qualidade']) result.quality = specs['qualidade'];
  if (specs['tamanho']) result.size = specs['tamanho'].trim();
  if (specs['formato']) result.format = specs['formato'];
  if (specs['duracao']) result.duration = specs['duracao'];
  if (specs['duração']) result.duration = specs['duração'];
}

export function extractHdrMetadata($: any, jsonLdBlocks?: any[]): HdrMetadata {
  const result = criarMetadadoVazio();

  aplicarJsonLd(result, jsonLdBlocks);

  const paragrafo = $('p').filter((_i: number, el: any) => /T[íi]tulo\s+Original/i.test($(el).text())).first();

  if (paragrafo.length) {
    aplicarParagrafo(result, $, paragrafo);
    return result;
  }

  const specs = parseSpecsList($);
  if (Object.keys(specs).length === 0) return result;

  aplicarSpecs(result, specs);
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

// Magnet
export function extrairDnDoMagnet(magnet: string): string | undefined {
  const m = magnet.match(/[&?]dn=([^&]+)/i);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch {
    return m[1];
  }
}

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

interface SecaoHeader {
  pos: number;
  type: 'DUAL' | 'LEGENDADO';
}

function detectarSecoes($: any, html: string): SecaoHeader[] {
  const secaoHeaders: SecaoHeader[] = [];

  $('h1, h2, h3, h4, h5, h6, strong, b').each((_i: number, el: any) => {
    const texto = $(el).text().trim();
    if (!texto) return;

    const tipo = classificarSecao(texto);
    if (tipo === 'NONE') return;

    const pos = html.indexOf($(el).toString());
    if (pos === -1) return;

    secaoHeaders.push({ pos, type: tipo });
  });

  secaoHeaders.sort((a, b) => a.pos - b.pos);
  return secaoHeaders;
}

function secaoNaPosicao(pos: number, secaoHeaders: SecaoHeader[]): 'DUAL' | 'LEGENDADO' | 'NONE' {
  let secao: 'DUAL' | 'LEGENDADO' | 'NONE' = 'NONE';
  for (const sh of secaoHeaders) {
    if (pos > sh.pos) secao = sh.type;
    else break;
  }
  return secao;
}

// Search
export interface SearchResultItem {
  title: string;
  postUrl: string;
}

export interface SearchLinksResult {
  status: 'ok' | 'empty' | 'error' | 'blocked';
  items: SearchResultItem[];
  error?: string;
  reason?: string;
}

export function montarUrlBusca(query: string): string {
  const termo = encodeURIComponent(query.trim()).replace(/%20/g, '+');
  return `${HDR_BASE}/pesquisa/${termo}/`;
}

export async function fetchComSessao(url: string, tentativa = 0): Promise<string> {
  try {
    const res = await axios.get(url, {
      ...axiosConfig,
      headers: { ...BROWSER_HEADERS, 'Referer': `${HDR_BASE}/` },
    });
    return res.data;
  } catch (err: any) {
    const status = err.response?.status;
    if (status >= 500 && tentativa === 0) {
      logger.debug('HDR: erro 5xx, retentando');
      return fetchComSessao(url, 1);
    }
    throw err;
  }
}

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

export function mapearTipoEsperado(mediaType?: TipoConteudo): string | null {
  if (mediaType === 'series' || mediaType === 'tv') return 'TVSeries';
  if (mediaType === 'movie') return 'Movie';
  return null;
}

function parsearJsonLdItems(
  items: any[],
  tipoEsperado: string | null,
  targetSeason?: number,
  mediaType?: TipoConteudo
): { results: SearchResultItem[]; cortadosPorTipo: number } {
  const results: SearchResultItem[] = [];
  const seen = new Set<string>();
  let cortadosPorTipo = 0;

  for (const entry of items) {
    const title: string | undefined = entry?.item?.name || entry?.name;
    const rawUrl: string | undefined = entry?.item?.url || entry?.url;
    if (!title || !rawUrl) continue;

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

  return { results, cortadosPorTipo };
}

export async function searchHdrLinks(
  query: string,
  targetSeason?: number,
  mediaType?: TipoConteudo
): Promise<SearchLinksResult> {
  const t0 = Date.now();
  const q = truncar(query);

  if (!breakerPodeUsar(FONTE)) {
    logger.debug(`HDR: circuit breaker OPEN, pulando searchHdrLinks | "${q}"`);
    return { status: 'blocked', items: [], reason: 'circuit breaker open' };
  }

  try {
    const url = montarUrlBusca(query);
    const html = await fetchComSessao(url);
    const $ = cheerio.load(html);

    const { blocks, malformados } = parseJsonLdBlocks($);
    if (malformados > 0) {
      logger.warn('HDR: JSON-LD malformado', { query: q, malformados });
    }

const collectionPage = blocks.find(b => b && b['@type'] === 'CollectionPage');
if (!collectionPage) {
  // HDR às vezes devolve a home (WebSite + Organization) em vez de página de busca.
  // Acontece com queries não-latinas, termos raros, ou quando o WAF mascara a resposta.
  // Home sem CollectionPage NÃO é falha de fonte — é "0 resultados" disfarçado.
  const tipos = blocks.map(b => b?.['@type']).filter(Boolean);
  const ehHome = tipos.length === 2 && tipos.includes('WebSite') && tipos.includes('Organization');

  if (ehHome) {
    logger.debug(`HDR: query rejeitada (home sem CollectionPage) | "${truncar(query)}"`);
    return { status: 'empty', items: [] };
  }

  // JSON-LD ausente com outros blocos = mudança de layout ou bloqueio real
  logger.warn('HDR: JSON-LD sem CollectionPage', {
    query: truncar(query),
    blocos: tipos.join(','),
  });
  breakerRegistrarFalha(FONTE);
  return { status: 'error', items: [], reason: 'no CollectionPage' };
}

    const items = collectionPage.mainEntity?.itemListElement;
    if (!Array.isArray(items) || items.length === 0) {
      breakerRegistrarSucesso(FONTE);
      logger.debug(`HDR: CollectionPage vazia | "${q}"`);
      return { status: 'empty', items: [] };
    }

    const tipoEsperado = mapearTipoEsperado(mediaType);
    const { results, cortadosPorTipo } = parsearJsonLdItems(items, tipoEsperado, targetSeason, mediaType);

    breakerRegistrarSucesso(FONTE);
    logger.debug(`HDR: "${q}" JSON-LD | ${items.length} itens, ${cortadosPorTipo} cortados por tipo, ${results.length} pós-temporada (${Date.now() - t0}ms)`);

    return { status: 'ok', items: results.slice(0, 40) };
  } catch (err: any) {
    logger.warn('HDR busca falhou', {
      query: truncar(query, 50),
      status: err.response?.status || '-',
      error: err.message,
    });
    breakerRegistrarFalha(FONTE);
    return { status: 'error', items: [], error: err.message };
  }
}

interface RawLink {
  href: string;
  containerText: string;
  linkText: string;
  qualityMatch?: string;
  sizeMatch?: string;
}

interface ContextoPost {
  pageTitle: string;
  postTitle: string;
  tituloDoPost: string | undefined;
  metadata: HdrMetadata;
  targetSeason?: number;
  mediaType?: TipoConteudo;
}

function coletarRawLinks(
  $: any,
  html: string,
  secaoHeaders: SecaoHeader[],
  ctx: { postTitle: string; pageTitle: string; targetSeason?: number; mediaType?: TipoConteudo }
): { rawLinks: RawLink[]; totalAnchors: number } {
  const rawLinks: RawLink[] = [];
  const totalAnchors = $('a[href^="magnet:"]').length;

  $('a[href^="magnet:"]').each((_i: number, el: any) => {
    const href = $(el).attr('href');
    if (!href) return;

    const containerText = getContainerText($, el);
    const linkText = $(el).text().trim();

    const posMagnet = html.indexOf($(el).toString());
    const secaoPosicional = posMagnet !== -1 ? secaoNaPosicao(posMagnet, secaoHeaders) : 'NONE';
    if (secaoPosicional === 'LEGENDADO') return;

    const isLegendado = /legendado|legendada|legenda/i.test(containerText);
    const isDualOuDublado = /dual\s*áudio|dual\s*audio|dublado|dublada|dublagem|nacional/i.test(containerText);
    if (isLegendado && !isDualOuDublado) return;

    if (!passaFiltroTemporada([containerText, ctx.postTitle, ctx.pageTitle], ctx.targetSeason, ctx.mediaType)) return;

    const qualityMatch = containerText.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
    let sizeMatch = containerText.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];

    if (!sizeMatch) {
      const dn = extrairDnDoMagnet(href);
      if (dn) sizeMatch = dn.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];
    }

    rawLinks.push({ href, containerText, linkText, qualityMatch, sizeMatch });
  });

  return { rawLinks, totalAnchors };
}

async function processarRawLink(raw: RawLink, ctx: ContextoPost): Promise<HdrTorrent | null> {
  try {
    const hashMatch = raw.href.match(/btih:([a-zA-Z0-9]+)/i);
    let infoHash = hashMatch ? hashMatch[1].toLowerCase() : '';

    if (!infoHash) {
      logger.warn(`HDR: magnet sem infoHash`, { magnet: raw.href.substring(0, 60) });
      return null;
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

    const anosDoMagnet = extrairAno(raw.containerText);
    const years = (anosDoMagnet && anosDoMagnet.length > 0) ? anosDoMagnet : undefined;
    const year = years ? years[0] : ctx.metadata.year;

    const language = extractLanguage(raw.containerText) || ctx.metadata.language || extractLanguage(ctx.pageTitle);

    const rangeDoEpisodio = detectSeasonRange(raw.containerText);
    const rangeDaTemporada =
      detectSeasonRange(ctx.postTitle) ??
      detectSeasonRange(ctx.pageTitle);

    const range =
      (rangeDoEpisodio && rangeDoEpisodio.seasonStart > 0 ? rangeDoEpisodio : null) ??
      rangeDaTemporada ??
      rangeDoEpisodio;

    const rangeEp = extrairRangeEpisodios(raw.containerText);
    let episodeStart = rangeEp?.episodeStart ?? undefined;

    if (episodeStart === undefined && canonicalName) {
      const rangeCanonical = extrairRangeEpisodios(canonicalName);
      episodeStart = rangeCanonical?.episodeStart ?? undefined;
    }

    const episode = episodeStart;
    const qualityMatch = raw.qualityMatch || ctx.metadata.quality?.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
    const sizeMatch = raw.sizeMatch || ctx.metadata.size?.trim();

    const seasonLabel = range && range.seasonStart > 0
      ? (range.seasonStart === range.seasonEnd
        ? `${range.seasonStart}ª Temporada`
        : `${range.seasonStart}ª à ${range.seasonEnd}ª Temporada`)
      : '';

    const magnetTitle = seasonLabel
      ? `${ctx.pageTitle} - ${seasonLabel}${episode ? ` Episódio ${episode}` : ''}${language ? ` [${language}]` : ''}${qualityMatch ? ` ${qualityMatch}` : ''}`
      : [ctx.pageTitle, episode ? `Episódio ${episode}` : '', language ? `[${language}]` : '', qualityMatch].filter(Boolean).join(' ');

    const htmlTitleLimpo = raw.containerText
      .replace(/MAGNET LINK/gi, '')
      .replace(/\s+/g, ' ')
      .trim() || undefined;

    return {
      title: magnetTitle,
      htmlTitle: htmlTitleLimpo,
      magnet: raw.href,
      infoHash,
      seeders: 0,
      size: sizeMatch || '',
      language,
      originalTitle: ctx.tituloDoPost,
      year,
      years,
      canonicalName,
      season: range?.seasonStart && range.seasonStart > 0 ? range.seasonStart : undefined,
      episode,
    };
  } catch (err) {
    logger.warn(`HDR: erro ao processar magnet`, { magnet: raw.href.substring(0, 60), error: (err as Error).message });
    return null;
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

  const h1Title = $('h1').first().text().replace(/Torrent.*$/i, '').trim();
  const titleTag = $('title').text().replace(/Torrent.*$/i, '').trim();
  const pageTitle = h1Title || titleTag || postTitle;

  const { blocks: jsonLdBlocks } = parseJsonLdBlocks($);
  const metadata = extractHdrMetadata($, jsonLdBlocks);
  const tituloDoPost =
    (metadata.originalTitle && normalizarTexto(metadata.originalTitle).length > 0
      ? metadata.originalTitle
      : undefined) ??
    (metadata.originalTitleBruto && normalizarTexto(metadata.originalTitleBruto).length > 0
      ? metadata.originalTitleBruto
      : undefined) ??
    pageTitle ??
    postTitle;

  const secaoHeaders = detectarSecoes($, html);
  const { rawLinks, totalAnchors } = coletarRawLinks($, html, secaoHeaders, { postTitle, pageTitle, targetSeason, mediaType });

  const ctx: ContextoPost = { pageTitle, postTitle, tituloDoPost, metadata, targetSeason, mediaType };
  const results: HdrTorrent[] = [];

  for (const raw of rawLinks) {
    const torrent = await processarRawLink(raw, ctx);
    if (torrent) results.push(torrent);
  }

  logger.debug(`HDR extract | "${truncar(postTitle)}" | anchors=${totalAnchors} rawLinks=${rawLinks.length} magnets=${results.length}`);

  if (results.length > 0) {
    logger.debug(`HDR post | "${truncar(postTitle)}" | title=${metadata.origem.title} year=${metadata.origem.year} | ${results.length} magnets`);
  }

  return results;
}

interface ValidacaoImdb {
  imdbConfirmed: boolean;
  mismatch: boolean;
  imdbIdDoPost: string | null;
}

function validarImdb(
  html: string,
  imdbId: string | undefined,
  titulo: string,
  mediaType?: TipoConteudo
): ValidacaoImdb {
  if (!imdbId) return { imdbConfirmed: false, mismatch: false, imdbIdDoPost: null };

  const imdbIdDoPost = html.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
  if (!imdbIdDoPost) return { imdbConfirmed: false, mismatch: false, imdbIdDoPost: null };

  const isCollection = isCollectionTitle(titulo, mediaType);
  if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
    return { imdbConfirmed: false, mismatch: true, imdbIdDoPost };
  }

  return { imdbConfirmed: !isCollection, mismatch: false, imdbIdDoPost };
}

export async function processarPostHdr(
  item: SearchResultItem,
  imdbId: string | undefined,
  targetSeason: number | undefined,
  mediaType?: TipoConteudo
): Promise<{ torrents: HdrTorrent[]; imdbConfirmed: boolean }> {
  let html: string;
  try {
    html = await fetchComSessao(item.postUrl);
  } catch (err) {
    const classificacao = classificarErroFonte(err);
    if (classificacao === 'fonte') {
      breakerRegistrarFalha(FONTE);
    }
    logger.debug(`HDR post falhou | "${truncar(item.title)}" | ${classificacao} | ${(err as Error).message}`);
    return { torrents: [], imdbConfirmed: false };
  }

  const validacao = validarImdb(html, imdbId, item.title, mediaType);
  if (validacao.mismatch) {
    logger.debug(`HDR imdb mismatch | "${truncar(item.title)}" | post=${validacao.imdbIdDoPost} alvo=${imdbId}`);
    return { torrents: [], imdbConfirmed: false };
  }

  const torrents = await extractMagnetsFromPost(html, item.title, item.postUrl, targetSeason, mediaType);

  if (torrents.length === 0) {
    logger.debug(`HDR post vazio | "${truncar(item.title)}" | html=${html.length}b`);
  }

  return { torrents, imdbConfirmed: validacao.imdbConfirmed };
}

function filtrarPorSimilaridade(
  links: SearchResultItem[],
  frases: string[],
  mediaType?: TipoConteudo
): SearchResultItem[] {
  return links.filter(link => {
    const resultado = similarity.preFiltroContem(frases, link.title);
    const isCollection = isCollectionTitle(link.title, mediaType);

    if (!resultado.match && !isCollection) {
      // rejeitado: sem log por item, o resumo já aparece em "HDR: N links, M relevantes"
      return false;
    }
    return true;
  });
}

function dedupPorPostUrl(items: SearchResultItem[], seen: Set<string>): SearchResultItem[] {
  return items.filter(item => {
    if (seen.has(item.postUrl)) return false;
    seen.add(item.postUrl);
    return true;
  });
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
  const qTruncada = truncar(query);

  const queriesParaBusca = searchQueries && searchQueries.length > 0 ? [...searchQueries] : [query];
  const frasesValidas = queriesParaBusca.map(f => normalizarTexto(f)).filter(Boolean);

  const ncKey = negativeCacheKey(FONTE, query, {
    type,
    season: targetSeason ?? 0,
    mediaType: mediaType ?? null,
  });
  if (negativeCacheIsBlocked(ncKey)) {
    logger.debug(`HDR: negative cache HIT | "${qTruncada}"`);
    return [];
  }

  if (!breakerPodeUsar(FONTE)) {
    logger.debug(`HDR: circuit breaker OPEN, pulando searchHdr | "${qTruncada}"`);
    return [];
  }

  try {
    const allResults: HdrTorrent[] = [];
    const seenInfoHashes = new Set<string>();
    const seenPostUrls = new Set<string>();
    let queriesComResultado = 0;
    let houveErro = false;
    let houveSucesso = false;

    for (const q of queriesParaBusca) {
      const t0 = Date.now();
      const qLog = truncar(q);

      const searchResult = await searchHdrLinks(q, targetSeason, mediaType);

      if (searchResult.status === 'blocked') {
        logger.debug(`HDR: breaker abriu no meio do loop | "${qLog}"`);
        break;
      }

      if (searchResult.status === 'error') {
        houveErro = true;
        continue;
      }

      if (searchResult.status === 'empty') {
        houveSucesso = true;
        continue;
      }

      houveSucesso = true;
      const links = searchResult.items;

      if (links.length === 0) {
        logger.debug(`HDR: "${qLog}" | 0 links (${Date.now() - t0}ms)`);
        continue;
      }

      const filtrados = filtrarPorSimilaridade(links, frasesValidas, mediaType);
      if (filtrados.length === 0) {
        logger.debug(`HDR: "${qLog}" | ${links.length} links, 0 relevantes (${Date.now() - t0}ms)`);
        continue;
      }

      const novos = dedupPorPostUrl(filtrados, seenPostUrls);
      if (novos.length === 0) {
        logger.debug(`HDR: "${qLog}" | ${links.length} links, ${filtrados.length} relevantes, 0 novos (${Date.now() - t0}ms)`);
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

      logger.debug(`HDR: "${qLog}" | ${links.length} links, ${filtrados.length} relevantes, ${novos.length} novos, ${magnetsDaQuery} magnets (${Date.now() - t0}ms)`);
    }

    const duration = Date.now() - startTime;

    if (allResults.length === 0 && houveSucesso && !houveErro) {
      negativeCacheMark(ncKey);
      logger.info(`HDR: 0 resultados, cacheado negativo | "${qTruncada}" | ttlMs=${NEGATIVE_DEFAULT_TTL_MS}`);
    }

    logger.info(`HDR: ${allResults.length} magnets em ${duration}ms | queries=${queriesParaBusca.length} comResultado=${queriesComResultado}`);
    return allResults;
  } catch (err: any) {
    logger.error('HDR erro', { query: truncar(query, 50), error: err.message });
    breakerRegistrarFalha(FONTE);
    return [];
  }
}