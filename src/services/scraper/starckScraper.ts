import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairRangeEpisodios, normalizarTexto } from '../../titulos/TechnicalWords.js';

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
  /** Temporada alvo, se fornecida e detectada na busca */
  season?: number;
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
//  Helpers de slug e temporada
// ═══════════════════════════════════════════════════════════════════════

function cleanSlug(slug: string): string {
  const semData = slug.replace(/-\d{2}-\d{2}-\d{4}$/, '');
  return semData.replace(/-/g, ' ');
}

function extrairTituloBaseDoSlug(slug: string): string {
  const limpo = cleanSlug(slug);
  const normalizado = normalizarTexto(limpo);
  
  const semTemporada = normalizado
    .replace(/\b\d+\s*(?:a|ª|º|°)?\s*temporad[ao]?\b/gi, '')
    .replace(/\btemporad[ao]?\s*\d+\b/gi, '')
    .replace(/\bseason\s*\d+\b/gi, '');
  
  const semAno = semTemporada.replace(/\b(19|20)\d{2}\b/g, '');
  
  return semAno.trim();
}

function extrairTemporadaDoSlug(slug: string): number | undefined {
  const limpo = cleanSlug(slug);
  const match = limpo.match(/(\d+)\s*temporad[ao]?/i);
  return match ? parseInt(match[1], 10) : undefined;
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 1: Busca → lista de URLs de posts
// ═══════════════════════════════════════════════════════════════════════

interface SearchResultItem {
  title: string;
  postUrl: string;
  slugTitle: string;
  season?: number;
}

async function searchStarckLinks(
  searchQuery: string,
  allQueries: string[],
  targetSeason?: number
): Promise<SearchResultItem[]> {
  const searchUrl = `${STARCK_BASE}/?s=${encodeURIComponent(searchQuery)}`;

  try {
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const itemsMap = new Map<string, SearchResultItem>();

    $('a[href*="/catalog/"]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      
      const fullUrl = href.startsWith('http') ? href : `${STARCK_BASE}${href}`;
      
      if (itemsMap.has(fullUrl)) return;
      
      const slug = fullUrl.split('/').filter(Boolean).pop() || '';
      const slugTitle = extrairTituloBaseDoSlug(slug);
      const season = extrairTemporadaDoSlug(slug) || targetSeason;
      
      if (!slugTitle || slugTitle.length < 3) return;
      
      itemsMap.set(fullUrl, {
        title: $(el).text().trim() || slugTitle,
        postUrl: fullUrl,
        slugTitle,
        season,
      });
    });

    const results = [...itemsMap.values()];

    const frases = new Set<string>();
    for (const q of allQueries) {
      const phrase = normalizarTexto(
        q
          .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
          .replace(/\btemporada\s*\d+\b/gi, '')
          .replace(/\bseason\s*\d+\b/gi, '')
          .replace(/\b\d{4}\b/g, '')
      );
      if (phrase) frases.add(phrase);
    }

    logger.debug(`Starck: frases possíveis para filtro: [${[...frases].join(' | ')}]`);

    const filtered = results.filter(item => {
      const titleNormalizado = normalizarTexto(item.slugTitle);

      if (targetSeason !== undefined && item.season !== targetSeason) {
        return false;
      }

      const match = [...frases].some(frase => titleNormalizado.includes(frase));
      if (!match) {
        logger.debug(`Starck: link ignorado (frase não encontrada no slug): "${item.slugTitle}"`);
        return false;
      }

      return true;
    });

    logger.debug(`Starck: ${results.length} itens → ${filtered.length} após filtro para query "${searchQuery.substring(0, 40)}"`);
    return filtered.slice(0, 40);
  } catch (err: any) {
    logger.warn('Starck busca falhou', { query: searchQuery.substring(0, 50), error: err.message });
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Extrai metadados e magnets da página do post
// ═══════════════════════════════════════════════════════════════════════

interface PostMetadata {
  originalTitle?: string;
  year?: number;
  size?: string;
  language?: string;
  quality?: string;
}

function extractPostMetadata($: any): PostMetadata {
  const result: PostMetadata = {};

  // Percorre os parágrafos dentro de .post-description
  $('.post-description p').each((_i: any, p: any) => {
    const spans = $(p).find('span');
    if (spans.length >= 2) {
      const label = $(spans[0]).text().trim().toLowerCase();
      const value = $(spans[1]).text().trim();
      if (!label || !value) return;

      if (label.includes('nome original')) result.originalTitle = value;
      else if (label.includes('lançamento') || label.includes('ano')) {
        const yearMatch = value.match(/\b(19|20)\d{2}\b/);
        if (yearMatch) result.year = parseInt(yearMatch[0]);
      }
      else if (label.includes('tamanho')) result.size = value;
      else if (label.includes('idioma')) result.language = value;
      else if (label.includes('qualidade de video') || label.includes('qualidade')) result.quality = value;
    }
  });

  // Se não encontrou qualidade nos metadados, tenta a classe sl-quality
  if (!result.quality) {
    const q = $('.sl-quality').first().text().trim();
    if (q) result.quality = q;
  }

  // Determina language a partir do título se não veio dos metadados
  if (!result.language) {
    const h1 = $('h1').first().text().toLowerCase();
    if (h1.includes('dual áudio') || h1.includes('dual audio')) result.language = 'Dual Áudio';
    else if (h1.includes('legendado')) result.language = 'Legendado';
    else if (h1.includes('dublado')) result.language = 'Dublado';
    else if (h1.includes('nacional')) result.language = 'Nacional';
  }

  return result;
}

async function decodeBase64Magnets($: any): Promise<StarckTorrent[]> {
  const rawMagnets: { magnet: string; qualityHint: string }[] = [];

  // Coleta todos os links filmedl.com e decodifica o id
  $('a[href*="filmedl.com"]').each((_i: any, el: any) => {
    const href = $(el).attr('href') || '';
    const idMatch = href.match(/[?&]id=([^&]+)/i);
    if (!idMatch) return;
    try {
      const decoded = decodeURIComponent(idMatch[1]);
      const magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
      if (!magnet.startsWith('magnet:?')) return;
      const parentP = $(el).closest('p');
      const parentText = parentP.text().trim() || '';
      rawMagnets.push({ magnet, qualityHint: parentText });
    } catch {}
  });

  // Analisa cada magnet
  const analyzed = await Promise.all(
    rawMagnets.map(async (item) => {
      try {
        const dados = await analisarMagnet(item.magnet);
        if (!dados || !dados.infoHash) return null;
        return {
          magnet: item.magnet,
          infoHash: dados.infoHash.toLowerCase(),
          canonicalName: dados.nome || undefined,
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
      qualityHint: item.qualityHint,
    });
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════

export async function searchStarck(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[]
): Promise<StarckTorrent[]> {
  const startTime = Date.now();

  const queriesParaBusca = searchQueries && searchQueries.length > 0
    ? searchQueries
    : [query];

  const allQueries = [...new Set([query, ...(searchQueries || [])])];

  const allResults: StarckTorrent[] = [];
  const seenInfoHashes = new Set<string>();

  for (const q of queriesParaBusca) {
    logger.debug(`Starck: tentando busca com query "${q}"`);
    const links = await searchStarckLinks(q, allQueries, targetSeason);
    if (links.length === 0) {
      logger.debug(`Starck: query "${q}" não retornou links, tentando próxima...`);
      continue;
    }

    // Processa cada link, extrai metadados e magnets
    for (const link of links) {
      try {
        const res = await axios.get(link.postUrl, axiosConfig);
        const $ = cheerio.load(res.data);
        const metadata = extractPostMetadata($);
        const magnets = await decodeBase64Magnets($);

        for (const magnet of magnets) {
          if (seenInfoHashes.has(magnet.infoHash)) continue;
          seenInfoHashes.add(magnet.infoHash);

          // Define season, language, originalTitle, year, qualityHint
          if (targetSeason && magnet.season === undefined) {
            magnet.season = targetSeason;
          }
          magnet.language = metadata.language || magnet.language;
          magnet.originalTitle = metadata.originalTitle;
          magnet.year = metadata.year;
          if (metadata.quality && !magnet.qualityHint) {
            magnet.qualityHint = metadata.quality;
          }

          allResults.push(magnet);
        }
      } catch (err) {
        logger.warn(`Starck: falha ao processar post ${link.postUrl}`, { error: (err as Error).message });
      }
    }

    if (allResults.length > 0) {
      logger.debug(`Starck: query "${q}" retornou ${allResults.length} magnets. Encerrando busca.`);
      break;
    }
  }

  const duration = Date.now() - startTime;
  logger.info(`Starck: ${allResults.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);

  return allResults;
}