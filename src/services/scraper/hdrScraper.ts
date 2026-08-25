import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { extrairRangeEpisodios } from '../../titulos/TechnicalWords.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';

const logger = new Logger('HdrScraper');

const HDR_BASE = 'https://hdrtorrent.com';

// ── Tipos ─────────────────────────────────────────────────────────────

export interface HdrTorrent {
  title: string;
  magnet: string;
  infoHash: string;
  seeders: number;
  size: string;
  language: string;
  originalTitle?: string;
  year?: number;
  /** Nome canônico extraído do magnet via parse-torrent (campo "dn") */
  canonicalName?: string;
  /** Temporada detectada no contexto ou canonicalName */
  season?: number;
  /** Episódio detectado no contexto ou canonicalName */
  episode?: number;
}

// ── Config do axios ───────────────────────────────────────────────────
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

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

export function detectSeasonFromText(text: string): number | null {
  const range = extrairRangeEpisodios(text);
  if (range && range.season && range.season > 0) {
    return range.season;
  }
  const seasonMatch = text.match(/(\d+)\s*ª\s+TEMPORADA/i) || text.match(/Season\s+(\d+)/i);
  return seasonMatch ? parseInt(seasonMatch[1]) : null;
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
  const generic = [
    'hdr torrent',
    'sitemap',
    'início',
    'home',
    'contato',
    'sobre',
    'login',
    'registro',
    'feed',
    'rss',
    'categoria',
  ];
  if (generic.some(g => lowerText === g || lowerText.includes(g))) {
    return false;
  }

  const torrentWords = [
    'torrent', 'temporada', 'season', 'dual', 'dublado', 'legendado',
    '1080p', '720p', '4k', 'bluray', 'web-dl', 'hdtv', 'download',
  ];
  const containsTorrentWord = torrentWords.some(w => lowerText.includes(w));
  const slugMatch = href.match(/\/([a-z0-9-]{15,})\/?$/i);
  return containsTorrentWord || !!slugMatch;
}

export function isLegendasOnly(parentText: string, linkText: string): boolean {
  const lt = (linkText || '').trim().toLowerCase();
  const pt = (parentText || '').trim().toLowerCase();
  return lt === 'legendas' || /^legendas/.test(pt);
}

export function extractLanguage(parentText: string): string {
  const t = parentText.toLowerCase();
  if (t.includes('dual') && /áudio|audio/.test(t)) return 'Dual Áudio';
  if (/dublado|dublada|dublagem/.test(t)) return 'Dublado';
  if (/legendado|legendada/.test(t)) return 'Legendado';
  if (/nacional/.test(t)) return 'Nacional';
  return '';
}

/**
 * Extrai metadados do post a partir do parágrafo que contém os rótulos em negrito.
 * Retorna título original (sem sufixo Sxx), ano e idioma.
 */
