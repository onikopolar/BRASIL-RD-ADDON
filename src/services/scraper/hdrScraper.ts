import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import {
  extrairRangeEpisodios,
  normalizarTexto,
  isCollectionTitle,
  temporadaAlvoNoRange,
  EpisodeRange,
} from '../../titulos/TechnicalWords.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';

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

export function passaFiltroTemporada(textos: string[], targetSeason?: number): boolean {
  if (targetSeason === undefined) return true;

  for (const t of textos) {
    if (!t) continue;
    const range = detectSeasonRange(t);
    if (range) return temporadaAlvoNoRange(range, targetSeason);
  }

  return textos.some(t => isCollectionTitle(t));
}

export function isLikelyPostLink(href: string, text: string): boolean {
  if (!href || !text) return false;

  if (
    href === '/' ||
    href.includes('#') ||
    href.includes('/categoria/') ||
    href.includes('/tag/') ||
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

export function extractHdrMetadata($: any): { originalTitle?: string; originalTitleBruto?: string; year?: number; language?: string } {
  const result: { originalTitle?: string; originalTitleBruto?: string; year?: number; language?: string } = {};

  const paragrafo = $('p').filter((_i: number, el: any) => /T[íi]tulo\s+Original/i.test($(el).text())).first();
  if (!paragrafo.length) return result;

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
      result.originalTitleBruto = valor.replace(/\s*S\d{1,2}$/i, '').trim();
    } else if (/lan[çc]amento/i.test(rotulo)) {
      const yearMatch = valor.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) result.year = parseInt(yearMatch[0]);
    } else if (/idiomas?/i.test(rotulo)) {
      result.language = valor;
    }
  });

  const tituloBase = extrairTituloBasePosImdb($, paragrafo);
  result.originalTitle = tituloBase || result.originalTitleBruto;

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

interface SearchResultItem {
  title: string;
  postUrl: string;
}

