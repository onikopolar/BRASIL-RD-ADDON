import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import {
  extrairRangeEpisodios,
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

const HDR_BASE = 'https://hdrtorrents.net';

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
  canonicalName?: string;
  imdbConfirmed?: boolean;
  season?: number;
  episode?: number;
}

const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
};

// Instância única do SimilarityCalculator — mesma régua do TitleFilter.
const similarity = SimilarityCalculator.getInstance();

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

export function isLikelyPostLink(href: string, text: string): boolean {
  if (!href || !text) return false;

  if (
    href === '/' ||
    href.includes('#') ||
    href.includes('/categoria/') ||
    href.includes('/tag/') ||
    href.includes('/etiqueta/') ||
    href.includes('/genero/') ||
    href.includes('/qualidade/') ||
    href.includes('/page/') ||
    href.includes('sitemap') ||
    href.includes('feed') ||
    href.includes('xmlrpc') ||
    href.includes('wp-json') ||
    href.includes('wp-content') ||
    href.includes('?s=') ||
    href.includes('/autor/') ||
    href.includes('/author/')
  ) {
    return false;
  }

  const lowerText = text.toLowerCase().trim();
  const genericExact = ['hdr torrent'];
  const genericWords = [
    'sitemap', 'início', 'home', 'contato', 'sobre',
    'login', 'registro', 'feed', 'rss', 'categoria',
  ];

  if (genericExact.some(g => lowerText === g)) return false;
  if (genericWords.some(g => new RegExp(`\\b${g}\\b`, 'i').test(lowerText))) return false;

  const torrentWords = [
    'torrent', 'temporada', 'season', 'dual', 'dublado', 'legendado',
    '1080p', '720p', '4k', 'bluray', 'web-dl', 'hdtv', 'download',
  ];
  const containsTorrentWord = torrentWords.some(w => lowerText.includes(w));
  const slugMatch = href.match(/\/([a-z0-9-]{15,})\/?$/i);
  return containsTorrentWord || !!slugMatch;
}

export function extractLanguage(parentText: string): string {
  const t = parentText.toLowerCase();
  if (t.includes('dual') && /áudio|audio/.test(t)) return 'Dual Áudio';
  if (/dublado|dublada|dublagem/.test(t)) return 'Dublado';
  if (/legendado|legendada/.test(t)) return 'Legendado';
  if (/nacional/.test(t)) return 'Nacional';
  return '';
}

// Leitura genérica de <dl class="item-specs"><div><dt>Rótulo</dt><dd>Valor</dd></div></dl> — layout novo.
function parseSpecsList($: any): Record<string, string> {
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
function limparTituloOriginal(titulo: string): string {
  return titulo
    .replace(/\s*[-–—]\s*(complete|completa?)\s*s\d{1,2}$/i, '')
    .replace(/\s*temporada\s+completa\s*(s\d{1,2})?$/i, '')
    .replace(/\s*complete\s+season\s*\d*$/i, '')
    .replace(/\s*s\d{1,2}$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHdrMetadata($: any): {
  originalTitle?: string;
  originalTitleBruto?: string;
  year?: number;
  language?: string;
  quality?: string;
  size?: string;
  format?: string;
  duration?: string;
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
  } = {};

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

      if (/t[íi]tulo\s+original/i.test(rotulo)) {
        result.originalTitleBruto = valor;
      } else if (/lan[çc]amento/i.test(rotulo)) {
        const yearMatch = valor.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) result.year = parseInt(yearMatch[0]);
      } else if (/idiomas?/i.test(rotulo)) {
        result.language = valor;
      }
    });

    const tituloBase = extrairTituloBasePosImdb($, paragrafo);
    const originalFinal = tituloBase || result.originalTitleBruto;
    if (originalFinal) result.originalTitle = limparTituloOriginal(originalFinal);

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

  if (specs['titulo original']) {
    result.originalTitleBruto = specs['titulo original'];
    result.originalTitle = limparTituloOriginal(specs['titulo original']);
  }
  if (specs['lancamento']) {
    const yearMatch = specs['lancamento'].match(/\b(19|20)\d{2}\b/);
    if (yearMatch) result.year = parseInt(yearMatch[0]);
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

export function extrairAno(texto: string): number | undefined {
  const m = texto.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0]) : undefined;
}

