import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairRangeEpisodios, normalizarTexto } from '../../titulos/TechnicalWords.js';

const logger = new Logger('StarckScraper');

const STARCK_BASE = 'https://www.starck-oficial.com';

export interface StarckTorrent {
  magnet: string;
  infoHash: string;
  originalTitle?: string;
  year?: number;
  language?: string;
  canonicalName?: string;
  qualityHint?: string;
  quality?: string;
  size?: string;
  season?: number;
  episode?: number;
}

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

function cleanSlug(slug: string): string {
  let decodificado = slug;
  try {
    decodificado = decodeURIComponent(slug);
  } catch {}

  let semData = decodificado.replace(/-\d{2}-\d{2}-\d{4}$/, '');

  semData = semData.replace(
    /([0-9a-f]{2})-([0-9a-f]{2})(?:-([0-9a-f]{2}))?/gi,
    (match, h1, h2, h3) => {
      const bytes = [parseInt(h1, 16), parseInt(h2, 16)];
      if (h3) bytes.push(parseInt(h3, 16));

      const isValid2 = bytes.length === 2 && bytes[0] >= 0xc0 && bytes[0] <= 0xdf && bytes[1] >= 0x80 && bytes[1] <= 0xbf;
      const isValid3 = bytes.length === 3 && bytes[0] >= 0xe0 && bytes[0] <= 0xef && bytes[1] >= 0x80 && bytes[1] <= 0xbf && bytes[2] >= 0x80 && bytes[2] <= 0xbf;

      if (isValid2 || isValid3) {
        try {
          return Buffer.from(bytes).toString('utf8');
        } catch {
          return match;
        }
      }
      return match;
    }
  );

  return semData.replace(/-/g, ' ');
}

function extrairTituloBaseDoSlug(slug: string): string {
  const limpo = cleanSlug(slug);
  const range = extrairRangeEpisodios(limpo);
  const normalizado = normalizarTexto(limpo);

  return normalizado
    .replace(/\b\d+\s*(?:a|ª|º|°)?\s*temporad[ao]?\b/gi, '')
    .replace(/\btemporad[ao]?\s*\d+\b/gi, '')
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\b(19|20)\d{2}\b/g, '')
    .trim();
}

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
      const range = extrairRangeEpisodios(cleanSlug(slug));
      const season = range?.season;

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

interface PostMetadata {
  originalTitle?: string;
  year?: number;
  size?: string;
  language?: string;
  quality?: string;
}

function extractPostMetadata($: any): PostMetadata {
  const result: PostMetadata = {};

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

  if (!result.quality) {
    const q = $('.sl-quality').first().text().trim();
    if (q) result.quality = q;
  }

  if (!result.language) {
    const h1 = $('h1').first().text().toLowerCase();
    if (h1.includes('dual áudio') || h1.includes('dual audio')) result.language = 'Dual Áudio';
    else if (h1.includes('legendado')) result.language = 'Legendado';
    else if (h1.includes('dublado')) result.language = 'Dublado';
    else if (h1.includes('nacional')) result.language = 'Nacional';
  }

  return result;
}

function linkEhDaSecaoDual($: any, el: any): boolean {
  const html = $('body').html() || '';
  const legendadoPos = html.search(/VERS[ÃA]O\s+LEGENDAD[OA]/i);
  if (legendadoPos === -1) return true;

  const linkHtml = $(el).toString();
  const linkPos = html.indexOf(linkHtml);
  if (linkPos === -1) return false;

  return linkPos < legendadoPos;
}

/**
 * Extrai metadados de um botão .buttons-content
 */
function extrairMetadadosDoBotao($: any, linkEl: any): {
  idioma?: string;
  formato?: string;
  qualidade?: string;
  tamanho?: string;
} {
  const container = $(linkEl).closest('.buttons-content');
  if (!container.length) return {};

  const textoSpan = container.find('.text').first().text().trim();
  if (!textoSpan) return {};

  // Divide as linhas
  const linhas = textoSpan.split('\n').map((s: string) => s.trim()).filter(Boolean);
  if (linhas.length < 3) return {};

  // Primeira linha: "Dual ÁudioMKV" ou "Dual ÁudioHDR"
  const primeiraLinha = linhas[0];
  const idiomaMatch = primeiraLinha.match(/(Dual Áudio|Dublado|Legendado|Nacional)/i);
  const idioma = idiomaMatch ? idiomaMatch[1] : undefined;

  // Formato: geralmente após o idioma, sem espaço
  let formato: string | undefined;
  if (idiomaMatch && idiomaMatch[0]) {
    const restante = primeiraLinha.substring(idiomaMatch[0].length);
    if (restante) formato = restante.trim();
  }

  // Terceira linha: "1080p (3.12 GB)" ou "2160p (28.05 GB)"
  const terceiraLinha = linhas[2];
  const qualidadeMatch = terceiraLinha.match(/(\d{3,4}p|4K|HD)/i);
  const tamanhoMatch = terceiraLinha.match(/\(([\d.]+)\s*GB\)/i);

  return {
    idioma,
    formato,
    qualidade: qualidadeMatch ? qualidadeMatch[1] : undefined,
    tamanho: tamanhoMatch ? `${tamanhoMatch[1]} GB` : undefined,
  };
}

