import axios from 'axios';
import * as cheerio from 'cheerio';
import { Logger } from '../../utils/logger.js';
import { agenteHttps, lookupCustomizado } from './wordpressScraper.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { extrairAno } from '../../titulos/TechnicalWords.js';
import {
  extrairRangeEpisodios,
  normalizarTexto,
  isCollectionTitle,
  temporadaAlvoNoRange,
  EpisodeRange,
  TipoConteudo,
} from '../../titulos/TechnicalWords.js';
import { SimilarityCalculator } from '../../titulos/SimilarityCalculator.js';

const logger = new Logger('StarckScraper');

const STARCK_BASE = 'https://www.starckfilmes-v24.com';

const QUALIDADE_VALIDA_REGEX = /\b(\d{3,4}p|4k|uhd|fhd|full\s*hd|hd)\b/i;

// Mesma instância usada pelo TitleFilter e pelos outros scrapers.
const similarity = SimilarityCalculator.getInstance();

export interface StarckTorrent {
  magnet: string;
  infoHash: string;
  originalTitle?: string;
  year?: number;
  years?: number[];
  language?: string;
  canonicalName?: string;
  qualityHint?: string;
  quality?: string;
  format?: string;
  size?: string;
  season?: number;
  episode?: number;
  imdbConfirmed?: boolean;
}

export interface PostMetadata {
  originalTitle?: string;
  year?: number;
  years?: number[];
  size?: string;
  language?: string;
  quality?: string;
}

export type TipoSecao = 'DUAL' | 'LEGENDADO' | 'NONE';

export interface SecaoStarck {
  tipo: TipoSecao;
  start: number;
  end: number;
}

export interface MetadadosBotao {
  idioma: string | null;
  formato: string | null;
  qualidade: string | null;
  tamanho: string | null;
}

export interface LinkClassificado {
  href: string;
  pos: number;
  idioma: string | null;
  formato: string | null;
  qualidade: string | null;
  tamanho: string | null;
  origem: 'secao' | 'botao' | 'fallback';
  motivo: string;
}

export interface SearchResultItem {
  title: string;
  postUrl: string;
  slugTitle: string;
  range: EpisodeRange | null;
}

export interface ContagemClassificacao {
  secaoDual: number;
  secaoLegendado: number;
  botaoDual: number;
  botaoLegendado: number;
  fallback: number;
}

export const axiosConfig = {
  timeout: 15000,
  httpsAgent: agenteHttps,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export { STARCK_BASE, QUALIDADE_VALIDA_REGEX };

// Decodifica slug: UTF-8 em hex, sufixo de data e hífen por espaço.
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

// Título base sem temporada e ano.
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

// Frases normalizadas, sem temporada nem ano.
function construirFrases(allQueries: string[]): Set<string> {
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
  return frases;
}

// Uma busca só; o filtro já usa todas as queries como frases.
export async function searchStarckLinks(
  searchQuery: string,
  allQueries: string[],
  targetSeason?: number,
  targetYear?: number,
  mediaType?: TipoConteudo,
  type?: 'movie' | 'series'
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

      const textoRaw = ($(el).text() || '').trim();
      const titleAttr = ($(el).attr('title') || '').trim();
      const textoUtil = textoRaw.length > 3 && !/^(N\/D|[\d.,]+)$/i.test(textoRaw);
      const titulo = textoUtil ? textoRaw : (titleAttr || slugTitle);

      itemsMap.set(fullUrl, {
        title: titulo,
        postUrl: fullUrl,
        slugTitle,
        range,
      });
    });

    const results = [...itemsMap.values()];
    const frasesArr = [...construirFrases(allQueries)];

    // Só FILME usa collection pra bypassar similaridade.
    // Série: "1ª Temporada Completa" é só uma temporada, não pack.
    // Deixar collection ativo em série aceitava spin-off (Dragon Ball Super).
    const ehSerie = mediaType === 'series' || mediaType === 'tv';

    let descartadosPorTipo = 0;
    let descartadosPorTemporada = 0;
    let descartadosPorSimilaridade = 0;
    let aceitosPorColecao = 0;

    const filtered = results.filter(item => {
      // Pré-filtro de tipo via slug: range != null sinaliza série; coleção de série cobre pack sem range.
      const isCollection = !ehSerie && isCollectionTitle(item.slugTitle, mediaType);
      const isCollectionSeries = isCollectionTitle(item.slugTitle, 'series');
      const pareceSerie = item.range !== null || isCollectionSeries;

      if (type === 'movie' && pareceSerie) {
        descartadosPorTipo++;
        return false;
      }
      if (type === 'series' && !pareceSerie) {
        descartadosPorTipo++;
        return false;
      }

      if (!temporadaAlvoNoRange(item.range, targetSeason)) {
        descartadosPorTemporada++;
        return false;
      }

      const resultado = similarity.compararComTitulos(frasesArr, item.slugTitle);

      if (!resultado.match && !isCollection) {
        descartadosPorSimilaridade++;
        return false;
      }

      if (!resultado.match && isCollection) aceitosPorColecao++;

      return true;
    });

    logger.debug(
      `Starck: ${results.length} itens | matches=${filtered.length}` +
      ` | descartados: tipo=${descartadosPorTipo} temporada=${descartadosPorTemporada} similaridade=${descartadosPorSimilaridade}` +
      (aceitosPorColecao > 0 ? ` | coleções=${aceitosPorColecao}` : '') +
      ` | type=${type ?? '-'} mediaType=${mediaType ?? '-'}`
    );

    return filtered.slice(0, 40);
  } catch (err: any) {
    logger.warn('Starck busca falhou', { query: searchQuery.substring(0, 50), error: err.message });
    return [];
  }
}

