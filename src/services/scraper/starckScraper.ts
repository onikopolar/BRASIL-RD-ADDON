// starck-oficial.com HTML Scraper — 2-passos: busca → página de post → magnet base64
// Agora filtra por seção de idioma (DUAL ÁUDIO) e extrai language + canonicalName via magnetHelper
// Adiciona qualityHint para detecção precisa de qualidade
// Filtro de temporada corrigido para evitar resultados de temporadas erradas

import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairRangeEpisodios } from '../../titulos/TechnicalWords.js';

const logger = new Logger('StarckScraper');

const STARCK_BASE = 'https://www.starck-oficial.com';

// ── Tipos ─────────────────────────────────────────────────────────────

export interface StarckTorrent {
  magnet: string;
  infoHash: string;
  /** Título original extraído do HTML do post ("Nome Original: ...") */
  originalTitle?: string;
  /** Ano de lançamento extraído do HTML do post ("Lançamento: 2026") */
  year?: number;
  /** Idioma da seção onde o magnet foi encontrado (DUAL ÁUDIO, LEGENDADO, etc.) */
  language?: string;
  /** Nome canônico extraído do magnet via parse-torrent (campo "dn") */
  canonicalName?: string;
  /** Texto ao redor do link (ex.: "EPISÓDIO 02: 1080p") para detecção de qualidade */
  qualityHint?: string;
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

    // ─── Extrai temporada da query ───
    const queryRange = extrairRangeEpisodios(query);
    const querySeason = queryRange?.season;

    // ─── Extrai palavras significativas da série (sem temporada/ano) ───
    const cleanTitleForSeries = query
      .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
      .replace(/\btemporada\s*\d+\b/gi, '')
      .replace(/\bseason\s*\d+\b/gi, '')
      .replace(/\b\d{4}\b/g, '')
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    const seriesWords = cleanTitleForSeries.split(/\s+/).filter(w => w.length > 0);

    // ─── Filtro por temporada e nome da série ───
    const filtered = results.filter(r => {
      const lowerTitle = r.title.toLowerCase();

      // Se a query contém temporada, exige que o título contenha essa temporada
      if (querySeason) {
        const seasonPatterns = [
          new RegExp(`\\b${querySeason}\\s*[ªº°]?\\s*temporada\\b`, 'i'),
          new RegExp(`\\btemporada\\s*${querySeason}\\b`, 'i'),
          new RegExp(`\\bseason\\s*${querySeason}\\b`, 'i'),
        ];
        if (!seasonPatterns.some(p => p.test(lowerTitle))) return false;
      }

      // Exige ao menos uma palavra do nome da série
      if (seriesWords.length > 0) {
        const hasSeriesWord = seriesWords.some(word => lowerTitle.includes(word));
        if (!hasSeriesWord) return false;
      }

      return true;
    });