export async function searchHdrLinks(query: string, targetSeason?: number): Promise<SearchResultItem[]> {
  const searchUrl = `${HDR_BASE}/index.php?s=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_i: number, el: any) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 10) return;
      if (!isLikelyPostLink(href, text)) return;

      const absoluteHref = href.startsWith('http') ? href : `${HDR_BASE}${href}`;
      if (seen.has(absoluteHref)) return;
      seen.add(absoluteHref);

      if (!passaFiltroTemporada([text], targetSeason)) return;

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
  targetSeason?: number
): Promise<HdrTorrent[]> {
  const $ = cheerio.load(html);
  const results: HdrTorrent[] = [];

  const h1Title = $('h1').first().text().replace(/Torrent.*$/i, '').trim();
  const titleTag = $('title').text().replace(/Torrent.*$/i, '').trim();
  const pageTitle = h1Title || titleTag || postTitle;

  const metadata = extractHdrMetadata($);

  // FIX H6: detecta seções ::VERSÃO DUAL ÁUDIO:: / ::VERSÃO LEGENDADA:: por posição no HTML.
  // Sem isso o filtro de idioma dependia só do texto do parentText — funcionava por sorte.
  const sectionHeaders: Array<{ pos: number; type: 'DUAL' | 'LEGENDADO' }> = [];
  $('h1, h2, h3, h4, h5, h6, strong, b').each((_i: number, el: any) => {
    const texto = $(el).text().trim();
    if (!texto) return;
    if (!/vers[ãa]o\s+(dual|legendad)/i.test(texto)) return;
    const pos = html.indexOf($(el).toString());
    if (pos === -1) return;
    sectionHeaders.push({ pos, type: /legendad/i.test(texto) ? 'LEGENDADO' : 'DUAL' });
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

  const rawMagnets: {
    href: string;
    parentText: string;
    linkText: string;
    qualityMatch?: string;
    sizeMatch?: string;
  }[] = [];

  $('a[href^="magnet:"]').each((_i: number, el: any) => {
    const href = $(el).attr('href');
    if (!href) return;

    const parentP = $(el).closest('p');
    const parentText = parentP.text().trim();
    const linkText = $(el).text().trim();

    // FIX H6: se o post declara seções, elas têm prioridade. Magnet na seção LEGENDADO
    // é descartado — sem depender do texto do parentText.
    const posMagnet = html.indexOf($(el).toString());
    const secaoPosicional = posMagnet !== -1 ? detectarSecaoPorPosicao(posMagnet) : 'NONE';
    if (secaoPosicional === 'LEGENDADO') return;

    // Fallback por texto — mantém o comportamento atual pra posts sem seção declarada.
    const isLegendado = /legendado|legendada|legenda/i.test(parentText);
    const isDualOuDublado = /dual\s*áudio|dual\s*audio|dublado|dublada|dublagem|nacional/i.test(parentText);
    if (isLegendado && !isDualOuDublado) return;

    if (!passaFiltroTemporada([parentText, postTitle, pageTitle], targetSeason)) return;

    const qualityMatch = parentText.match(/(\d{3,4}p|4K|HD|FullHD)/i)?.[0];
    let sizeMatch = parentText.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];

    if (!sizeMatch) {
      const dn = extrairDnDoMagnet(href);
      if (dn) {
        sizeMatch = dn.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];
      }
    }

    rawMagnets.push({ href, parentText, linkText, qualityMatch, sizeMatch });
  });

  logger.debug(`HDR extractMagnetsFromPost | post="${postTitle.substring(0, 50)}" | totalMagnetsBrutos=${rawMagnets.length}`);

  for (const raw of rawMagnets) {
    try {
      const hashMatch = raw.href.match(/btih:([a-zA-Z0-9]+)/i);
      let infoHash = hashMatch ? hashMatch[1].toLowerCase() : '';

      if (!infoHash) {
        logger.warn(`HDR extractMagnetsFromPost | magnet sem infoHash | magnet=${raw.href.substring(0, 60)}`);
        continue;
      }

      let canonicalName: string | undefined;
      let hashNormalizado = false;

      try {
        const dados = await analisarMagnet(raw.href);
        canonicalName = dados?.nome ?? undefined;
        if (dados?.infoHash && dados.infoHash.toLowerCase() !== infoHash) {
          infoHash = dados.infoHash.toLowerCase();
          hashNormalizado = true;
        }
      } catch {
        canonicalName = undefined;
      }

      if (hashNormalizado) {
        logger.debug(`HDR | hash base32 → hex | magnet=${raw.href.substring(0, 40)}... | hash=${infoHash.substring(0, 12)}`);
      } else {
        logger.debug(`HDR | hash mantido do regex | magnet=${raw.href.substring(0, 40)}... | hash=${infoHash.substring(0, 12)} | len=${infoHash.length}`);
      }

      let year = metadata.year;
      const originalTitle = metadata.originalTitle || metadata.originalTitleBruto;

      const anoDoMagnet = extrairAno(raw.parentText) || (canonicalName ? extrairAno(canonicalName) : undefined);
      if (anoDoMagnet) {
        year = anoDoMagnet;
      }

      const language = extractLanguage(raw.parentText) || metadata.language || extractLanguage(pageTitle);

      const range =
        detectSeasonRange(raw.parentText) ??
        detectSeasonRange(postTitle) ??
        detectSeasonRange(pageTitle);

      const rangeEp = extrairRangeEpisodios(raw.parentText);
      let episodeStart = rangeEp?.episodeStart ?? undefined;
      let episodeEnd = rangeEp?.episodeEnd ?? undefined;

      if (episodeStart === undefined && canonicalName) {
        const rangeCanonical = extrairRangeEpisodios(canonicalName);
        episodeStart = rangeCanonical?.episodeStart ?? undefined;
        episodeEnd = rangeCanonical?.episodeEnd ?? undefined;
      }

      const episode = episodeStart;
      const qualityMatch = raw.qualityMatch;
      const sizeMatch = raw.sizeMatch;

      const seasonLabel = range && range.seasonStart > 0
        ? (range.seasonStart === range.seasonEnd
            ? `${range.seasonStart}ª Temporada`
            : `${range.seasonStart}ª à ${range.seasonEnd}ª Temporada`)
        : '';

      const magnetTitle = seasonLabel
        ? `${pageTitle} - ${seasonLabel}${episode ? ` Episódio ${episode}` : ''}${language ? ` [${language}]` : ''}${qualityMatch ? ` ${qualityMatch}` : ''}`
        : [pageTitle, episode ? `Episódio ${episode}` : '', language ? `[${language}]` : '', qualityMatch].filter(Boolean).join(' ');

      // FIX H6: passa o parentText limpo como htmlTitle — o StreamFormatter anexa como
      // sufixo entre parênteses. Diferencia magnets com o mesmo dn= (ex: "SEM COMPACTAÇÃO").
      const htmlTitleLimpo = raw.parentText
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

      logger.info(`HDR extractMagnetsFromPost | magnet OK | infoHash=${infoHash.substring(0, 12)} | language=${language} | year=${year} | quality=${qualityMatch || 'N/A'} | size=${sizeMatch || 'N/A'}`);
    } catch (err) {
      logger.warn(`HDR extractMagnetsFromPost | erro ao processar magnet | magnet=${raw.href.substring(0, 60)} | error=${(err as Error).message}`);
    }
  }

  logger.info(`HDR extractMagnetsFromPost | post="${postTitle.substring(0, 50)}" | totalExtraidos=${results.length}`);
  return results;
}

export async function searchHdr(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[],
  targetYear?: number,
  imdbId?: string
): Promise<HdrTorrent[]> {
  const startTime = Date.now();

  const queriesBase = searchQueries && searchQueries.length > 0 ? [...searchQueries] : [query];

  const queriesParaBusca: string[] = [];
  for (const q of queriesBase) {
    if (!queriesParaBusca.includes(q)) queriesParaBusca.push(q);
    const q4k = `${q} 4k`;
    if (!queriesParaBusca.includes(q4k)) queriesParaBusca.push(q4k);
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

  const baseTitles = frasesValidas
    .map(frase => normalizarTexto(frase.replace(/\b\d+\b/g, ' ').trim()))
    .filter(Boolean);

  try {
    const allResults: HdrTorrent[] = [];
    const seenInfoHashes = new Set<string>();

    for (const q of queriesParaBusca) {
      logger.debug(`HDR: tentando busca com query "${q}"`);
      const links = await searchHdrLinks(q, targetSeason);

      if (links.length === 0) {
        logger.debug(`HDR: query "${q}" não retornou links, tentando próxima...`);
        continue;
      }

      const filtrados = links.filter(link => {
        const tituloNorm = normalizarTexto(link.title);
        const contemFrase = frasesValidas.some(frase => tituloNorm.includes(frase));
        const isCollection = isCollectionTitle(tituloNorm) &&
          baseTitles.some(base => tituloNorm.includes(base));
        return contemFrase || isCollection;
      });

      logger.debug(`HDR: ${links.length} links → ${filtrados.length} após filtro local para query "${q}"`);

      if (filtrados.length === 0) continue;

      for (const item of filtrados) {
        try {
          const res = await axios.get(item.postUrl, axiosConfig);
          let imdbConfirmed = false;
          if (imdbId) {
            const imdbIdDoPost = res.data.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
            if (imdbIdDoPost) {
              const isCollection = isCollectionTitle(item.title);
              if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
                continue;
              }
              if (!isCollection) {
                imdbConfirmed = true;
              }
            }
          }
          const magnets = await extractMagnetsFromPost(res.data, item.title, item.postUrl, targetSeason);
          for (const r of magnets) {
            if (imdbConfirmed) r.imdbConfirmed = true;
            if (!seenInfoHashes.has(r.infoHash)) {
              seenInfoHashes.add(r.infoHash);
              allResults.push(r);
            }
          }
        } catch {
          // ignora erro de post individual
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