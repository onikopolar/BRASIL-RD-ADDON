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
  /** Ano de lançamento extraído do HTML do post */
  year?: number;
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

function extractMagnetsFromPost(html: string, postTitle: string, postUrl?: string): HdrTorrent[] {
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

  // ═══ Extrai Ano de Lançamento direto do DOM ═══
  // Estrutura: <b>Lançamento</b>: 2020<br />
  let year: number | undefined;
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
      if (m) year = parseInt(m[0]);
    }
  }

  // ═══ Encontra seções DUAL/LEGENDADO via flags ═══
  // Estrutura: <h3>::DUBLADO::</h3> <div>...magnets...</div> <h3>::VERSÃO LEGENDADA::</h3>
  const reDual = /::\s*(?:VERS[ÃA]O\s+)?(?:DUAL\s+[ÁA]UDIO|DUBLADO)\s*::/i;
  const reLeg = /::\s*(?:VERS[ÃA]O\s+)?(?:LEGENDAD[OA]|LEGENDA)\s*::/i;

  const h3Elements = $('h3').toArray();
  const h3Texts: string[] = [];
  let emSecaoDual = false;
  let temSecaoDual = false;
  let temSecaoLegendado = false;

  for (let i = 0; i < h3Elements.length; i++) {
    const text = $(h3Elements[i]).text().trim();
    h3Texts.push(text);
    if (reDual.test(text)) {
      emSecaoDual = true;
      temSecaoDual = true;
    } else if (reLeg.test(text)) {
      emSecaoDual = false;
      temSecaoLegendado = true;
      break; // tudo depois de LEGENDADO é ignorado
    }
  }

  // Post 100% legendado → retorna vazio
  if (!temSecaoDual) {
    if (temSecaoLegendado) {
      logger.debug(`HDR LEGENDADO-only | ${postTitle.substring(0, 60)} | ${postUrl || '?'} | H3s: [${h3Texts.join(' | ')}]`);
      return [];
    }
    logger.debug(`HDR sem DUAL/LEG | ${postTitle.substring(0, 60)} | ${postUrl || '?'} | H3s: [${h3Texts.join(' | ')}]`);
  }

  // ═══ Coleta magnets na seção DUAL ═══
  // Itera todos os magnets e verifica se estão em seção DUAL via h3 precedente
  $('a[href^="magnet:"]').each((_i, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    const btihMatch = href.match(/btih:([a-fA-F0-9]{40})/i);
    if (!btihMatch) return;

    // Se tem seção LEGENDADA, verifica se o magnet está antes do h3 LEGENDADO
    if (temSecaoLegendado) {
      const $prevH3 = $(el).prevAll('h3').first();
      const prevText = $prevH3.text().trim();
      if (reLeg.test(prevText)) return; // magnet em seção LEGENDADA → ignorar
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
      year,
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
    if (links.length === 0) {
      logger.info(`HDR: 0 magnets em ${Date.now() - startTime}ms para "${query.substring(0, 50)}" (0 links)`);
      return [];
    }

    logger.debug(`HDR busca: ${links.length} links para "${query.substring(0, 50)}"`, {
      links: links.slice(0, 5).map(l => l.title.substring(0, 60)),
      total: links.length,
    });

    // PASSO 2: Para cada post, extrai magnets (paralelo, max 8)
    const batchSize = 8;
    const allResults: HdrTorrent[] = [];

    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await axios.get(item.postUrl, axiosConfig);
            return extractMagnetsFromPost(res.data, item.title, item.postUrl);
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
