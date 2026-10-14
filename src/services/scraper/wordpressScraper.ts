import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../../utils/logger.js';
import { TorrentResult } from './torrentTypes.js';
import { QualityDetector } from '../../lib/qualityDetector.js';
import { analisarMagnet } from '../../magnet/magnetHelper.js';
import { CacheService } from '../../debrid/CacheService.js';
import { INDICADORES_INTERNACIONAL_TORRENTS, extrairRangeEpisodios, normalizarTexto, isCollectionTitle, temporadaAlvoNoRange, extrairAno, TipoConteudo } from '../../titulos/TechnicalWords.js';
import { SimilarityCalculator } from '../../titulos/SimilarityCalculator.js';

export const CAT_FILMES = 38;
export const CAT_SERIES = 43;

export const LEGENDADO_REGEX = new RegExp(
  '\\b(' + INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b',
  'i'
);

export const LEGENDADO_CABECALHO_REGEX = /\blegendad[ao]s?\b/i;
export const QUALIDADE_PURA_REGEX = /^\s*(?:qualidade:?\s*)?(\d{3,4}p|4k|uhd|full\s*hd)\s*$/i;

export const logger = new Logger('WordPressScraper');

// Marcador de posição única por elemento. Sem ele, dois <strong> idênticos teriam a mesma string em indexOf.
const LYRA_MARK = 'data-lyra-h';

dns.setServers(['8.8.8.8', '1.1.1.1']);

// Negative cache local do WordPress. Cada site tem seu veredito independente.
const WP_NEGATIVE_TTL_MS = 30 * 60 * 1000;
const WP_NEGATIVE_MAX = 5000;

interface WpNegativeEntry {
  ts: number;
  ttlMs: number;
  hits: number;
}

const wpNegativeStore = new Map<string, WpNegativeEntry>();

function wpNegativeKey(site: string, query: string, extra: Record<string, unknown>): string {
  const q = query.trim().toLowerCase();
  return `wp:${site}|${q}|${JSON.stringify(extra)}`;
}

function wpNegativeIsBlocked(key: string): boolean {
  const entry = wpNegativeStore.get(key);
  if (!entry) return false;
  if (Date.now() - entry.ts > entry.ttlMs) {
    wpNegativeStore.delete(key);
    return false;
  }
  entry.hits++;
  return true;
}

function wpNegativeMark(key: string, ttlMs = WP_NEGATIVE_TTL_MS): void {
  if (wpNegativeStore.size >= WP_NEGATIVE_MAX) {
    const first = wpNegativeStore.keys().next().value;
    if (first) wpNegativeStore.delete(first);
  }
  wpNegativeStore.set(key, { ts: Date.now(), ttlMs, hits: 0 });
}

export function wpNegativeClear(): void {
  wpNegativeStore.clear();
}

export function wpNegativeStats() {
  const agora = Date.now();
  return {
    size: wpNegativeStore.size,
    maxEntries: WP_NEGATIVE_MAX,
    defaultTtlMs: WP_NEGATIVE_TTL_MS,
    entries: Array.from(wpNegativeStore.entries()).map(([key, v]) => ({
      key,
      ageMs: agora - v.ts,
      ttlMs: v.ttlMs,
      expiraEmMs: Math.max(0, v.ttlMs - (agora - v.ts)),
      hits: v.hits,
    })),
  };
}

export function decodeHtmlEntities(texto: string): string {
  if (!texto || (!texto.includes('&') && !texto.includes('&#'))) return texto;
  return texto
    .replace(/&#(\d+);/g, (_m, cod) => String.fromCharCode(parseInt(cod, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, cod) => String.fromCharCode(parseInt(cod, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'");
}

export class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    (dns as any).resolve4(hostname, (err: any, addresses: string[]) => {
      if (err) return cb(err);
      const sock = tls.connect({
        host: addresses[0],
        port: options.port || 443,
        servername: hostname,
        rejectUnauthorized: false,
      }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined as any;
  }
}

export const dnsAgent = new DnsAgent({ keepAlive: true });
export const agenteHttps = dnsAgent;

export function criarLookup() {
  return (hostname: string, _opts: any, cb: any) => {
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      cb(null, addresses[0], 4);
    });
  };
}
export const lookupCustomizado = criarLookup();

export interface WordPressSite {
  name: string;
  baseUrl: string;
  priority: number;
  timeout: number;
}

export const WP_SITES: WordPressSite[] = [
  {
    name: 'Comando Torrents',
    baseUrl: 'https://comando1.com',
    priority: 2,
    timeout: 15000,
  },
];

export const jsonAxiosConfig = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: lookupCustomizado,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
  },
};

export type MagnetCacheEntry = { nome: string | null; infoHash: string };
export type InfoBlock = {
  originalTitle?: string;
  translatedTitle?: string;
  year?: number;
  years?: number[];
  size?: string;
};

export type Secao = {
  tipo: 'DUAL' | 'LEGENDADO';
  start: number;
  end: number;
  season: number | null;
  textoHeading: string;
};

// Tree delimitada do magnet + contexto acima dele dentro da seção (texto entre magnet anterior e este).
export type MagnetTree = {
  proprio: string;
  filhos: string[];
  imgAlt: string | null;
  paiTexto: string;
  irmaos: string[];
  contextoAcima: string;
};

export type ExtractedMagnet = {
  magnet: string;
  tree: MagnetTree;
  secao: 'DUAL' | 'LEGENDADO' | 'NONE';
  section: Secao | null;
};

