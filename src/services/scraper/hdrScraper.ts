// hdrtorrent.com HTML Scraper — 2-passos: busca → página de post → magnet
// Magnets estão diretos no HTML (sem ofuscação), diferente do Starck
// Usa o mesmo DNS bypass do WordPress/TPB/Starck scraper

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';

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
  /** Título original extraído do HTML do post */
  originalTitle?: string;
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
//  PASSO 1: Busca → lista de URLs de posts
// ═══════════════════════════════════════════════════════════════════════

interface SearchResultItem {
  title: string;
  postUrl: string;
}

async function searchHdrLinks(query: string): Promise<SearchResultItem[]> {
  const searchUrl = `${HDR_BASE}/index.php?s=${encodeURIComponent(query)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: SearchResultItem[] = [];
    const seen = new Set<string>();

    // Links de posts — tipicamente dentro de h2/h3 com classe de post
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (!href || !text || text.length < 10) return;
      // Filtra links que parecem posts (não categorias, tags, etc)
      if (href.includes('/categoria/') || href.includes('/tag/') || href === '/' || href.includes('#')) return;
      if (seen.has(href)) return;
      seen.add(href);

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
//  PASSO 2: Extrai magnets de uma página de post
// ═══════════════════════════════════════════════════════════════════════

function extractLanguage(parentText: string): string {
  const t = parentText.toLowerCase();
  if (t.includes('dual') && /áudio|audio/.test(t)) return 'Dual Áudio';
  if (/dublado|dublada|dublagem/.test(t)) return 'Dublado';
  if (/legendado|legendada/.test(t)) return 'Legendado';
  if (/nacional/.test(t)) return 'Nacional';
  return '';
}

function extractMagnetsFromPost(html: string, postTitle: string): HdrTorrent[] {
  const $ = cheerio.load(html);
  const results: HdrTorrent[] = [];

  // Título da página (fallback do postTitle da busca)
  const pageTitle = $('title').text().replace(/Torrent.*$/i, '').trim() || postTitle;

  // ═══ Extrai Título Original direto do DOM ═══
  // Estrutura: <b>Título Original:</b> The Matrix<br />
  let originalTitle: string | undefined;
  const tituloEl = $('b, strong').toArray().find(el => /T[ií]tulo\s+Original/i.test($(el).text()));
  if (tituloEl) {
    const parentHtml = $(tituloEl).parent().html() || '';
    const elHtml = $(tituloEl).toString();
    const idx = parentHtml.indexOf(elHtml);
    if (idx !== -1) {
      const after = parentHtml.substring(idx + elHtml.length);
      const endIdx = after.indexOf('<');
      const raw = endIdx !== -1 ? after.substring(0, endIdx) : after;
      originalTitle = raw.replace(/^[:\s]+/, '').trim();
    }
  }

  // ═══ Encontra limites da seção DUAL ═══
  // Estrutura: <h3>::VERSÃO DUAL ÁUDIO::</h3> ...magnets... <h3>::VERSÃO LEGENDADA::</h3>
  let dualStartPos = -1;
  let legendadoPos = html.length;

  const h3Elements = $('h3').toArray();
  for (let i = 0; i < h3Elements.length; i++) {
    const text = $(h3Elements[i]).text().trim();
    if (dualStartPos === -1 && /::\s*(?:VERS[ÃA]O\s+)?(?:DUAL\s+[ÁA]UDIO|DUBLADO)\s*::/i.test(text)) {
      dualStartPos = html.indexOf($(h3Elements[i]).toString());
    } else if (dualStartPos !== -1 && /::\s*(?:VERS[ÃA]O\s+)?(?:LEGENDAD[OA]|LEGENDA)\s*::/i.test(text)) {
      legendadoPos = html.indexOf($(h3Elements[i]).toString());
      break;
    }
  }

  // Se não achou seção DUAL, verifica se o post TEM seção LEGENDADA
  // Post 100% legendado → retorna vazio
  if (dualStartPos === -1) {
    const hasLegendadoSection = h3Elements.some(el => 
      /::\s*(?:VERS[ÃA]O\s+)?(?:LEGENDAD[OA]|LEGENDA)\s*::/i.test($(el).text().trim())
    );
    if (hasLegendadoSection) {
      return []; // post é só legendado, não retorna nada
    }
  }

  // ═══ Coleta magnets na seção DUAL ═══
  $('a[href^="magnet:"]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const btihMatch = href.match(/btih:([a-fA-F0-9]{40})/i);
    if (!btihMatch) return;

    // Verifica se o magnet está na seção DUAL
    if (dualStartPos !== -1) {
      const magnetHtml = $(el).toString();
      const magnetPos = html.indexOf(magnetHtml);
      if (magnetPos < dualStartPos || magnetPos >= legendadoPos) return;
    }

    // Tenta extrair informações do texto próximo ao magnet
    const parentText = $(el).parent().text().trim();
    const qualityMatch = parentText.match(/(\d{3,4}p|4K|HD|FullHD)/i);
    const sizeMatch = parentText.match(/(\d+(?:\.\d+)?)\s*(GB|MB)/i);
    let language = extractLanguage(parentText);
    if (!language) language = extractLanguage(pageTitle);

    // Monta título descritivo
    const parts = [pageTitle];
    if (language) parts.push(`[${language}]`);
    if (qualityMatch) parts.push(qualityMatch[0]);
    const descriptiveTitle = parts.join(' ');

    results.push({
      title: descriptiveTitle,
      magnet: href,
      infoHash: btihMatch[1].toLowerCase(),
      seeders: 0,
      size: sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : '',
      language,
      originalTitle,
    });
  });

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════

export async function searchHdr(
  query: string,
  type: 'movie' | 'series' = 'movie'
): Promise<HdrTorrent[]> {
  const startTime = Date.now();

  try {
    // PASSO 1: Busca → URLs de posts
    const links = await searchHdrLinks(query);
    if (links.length === 0) return [];

    // PASSO 2: Para cada post, extrai magnets (paralelo, max 8)
    const batchSize = 8;
    const allResults: HdrTorrent[] = [];

    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await axios.get(item.postUrl, axiosConfig);
            return extractMagnetsFromPost(res.data, item.title);
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