function extrairDnDoMagnet(magnet: string): string | undefined {
  const m = magnet.match(/[&?]dn=([^&]+)/i);
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1].replace(/\+/g, ' '));
  } catch {
    return m[1];
  }
}

// Encontra o container de texto do magnet — layout novo (.download-row) ou antigo (<p>).
function getContainerText($: any, el: any): string {
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
function classificarSecao(texto: string): 'DUAL' | 'LEGENDADO' | 'NONE' {
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

interface SearchResultItem {
  title: string;
  postUrl: string;
}

// Extrai o título "limpo" de um <a> de resultado.
function extrairTituloDoLink($: any, el: any): string {
  const metaName = $(el).find('meta[itemprop="name"]').attr('content');
  if (metaName && metaName.trim()) return metaName.trim();

  const cardTitle = $(el).find('.media-card-title').first();
  if (cardTitle.length) {
    const clone = cardTitle.clone();
    clone.find('.media-card-year').remove();
    const t = clone.text().replace(/\s+/g, ' ').trim();
    if (t) return t;
  }

  const titleAttr = $(el).attr('title');
  if (titleAttr && titleAttr.trim()) {
    return titleAttr.replace(/\s*Torrent\s*$/i, '').trim();
  }

  return $(el).text().replace(/\s+/g, ' ').trim();
}

export async function searchHdrLinks(query: string, targetSeason?: number, mediaType?: TipoConteudo): Promise<SearchResultItem[]> {
  const searchUrl = `${HDR_BASE}/index.php?busca=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_i: number, el: any) => {
      const href = $(el).attr('href');
      if (!href) return;

      const text = extrairTituloDoLink($, el);
      if (!text || text.length < 3) return;
      if (!isLikelyPostLink(href, text)) return;

      const absoluteHref = href.startsWith('http') ? href : `${HDR_BASE}${href}`;
      if (seen.has(absoluteHref)) return;
      seen.add(absoluteHref);

      if (!passaFiltroTemporada([text], targetSeason, mediaType)) return;

      results.push({ title: text, postUrl: absoluteHref });
    });

    return results.slice(0, 40);
  } catch (err: any) {
    logger.warn('HDR busca falhou', { query: query.substring(0, 50), error: err.message });
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

  const metadata = extractHdrMetadata($);

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

      let year = metadata.year;
      const originalTitle = metadata.originalTitle || metadata.originalTitleBruto;

      const anoDoMagnet = extrairAno(raw.containerText) || (canonicalName ? extrairAno(canonicalName) : undefined);
      if (anoDoMagnet) year = anoDoMagnet;

      const language = extractLanguage(raw.containerText) || metadata.language || extractLanguage(pageTitle);

      const range =
        detectSeasonRange(raw.containerText) ??
        detectSeasonRange(postTitle) ??
        detectSeasonRange(pageTitle);

      const rangeEp = extrairRangeEpisodios(raw.containerText);
      let episodeStart = rangeEp?.episodeStart ?? undefined;
      let episodeEnd = rangeEp?.episodeEnd ?? undefined;

      if (episodeStart === undefined && canonicalName) {
        const rangeCanonical = extrairRangeEpisodios(canonicalName);
        episodeStart = rangeCanonical?.episodeStart ?? undefined;
        episodeEnd = rangeCanonical?.episodeEnd ?? undefined;
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
        canonicalName,
        season: range?.seasonStart && range.seasonStart > 0 ? range.seasonStart : undefined,
        episode,
      });
    } catch (err) {
      logger.warn(`HDR: erro ao processar magnet`, { magnet: raw.href.substring(0, 60), error: (err as Error).message });
    }
  }

  if (results.length > 0) {
    logger.debug(`HDR post | "${postTitle.substring(0, 45)}" → ${results.length} magnets`);
  }

  return results;
}

// Busca um único post do HDR: faz o GET, valida IMDb (se aplicável) e extrai os magnets.
async function processarPostHdr(
  item: SearchResultItem,
  imdbId: string | undefined,
  targetSeason: number | undefined,
  mediaType?: TipoConteudo
): Promise<{ torrents: HdrTorrent[]; imdbConfirmed: boolean }> {
  try {
    const res = await axios.get(item.postUrl, axiosConfig);

    let imdbConfirmed = false;
    if (imdbId) {
      const imdbIdDoPost = res.data.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
      if (imdbIdDoPost) {
        const isCollection = isCollectionTitle(item.title, mediaType);
        if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
          return { torrents: [], imdbConfirmed: false };
        }
        if (!isCollection) {
          imdbConfirmed = true;
        }
      }
    }

    const torrents = await extractMagnetsFromPost(res.data, item.title, item.postUrl, targetSeason, mediaType);
    return { torrents, imdbConfirmed };
  } catch {
    return { torrents: [], imdbConfirmed: false };
  }
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

  const queriesBase = searchQueries && searchQueries.length > 0 ? [...searchQueries] : [query];

  const queriesParaBusca: string[] = [];
  for (const q of queriesBase) {
    if (!queriesParaBusca.includes(q)) queriesParaBusca.push(q);
  }

  for (const q of queriesBase) {
    if (type === 'series') {
      const tituloSemTemporada = q
        .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
        .replace(/\btemporada\s*\d+\b/gi, '')
        .replace(/\bseason\s*\d+\b/gi, '')
        .trim();
      if (tituloSemTemporada && !queriesParaBusca.includes(tituloSemTemporada)) {
        queriesParaBusca.push(tituloSemTemporada);
      }
    }
  }

  const frasesValidas = queriesParaBusca.map(f => normalizarTexto(f)).filter(Boolean);

  try {
    const allResults: HdrTorrent[] = [];
    const seenInfoHashes = new Set<string>();

    for (const q of queriesParaBusca) {
      const links = await searchHdrLinks(q, targetSeason, mediaType);

      if (links.length === 0) {
        logger.debug(`HDR: "${q}" sem links`);
        continue;
      }

      // Limpa ruído do site (tokens frequentes) antes do pré-filtro.
      const tokensRuido = calcularTokensRuido(links.map(l => l.title));

      const filtrados = links.filter(link => {
        const tituloLimpo = limparPorRaridade(link.title, tokensRuido);
        const resultado = similarity.compararComTitulos(frasesValidas, tituloLimpo);
        const isCollection = isCollectionTitle(link.title, mediaType);

        if (!resultado.match && !isCollection) return false;

        if (!resultado.match && isCollection) {
          logger.debug(`HDR: coleção aceita por pré-filtro: "${link.title.substring(0, 60)}" mediaType=${mediaType ?? '-'}`);
        }

        if (resultado.match) {
          logger.debug(
            `HDR: post aceito (${resultado.nivel} score=${resultado.score.toFixed(2)}): "${link.title.substring(0, 60)}"`
          );
        }

        return true;
      });

      if (filtrados.length === 0) {
        logger.debug(`HDR: "${q}" → ${links.length} links, 0 relevantes — encerrando`);
        break;
      }

      logger.debug(`HDR: "${q}" → ${links.length} links, ${filtrados.length} relevantes`);

      const respostas = await Promise.all(
        filtrados.map(item => processarPostHdr(item, imdbId, targetSeason, mediaType))
      );

      for (const { torrents, imdbConfirmed } of respostas) {
        for (const r of torrents) {
          if (imdbConfirmed) r.imdbConfirmed = true;
          if (!seenInfoHashes.has(r.infoHash)) {
            seenInfoHashes.add(r.infoHash);
            allResults.push(r);
          }
        }
      }

      break;
    }

    const duration = Date.now() - startTime;
    logger.info(`HDR: ${allResults.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);
    return allResults;
  } catch (err: any) {
    logger.error('HDR erro', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}