function extractHdrMetadata($: any): { originalTitle?: string; year?: number; language?: string } {
  const result: { originalTitle?: string; year?: number; language?: string } = {};

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
      result.originalTitle = valor.replace(/\s*S\d{1,2}$/i, '').trim();
    } else if (/lan[çc]amento/i.test(rotulo)) {
      const yearMatch = valor.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) result.year = parseInt(yearMatch[0]);
    } else if (/idiomas?/i.test(rotulo)) {
      result.language = valor;
    }
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 1: Busca → lista de URLs de posts
// ═══════════════════════════════════════════════════════════════════════

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

      if (targetSeason !== undefined) {
        const season = detectSeasonFromText(text);
        if (season !== null && season !== targetSeason) return;
      }

      results.push({ title: text, postUrl: absoluteHref });
    });

    return results.slice(0, 40);
  } catch (err: any) {
    logger.warn('HDR busca falhou', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai magnets de uma página de post
// ═══════════════════════════════════════════════════════════════════════

export async function extractMagnetsFromPost(
  html: string,
  postTitle: string,
  postUrl?: string,
  targetSeason?: number
): Promise<HdrTorrent[]> {
  const $ = cheerio.load(html);
  const results: HdrTorrent[] = [];

  const pageTitle = $('title').text().replace(/Torrent.*$/i, '').trim() || postTitle;
  const metadata = extractHdrMetadata($);

  // Seções DUAL/LEGENDADO
  const reDual = /::\s*(?:VERS[ÃA]O\s+)?(?:DUAL\s+[ÁA]UDIO|DUBLADO)\s*::/i;
  const reLeg = /::\s*(?:VERS[ÃA]O\s+)?(?:LEGENDAD[OA]|LEGENDA)\s*::/i;

  const h3Elements = $('h3').toArray();
  const h3Texts: string[] = [];
  let temSecaoDual = false;
  let temSecaoLegendado = false;

  for (let i = 0; i < h3Elements.length; i++) {
    const text = $(h3Elements[i]).text().trim();
    h3Texts.push(text);
    if (reDual.test(text)) {
      temSecaoDual = true;
    } else if (reLeg.test(text)) {
      temSecaoLegendado = true;
      break;
    }
  }

  if (!temSecaoDual) {
    if (temSecaoLegendado) {
      logger.debug(`HDR LEGENDADO-only | ${postTitle.substring(0, 60)} | ${postUrl || '?'} | H3s: [${h3Texts.join(' | ')}]`);
      return [];
    }
    logger.debug(`HDR sem DUAL/LEG | ${postTitle.substring(0, 60)} | ${postUrl || '?'} | H3s: [${h3Texts.join(' | ')}]`);
  }

  // Coleta magnets brutos com contexto
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
    const btihMatch = href.match(/btih:([a-fA-F0-9]{40})/i);
    if (!btihMatch) return;

    const parentP = $(el).closest('p');
    const parentText = parentP.text().trim();
    const linkText = $(el).text().trim();
    if (isLegendasOnly(parentText, linkText)) return;

    if (temSecaoLegendado) {
      const $prevH3 = $(el).prevAll('h3').first();
      const prevText = $prevH3.text().trim();
      if (reLeg.test(prevText)) return;
    }

    const seasonNumber =
      detectSeasonFromText(parentText) ??
      detectSeasonFromText(postTitle) ??
      detectSeasonFromText(pageTitle);

    if (targetSeason !== undefined && seasonNumber !== null && seasonNumber !== targetSeason) return;

    const qualityMatch = parentText.match(/(\d{3,4}p|4K|HD|FullHD)/i)?.[0];
    const sizeMatch = parentText.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i)?.[0];

    rawMagnets.push({ href, parentText, linkText, qualityMatch, sizeMatch });
  });

  // Processa cada magnet com analisarMagnet
  for (const raw of rawMagnets) {
    try {
      const dados = await analisarMagnet(raw.href);
      if (!dados || !dados.infoHash) continue;

      const canonicalName = dados.nome ?? undefined;
      const infoHash = dados.infoHash.toLowerCase();
      const language = extractLanguage(raw.parentText) || metadata.language || extractLanguage(pageTitle);

      const seasonNumber =
        detectSeasonFromText(raw.parentText) ??
        detectSeasonFromText(postTitle) ??
        detectSeasonFromText(pageTitle);

      // Extrai range de episódios do parentText e canonicalName
      const range = extrairRangeEpisodios(raw.parentText);
      let episodeStart = range?.episodeStart ?? undefined;
      let episodeEnd = range?.episodeEnd ?? undefined;

      if (episodeStart === undefined && canonicalName) {
        const rangeCanonical = extrairRangeEpisodios(canonicalName);
        episodeStart = rangeCanonical?.episodeStart ?? undefined;
        episodeEnd = rangeCanonical?.episodeEnd ?? undefined;
      }

      // Se encontrou um range, o episódio inicial é suficiente para os campos atuais
      const episode = episodeStart;

      const magnetTitle = seasonNumber
        ? `${pageTitle} - ${seasonNumber}ª Temporada${episode ? ` Episódio ${episode}` : ''}${language ? ` [${language}]` : ''}${raw.qualityMatch ? ` ${raw.qualityMatch}` : ''}`
        : [pageTitle, episode ? `Episódio ${episode}` : '', language ? `[${language}]` : '', raw.qualityMatch].filter(Boolean).join(' ');

      results.push({
        title: magnetTitle,
        magnet: raw.href,
        infoHash,
        seeders: 0,
        size: raw.sizeMatch || '',
        language,
        originalTitle: metadata.originalTitle,
        year: metadata.year,
        canonicalName,
        season: seasonNumber ?? undefined,
        episode,
      });
    } catch {
      // magnet inválido, ignora
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════

export async function searchHdr(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[]
): Promise<HdrTorrent[]> {
  const startTime = Date.now();

  const queriesParaBusca = searchQueries && searchQueries.length > 0
    ? searchQueries
    : [query];

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

      const batchSize = 8;
      for (let i = 0; i < links.length; i += batchSize) {
        const batch = links.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (item) => {
            try {
              const res = await axios.get(item.postUrl, axiosConfig);
              return await extractMagnetsFromPost(res.data, item.title, item.postUrl, targetSeason);
            } catch {
              return [];
            }
          })
        );

        for (const results of batchResults) {
          for (const r of results) {
            if (!seenInfoHashes.has(r.infoHash)) {
              seenInfoHashes.add(r.infoHash);
              allResults.push(r);
            }
          }
        }
      }

      if (allResults.length > 0) {
        logger.debug(`HDR: query "${q}" retornou ${allResults.length} magnets. Encerrando busca.`);
        break;
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`HDR: ${allResults.length} magnets em ${duration}ms para "${query.substring(0,50)}"`);
    return allResults;
  } catch (err: any) {
    logger.error('HDR erro', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}