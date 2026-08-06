// hdrtorrent.com HTML Scraper — 2-passos: busca → página de post → magnet
// Magnets estão diretos no HTML (sem ofuscação), diferente do Starck
// Usa o mesmo DNS bypass do WordPress/TPB/Starck scraper
// canonicalName extraído via magnetHelper (analisarMagnet)

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
//  PASSO 1: Busca → lista de URLs de posts (com filtro de temporada)
// ═══════════════════════════════════════════════════════════════════════

interface SearchResultItem {
  title: string;
  postUrl: string;
}

/**
 * Tenta extrair o número da temporada a partir de um texto,
 * usando extrairRangeEpisodios (reconhece "1ª Temporada", "Season 1", "S01", etc.)
 */
function detectSeasonFromText(text: string): number | null {
  const range = extrairRangeEpisodios(text);
  if (range && range.season) {
    return range.season;
  }
  // Fallback: regex para "Nª Temporada" ou "Season N"
  const seasonMatch = text.match(/(\d+)\s*ª\s+TEMPORADA/i) || text.match(/Season\s+(\d+)/i);
  return seasonMatch ? parseInt(seasonMatch[1]) : null;
}

async function searchHdrLinks(query: string, targetSeason?: number): Promise<SearchResultItem[]> {
  const searchUrl = `${HDR_BASE}/index.php?s=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 10) return;
      if (href.includes('/categoria/') || href.includes('/tag/') || href === '/' || href.includes('#')) return;
      if (seen.has(href)) return;
      seen.add(href);

      // ═══ FILTRO POR TEMPORADA NA BUSCA ═══
      if (targetSeason !== undefined) {
        const season = detectSeasonFromText(text);
        // Se detectou uma temporada e ela não coincide com a alvo, pula este link
        if (season !== null && season !== targetSeason) {
          return;
        }
      }

      const fullUrl = href.startsWith('http') ? href : `${HDR_BASE}${href}`;
      results.push({ title: text, postUrl: fullUrl });
    });

    return results.slice(0, 40);
  } catch (err: any) {
    logger.warn('HDR busca falhou', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai magnets de uma página de post (agora async)
// ═══════════════════════════════════════════════════════════════════════

function extractLanguage(parentText: string): string {
  const t = parentText.toLowerCase();
  if (t.includes('dual') && /áudio|audio/.test(t)) return 'Dual Áudio';
  if (/dublado|dublada|dublagem/.test(t)) return 'Dublado';
  if (/legendado|legendada/.test(t)) return 'Legendado';
  if (/nacional/.test(t)) return 'Nacional';
  return '';
}

async function extractMagnetsFromPost(
  html: string,
  postTitle: string,
  postUrl?: string,
  targetSeason?: number
): Promise<HdrTorrent[]> {
  const $ = cheerio.load(html);
  const results: HdrTorrent[] = [];

  const pageTitle = $('title').text().replace(/Torrent.*$/i, '').trim() || postTitle;

  // Extrai Título Original do post
  let globalOriginalTitle: string | undefined;
  const tituloEl = $('b, strong').toArray().find(el => /T[ií]tulo\s+Original/i.test($(el).text()));
  if (tituloEl) {
    const parentHtml = $(tituloEl).parent().html() || '';
    const elHtml = $(tituloEl).toString();
    const idx = parentHtml.indexOf(elHtml);
    if (idx !== -1) {
      const after = parentHtml.substring(idx + elHtml.length);
      const endIdx = after.indexOf('<');
      const raw = endIdx !== -1 ? after.substring(0, endIdx) : after;
      globalOriginalTitle = raw.replace(/^[:\s]+/, '').trim();
    }
  }

  // Extrai Ano de Lançamento do post
  let globalYear: number | undefined;
  const lancamentoEl = $('b, strong').toArray().find(el => /^Lançamento$/i.test($(el).text().trim()));
  if (lancamentoEl) {
    const parentHtml = $(lancamentoEl).parent().html() || '';
    const elHtml = $(lancamentoEl).toString();
    const idx = parentHtml.indexOf(elHtml);
    if (idx !== -1) {
      const after = parentHtml.substring(idx + elHtml.length);
      const endIdx = after.indexOf('<');
      const raw = endIdx !== -1 ? after.substring(0, endIdx) : after;
      const yearStr = raw.replace(/^[:\s]+/, '').trim();
      const m = yearStr.match(/\b(19|20)\d{2}\b/);
      if (m) globalYear = parseInt(m[0]);
    }
  }

  // Encontra seções DUAL/LEGENDADO
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

  // Coleta magnets na seção DUAL (primeiro coleta bruta, depois analisa com magnetHelper)
  const rawMagnets: { href: string; parentText: string; qualityMatch?: string; sizeMatch?: string }[] = [];

  $('a[href^="magnet:"]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const btihMatch = href.match(/btih:([a-fA-F0-9]{40})/i);
    if (!btihMatch) return;

    if (temSecaoLegendado) {
      const $prevH3 = $(el).prevAll('h3').first();
      const prevText = $prevH3.text().trim();
      if (reLeg.test(prevText)) return;
    }

    const parentP = $(el).closest('p');
    const parentText = parentP.text().trim();

    let seasonNumber: number | null = null;
    if (parentText) {
      seasonNumber = detectSeasonFromText(parentText);
    }
    if (seasonNumber === null) {
      seasonNumber = detectSeasonFromText(postTitle) || detectSeasonFromText(pageTitle);
    }

    if (targetSeason !== undefined && seasonNumber !== null && seasonNumber !== targetSeason) {
      return;
    }

    const qualityMatch = parentText.match(/(\d{3,4}p|4K|HD|FullHD)/i)?.[0];
    const sizeMatch = parentText.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i)?.[0];

    rawMagnets.push({ href, parentText, qualityMatch, sizeMatch });
  });

  // Processa cada magnet com analisarMagnet
  for (const raw of rawMagnets) {
    try {
      const dados = await analisarMagnet(raw.href);
      if (!dados || !dados.infoHash) continue;

      const canonicalName = dados.nome ?? undefined;
      const infoHash = dados.infoHash.toLowerCase();
      const language = extractLanguage(raw.parentText) || extractLanguage(pageTitle);

      // Temporada (já filtrada, mas mantida para título)
      let seasonNumber: number | null = null;
      if (raw.parentText) seasonNumber = detectSeasonFromText(raw.parentText);
      if (seasonNumber === null) seasonNumber = detectSeasonFromText(postTitle) || detectSeasonFromText(pageTitle);

      let magnetOriginalTitle: string | undefined;
      let magnetTitle: string;

      if (seasonNumber) {
        magnetOriginalTitle = globalOriginalTitle
          ? globalOriginalTitle.replace(/Season\s+\d+/i, `Season ${seasonNumber}`)
          : undefined;
        magnetTitle = `${pageTitle} - ${seasonNumber}ª Temporada`;
        if (language) magnetTitle += ` [${language}]`;
        if (raw.qualityMatch) magnetTitle += ` ${raw.qualityMatch}`;
      } else {
        magnetOriginalTitle = globalOriginalTitle;
        const parts = [pageTitle];
        if (language) parts.push(`[${language}]`);
        if (raw.qualityMatch) parts.push(raw.qualityMatch);
        magnetTitle = parts.join(' ');
      }

      results.push({
        title: magnetTitle,
        magnet: raw.href,
        infoHash,
        seeders: 0,
        size: raw.sizeMatch || '',
        language,
        originalTitle: magnetOriginalTitle,
        year: globalYear,
        canonicalName,
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
  targetSeason?: number
): Promise<HdrTorrent[]> {
  const startTime = Date.now();

  try {
    const links = await searchHdrLinks(query, targetSeason);
    if (links.length === 0) {
      logger.info(`HDR: 0 magnets em ${Date.now() - startTime}ms para "${query.substring(0, 50)}" (0 links)`);
      return [];
    }

    logger.debug(`HDR busca: ${links.length} links para "${query.substring(0, 50)}"`, {
      links: links.slice(0, 5).map(l => l.title.substring(0, 60)),
      total: links.length,
    });

    const batchSize = 8;
    const allResults: HdrTorrent[] = [];

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
        allResults.push(...results);
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`HDR: ${allResults.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);

    return allResults;
  } catch (err: any) {
    logger.error('HDR erro', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}