export type IdiomaFlags = {
  temNacional: boolean;
  temDual: boolean;
  temAudio: boolean;
  temDublado: boolean;
  temLegendado: boolean;
  temLegendaSubstantivo: boolean;
};

export type TamanhoNumerico = { valor: number; unidade: 'GB' | 'MB' | 'KB' };

export type ContextoLocalMagnet = {
  altDaImg: string | null;
  textoIrmaoAnterior: string | null;
  tituloIrmaoAnterior: string | null;
};

type CandidatoAncora = {
  el: any;
  tipo: 'DUAL' | 'LEGENDADO';
  pos: number;
  season: number | null;
  texto: string;
  tag: string;
};

export class WordPressScraper {
  public readonly qualityDetector: QualityDetector;
  public readonly magnetCache: CacheService;
  public readonly similarity: SimilarityCalculator;
  public readonly POST_BATCH_SIZE = 3;
  public readonly PROTECTOR_BATCH_SIZE = 5;
  public readonly MAGNET_CACHE_TTL = 30 * 60 * 1000;

  constructor() {
    this.qualityDetector = new QualityDetector();
    this.magnetCache = new CacheService();
    this.similarity = SimilarityCalculator.getInstance();
  }

  async search(
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[],
    imdbId?: string,
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const queriesParaBusca = searchQueries && searchQueries.length > 0
      ? searchQueries
      : [query];

    const activeSites = WP_SITES.filter(s => s.priority > 0).sort((a, b) => b.priority - a.priority);

    for (const q of queriesParaBusca) {
      logger.debug(`search query="${q}"`);

      // Cada site tem seu veredito de cache. Se um site não acha, os outros continuam livres.
      const respostas = await Promise.all(
        activeSites.map(async site => {
          const ncKey = wpNegativeKey(site.name, q, {
            type,
            season: targetSeason ?? 0,
            mediaType: mediaType ?? null,
          });

          if (wpNegativeIsBlocked(ncKey)) {
            logger.debug(`WP: negative cache HIT | site=${site.name} | "${q.substring(0, 40)}"`);
            return [] as TorrentResult[];
          }

          try {
            const r = await this.searchSite(site, q, type, targetSeason, searchQueries, imdbId, mediaType);

            // Só marca negativo quando o site respondeu OK e não achou nada.
            // Erro de rede/servidor cai no catch e NÃO marca.
            if (r.length === 0) {
              wpNegativeMark(ncKey);
              logger.info(`WP: 0 resultados, cacheado negativo | site=${site.name} | "${q.substring(0, 40)}"`);
            }

            return r;
          } catch (err: any) {
            logger.warn(`site falhou`, { site: site.name, query: q, error: err.code || err.message });
            return [] as TorrentResult[];
          }
        })
      );

      const resultados = respostas.flat();

      if (resultados.length > 0) {
        logger.debug(`query "${q}" retornou ${resultados.length}`);
        return resultados;
      }
    }

    return [];
  }