    logger.debug(`Starck: ${results.length} links → ${filtered.length} após filtro de query "${query.substring(0, 40)}"`);
    return filtered.slice(0, 40);
  } catch (err: any) {
    logger.warn('Starck busca falhou', { query: query.substring(0, 50), error: err.message });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai magnets base64 + metadados + filtro de idioma
// ═══════════════════════════════════════════════════════════════════════

async function decodeBase64Magnets(html: string): Promise<{ magnets: StarckTorrent[]; originalTitle?: string }> {
  const $ = cheerio.load(html);

  // ═══ Extrai Nome Original do DOM ═══
  const nomeOrigSpan = $('span').toArray().find(el => /Nome\s+Original/i.test($(el).text()));
  const originalTitle = nomeOrigSpan
    ? $(nomeOrigSpan).next('span').text().trim() || undefined
    : undefined;

  // ═══ Extrai Lançamento do DOM ═══
  let year: number | undefined;
  const lancSpan = $('span').toArray().find((el: any) => /^Lan[cç]amento:?$/i.test($(el).text().trim()));
  if (lancSpan) {
    const yearText = $(lancSpan).next('span').text().trim();
    const yearMatch = yearText.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) year = parseInt(yearMatch[0]);
  }

  // ═══ Coleta bruta de magnets das seções (urls base64 + qualityHint) ═══
  const rawMagnets: { magnet: string; language: string; qualityHint: string }[] = [];

  // Encontra os containers das seções DUAL/LEGENDADO
  const dualContainer = $('.epsodios').filter((_i, el) => {
    const h3Text = $(el).find('h3').text().trim().toLowerCase();
    return h3Text.includes('dual') && h3Text.includes('áudio');
  }).first();

  const legendadoContainer = $('.epsodios').filter((_i, el) => {
    const h3Text = $(el).find('h3').text().trim().toLowerCase();
    return h3Text.includes('legendado');
  }).first();

  // Extrai URLs da seção DUAL (com qualityHint)
  if (dualContainer.length > 0) {
    dualContainer.find('a[href*="filmedl.com"]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const idMatch = href.match(/[?&]id=([^&]+)/i);
      if (!idMatch) return;
      try {
        const decoded = decodeURIComponent(idMatch[1]);
        const magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
        if (!magnet.startsWith('magnet:?')) return;
        const parentP = $(el).closest('p');
        const parentText = parentP.text().trim() || '';
        rawMagnets.push({ magnet, language: 'Dual Áudio', qualityHint: parentText });
      } catch {}
    });

    // Também procura base64 cru dentro do HTML da seção DUAL (sem qualityHint definido, pois não há elemento pai)
    const dualHtml = dualContainer.html() || '';
    const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
    let match;
    while ((match = b64Regex.exec(dualHtml)) !== null) {
      const b64 = match[0];
      try {
        const decoded = Buffer.from(b64, 'base64').toString('latin1').replace(/&amp;/gi, '&');
        if (!decoded.startsWith('magnet:?')) continue;
        // Evita duplicar com os filmedl.com já extraídos
        if (rawMagnets.some(r => r.magnet === decoded)) continue;
        rawMagnets.push({ magnet: decoded, language: 'Dual Áudio', qualityHint: '' });
      } catch {}
    }
  } else if (legendadoContainer.length === 0) {
    // Fallback: se não há seções, pega todos os filmedl.com
    $('a[href*="filmedl.com"]').each((_i, el) => {
      const href = $(el).attr('href') || '';
      const idMatch = href.match(/[?&]id=([^&]+)/i);
      if (!idMatch) return;
      try {
        const decoded = decodeURIComponent(idMatch[1]);
        const magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
        if (!magnet.startsWith('magnet:?')) return;
        const parentP = $(el).closest('p');
        const parentText = parentP.text().trim() || '';
        rawMagnets.push({ magnet, language: '', qualityHint: parentText });
      } catch {}
    });

    // Fallback base64 cru global
    const b64Regex = /[A-Za-z0-9+/]{60,}={0,2}/g;
    let match;
    while ((match = b64Regex.exec(html)) !== null) {
      const b64 = match[0];
      try {
        const decoded = Buffer.from(b64, 'base64').toString('latin1').replace(/&amp;/gi, '&');
        if (!decoded.startsWith('magnet:?')) continue;
        if (rawMagnets.some(r => r.magnet === decoded)) continue;
        rawMagnets.push({ magnet: decoded, language: '', qualityHint: '' });
      } catch {}
    }
  }

  // ═══ Analisa cada magnet via magnetHelper (parse-torrent) ═══
  const analyzed = await Promise.all(
    rawMagnets.map(async (item) => {
      try {
        const dados = await analisarMagnet(item.magnet);
        if (!dados || !dados.infoHash) return null;
        return {
          magnet: item.magnet,
          infoHash: dados.infoHash.toLowerCase(),
          canonicalName: dados.nome || undefined,
          language: item.language || undefined,
          qualityHint: item.qualityHint,
        };
      } catch {
        return null;
      }
    })
  );

  // Remove nulos e duplicados por infoHash
  const seen = new Set<string>();
  const results: StarckTorrent[] = [];
  for (const item of analyzed) {
    if (!item || seen.has(item.infoHash)) continue;
    seen.add(item.infoHash);
    results.push({
      magnet: item.magnet,
      infoHash: item.infoHash,
      canonicalName: item.canonicalName,
      originalTitle,
      year,
      language: item.language,
      qualityHint: item.qualityHint,
    });
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
    const links = await searchStarckLinks(query);
    if (links.length === 0) return [];

    const batchSize = 8;
    const allResults: StarckTorrent[] = [];

    for (let i = 0; i < links.length; i += batchSize) {
      const batch = links.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (item) => {
          try {
            const res = await axios.get(item.postUrl, axiosConfig);
            const result = await decodeBase64Magnets(res.data);
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