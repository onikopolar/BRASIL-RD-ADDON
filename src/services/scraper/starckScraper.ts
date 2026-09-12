import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import {
  extrairRangeEpisodios,
  normalizarTexto,
  temporadaAlvoNoRange,
  EpisodeRange,
} from '../../titulos/TechnicalWords.js';

const logger = new Logger('StarckScraper');

const STARCK_BASE = 'https://www.starck-oficial.com';

// FIX 1: só aceita como qualidade de vídeo valores que realmente são qualidade.
// Sem isso, "Qualidade de Video: 10" (nota) sobrescrevia o "FHD" do .sl-quality
const QUALIDADE_VALIDA_REGEX = /\b(\d{3,4}p|4k|uhd|fhd|full\s*hd|hd)\b/i;

export interface StarckTorrent {
  magnet: string;
  infoHash: string;
  originalTitle?: string;
  year?: number;
  language?: string;
  canonicalName?: string;
  qualityHint?: string;
  quality?: string;
  format?: string;
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

//Aqui ele limpa o slug, decodifica e troca hífen por espaço
export function cleanSlug(slug: string): string {
  let decodificado = slug;
  try {
    decodificado = decodeURIComponent(slug);
  } catch { }

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

//Aqui ele extrai o título base do slug, tirando temporada e ano
export function extrairTituloBaseDoSlug(slug: string): string {
  const limpo = cleanSlug(slug);
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
  range: EpisodeRange | null;
}

//Aqui ele busca links do catálogo e filtra pelo range de temporada
async function searchStarckLinks(
  searchQuery: string,
  allQueries: string[],
  targetSeason?: number,
  targetYear?: number
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

      if (!slugTitle || slugTitle.length < 3) return;

      itemsMap.set(fullUrl, {
        title: $(el).text().trim() || slugTitle,
        postUrl: fullUrl,
        slugTitle,
        range,
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

      //Aqui ele checa se o alvo cabe no range declarado pelo slug
      if (!temporadaAlvoNoRange(item.range, targetSeason)) {
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

//Aqui ele extrai metadados do post a partir do bloco de descrição
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
      // FIX 1: só aceita qualidade de vídeo se o value for qualidade real.
      // "Qualidade de Video: 10" (nota) não passa; "Qualidade do Audio" cai fora naturalmente.
      else if (/qualidade\s+de\s+v[íi]deo/i.test(label)) {
        if (QUALIDADE_VALIDA_REGEX.test(value)) result.quality = value;
      }
    }
  });

  // FIX 1: fallback pro span .sl-quality (FHD/HD/etc) quando nada foi capturado acima
  if (!result.quality) {
    const q = $('.sl-quality').first().text().trim();
    if (q && QUALIDADE_VALIDA_REGEX.test(q)) result.quality = q;
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

//Aqui ele confirma se o link está antes da seção "LEGENDADO", ou seja, é dual
function linkEhDaSecaoDual($: any, el: any): boolean {
  const html = $('body').html() || '';
  const legendadoPos = html.search(/VERS[ÃA]O\s+LEGENDAD[OA]/i);
  if (legendadoPos === -1) return true;

  const linkHtml = $(el).toString();
  const linkPos = html.indexOf(linkHtml);
  if (linkPos === -1) return false;

  return linkPos < legendadoPos;
}

//Aqui ele extrai idioma, formato, qualidade e tamanho do botão do magnet
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

  const linhas = textoSpan.split('\n').map((s: string) => s.trim()).filter(Boolean);
  if (linhas.length < 3) return {};

  const primeiraLinha = linhas[0];
  const idiomaMatch = primeiraLinha.match(/(Dual Áudio|Dublado|Legendado|Nacional)/i);
  const idioma = idiomaMatch ? idiomaMatch[1] : undefined;

  let formato: string | undefined;
  if (idiomaMatch && idiomaMatch[0]) {
    const restante = primeiraLinha.substring(idiomaMatch[0].length);
    if (restante) formato = restante.trim();
  }

  const terceiraLinha = linhas[2];
  const qualidadeMatch = terceiraLinha.match(/(\d{3,4}p|4K|FHD|HD)/i);
  const tamanhoMatch = terceiraLinha.match(/\(([\d.]+)\s*GB\)/i);

  return {
    idioma,
    formato,
    qualidade: qualidadeMatch ? qualidadeMatch[1] : undefined,
    tamanho: tamanhoMatch ? `${tamanhoMatch[1]} GB` : undefined,
  };
}

//Aqui ele decodifica os magnets em base64 e enriquece com metadados do botão
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

    // FIX 4: antes de qualquer coisa, olha o idioma do botão.
    // Se for "Legendado", descarta — mesmo sem cabeçalho "VERSÃO LEGENDADO" na página.
    const botaoMetadados = extrairMetadadosDoBotao($, el);
    if (botaoMetadados.idioma && /legendad[ao]/i.test(botaoMetadados.idioma)) {
      logger.debug(`Starck decode | botão marcado como Legendado — ignorado | href=${href.substring(0, 60)}`);
      return;
    }

    // Checagem por seção (segunda barreira)
    if (!linkEhDaSecaoDual($, el)) return;

    try {
      const decoded = decodeURIComponent(idMatch[1]);
      let magnet = Buffer.from(decoded, 'base64').toString('latin1').replace(/&amp;/gi, '&');
      if (!magnet.startsWith('magnet:?')) return;

      //Aqui ele corrige o "&" solto dentro do dn (não vem codificado pelo Starck)
      magnet = magnet.replace(/&(?!\s*(?:tr|xl|dn|xt)=)/gi, '%26');

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
        // FIX 3: propaga o formato extraído do botão (MKV, MP4, etc)
        format: botaoMetadados.formato,
        episode,
      });
    } catch (err) {
      logger.warn('Starck decode | erro ao decodificar magnet', { error: (err as Error).message });
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

    //Aqui ele monta um canonicalName a partir dos metadados quando o magnet não tem dn
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
      // FIX 3: expõe o formato do botão pro mapper usar, se quiser
      format: item.format,
      size: item.size,
      language: item.language || 'Dual Áudio',
      episode,
    });
  }

  logger.debug(`Starck decode | post="${postTitle.substring(0, 50)}" | totalExtraidos=${results.length}`);
  return results;
}

//Aqui é o entrypoint do scraper Starck
export async function searchStarck(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[],
  targetYear?: number
): Promise<StarckTorrent[]> {
  const startTime = Date.now();

  const queriesParaBusca = searchQueries && searchQueries.length > 0 ? searchQueries : [query];
  const allQueries = [...new Set([query, ...(searchQueries || [])])];

  const allResults: StarckTorrent[] = [];
  const seenInfoHashes = new Set<string>();

  for (const q of queriesParaBusca) {
    logger.debug(`Starck: tentando busca com query "${q}"`);
    const links = await searchStarckLinks(q, allQueries, targetSeason, targetYear);
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
          magnet.originalTitle = metadata.originalTitle || link.slugTitle;
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