  async searchSite(
    site: WordPressSite,
    query: string,
    type: 'movie' | 'series',
    targetSeason?: number,
    searchQueries?: string[],
    imdbId?: string,
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const searchQuery = query.trim();
    const catId = type === 'movie' ? CAT_FILMES : CAT_SERIES;
    const searchUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(searchQuery)}&per_page=100&_fields=id,title,link&categories=${catId}`;
    logger.debug(`GET posts search="${searchQuery}" cat=${catId}`);

    const response = await axios.get(searchUrl, jsonAxiosConfig);
    const posts = response.data;

    const postItems: { id: number; title: string; url: string }[] = [];

    for (const post of posts) {
      if (!post.id || !post.title?.rendered || !post.link) continue;

      const titleBruto = post.title.rendered as string;
      const titleLimpo = decodeHtmlEntities(titleBruto);

      postItems.push({
        id: post.id,
        title: titleLimpo,
        url: post.link,
      });
    }

    const queryRange = extrairRangeEpisodios(searchQuery);
    const querySeason = targetSeason ?? queryRange?.seasonStart;

    const frases = this.montarFrasesDeBusca(searchQuery, searchQueries);

    const relevantPosts = postItems.filter(post =>
      this.postRelevante(post, querySeason, frases, site.name, mediaType)
    );

    logger.debug(`posts API=${postItems.length} relevantes=${relevantPosts.length} season=${querySeason ?? '-'}`);

    const results: TorrentResult[] = [];

    for (let i = 0; i < relevantPosts.length; i += this.POST_BATCH_SIZE) {
      const batch = relevantPosts.slice(i, i + this.POST_BATCH_SIZE);
      const batchPromises = batch.map(post =>
        this.scrapePostApi(post.id, post.title, site.name, type, imdbId, mediaType)
          .catch(err => {
            logger.warn(`post falhou`, { post: post.title.substring(0, 50), error: err.message });
            return [] as TorrentResult[];
          })
      );
      const batchResults = await Promise.all(batchPromises);
      for (const res of batchResults) {
        results.push(...res);
      }
    }

    if (querySeason) {
      for (const r of results) {
        if (r.season === undefined) r.season = querySeason;
      }
    }

    logger.debug(`site=${site.name} total=${results.length}`);
    return results;
  }

  montarFrasesDeBusca(searchQuery: string, searchQueries?: string[]): Set<string> {
    const allQueries = new Set<string>([searchQuery, ...(searchQueries || [])]);
    const frases = new Set<string>();

    for (const q of allQueries) {
      const phrase = normalizarTexto(
        q
          .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
          .replace(/\btemporada\s*\d+\b/gi, '')
          .replace(/\bseason\s*\d+\b/gi, '')
      );
      if (phrase) frases.add(phrase);
    }

    return frases;
  }

  // Pré-filtro barato: substring com boundary. Sem fuzzy, sem cascata N1-N5.
  postRelevante(
    post: { title: string },
    querySeason: number | undefined,
    frases: Set<string>,
    siteName: string,
    mediaType?: TipoConteudo
  ): boolean {
    const lowerTitle = post.title.toLowerCase();

    if (/\blist[aã]o\b/i.test(lowerTitle)) return false;

    if (querySeason) {
      const range = extrairRangeEpisodios(post.title);
      if (!temporadaAlvoNoRange(range, querySeason)) return false;
    }

    const resultado = this.similarity.preFiltroContem([...frases], post.title);

    const isCollection = isCollectionTitle(post.title, mediaType);

    if (!resultado.match && !isCollection) {
      logger.debug(`post rejeitado`, { score: resultado.score.toFixed(2), titulo: post.title.substring(0, 60) });
      return false;
    }

    if (!resultado.match && isCollection) {
      logger.debug(`coleção aceita pré-filtro`, { titulo: post.title.substring(0, 60), mediaType: mediaType ?? '-' });
      return true;
    }

    logger.debug(`post aceito`, { score: resultado.score.toFixed(2), frase: resultado.fraseVencedora || '-', titulo: post.title.substring(0, 60) });
    return true;
  }

  classificarTextoIdioma(texto: string): IdiomaFlags {
    const t = normalizarTexto(texto);
    return {
      temNacional: /\bnacional\b/.test(t),
      temDual: /\bdual\b/.test(t),
      temAudio: /\baudio\b/.test(t),
      temDublado: /\bdublado\b|\bdublada\b|\bdublagem\b/.test(t),
      temLegendado: LEGENDADO_CABECALHO_REGEX.test(texto),
      temLegendaSubstantivo: /\blegenda\b/i.test(texto),
    };
  }

  extractQualityFromText(text: string): string | null {
    if (!text) return null;
    const q = this.qualityDetector.extractBestQuality(text);
    return (q && q !== 'HD') ? q : null;
  }

  cleanHtmlTitle(parentText: string, linkText: string, qualityOverride?: string | null): string {
    if (!parentText) return '';

    const epPatterns = [
      /Epis[oó]dio\s+\d{1,3}\s+ao?\s+\d{1,3}/i,
      /Epis[oó]dio\s+\d{1,3}/i,
      /\bS\d{1,2}\s*E\d{1,3}/i,
      /\bE\d{1,3}/i
    ];

    let episode = '';
    for (const pattern of epPatterns) {
      const match = parentText.match(pattern);
      if (match) {
        episode = match[0];
        break;
      }
    }

    if (!episode) return '';

    let quality = qualityOverride || null;
    if (!quality && linkText) {
      quality = this.extractQualityFromText(linkText);
    }

    return quality ? `${episode}: ${quality}` : episode;
  }

  extrairContextoLocal($: any, el: any): ContextoLocalMagnet {
    const $el = $(el);
    const altDaImg = ($el.find('img').attr('alt') || '').trim() || null;

    let textoIrmaoAnterior: string | null = null;
    let tituloIrmaoAnterior: string | null = null;

    const $pai = $el.parent();
    const idxLink = $el.index();

    if (idxLink !== -1 && idxLink > 0) {
      const textoAntes = $pai.contents().slice(0, idxLink).text().replace(/\s+/g, ' ').trim();
      if (textoAntes) {
        if (QUALIDADE_PURA_REGEX.test(textoAntes)) textoIrmaoAnterior = textoAntes;
        if (this.pareceTituloDeItem(textoAntes)) tituloIrmaoAnterior = textoAntes;
      }
    }

    if (!textoIrmaoAnterior && !tituloIrmaoAnterior) {
      const $rotulo = $pai.find('strong, b').first();
      if ($rotulo.length) {
        const idxRotulo = $rotulo.index();
        if (idxRotulo !== -1 && idxLink !== -1 && idxRotulo < idxLink) {
          const texto = $rotulo.text().replace(/\s+/g, ' ').trim();
          if (texto) {
            if (QUALIDADE_PURA_REGEX.test(texto)) textoIrmaoAnterior = texto;
            if (this.pareceTituloDeItem(texto)) tituloIrmaoAnterior = texto;
          }
        }
      }
    }

    if (!textoIrmaoAnterior && !tituloIrmaoAnterior) {
      let irmao = $pai.prev();
      for (let passo = 0; passo < 3 && irmao.length; passo++) {
        if (irmao.find('a[href^="magnet:"]').length > 0) {
          irmao = irmao.prev();
          continue;
        }

        const texto = irmao.text().replace(/\s+/g, ' ').trim();
        if (texto) {
          if (QUALIDADE_PURA_REGEX.test(texto)) textoIrmaoAnterior = texto;
          if (this.pareceTituloDeItem(texto)) tituloIrmaoAnterior = texto;
          break;
        }
        irmao = irmao.prev();
      }
    }

    return { altDaImg, textoIrmaoAnterior, tituloIrmaoAnterior };
  }

  pareceTituloDeItem(texto: string): boolean {
    if (texto.length < 3 || texto.length > 150) return false;
    if (!/[a-zA-ZÀ-ÿ]/.test(texto)) return false;
    if (QUALIDADE_PURA_REGEX.test(texto)) return false;
    if (/^(assistir|baixar|download|ver|trailer|sinopse|informa[çc]|caso haja|k-lite|codec)/i.test(texto)) return false;
    if (/^\d+\s*(gb|mb|kb|kbps|mbps|gbps)$/i.test(texto)) return false;
    return true;
  }

  // Qualidade: contexto acima do magnet (dentro da seção) > texto próprio > img > filhos > pai > dn > metadata > post title.
  resolverQualidade(
    tree: MagnetTree,
    canonicalName: string | null,
    linkText: string,
    parentText: string,
    postTitle: string,
    html: string
  ): { qualidade: string; fonte: string } {
    if (tree.contextoAcima) {
      const q = this.extractQualityFromText(tree.contextoAcima);
      if (q) return { qualidade: q, fonte: 'contextoAcima' };
    }

    if (tree.proprio) {
      const q = this.extractQualityFromText(tree.proprio);
      if (q) return { qualidade: q, fonte: 'proprio' };
    }

    if (tree.imgAlt) {
      const q = this.extractQualityFromText(tree.imgAlt);
      if (q) return { qualidade: q, fonte: 'imgAlt' };
    }

    for (const filho of tree.filhos) {
      const q = this.extractQualityFromText(filho);
      if (q) return { qualidade: q, fonte: 'filhos' };
    }

    if (tree.paiTexto) {
      const q = this.extractQualityFromText(tree.paiTexto);
      if (q) return { qualidade: q, fonte: 'paiTexto' };
    }

    if (canonicalName) {
      const q = this.extractQualityFromText(canonicalName);
      if (q) return { qualidade: q, fonte: 'canonicalName' };
    }

    if (linkText) {
      const q = this.extractQualityFromText(linkText);
      if (q) return { qualidade: q, fonte: 'linkText' };
    }

    if (parentText) {
      const q = this.extractQualityFromText(parentText);
      if (q) return { qualidade: q, fonte: 'parentText' };
    }

    const qPost = this.extractQualityFromText(postTitle);
    if (qPost) return { qualidade: qPost, fonte: 'postTitle' };

    const qHtml = this.extractQualityFromText(html);
    if (qHtml) return { qualidade: qHtml, fonte: 'html' };

    return { qualidade: 'HD', fonte: 'fallback' };
  }

  // Classifica seção apenas pelo texto: presença de dual/dublado/nacional vs legendado. Sem dependência de tag, tamanho ou posição.
  detectSectionType(text: string): 'DUAL' | 'LEGENDADO' | 'OUTRO' {
    const t = normalizarTexto(text).trim();

    if (/^(assistir|baixar|download|ver|trailer)\b/i.test(t)) return 'OUTRO';

    if (/^\p{L}{2,15}\s*:\s*\S/iu.test(text.trim())) return 'OUTRO';

    const f = this.classificarTextoIdioma(text);
    const temDualCompleto = f.temDual && f.temAudio;
    const temLegendadoCabecalho = f.temLegendado;

    if (temLegendadoCabecalho && !temDualCompleto && !f.temDublado) return 'LEGENDADO';
    if ((temDualCompleto || f.temDublado || f.temNacional) && !temLegendadoCabecalho) return 'DUAL';
    return 'OUTRO';
  }

  findSections($: any, content: string): Secao[] {
    const candidatos: CandidatoAncora[] = [];

    $('*').each((_: number, el: any) => {
      const $el = $(el);
      const texto = $el.text().replace(/\s+/g, ' ').trim();

      if (texto.length < 3 || texto.length > 200) return;

      if ($el.find('a[href^="magnet:"]').length > 0) return;

      const tipo = this.detectSectionType(texto);
      if (tipo === 'OUTRO') return;

      const pos = content.indexOf($el.toString());
      if (pos === -1) return;

      const range = extrairRangeEpisodios(texto);
      const season = range && range.seasonStart > 0 && range.seasonStart === range.seasonEnd
        ? range.seasonStart
        : null;

      const tag = ($el.prop('tagName') || '').toLowerCase();
      candidatos.push({ el, tipo, pos, season, texto, tag });
    });

    logger.debug(`findSections candidatos brutos=${candidatos.length}`);

    const filtrados = candidatos.filter(cab =>
      !candidatos.some(outro =>
        outro !== cab && $(outro.el).find(cab.el).length > 0
      )
    );

    filtrados.sort((a, b) => a.pos - b.pos);

    const secoes: Secao[] = [];
    for (let i = 0; i < filtrados.length; i++) {
      const cab = filtrados[i];
      const proximo = filtrados[i + 1];
      secoes.push({
        tipo: cab.tipo,
        start: cab.pos,
        end: proximo ? proximo.pos : content.length,
        season: cab.season,
        textoHeading: cab.texto,
      });
    }

    return secoes;
  }

  secaoDaPosicao(pos: number, secoes: Secao[]): Secao | null {
    for (const s of secoes) {
      if (pos >= s.start && pos < s.end) return s;
    }
    return null;
  }

  // Converte um trecho de HTML em texto puro — serve pra extrair qualidade/episódio do contexto.
  private extrairTextoDeHtml(html: string): string {
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Tree delimitada do magnet + contexto acima (texto entre magnet anterior e este, dentro da seção).
  extrairTreeDoMagnet($: any, el: any, contextoAcima = ''): MagnetTree {
    const $el = $(el);
    const proprio = $el.text().trim().replace(/\s+/g, ' ');

    const filhos: string[] = [];
    $el.find('strong, b, span').each((_: number, child: any) => {
      const t = $(child).text().trim().replace(/\s+/g, ' ');
      if (t && t !== proprio) filhos.push(t);
    });

    const $img = $el.find('img').first();
    const imgAlt = ($img.attr('alt') || $img.attr('title') || '').trim() || null;

    const $pai = $el.parent();
    const $paiClone = $pai.clone();
    $paiClone.find('a').remove();
    const paiTexto = $paiClone.text().trim().replace(/\s+/g, ' ');

    const irmaos: string[] = [];
    $pai.children('a').each((_: number, irmao: any) => {
      if (irmao === el) return;
      const t = $(irmao).text().trim().replace(/\s+/g, ' ');
      if (t) irmaos.push(t);
    });

    return { proprio, filhos, imgAlt, paiTexto, irmaos, contextoAcima };
  }

  // Coleta magnets, agrupa por seção, ordena por posição e calcula o contexto acima de cada um (entre magnet anterior e este).
  extractDirectMagnets($: any, contentHtml: string, sections: Secao[]): ExtractedMagnet[] {
    const allMagnetAnchors = $('a[href^="magnet:"]').toArray();
    const stats: Record<'DUAL' | 'LEGENDADO' | 'NONE', number> = { DUAL: 0, LEGENDADO: 0, NONE: 0 };

    type Candidato = {
      el: any;
      magnet: string;
      pos: number;
      htmlLen: number;
      secao: 'DUAL' | 'LEGENDADO' | 'NONE';
      section: Secao | null;
    };

    const candidatos: Candidato[] = [];

    for (const el of allMagnetAnchors) {
      const magnet = $(el).attr('href')?.trim();
      if (!magnet) continue;

      const htmlStr = $(el).toString();
      const pos = contentHtml.indexOf(htmlStr);
      if (pos === -1) {
        stats.NONE++;
        continue;
      }

      const section = this.secaoDaPosicao(pos, sections);
      const secao = section?.tipo ?? 'NONE';
      stats[secao]++;

      candidatos.push({ el, magnet, pos, htmlLen: htmlStr.length, secao, section });
    }

    // Contexto por elemento: só nos DUAL. É o texto entre o magnet anterior (ou início da seção) e este magnet.
    const contextoPorEl = new Map<any, string>();

    const virtualSection: Secao = { tipo: 'DUAL', start: 0, end: contentHtml.length, season: null, textoHeading: '' };
    const porSecaoDual = new Map<Secao, Candidato[]>();

    for (const c of candidatos) {
      if (c.secao !== 'DUAL') continue;
      const key = c.section ?? virtualSection;
      if (!porSecaoDual.has(key)) porSecaoDual.set(key, []);
      porSecaoDual.get(key)!.push(c);
    }

    for (const [section, mags] of porSecaoDual) {
      mags.sort((a, b) => a.pos - b.pos);
      let prevFim = section.start;
      for (const mag of mags) {
        if (mag.pos > prevFim) {
          const trecho = contentHtml.substring(prevFim, mag.pos);
          contextoPorEl.set(mag.el, this.extrairTextoDeHtml(trecho));
        } else {
          contextoPorEl.set(mag.el, '');
        }
        prevFim = mag.pos + mag.htmlLen;
      }
    }

    const resultados: ExtractedMagnet[] = [];
    for (const c of candidatos) {
      if (c.secao !== 'DUAL') continue;
      const contextoAcima = contextoPorEl.get(c.el) || '';
      resultados.push({
        magnet: c.magnet,
        tree: this.extrairTreeDoMagnet($, c.el, contextoAcima),
        secao: c.secao,
        section: c.section,
      });
    }

    if (allMagnetAnchors.length > 0) {
      logger.debug(
        `atribuição | brutos=${allMagnetAnchors.length} | DUAL=${stats.DUAL} LEGENDADO=${stats.LEGENDADO} NONE=${stats.NONE}`
      );
    }

    return resultados;
  }

  async scrapePostApi(
    postId: number,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series',
    imdbId?: string,
    mediaType?: TipoConteudo
  ): Promise<TorrentResult[]> {
    const postUrl = `https://comando1.com/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content`;
    const response = await axios.get(postUrl, jsonAxiosConfig);
    const post = response.data;

