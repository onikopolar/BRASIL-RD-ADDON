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
  // Estrutura: <span>Nome Original:</span><span>The Matrix Resurrections</span>
  const nomeOrigSpan = $$('span').toArray().find(el => /Nome\s+Original/i.test($$(el).text()));
  const originalTitle = nomeOrigSpan
    ? $$(nomeOrigSpan).next('span').text().trim() || undefined
    : undefined;

  // ═══ Extrai magnets (base64) ═══
  const results: StarckTorrent[] = [];
  const seen = new Set<string>();

  const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
  let match;

  // Primeiro encontra as posições de todos os marcadores de idioma no texto
  const bodyText = ($$('body').text() || '').replace(/\s+/g, ' ');
  // Encontra marcadores de LEGENDADO no texto (para filtrar depois)
  const legendadoPositions: number[] = [];
  const legendadoRe = /\b(?:legendado|legendada|legenda)\b/gi;
  let lm;
  while ((lm = legendadoRe.exec(bodyText)) !== null) {
    legendadoPositions.push(lm.index);
  }
  // Encontra o PRIMEIRO marcador LEGENDADO (boundary)
  // Starck: "Dublado Download 1080p" → magnet → "Dual Áudio Download 2160p" → magnet
  // Se tiver "Legendado Download", a partir dali são legendados
  const firstLegendadoIdx = legendadoPositions.length > 0
    ? Math.min(...legendadoPositions)
    : bodyText.length;

  while ((match = b64Regex.exec(html)) !== null) {
    const b64 = match[0];
    if (seen.has(b64)) continue;
    seen.add(b64);

    try {
      const decoded = Buffer.from(b64, 'base64').toString('latin1')
        .replace(/&amp;/gi, '&');

      if (!decoded.startsWith('magnet:?')) continue;

      const btihMatch = decoded.match(/btih:([a-fA-F0-9]{40})/i);
      if (!btihMatch) continue;

      // Verifica se o magnet está DEPOIS do primeiro marcador LEGENDADO
      if (firstLegendadoIdx < bodyText.length) {
        // Pega o contexto próximo ao magnet no texto
        const dnMatch = decoded.match(/dn=([^&]+)/i);
        const dn = dnMatch ? decodeURIComponent(dnMatch[1]).replace(/\+/g, ' ') : '';
        const dnIdx = bodyText.indexOf(dn.substring(0, 20));
        if (dnIdx !== -1 && dnIdx >= firstLegendadoIdx) {
          continue; // magnet está na seção legendada → pular
        }
        // Também verifica se o magnet NAME contém "legendado"
        if (/legendado|legendada/i.test(dn)) {
          continue;
        }
      }

      results.push({
        magnet: decoded,
        infoHash: btihMatch[1].toLowerCase(),
        originalTitle,
      });
    } catch {
      // Base64 inválido, ignora
    }
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