async function decodeBase64Magnets($: any, postTitle: string, metadata: PostMetadata): Promise<StarckTorrent[]> {
  const rawMagnets: {
    magnet: string;
    qualityHint: string;
    quality?: string;
    size?: string;
    language?: string;
    format?: string;
    episode?: number;
  }[] = [];

  $('a[href*="filmedl.com"]').each((_i: any, el: any) => {
    const href = $(el).attr('href') || '';
    const idMatch = href.match(/[?&]id=([^&]+)/i);
    if (!idMatch) return;

    if (!linkEhDaSecaoDual($, el)) return;

    try {
      const decoded = decodeURIComponent(idMatch[1]);
      const magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
      if (!magnet.startsWith('magnet:?')) return;

      const botaoMetadados = extrairMetadadosDoBotao($, el);

      const parentP = $(el).closest('p');
      const parentText = parentP.text().trim() || '';

      const range = extrairRangeEpisodios(parentText);
      const episode = range?.episodeStart && range.episodeStart > 0 ? range.episodeStart : undefined;

      rawMagnets.push({
        magnet,
        qualityHint: parentText,
        quality: botaoMetadados.qualidade,
        size: botaoMetadados.tamanho,
        language: botaoMetadados.idioma,
        format: botaoMetadados.formato,
        episode,
      });
    } catch (err) {
      logger.warn('Starck: erro ao decodificar magnet', { error: (err as Error).message });
    }
  });

  logger.debug(`Starck decode | post="${postTitle.substring(0, 50)}" | totalLinks=${rawMagnets.length}`);

  const analyzed = await Promise.all(
    rawMagnets.map(async (item) => {
      try {
        const dados = await analisarMagnet(item.magnet);
        if (!dados || !dados.infoHash) {
          logger.warn('Starck decode | magnet sem infoHash', { magnet: item.magnet.substring(0, 60) });
          return null;
        }
        return {
          magnet: item.magnet,
          infoHash: dados.infoHash.toLowerCase(),
          canonicalName: dados.nome || undefined,
          qualityHint: item.qualityHint,
          quality: item.quality,
          size: item.size,
          language: item.language,
          format: item.format,
          episode: item.episode,
        };
      } catch (err) {
        logger.warn('Starck decode | falha ao analisar magnet', { error: (err as Error).message });
        return null;
      }
    })
  );

  const seen = new Set<string>();
  const results: StarckTorrent[] = [];
  for (const item of analyzed) {
    if (!item || seen.has(item.infoHash)) continue;
    seen.add(item.infoHash);

    let episode = item.episode;
    if (episode === undefined && item.canonicalName) {
      const range = extrairRangeEpisodios(item.canonicalName);
      episode = range?.episodeStart && range.episodeStart > 0 ? range.episodeStart : undefined;
    }

    // Se o magnet não tem nome (dn), monta a partir de metadados da página
    if (!item.canonicalName) {
      const tituloBase = metadata.originalTitle || postTitle;
      const partes = [
        tituloBase,
        item.language || metadata.language,
        item.quality || item.qualityHint,
        item.size,
      ].filter(Boolean);
      item.canonicalName = partes.join(' ');
    }

    results.push({
      magnet: item.magnet,
      infoHash: item.infoHash,
      canonicalName: item.canonicalName,
      qualityHint: item.qualityHint,
      quality: item.quality,
      size: item.size,
      language: item.language || 'Dual Áudio',
      episode,
    });
  }

  logger.debug(`Starck decode | post="${postTitle.substring(0, 50)}" | totalExtraidos=${results.length}`);
  return results;
}

export async function searchStarck(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[]
): Promise<StarckTorrent[]> {
  const startTime = Date.now();

  const queriesParaBusca = searchQueries && searchQueries.length > 0 ? searchQueries : [query];
  const allQueries = [...new Set([query, ...(searchQueries || [])])];

  const allResults: StarckTorrent[] = [];
  const seenInfoHashes = new Set<string>();

  for (const q of queriesParaBusca) {
    logger.debug(`Starck: tentando busca com query "${q}"`);
    const links = await searchStarckLinks(q, allQueries, targetSeason);
    if (links.length === 0) continue;

    let processedPosts = 0;

    for (const link of links) {
      if (processedPosts >= 5) break;

      try {
        const res = await axios.get(link.postUrl, axiosConfig);
        const $ = cheerio.load(res.data);
        const metadata = extractPostMetadata($);
        const magnets = await decodeBase64Magnets($, link.title, metadata);

        for (const magnet of magnets) {
          if (seenInfoHashes.has(magnet.infoHash)) continue;
          seenInfoHashes.add(magnet.infoHash);

          if (magnet.season === undefined && targetSeason) magnet.season = targetSeason;
          magnet.language = magnet.language || metadata.language;
          magnet.originalTitle = metadata.originalTitle;
          magnet.year = metadata.year;
          if (metadata.quality && !magnet.qualityHint) magnet.qualityHint = metadata.quality;
          if (!magnet.size && metadata.size) magnet.size = metadata.size;

          allResults.push(magnet);
        }

        processedPosts++;
      } catch (err) {
        logger.warn(`Starck: falha ao processar post ${link.postUrl}`, { error: (err as Error).message });
        processedPosts++;
      }
    }

    if (allResults.length > 0) break;
  }

  const duration = Date.now() - startTime;
  logger.info(`Starck: ${allResults.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);
  return allResults;
}