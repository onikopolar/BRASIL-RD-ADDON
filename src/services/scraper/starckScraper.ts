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
  title: string;
  magnet: string;
  infoHash: string;
  size: string;
}

// ── Config do axios (igual TPB/WordPress) ─────────────────────────────
const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml',
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

    return results.slice(0, 20);
  } catch (err: any) {
    logger.warn('Starck busca falhou', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai magnets base64 da página de post
// ═══════════════════════════════════════════════════════════════════════

function decodeBase64Magnets(html: string): StarckTorrent[] {
  const results: StarckTorrent[] = [];
  const seen = new Set<string>();

  const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
  let match;

  while ((match = b64Regex.exec(html)) !== null) {
    const b64 = match[0];
    if (seen.has(b64)) continue;
    seen.add(b64);

    try {
      // latin1: decodifica qualquer byte sem perda (UTF-8 pode gerar � com bytes inválidos)
      const decoded = Buffer.from(b64, 'base64').toString('latin1')
        // Corrige double-encoding: &amp;tr= → &tr= (comum em HTML)
        .replace(/&amp;/gi, '&');

      if (!decoded.startsWith('magnet:?')) continue;

      // Extrai infoHash
      const btihMatch = decoded.match(/btih:([a-fA-F0-9]{40})/i);
      if (!btihMatch) continue;

      // Extrai dn — magnet URI parameter, para no próximo param conhecido (&tr=, &xt=, etc)
      const dnStart = decoded.indexOf('dn=');
      let title = '';
      if (dnStart >= 0) {
        let pos = dnStart + 3;
        const end = decoded.length;
        let raw = '';
        while (pos < end) {
          if (decoded[pos] === '&') {
            const after = decoded.substring(pos + 1);
            // Novo param? (&tr=, &xt=, &xl=, &dn=, &ws=)
            if (/^(?:tr|xt|xl|dn|ws)=/i.test(after)) break;
          }
          raw += decoded[pos];
          pos++;
        }
        title = raw
          .replace(/\+/g, ' ')
          .replace(/&[Aa]tilde;/g, 'ã')
          .replace(/&[Aa]acute;/g, 'á')
          .replace(/&[Cc]cedil;/g, 'ç')
          .replace(/&[Oo]acute;/g, 'ó')
          .replace(/&[Ee]acute;/g, 'é')
          .replace(/&[Ii]acute;/g, 'í')
          .replace(/&[Uu]acute;/g, 'ú')
          .replace(/&[Oo]tilde;/g, 'õ')
          .replace(/&[Aa]circ;/g, 'â')
          .replace(/&[Ee]circ;/g, 'ê')
          .replace(/&[Oo]circ;/g, 'ô')
          .replace(/&[Aa]grave;/g, 'à')
          .replace(/&[Aa]uml;/g, 'ä')
          .replace(/&[Ee]uml;/g, 'ë')
          .replace(/&[Ii]uml;/g, 'ï')
          .replace(/&[Oo]uml;/g, 'ö')
          .replace(/&[Uu]uml;/g, 'ü')
          .replace(/&nbsp;/gi, ' ')
          .replace(/&#\d{2,4};/g, '')
          .replace(/\./g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      // Extrai tamanho (xl)
      const xlMatch = decoded.match(/xl=(\d+)/);
      const sizeBytes = xlMatch ? parseInt(xlMatch[1]) : 0;
      const sizeGB = sizeBytes > 0 ? (sizeBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB' : '';

      results.push({
        title,
        magnet: decoded,
        infoHash: btihMatch[1].toLowerCase(),
        size: sizeGB,
      });
    } catch {
      // Base64 inválido, ignora
    }
  }

  return results;
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
            return decodeBase64Magnets(res.data);
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
