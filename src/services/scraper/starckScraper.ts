// starck-oficial.com HTML Scraper — 2-passos: busca → página de post → magnet base64
// Usa o mesmo DNS bypass do WordPress/TPB scraper
// Apenas entrega dados brutos do HTML (igual TPB/RARGB scraper)

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';

const logger = new Logger('StarckScraper');

const STARCK_BASE = 'https://www.starck-oficial.com';

// ── Tipos ─────────────────────────────────────────────────────────────

export interface StarckTorrent {
  magnet: string;
  infoHash: string;
  /** Título original extraído do HTML do post ("Nome Original: ...") */
  originalTitle?: string;
}

// ── Config do axios (igual TPB/WordPress) ─────────────────────────────
const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 1: Busca → lista de URLs de posts
// ═══════════════════════════════════════════════════════════════════════

interface SearchResultItem {
  title: string;
  postUrl: string;
}

async function searchStarckLinks(query: string): Promise<SearchResultItem[]> {
  const searchUrl = `${STARCK_BASE}/?s=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    $('a[href*="/catalog/"]').each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 5 || text === 'Detalhes') return;
      if (seen.has(href)) return;
      seen.add(href);

      results.push({
        title: text,
        postUrl: href.startsWith('http') ? href : `${STARCK_BASE}${href}`,
      });
    });

    return results.slice(0, 40);
  } catch (err: any) {
    logger.warn('Starck busca falhou', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai magnets base64 + Nome Original da página de post
// ═══════════════════════════════════════════════════════════════════════

function decodeBase64Magnets(html: string): { magnets: StarckTorrent[]; originalTitle?: string } {
  const $$ = cheerio.load(html);

  // ═══ Extrai Nome Original do DOM ═══
  const nomeOrigSpan = $$('span').toArray().find(el => /Nome\s+Original/i.test($$(el).text()));
  const originalTitle = nomeOrigSpan
    ? $$(nomeOrigSpan).next('span').text().trim() || undefined
    : undefined;

  // ═══ Extrai Lançamento do DOM ═══
  // Starck: <p><span>Lançamento:</span><span>2022</span></p>
  let year: number | undefined;
  const lancSpan = $$('span').toArray().find((el: any) => /^Lan[cç]amento:?$/i.test($$(el).text().trim()));
  if (lancSpan) {
    const yearText = $$(lancSpan).next('span').text().trim();
    const yearMatch = yearText.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) year = parseInt(yearMatch[0]);
  }

  const results: StarckTorrent[] = [];
  const seen = new Set<string>();

  // ═══ Fonte 1: href="filmedl.com/?id=BASE64" (magnets, base64 padrão) ═══
  $$('a[href*="filmedl.com"]').each((_i, el) => {
    const href = $$(el).attr('href') || '';
    const idMatch = href.match(/[?&]id=([^&]+)/i);
    if (!idMatch) return;
    try {
      const decoded = decodeURIComponent(idMatch[1]);
      const magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
      if (!magnet.startsWith('magnet:?')) return;
      const btihMatch = magnet.match(/btih:([a-zA-Z0-9]{32,40})/i);
      if (!btihMatch) return;
      const infoHash = btihMatch[1].toLowerCase();
      if (seen.has(infoHash)) return;
      seen.add(infoHash);
      results.push({ magnet, infoHash, originalTitle });
    } catch {}
  });

  // ═══ Fonte 2: base64 cru no HTML (fallback, pega o que a fonte 1 não cobriu) ═══
  const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
  let match;
  while ((match = b64Regex.exec(html)) !== null) {
    const b64 = match[0];
    try {
      const decoded = Buffer.from(b64, 'base64').toString('latin1').replace(/&amp;/gi, '&');
      if (!decoded.startsWith('magnet:?')) continue;
      const btihMatch2 = decoded.match(/btih:([a-zA-Z0-9]{32,40})/i);
      if (!btihMatch2) continue;
      const infoHash = btihMatch2[1].toLowerCase();
      if (seen.has(infoHash)) continue;
      seen.add(infoHash);
      results.push({ magnet: decoded, infoHash, originalTitle });
    } catch {}
  }

  return { magnets: results, originalTitle };
}

// ═══════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════

export async function searchStarck(
  query: string,
  type: 'movie' | 'series' = 'movie'
): Promise<StarckTorrent[]> {
  const startTime = Date.now();

  try {
    // PASSO 1: Busca → URLs de posts
    const links = await searchStarckLinks(query);
    if (links.length === 0) return [];

    // PASSO 2: Para cada post, extrai magnets (paralelo, max 8)
    const batchSize = 8;
    const allResults: StarckTorrent[] = [];

    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await axios.get(item.postUrl, axiosConfig);
            const result = decodeBase64Magnets(res.data);
            return result.magnets;
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
    logger.info(`Starck: ${allResults.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);

    return allResults;
  } catch (err: any) {
    logger.error('Starck erro', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}