    const titleRenderedBruto = post.title?.rendered || postTitle;
    const titleRendered = decodeHtmlEntities(titleRenderedBruto);

    const contentHtmlOriginal = post.content?.rendered || '';

    if (!contentHtmlOriginal) {
      logger.warn(`post sem conteúdo`, { postId });
      return [];
    }

    let imdbConfirmed = false;
    if (imdbId) {
      const imdbIdDoPost = contentHtmlOriginal.match(/imdb\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d+)/i)?.[1] || null;
      if (imdbIdDoPost) {
        const isCollection = isCollectionTitle(titleRendered, mediaType);
        if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
          return [];
        }
        if (!isCollection) {
          imdbConfirmed = true;
        }
      }
    }

    const $ = cheerio.load(contentHtmlOriginal);

    // Marca cada elemento com índice único — sem isso, dois <strong> idênticos teriam a mesma posição em indexOf.
    let counter = 0;
    $('*').each((_: number, el: any) => {
      $(el).attr(LYRA_MARK, String(counter++));
    });
    const html = $.html();
    logger.debug(`marcados=${counter} contentLen=${html.length}`);

    const infoBlock = this.extractInfoBlock($, html);
    const globalOriginalTitle = infoBlock.translatedTitle || infoBlock.originalTitle || undefined;
    const year = infoBlock.year;
    const years = infoBlock.years || (infoBlock.year ? [infoBlock.year] : undefined);

    logger.debug(`info`, {
      provider,
      postId,
      isCollection: isCollectionTitle(titleRendered, mediaType),
      originalTitle: globalOriginalTitle || '-',
      year: year ?? '-',
      years: years?.join(',') || '-',
      size: infoBlock.size || '-'
    });

    const secoes = this.findSections($, html);

    logger.debug(`seções do post ${postId}:`);
    for (const s of secoes) {
      const tag = s.season != null ? `S${s.season}` : 'range';
      logger.debug(`   ${s.tipo.padEnd(9)} ${tag.padEnd(6)} [${s.start}..${s.end}] "${s.textoHeading.substring(0, 70)}"`);
    }
    if (secoes.length === 0) logger.debug(`   (nenhuma)`);

    const temDual = secoes.some(s => s.tipo === 'DUAL');
    const temLegendado = secoes.some(s => s.tipo === 'LEGENDADO');
    if (!temDual && temLegendado) {
      logger.debug(`post apenas legendado descartado`, { postId });
      return [];
    }

    const secoesValidas = secoes.filter(s => s.tipo === 'DUAL');
    if (secoesValidas.length === 0) {
      const allMagnets = this.extractDirectMagnets($, html, []);
      logger.debug(`sem seções DUAL, processando todos`, { postId, magnets: allMagnets.length });

      const sampleSize = Math.min(3, allMagnets.length);
      for (let i = 0; i < sampleSize; i++) {
        const t = allMagnets[i].tree;
        logger.debug(
          `tree #${i + 1} | proprio="${t.proprio.substring(0, 30)}" | img="${t.imgAlt || '-'}" | ` +
          `contextoAcima="${t.contextoAcima.substring(0, 45)}"`
        );
      }

      const results = await this.processarMagnets(
        allMagnets, $, html, titleRendered, provider, type,
        globalOriginalTitle, year, years, mediaType
      );
      if (imdbConfirmed) for (const r of results) r.imdbConfirmed = true;
      return results;
    }

    const magnetsDual = this.extractDirectMagnets($, html, secoes);

    const sampleSize = Math.min(3, magnetsDual.length);
    for (let i = 0; i < sampleSize; i++) {
      const t = magnetsDual[i].tree;
      logger.debug(
        `tree #${i + 1} | proprio="${t.proprio.substring(0, 30)}" | img="${t.imgAlt || '-'}" | ` +
        `contextoAcima="${t.contextoAcima.substring(0, 45)}"`
      );
    }

    const results = await this.processarMagnets(
      magnetsDual, $, html, titleRendered, provider, type,
      globalOriginalTitle, year, years, mediaType
    );

    if (imdbConfirmed) for (const r of results) r.imdbConfirmed = true;
    return results;
  }

  async processarMagnets(
    magnets: ExtractedMagnet[],
    $: any,
    html: string,
    postTitle: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined,
    years: number[] | undefined,
    mediaType: TipoConteudo | undefined,
  ): Promise<TorrentResult[]> {
    const results: TorrentResult[] = [];
    const batchSize = 5;

    for (let i = 0; i < magnets.length; i += batchSize) {
      const batch = magnets.slice(i, i + batchSize);
      const batchPromises = batch.map(async (m: ExtractedMagnet) => {
        const el = $(`[${LYRA_MARK}]`).filter((_: number, e: any) => ($(e).attr('href') || '') === m.magnet).get(0);
        const parentText = el ? $(el).parent().text().trim() : '';
        const linkText = el ? $(el).text().trim() : '';
        const ctxLocal = el ? this.extrairContextoLocal($, el) : { altDaImg: null, textoIrmaoAnterior: null, tituloIrmaoAnterior: null };

        return this.processMagnetItem(
          m, parentText, linkText, ctxLocal,
          postTitle, html, provider, type, globalOriginalTitle, year, years,
          mediaType
        );
      });

      const batchResults = await Promise.all(batchPromises);
      for (const r of batchResults) {
        if (r) results.push(r);
      }
    }

    return results;
  }

  async processMagnetItem(
    m: ExtractedMagnet,
    parentText: string,
    linkText: string,
    ctxLocal: ContextoLocalMagnet,
    postTitle: string,
    html: string,
    provider: string,
    type: 'movie' | 'series',
    globalOriginalTitle: string | undefined,
    year: number | undefined,
    years?: number[],
    mediaType?: TipoConteudo,
  ): Promise<TorrentResult | null> {
    const dados = await this.analisarMagnetComCache(m.magnet, provider);
    const canonicalName = dados?.nome ?? null;
    const tree = m.tree;
    const secao = m.section;

    const { qualidade: quality, fonte: fonteQualidade } = this.resolverQualidade(
      tree, canonicalName, linkText, parentText, postTitle, html
    );

    if (!this.qualityDetector.isValidQuality(quality)) {
      logger.warn(`qualidade inválida`, { provider, quality, fonte: fonteQualidade });
      return null;
    }

    const sizeParent = this.extractSize(parentText);
    const sizePost = this.extractSize(postTitle);
    const size = sizeParent || sizePost;

    const language = this.extractLanguage(postTitle) || this.extractLanguage(parentText) || 'Desconhecido';
    const episode = this.extractEpisodeFromText(tree.proprio) ?? this.extractEpisodeFromText(parentText);
    const cleanedHtmlTitle = this.cleanHtmlTitle(parentText, linkText, quality);

    const isPostCollection = isCollectionTitle(postTitle, mediaType);

    let originalTitleFinal: string | undefined;
    let displayTitle: string;
    let fonteOriginal: 'html' | 'dn' | 'post' | 'heading' = 'post';

    if (isPostCollection) {
      const ctxOriginal = this.extractOriginalTitleFromContext(parentText);
      const tituloLocal = ctxLocal.tituloIrmaoAnterior;
      const rangeLocal = tituloLocal ? extrairRangeEpisodios(tituloLocal) : null;
      const localTemTemporada = !!(rangeLocal && rangeLocal.seasonStart > 0);

      if (tituloLocal && localTemTemporada) {
        originalTitleFinal = tituloLocal;
        fonteOriginal = 'html';
      } else if (secao?.textoHeading) {
        originalTitleFinal = secao.textoHeading;
        fonteOriginal = 'heading';
      } else if (tituloLocal) {
        originalTitleFinal = tituloLocal;
        fonteOriginal = 'html';
      } else if (canonicalName?.trim()) {
        originalTitleFinal = canonicalName.trim();
        fonteOriginal = 'dn';
      } else if (ctxOriginal) {
        originalTitleFinal = ctxOriginal;
        fonteOriginal = 'html';
      } else if (globalOriginalTitle) {
        originalTitleFinal = globalOriginalTitle;
        fonteOriginal = 'html';
      } else {
        const pt = this.extractTitleFromPostTitle(postTitle);
        if (pt) { originalTitleFinal = pt; fonteOriginal = 'post'; }
      }
      displayTitle = originalTitleFinal || postTitle;
    } else {
      const ctxOriginal = this.extractOriginalTitleFromContext(parentText);
      if (ctxOriginal) {
        originalTitleFinal = ctxOriginal;
        fonteOriginal = 'html';
      } else if (globalOriginalTitle) {
        originalTitleFinal = globalOriginalTitle;
        fonteOriginal = 'html';
      } else {
        const pt = this.extractTitleFromPostTitle(postTitle);
        if (pt) { originalTitleFinal = pt; fonteOriginal = 'post'; }
      }
      displayTitle = this.extractTitleFromPostTitle(postTitle) || canonicalName || postTitle;
    }

    const anosDoItem = originalTitleFinal ? extrairAno(originalTitleFinal) : undefined;
    const anosDoDnFallback = fonteOriginal !== 'dn' && canonicalName ? extrairAno(canonicalName) : undefined;

    const anosResolvidos =
      (anosDoItem && anosDoItem.length > 0) ? anosDoItem :
        (anosDoDnFallback && anosDoDnFallback.length > 0) ? anosDoDnFallback :
          undefined;

    const rangeDoItem = originalTitleFinal ? extrairRangeEpisodios(originalTitleFinal) : null;
    const itemTemTemporadaExplicita = !!(rangeDoItem && rangeDoItem.seasonStart > 0);
    const anoDoPostEhRuido = isPostCollection && itemTemTemporadaExplicita && !anosResolvidos;

    const yearFinal = anosResolvidos
      ? anosResolvidos[0]
      : (anoDoPostEhRuido ? undefined : year);

    const yearsFinal = anosResolvidos
      ?? (anoDoPostEhRuido ? undefined : (yearFinal !== undefined ? [yearFinal] : years));

    const canonicalFinal = canonicalName || this.sintetizarCanonicalName(
      originalTitleFinal || postTitle,
      yearsFinal,
      quality
    );

    const rangeFinal = originalTitleFinal ? extrairRangeEpisodios(originalTitleFinal) : null;
    const rangeStr = rangeFinal
      ? `S${rangeFinal.seasonStart}${rangeFinal.seasonEnd !== rangeFinal.seasonStart ? `-S${rangeFinal.seasonEnd}` : ''}${rangeFinal.episodeStart > 0 ? `E${rangeFinal.episodeStart}` : ''}`
      : 'null';

    logger.debug(
      `magnet | qual=${quality}(${fonteQualidade}) | ep=${episode ?? '-'} | fonte=${fonteOriginal} | range=${rangeStr} | ctx="${tree.contextoAcima.substring(0, 40)}"`
    );

    return {
      title: this.cleanTitle(displayTitle),
      htmlTitle: cleanedHtmlTitle || undefined,
      magnet: m.magnet,
      seeders: 0,
      leechers: 0,
      size,
      quality,
      provider,
      language,
      type,
      relevanceScore: 0.8,
      sizeInBytes: this.parseSize(size),
      season: undefined,
      episode,
      lastUpdated: new Date(),
      confidence: 0.85,
      originalTitle: originalTitleFinal ?? undefined,
      year: yearFinal,
      years: yearsFinal,
      canonicalName: canonicalFinal,
    };
  }

  limparTituloBase(titulo: string): string {
    return titulo
      .replace(/[*]+/g, '')
      .replace(/[?!,;:]+\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  sintetizarCanonicalName(base: string, years: number[] | undefined, quality: string): string {
    const baseLimpo = this.limparTituloBase(base);
    const anos = years && years.length > 0
      ? (years.length === 1 ? `${years[0]}` : `${years[0]}-${years[years.length - 1]}`)
      : null;
    return [baseLimpo, anos, quality].filter(Boolean).join(' ').trim();
  }

  extractTitleFromPostTitle(postTitle: string): string | null {
    if (!postTitle) return null;
    const limpo = postTitle
      .replace(/\bTorrent\b.*$/i, '')
      .replace(/\s+[–|-]\s+.*$/, '')
      .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-DL|DUAL|Dublado|Legendado)\b.*$/i, '')
      .trim();

    return limpo || null;
  }

  extractOriginalTitleFromContext(contextText: string): string | null {
    const match = contextText.match(/T[ií]tulo\s+Original:\s*([^\n]+)/i);
    if (!match?.[1]) return null;
    return this.limparTituloBase(match[1].trim()) || null;
  }

  extractInfoBlock($: any, html: string): InfoBlock {
    const articleText = $.root().text() || html;
    const titleText = articleText;

    const originalMatch = articleText.match(/T[ií]tulo\s+Original\s*:\s*([^\n]+)/i);
    const translatedMatch = articleText.match(/T[ií]tulo\s+Traduzido\s*:\s*([^\n]+)/i);

    const yearMatch = articleText.match(/Ano de Lançamento\s*:\s*([^\n]+)/i) || articleText.match(/Lançamento\s*:?\s*([^\n]+)/i);
    let years: number[] = [];
    if (yearMatch) {
      const rawYears = yearMatch[1].match(/\b(19|20)\d{2}\b/g) || [];
      years = rawYears.map((y: string) => parseInt(y));
    } else {
      const titleYears = titleText.match(/\b(19|20)\d{2}\b/g) || [];
      years = titleYears
        .map((y: string) => parseInt(y))
        .filter((y: number) => y >= 1950 && y <= 2030);
    }

    const sizeMatch = articleText.match(/Tamanho:\s*([^\n]+)/i);

    const originalLimpo = originalMatch?.[1]?.trim()
      ? this.limparTituloBase(originalMatch[1].trim())
      : undefined;
    const translatedLimpo = translatedMatch?.[1]?.trim()
      ? this.limparTituloBase(translatedMatch[1].trim())
      : undefined;
    const altImagem = ($('img[alt]').first().attr('alt') || '').trim();

    const originalTitle = this.escolherOriginalLatino(originalLimpo, translatedLimpo, altImagem);

    return {
      originalTitle,
      translatedTitle: translatedLimpo,
      year: years.length > 0 ? years[0] : undefined,
      years,
      size: sizeMatch?.[1]?.trim(),
    };
  }

  escolherOriginalLatino(
    original: string | undefined,
    translated: string | undefined,
    alt: string
  ): string | undefined {
    if (this.ehLatino(original)) return original;
    if (this.ehLatino(translated)) return translated;
    if (this.ehLatino(alt)) return alt;
    return original;
  }

  ehLatino(texto: string | undefined): boolean {
    if (!texto) return false;
    const letras = texto.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    return letras.length / Math.max(texto.length, 1) > 0.6;
  }

  async extractMagnetFromProtector(protectorUrl: string): Promise<string | null> {
    const maxAttempts = 2;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await axios.get(protectorUrl, {
          ...jsonAxiosConfig,
          timeout: 12000,
          maxRedirects: 5,
        });
        const html: string = res.data;
        const match = html.match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
        if (match) return match[1];
        const altMatch = html.match(/DEST_URL\s*=\s*"([^"]+)"/);
        if (altMatch) return altMatch[1];
      } catch (err: any) {
        if (attempt < maxAttempts - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        logger.warn(`protetor falhou`, { url: protectorUrl.substring(0, 50), error: err.message });
      }
    }
    return null;
  }

  extractCanonicalNameSync(magnet: string): string | null {
    const dnMatch = magnet.match(/[&?]dn=([^&]+)/i);
    if (dnMatch) {
      try {
        return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
      } catch {
        return dnMatch[1];
      }
    }
    return null;
  }

  extrairTamanhoNumerico(text: string): TamanhoNumerico | null {
    if (!text) return null;
    const m = text.match(/([\d,.]+)\s*(GB|MB|KB)/i);
    if (!m) return null;
    const valor = parseFloat(m[1].replace(',', '.'));
    if (!Number.isFinite(valor) || valor <= 0) return null;
    const unidade = m[2].toUpperCase() as 'GB' | 'MB' | 'KB';
    return { valor, unidade };
  }

  extractSize(text: string): string {
    const t = this.extrairTamanhoNumerico(text);
    if (!t || t.unidade === 'KB') return 'Desconhecido';
    return `${t.valor} ${t.unidade}`;
  }

  parseSize(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'Desconhecido' || sizeStr === '–') return 0;
    const t = this.extrairTamanhoNumerico(sizeStr);
    if (!t) return 0;
    const multiplicador = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[t.unidade];
    return Math.round(t.valor * multiplicador);
  }

  extractLanguage(title: string): string {
    if (!title) return 'Desconhecido';
    const f = this.classificarTextoIdioma(title);
    if (f.temDual) return 'Dual';
    if (f.temDublado) return 'Dublado';
    if (f.temNacional) return 'Nacional';
    if (f.temLegendado || f.temLegendaSubstantivo) return 'Legendado';
    return 'Desconhecido';
  }

  cleanTitle(title: string): string {
    return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  async analisarMagnetComCache(magnet: string, provider: string): Promise<MagnetCacheEntry | null> {
    const cached = this.magnetCache.get<MagnetCacheEntry>(magnet);
    if (cached) return cached;

    try {
      const dados = await analisarMagnet(magnet);
      if (dados) {
        const entry: MagnetCacheEntry = { nome: dados.nome, infoHash: dados.infoHash };
        this.magnetCache.set(magnet, entry, this.MAGNET_CACHE_TTL);
        return entry;
      }
    } catch (err: any) {
      logger.warn(`magnet análise falhou`, { provider, error: err.message });
    }
    return null;
  }

  extractEpisodeFromText(text: string): number | undefined {
    if (!text) return undefined;
    const range = extrairRangeEpisodios(text);
    return range?.episodeStart || undefined;
  }
}