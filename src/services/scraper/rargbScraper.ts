// rargb.to HTML Scraper — 2-passos: busca → página de detalhe → magnet
// Usa o mesmo DNS bypass do TPB/WordPress scraper
// Apenas entrega dados brutos do HTML (igual TPB scraper)

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';

const logger = new Logger('RargbScraper');

const RARGB_BASE = 'https://rargb.to';

// ── Tipos ─────────────────────────────────────────────────────────────

export interface RargbTorrent {
  title: string;
  magnet: string;
  seeders: number;
  leechers: number;
  size: string;
  infoHash: string;
  category: string;
}

// ── Config do axios (igual TPB/WordPress) ─────────────────────────────
const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html',
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 1: Busca no rargb.to → lista de URLs de detalhe
// ═══════════════════════════════════════════════════════════════════════

interface SearchResultItem {
  title: string;
  detailUrl: string;
}

async function searchRargbLinks(query: string): Promise<SearchResultItem[]> {
  const searchUrl = `${RARGB_BASE}/search/?search=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);
    const results: SearchResultItem[] = [];

    $('a[href^="/torrent/"]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const title = cheerio.load(`<span>${$(el).text().trim()}</span>`)('span').text();
      if (!title || !href) return;

      // Evita duplicatas
      if (!results.some(r => r.detailUrl === `${RARGB_BASE}${href}`)) {
        results.push({
          title,
          detailUrl: `${RARGB_BASE}${href}`,
        });
      }
    });

    logger.debug(`RARGB busca: ${results.length} resultados`, { query: query.substring(0, 40) });
    return results;
  } catch (err: any) {
    logger.warn(`RARGB busca falhou: ${err.code || err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Scrape da página de detalhe → magnet + metadados
// ═══════════════════════════════════════════════════════════════════════

async function scrapeRargbDetail(detailUrl: string): Promise<RargbTorrent | null> {
  try {
    const res = await axios.get(detailUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    // Magnet link — direto no HTML: <a href="magnet:?xt=urn:btih:...">
    const magnetLink = $('a[href^="magnet:"]').first().attr('href');
    if (!magnetLink) return null;

    // Extrai infoHash via regex (igual TPB scraper)
    const infoHashMatch = magnetLink.match(/btih:([a-fA-F0-9]{40})/i);
    if (!infoHashMatch) return null;
    const infoHash = infoHashMatch[1].toLowerCase();

    // Título: nome canônico do magnet (dn) ou <title> da página
    const magnetText = cheerio.load(`<span>${$('a[href^="magnet:"]').first().text().trim()}</span>`)('span').text();
    const pageTitle = cheerio.load(`<span>${$('title').first().text().replace(' torrent download', '').trim()}</span>`)('span').text();

    // Seeders / Leechers — "Seeders : 4 , Leechers : 1"
    let seeders = 0;
    let leechers = 0;
    let size = '';
    let category = '';

    // Varre a tabela de detalhes (header2 + lista)
    $('tr').each((_i, row) => {
      const header = $(row).find('td.header2').first().text().trim();
      const value = $(row).find('td.lista').first().text().trim();

      if (/peers|seeders/i.test(header)) {
        const seMatch = value.match(/Seeders\s*:\s*(\d+)/i);
        const leMatch = value.match(/Leechers\s*:\s*(\d+)/i);
        if (seMatch) seeders = parseInt(seMatch[1]);
        if (leMatch) leechers = parseInt(leMatch[1]);
      }
      if (/size|tamanho/i.test(header)) {
        size = value;
      }
      if (/category|categoria/i.test(header)) {
        category = value;
      }
    });

    // Fallback: busca nos textos do body inteiro
    if (seeders === 0 && leechers === 0) {
      const bodyText = $('body').text();
      const seMatch = bodyText.match(/Seeders\s*:\s*(\d+)/i);
      const leMatch = bodyText.match(/Leechers\s*:\s*(\d+)/i);
      if (seMatch) seeders = parseInt(seMatch[1]);
      if (leMatch) leechers = parseInt(leMatch[1]);
    }
    if (!size) {
      const bodyText = $('body').text();
      const sizeMatch = bodyText.match(/Size\s*:\s*([^\n]+)/i);
      if (sizeMatch) size = sizeMatch[1].trim();
    }

    return {
      title: pageTitle || magnetText,
      magnet: magnetLink,
      seeders,
      leechers,
      size,
      infoHash,
      category,
    };
  } catch (err: any) {
    logger.warn(`RARGB detail falhou: ${err.code || err.message}`, { url: detailUrl.substring(0, 60) });
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  API PRINCIPAL: searchRargb(query, type) → RargbTorrent[]
// ═══════════════════════════════════════════════════════════════════════

export async function searchRargb(
  query: string,
  type: 'movie' | 'series' = 'movie'
): Promise<RargbTorrent[]> {
  // Passo 1: busca → lista de links de detalhe
  const searchResults = await searchRargbLinks(query);
  if (searchResults.length === 0) return [];

  // Passo 2: para cada link (até 5), scrape da página de detalhe em paralelo
  const maxPages = Math.min(searchResults.length, 5);
  const detailPromises = searchResults.slice(0, maxPages).map(r =>
    scrapeRargbDetail(r.detailUrl)
  );

  const results = (await Promise.all(detailPromises)).filter((r): r is RargbTorrent => r !== null);

  // Dedup por infoHash
  const seen = new Set<string>();
  const deduped = results.filter(r => {
    if (seen.has(r.infoHash)) return false;
    seen.add(r.infoHash);
    return true;
  });

  logger.debug(`RARGB: ${deduped.length} torrents válidos (de ${searchResults.length} encontrados)`);
  return deduped;
}