// Lê o bloco .post-description. Coleta todos os anos de "Lançamento" — "2002 - 2012" vira [2002, 2012].
export function extractPostMetadata($: any): PostMetadata {
  const result: PostMetadata = {};

  $('.post-description p').each((_i: any, p: any) => {
    const spans = $(p).find('span');
    if (spans.length >= 2) {
      const label = $(spans[0]).text().trim().toLowerCase();
      const value = $(spans[1]).text().trim();
      if (!label || !value) return;

      if (label.includes('nome original')) result.originalTitle = value;
      else if (label.includes('lançamento') || label.includes('ano')) {
        const yearMatches = value.match(/\b(19|20)\d{2}\b/g) || [];
        if (yearMatches.length > 0) {
          const anos = yearMatches.map((y: string) => parseInt(y));
          result.years = anos;
          result.year = anos[0];
        }
      }
      else if (label.includes('tamanho')) result.size = value;
      else if (label.includes('idioma')) result.language = value;
      else if (/qualidade\s+de\s+v[íi]deo/i.test(label)) {
        if (QUALIDADE_VALIDA_REGEX.test(value)) result.quality = value;
      }
    }
  });

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

// DUAL / LEGENDADO / NONE pra um cabeçalho de seção.
export function classificarCabecalhoSecao(texto: string): TipoSecao {
  const t = normalizarTexto(texto).trim();
  if (!t || t.length > 60) return 'NONE';
  if (/^(trailer|assistir|baixar|download|ver)\b/i.test(t)) return 'NONE';
  if (/^epis[oó]dios?\b/i.test(t)) return 'NONE';

  const temDual = /\bdual\b/.test(t) && /\baudio\b/.test(t);
  const temDublado = /\bdublado\b|\bdublada\b|\bdublagem\b|\bnacional\b/.test(t);
  const temLegendado = /\blegendado\b|\blegendada\b/.test(t);

  if (temLegendado && !temDual && !temDublado) return 'LEGENDADO';
  if ((temDual || temDublado) && !temLegendado) return 'DUAL';
  return 'NONE';
}

// Seções [start, end) a partir dos cabeçalhos, sem duplicar aninhados.
export function detectarSecoesStarck($: any, html: string): SecaoStarck[] {
  const container = $('.post-buttons').first();
  const escopo = container.length ? container : $('body');

  const cabecalhos: Array<{ tipo: TipoSecao; pos: number; texto: string }> = [];

  escopo.find('h1, h2, h3, h4, h5, h6, strong, b').each((_i: number, el: any) => {
    const texto = $(el).text().trim();
    if (!texto) return;

    const tipo = classificarCabecalhoSecao(texto);
    if (tipo === 'NONE') return;

    const pos = html.indexOf($(el).toString());
    if (pos === -1) return;

    cabecalhos.push({ tipo, pos, texto });
  });

  cabecalhos.sort((a, b) => a.pos - b.pos);

  const dedup: typeof cabecalhos = [];
  for (const cab of cabecalhos) {
    const dup = dedup.find(d => normalizarTexto(d.texto) === normalizarTexto(cab.texto));
    if (dup) continue;
    dedup.push(cab);
  }

  const secoes: SecaoStarck[] = [];
  for (let i = 0; i < dedup.length; i++) {
    const cab = dedup[i];
    const proximo = dedup[i + 1];
    secoes.push({
      tipo: cab.tipo,
      start: cab.pos,
      end: proximo ? proximo.pos : html.length,
    });
  }

  return secoes;
}

export function secaoDaPosicao(pos: number, secoes: SecaoStarck[]): SecaoStarck | null {
  for (const s of secoes) {
    if (pos >= s.start && pos < s.end) return s;
  }
  return null;
}

// Idioma/formato/qualidade/tamanho do botão.
export function classificarBotao($: any, botaoEl: any): MetadadosBotao {
  const container = $(botaoEl);
  if (!container.length) return { idioma: null, formato: null, qualidade: null, tamanho: null };

  const textoSpan = container.find('.text').first();
  if (!textoSpan.length) return { idioma: null, formato: null, qualidade: null, tamanho: null };

  const linhas = textoSpan.text()
    .split('\n')
    .map((s: string) => s.trim())
    .filter(Boolean);

  if (linhas.length < 3) return { idioma: null, formato: null, qualidade: null, tamanho: null };

  const primeiraLinha = linhas[0];
  const idiomaMatch = primeiraLinha.match(/(Dual Áudio|Dublado|Legendado|Nacional)/i);
  const idioma = idiomaMatch ? idiomaMatch[1] : null;

  let formato: string | null = null;
  if (idiomaMatch && idiomaMatch[0]) {
    const restante = primeiraLinha.substring(idiomaMatch[0].length).trim();
    if (restante) formato = restante;
  }

  const terceiraLinha = linhas[2];
  const qualidadeMatch = terceiraLinha.match(/(\d{3,4}p|4K|FHD|HD)/i);
  const tamanhoMatch = terceiraLinha.match(/\(([\d.]+)\s*(GB|MB)\)/i);

  return {
    idioma,
    formato,
    qualidade: qualidadeMatch ? qualidadeMatch[1] : null,
    tamanho: tamanhoMatch ? `${tamanhoMatch[1]} ${tamanhoMatch[2]}` : null,
  };
}

// Qualidade/formato/tamanho do <p> em volta do link.
function extrairMetadadosDoContexto($: any, linkEl: any): {
  qualidade: string | null;
  formato: string | null;
  tamanho: string | null;
} {
  const linkText = $(linkEl).text().trim();
  const parentP = $(linkEl).closest('p');
  const parentText = parentP.text().replace(/\s+/g, ' ').trim();

  const qualidade =
    linkText.match(/(\d{3,4}p|4K|FHD|HD)/i)?.[1] ||
    parentText.match(/(\d{3,4}p|4K|FHD|HD)/i)?.[1] ||
    null;

  const formato =
    linkText.match(/\b(MKV|MP4)\b/i)?.[1] ||
    parentText.match(/\b(MKV|MP4)\b/i)?.[1] ||
    null;

  const tamanhoMatch =
    parentText.match(/\(([\d.]+)\s*(GB|MB)\)/i) ||
    linkText.match(/\(([\d.]+)\s*(GB|MB)\)/i);
  const tamanho = tamanhoMatch ? `${tamanhoMatch[1]} ${tamanhoMatch[2]}` : null;

  return { qualidade, formato, tamanho };
}

// Classifica link filmedl.com via seção, botão ou contexto.
export function classificarLink(
  $: any,
  linkEl: any,
  html: string,
  secoes: SecaoStarck[]
): LinkClassificado {
  const href = $(linkEl).attr('href') || '';
  const pos = html.indexOf($(linkEl).toString());

  const base: LinkClassificado = {
    href,
    pos,
    idioma: null,
    formato: null,
    qualidade: null,
    tamanho: null,
    origem: 'fallback',
    motivo: '',
  };

  if (pos !== -1 && secoes.length > 0) {
    const secao = secaoDaPosicao(pos, secoes);
    if (secao) {
      if (secao.tipo === 'LEGENDADO') {
        return { ...base, origem: 'secao', motivo: 'secao=LEGENDADO' };
      }
      if (secao.tipo === 'DUAL') {
        const ctx = extrairMetadadosDoContexto($, linkEl);
        return {
          ...base,
          idioma: 'Dual Áudio',
          formato: ctx.formato,
          qualidade: ctx.qualidade,
          tamanho: ctx.tamanho,
          origem: 'secao',
          motivo: 'secao=DUAL',
        };
      }
    }
  }

  const botaoEl = $(linkEl).closest('.buttons-content');
  if (botaoEl.length) {
    const m = classificarBotao($, botaoEl);
    if (m.idioma && /legendad[ao]/i.test(m.idioma)) {
      return { ...base, ...m, origem: 'botao', motivo: 'botao=Legendado' };
    }
    if (m.idioma) {
      return { ...base, ...m, origem: 'botao', motivo: `botao=${m.idioma}` };
    }
  }

  return { ...base, origem: 'fallback', motivo: 'sem secao e sem botao' };
}

// Base64 do id → magnet corrigido.
export function extrairMagnetDoLink(href: string): string | null {
  const idMatch = href.match(/[?&]id=([^&]+)/i);
  if (!idMatch) return null;

  try {
    const decoded = decodeURIComponent(idMatch[1]);
    let magnet = Buffer.from(decoded, 'base64').toString('utf8').replace(/&amp;/gi, '&');
    if (!magnet.startsWith('magnet:?')) return null;
    magnet = magnet.replace(/&(?!\s*(?:tr|xl|dn|xt)=)/gi, '%26');
    return magnet;
  } catch {
    return null;
  }
}

// Número do episódio no <p> em volta.
export function extrairEpisodioDoContexto($: any, linkEl: any): number | undefined {
  const parentP = $(linkEl).closest('p');
  const parentText = parentP.text().trim() || '';
  const range = extrairRangeEpisodios(parentText);
  return range?.episodeStart && range.episodeStart > 0 ? range.episodeStart : undefined;
}

function normalizarIdiomaMetadata(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  const lower = lang.toLowerCase();
  if (lower.includes('dual')) return 'Dual Áudio';
  if (lower.includes('dublado') || lower.includes('dublagem')) return 'Dublado';
  if (lower.includes('legendado')) return 'Legendado';
  if (lower.includes('nacional')) return 'Nacional';
  return undefined;
}

function limparQualityHint(texto: string): string {
  return texto
    .replace(/^epis[oó]dio\s*\d+(\s*(e|ao?|a|-)\s*\d+)?\s*:?\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Processa links filmedl.com e devolve magnets DUAL.
export async function decodeBase64Magnets(
  $: any,
  html: string,
  postTitle: string,
  metadata: PostMetadata
): Promise<{ torrents: StarckTorrent[]; contagem: ContagemClassificacao }> {
  const secoes = detectarSecoesStarck($, html);
  const resumo = secoes.map(s => `${s.tipo}[${s.start}-${s.end}]`).join(' ') || '(nenhuma)';
  logger.debug(`Starck decode | seções | ${resumo}`);

  const contagem: ContagemClassificacao = {
    secaoDual: 0,
    secaoLegendado: 0,
    botaoDual: 0,
    botaoLegendado: 0,
    fallback: 0,
  };

  const rawMagnets: Array<{
    magnet: string;
    qualityHint: string;
    quality?: string;
    size?: string;
    language?: string;
    format?: string;
    episode?: number;
  }> = [];

  const todosLinks = $('a[href*="filmedl.com"]').toArray() as any[];

  let legendadoViaSecao = 0;
  let legendadoViaBotao = 0;

  for (const linkEl of todosLinks) {
    const cls = classificarLink($, linkEl, html, secoes);

    if (cls.origem === 'secao' && cls.motivo === 'secao=LEGENDADO') {
      contagem.secaoLegendado++;
      legendadoViaSecao++;
      continue;
    }
    if (cls.origem === 'botao' && cls.motivo === 'botao=Legendado') {
      contagem.botaoLegendado++;
      legendadoViaBotao++;
      continue;
    }

    if (cls.origem === 'secao') contagem.secaoDual++;
    else if (cls.origem === 'botao') contagem.botaoDual++;
    else contagem.fallback++;

    const magnet = extrairMagnetDoLink(cls.href);
    if (!magnet) continue;

    const episode = extrairEpisodioDoContexto($, linkEl);
    const parentText = $(linkEl).closest('p').text().trim() || '';

    rawMagnets.push({
      magnet,
      qualityHint: limparQualityHint(parentText),
      quality: cls.qualidade || undefined,
      size: cls.tamanho || undefined,
      language: cls.idioma || undefined,
      format: cls.formato || undefined,
      episode,
    });
  }

  logger.debug(
    `Starck decode | links: total=${todosLinks.length}` +
    ` | seção DUAL=${contagem.secaoDual} LEGENDADO=${contagem.secaoLegendado}` +
    ` | botão DUAL=${contagem.botaoDual} LEGENDADO=${contagem.botaoLegendado}` +
    ` | fallback=${contagem.fallback} | extraídos=${rawMagnets.length}`
  );

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
  const idiomaMeta = normalizarIdiomaMetadata(metadata.language);

  for (const item of analyzed) {
    if (!item || seen.has(item.infoHash)) continue;
    seen.add(item.infoHash);

    let episode = item.episode;
    if (episode === undefined && item.canonicalName) {
      const range = extrairRangeEpisodios(item.canonicalName);
      episode = range?.episodeStart && range.episodeStart > 0 ? range.episodeStart : undefined;
    }

    if (!item.canonicalName) {
      const tituloBase = metadata.originalTitle || postTitle;
      const qualidadeLimpa = item.quality || item.qualityHint.replace(/^\d{3,4}p\s*$/i, '').trim() || null;
      const partes = [
        tituloBase,
        item.language || idiomaMeta,
        qualidadeLimpa,
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
      format: item.format,
      size: item.size,
      language: item.language || idiomaMeta || 'Dual Áudio',
      episode,
    });
  }

  logger.debug(`Starck decode | post="${postTitle.substring(0, 50)}" | totalExtraidos=${results.length}`);
  return { torrents: results, contagem };
}

// Entrypoint: uma busca, todos os posts relevantes, magnets prontos.
export async function searchStarck(
  query: string,
  type: 'movie' | 'series' = 'movie',
  targetSeason?: number,
  searchQueries?: string[],
  targetYear?: number,
  imdbId?: string,
  mediaType?: TipoConteudo
): Promise<StarckTorrent[]> {
  const startTime = Date.now();

  const allQueries = [...new Set([query, ...(searchQueries || [])])];

  const allResults: StarckTorrent[] = [];
  const seenInfoHashes = new Set<string>();

  const links = await searchStarckLinks(query, allQueries, targetSeason, targetYear, mediaType, type);

  if (links.length > 0) {
    let processedPosts = 0;

    for (const link of links) {
      if (processedPosts >= 5) break;

      try {
        const res = await axios.get(link.postUrl, axiosConfig);

        let imdbConfirmed = false;
        if (imdbId) {
          const imdbIdDoPost = (res.data as string).match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
          if (imdbIdDoPost) {
            const isCollection = isCollectionTitle(link.title, mediaType);
            if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
              processedPosts++;
              continue;
            }
            if (!isCollection) imdbConfirmed = true;
          }
        }

        const $ = cheerio.load(res.data);
        const htmlSerializado = $.html();
        const metadata = extractPostMetadata($);
        const { torrents } = await decodeBase64Magnets($, htmlSerializado, link.title, metadata);

        // Post inteiro é coleção? (ex: "Quadrilogia Completa – A Era do Gelo").
        // Nesse caso o título do post carrega o marcador de coleção — metadata PT só traz "Ice Age" puro.
        const postEhColecao = isCollectionTitle(link.title, mediaType);
        const originalDoPost = postEhColecao ? link.title : undefined;

        for (const magnet of torrents) {
          if (seenInfoHashes.has(magnet.infoHash)) continue;
          seenInfoHashes.add(magnet.infoHash);

          if (magnet.season === undefined && targetSeason) magnet.season = targetSeason;

          // Quando o dn é coleção, ele manda no originalTitle — o título do botão costuma apontar pra um filme só.
          const dn = magnet.canonicalName;
          const dnEhColecao = !!dn && isCollectionTitle(dn, mediaType);
          const originalDoDn = dnEhColecao ? dn : undefined;

          magnet.originalTitle = originalDoDn || originalDoPost || metadata.originalTitle || link.slugTitle;

          // years: range completo (ex: quadrilogia 2002-2012) do dn se tiver, senão do metadata.
          const anosDoDn = dn ? extrairAno(dn) : undefined;
          const years = (anosDoDn && anosDoDn.length > 0)
            ? anosDoDn
            : (metadata.years && metadata.years.length > 0
              ? metadata.years
              : (metadata.year !== undefined ? [metadata.year] : undefined));

          magnet.years = years;
          magnet.year = years ? years[0] : undefined;

          magnet.language = magnet.language || metadata.language;
          if (metadata.quality && !magnet.qualityHint) magnet.qualityHint = metadata.quality;
          if (!magnet.size && metadata.size) magnet.size = metadata.size;
          if (imdbConfirmed) magnet.imdbConfirmed = true;

          allResults.push(magnet);
        }

        processedPosts++;
      } catch (err) {
        logger.warn(`Starck: falha ao processar post ${link.postUrl}`, { error: (err as Error).message });
        processedPosts++;
      }
    }
  }

  const duration = Date.now() - startTime;
  logger.info(`Starck: ${allResults.length} magnets em ${duration}ms para "${query.substring(0, 50)}"`);
  return allResults;
}