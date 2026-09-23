// TmdbHtmlScraper — Fallback que busca dados do TMDB via HTML scraping
// quando a API key não funciona. Busca em pt-BR e en.
import axios from 'axios';
import * as cheerio from 'cheerio';
import dns from 'dns';
import https from 'https';
import tls from 'tls';
import { Logger } from '../utils/logger.js';
import { ImdbTitles } from './ImdbScraperService.js';

const logger = new Logger('TmdbHtmlScraper');

// DNS bypass (mesmo dos outros scrapers)
dns.setServers(['8.8.8.8', '1.1.1.1']);
class DnsAgent extends https.Agent {
  createConnection(options: any, cb: any): any {
    const hostname = options.hostname || options.host || '';
    dns.resolve4(hostname, (err, addresses) => {
      if (err) return cb(err);
      const sock = tls.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false }, () => cb(null, sock));
      sock.on('error', cb);
    });
    return undefined;
  }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const dnsLookup = (hostname: string, _opts: any, cb: any) => {
  dns.resolve4(hostname, (err, addresses) => {
    if (err) return cb(err);
    cb(null, addresses[0], 4);
  });
};

const axiosConfig = {
  timeout: 15000,
  httpsAgent: dnsAgent,
  lookup: dnsLookup,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html',
    'Accept-Language': 'pt-BR,pt;q=0.9',
  },
};

const axiosConfigEn = {
  ...axiosConfig,
  headers: { ...axiosConfig.headers, 'Accept-Language': 'en-US,en;q=0.9' },
};

// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function retryAxios<T>(fn: () => Promise<T>, maxRetries: number, delayMs: number): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastErr;
}

// ═══════════════════════════════════════════════════════════════════════
//  FALLBACK: TMDB /find/{imdb_id}
// ═══════════════════════════════════════════════════════════════════════

async function getTmdbViaFindEndpoint(imdbId: string): Promise<ImdbTitles | null> {
  try {
    const apiKey = process.env.TMDB_API_KEY;
    if (apiKey) {
      const resp = await axios.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
        params: { api_key: apiKey, external_source: 'imdb_id', language: 'pt-BR' },
        timeout: 10000,
        headers: { 'User-Agent': 'BrasilRD/1.0' },
      });
      const results = resp.data;
      const movie = results?.movie_results?.[0];
      const tv = results?.tv_results?.[0];
      const item = movie || tv;
      if (item) {
        const mediaType = movie ? 'movie' as const : 'tv' as const;
        const url = `https://www.themoviedb.org/${mediaType}/${item.id}?language=pt-BR`;
        const meta = await scrapeTmdbPage(url);
        if (meta) {
          const allTitles = [normalizeTitle(meta.originalTitle)];
          if (meta.portugueseTitle) {
            const normPt = normalizeTitle(meta.portugueseTitle);
            if (!allTitles.includes(normPt)) allTitles.push(normPt);
          }
          return {
            originalTitle: meta.originalTitle,
            portugueseTitle: meta.portugueseTitle,
            portugueseTitleRaw: meta.portugueseTitleRaw,
            allTitles,
            foundInPortuguese: !!meta.portugueseTitle,
            year: meta.year,
            mediaType,
            portuguesePriority: !!meta.portugueseTitle,
          };
        }
      }
    }
  } catch { /* fallback silencioso */ }

  try {
    for (const type of ['movie', 'tv']) {
      const url = `https://www.themoviedb.org/${type}/${imdbId}?language=pt-BR`;
      const meta = await scrapeTmdbPage(url);
      if (meta) {
        const allTitles = [normalizeTitle(meta.originalTitle)];
        if (meta.portugueseTitle) {
          const normPt = normalizeTitle(meta.portugueseTitle);
          if (!allTitles.includes(normPt)) allTitles.push(normPt);
        }
        return {
          originalTitle: meta.originalTitle,
          portugueseTitle: meta.portugueseTitle,
          portugueseTitleRaw: meta.portugueseTitleRaw,
          allTitles,
          foundInPortuguese: !!meta.portugueseTitle,
          year: meta.year,
          mediaType: type as 'movie' | 'tv',
          portuguesePriority: !!meta.portugueseTitle,
        };
      }
    }
  } catch { /* fallback silencioso */ }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 1: Pega título via Cinemeta (substitui OMDB)
// ═══════════════════════════════════════════════════════════════════════

async function getCinemetaTitle(imdbId: string): Promise<{ title: string; year?: number; type?: 'tv' | 'movie' } | null> {
  for (const tipo of ['series', 'movie'] as const) {
    try {
      const url = `https://v3-cinemeta.strem.io/meta/${tipo}/${imdbId}.json`;
      const res = await retryAxios(() => axios.get(url, {
        timeout: 10000,
        headers: { 'User-Agent': 'BrasilRD/1.0' },
      }), 3, 1000);

      const meta = res.data?.meta;
      if (!meta?.name) continue;

      const title = meta.name as string;
      const yearStr = String(meta.year ?? '').trim();

      // Só aceita year se for 4 dígitos puros.
      // Ranges como "1995–2003" ficam undefined pra não rejeitarem
      // o ano correto no filtro do PASSO 3.
      const year = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : undefined;

      const type: 'tv' | 'movie' = tipo === 'series' ? 'tv' : 'movie';

      logger.debug(`Cinemeta: "${title}" (${yearStr || '?'}) [${type}]`);
      return { title, year, type };
    } catch {
      // tenta o próximo tipo
    }
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: AdoroCinema — fonte PT-BR nativa
//  O AdoroCinema ofusca os hrefs em base64 dentro da classe CSS.
//  Decodifica e faz exact match por título + tipo.
// ═══════════════════════════════════════════════════════════════════════

interface AdoroCard {
  title: string;
  href: string;
  mediaType: 'movie' | 'tv';
  year?: number;
}

// Decodifica classe ofuscada do AdoroCinema: "ACrL3Nlcmllcy9zZXJpZS0zNDU5Lw=="
// → remove "ACr" → "/series/serie-3459/"
function decodeAdoroClass(cls: string | undefined): string | null {
  if (!cls) return null;
  const cleaned = cls.replace(/ACr/g, '');
  try {
    const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
    const m = decoded.match(/^\/(series\/serie-\d+|filmes\/filme-\d+)\//);
    return m ? `/${m[1]}/` : null;
  } catch {
    return null;
  }
}

// O AdoroCinema resolve o match sozinho: o ?q= dele cruza títulos PT e EN
// (buscar "Ice Age: The Meltdown" devolve "A Era do Gelo 2").
// Se retornou card, é o título certo — não precisa de exact match nem tipo.
async function searchAdoroCinema(title: string): Promise<AdoroCard | null> {
  try {
    const url = `https://www.adorocinema.com/pesquisar/?q=${encodeURIComponent(title)}`;
    const res = await axios.get(url, axiosConfig);
    const $ = cheerio.load(res.data);

    const cards: AdoroCard[] = [];
    $('.card.entity-card').each((_i, el) => {
      const t = $(el).find('.meta-title-link').text().trim();
      const cls = $(el).find('.meta-title-link').attr('class')
        || $(el).find('.thumbnail-container').attr('class')
        || '';
      const href = decodeAdoroClass(cls);
      if (!t || !href) return;

      const mediaType: 'movie' | 'tv' = href.includes('/series/') ? 'tv' : 'movie';
      const yearText = $(el).find('.meta-body-info').text().replace(/\s+/g, ' ').trim();
      const ym = yearText.match(/(\d{4})/);

      cards.push({
        title: t,
        href,
        mediaType,
        year: ym ? parseInt(ym[1], 10) : undefined,
      });
    });

    if (cards.length === 0) {
      logger.debug(`AdoroCinema: 0 cards para "${title}"`);
      return null;
    }

    logger.debug(`AdoroCinema: "${title}" → "${cards[0].title}" (${cards[0].year ?? '?'}) ${cards[0].href}`);
    return cards[0];
  } catch (err: any) {
    logger.warn(`AdoroCinema search falhou para "${title}": ${err.message}`);
    return null;
  }
}
async function scrapeAdoroPage(href: string): Promise<{
  titlePt: string;
  originalTitle: string | null;
  year?: number;
  mediaType: 'movie' | 'tv';
} | null> {
  try {
    const url = `https://www.adorocinema.com${href}`;
    const res = await axios.get(url, axiosConfig);
    const $ = cheerio.load(res.data);

    const titlePt = $('h1').first().text().trim();
    if (!titlePt) return null;

    // Título original — estrutura muda entre filme e série.
    // Série: .meta-body-original-title strong
    // Filme: .meta-body-item com .light contendo "Título original", strong dentro
    let originalTitle = $('.meta-body-original-title strong').text().trim() || null;
    if (!originalTitle) {
      const origWrap = $('.meta-body-item')
        .filter((_i, el) => $(el).find('.light').text().includes('Título original'))
        .first();
      originalTitle = origWrap.find('strong').text().trim() || null;
    }

    const metaInfo = $('.meta-body-info').text().replace(/\s+/g, ' ').trim();
    const year = parseInt(metaInfo.match(/(\d{4})/)?.[1] ?? '', 10) || undefined;

    const mediaType: 'movie' | 'tv' = href.includes('/series/') ? 'tv' : 'movie';

    return { titlePt, originalTitle, year, mediaType };
  } catch (err: any) {
    logger.warn(`AdoroCinema scrape falhou para ${href}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 3: Busca o título no TMDB via search HTML (fallback)
// ═══════════════════════════════════════════════════════════════════════

interface TmdbSearchResult {
  tmdbUrl: string;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
}

async function searchTmdbHtmlAll(query: string): Promise<TmdbSearchResult[]> {
  try {
    const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`;
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: TmdbSearchResult[] = [];

    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const movieMatch = href.match(/^\/(movie)\/(\d+)/);
      const tvMatch = href.match(/^\/(tv)\/(\d+)/);
      const match = movieMatch || tvMatch;
      if (!match) return;

      const mediaType = match[1] as 'movie' | 'tv';
      const fullUrl = `https://www.themoviedb.org${href}`;

      const card = $(el).closest('div, section, article');
      const titleEl = card.find('h2, .title, [class*="title"]').first();
      const title = titleEl.text().trim() || $(el).text().trim();

      if (title && title.length > 2) {
        const yearMatch = title.match(/\((\d{4})\)/);
        results.push({
          tmdbUrl: fullUrl,
          mediaType,
          title: title.replace(/\s*\(\d{4}\)\s*/, '').trim(),
          year: yearMatch ? parseInt(yearMatch[1]) : undefined,
        });
      }
    });

    const seen = new Set<string>();
    return results.filter(r => {
      if (seen.has(r.tmdbUrl)) return false;
      seen.add(r.tmdbUrl);
      return true;
    });
  } catch (err: any) {
    logger.warn(`TMDB search HTML falhou para "${query}": ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 3b: Extrai metadados da página do TMDB (pt-BR + en)
// ═══════════════════════════════════════════════════════════════════════

async function scrapeTmdbPage(tmdbUrl: string): Promise<{
  originalTitle: string;
  portugueseTitle: string | null;
  portugueseTitleRaw: string | null;
  year?: number;
} | null> {
  try {
    const urlPt = tmdbUrl.includes('?') ? `${tmdbUrl}&language=pt-BR` : `${tmdbUrl}?language=pt-BR`;
    const urlEn = tmdbUrl.includes('?') ? `${tmdbUrl}&language=en-US` : `${tmdbUrl}?language=en-US`;
    const [resPt, resEn] = await Promise.all([
      axios.get(urlPt, axiosConfig),
      axios.get(urlEn, axiosConfigEn).catch(() => null),
    ]);

    const $pt = cheerio.load(resPt.data);
    const $en = resEn ? cheerio.load(resEn.data) : null;

    const ptH2 = $pt('h2').first().text().trim().replace(/\s+/g, ' ');
    const yearMatch = ptH2.match(/\(\s*(\d{4})\s*\)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : undefined;
    const ptTitle = ptH2.replace(/\s*\(\s*\d{4}\s*\)\s*/, '').trim();

    let originalTitle = ptTitle;
    if ($en) {
      const enH2 = $en('h2').first().text().trim().replace(/\s+/g, ' ');
      const enTitle = enH2.replace(/\s*\(\s*\d{4}\s*\)\s*/, '').trim();
      if (enTitle && enTitle !== ptTitle) originalTitle = enTitle;
    }

    const isDifferent = normalizeTitle(ptTitle) !== normalizeTitle(originalTitle);

    logger.debug(`TMDB HTML: PT="${ptTitle}" | ORIG="${originalTitle}" | year=${year} | diff=${isDifferent}`);

    return {
      originalTitle,
      portugueseTitle: isDifferent ? ptTitle : null,
      portugueseTitleRaw: isDifferent ? ptTitle : null,
      year,
    };
  } catch (err: any) {
    logger.warn(`TMDB page scrape falhou para ${tmdbUrl}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  API PÚBLICA — mesmo contrato do ImdbScraperService.getTitlesFromImdbId
// ═══════════════════════════════════════════════════════════════════════

export async function getTmdbTitlesViaHtml(imdbId: string): Promise<ImdbTitles | null> {
  const startTime = Date.now();

  try {
    // PASSO 1: Pega título via Cinemeta
    const imdbData = await getCinemetaTitle(imdbId);
    if (!imdbData) {
      logger.warn(`TmdbHtmlScraper: Cinemeta falhou, tentando TMDB find direto para ${imdbId}`);
      const directResult = await getTmdbViaFindEndpoint(imdbId);
      if (directResult) {
        const duration = Date.now() - startTime;
        logger.info(`TmdbHtmlScraper: "${directResult.originalTitle}" [${directResult.mediaType}] em ${duration}ms (via find)`);
        return directResult;
      }
      logger.warn(`TmdbHtmlScraper: Cinemeta falhou para ${imdbId}`);
      return null;
    }

    // ═══ PASSO 2: AdoroCinema (fonte PT-BR nativa, prioritária) ═══
    logger.debug(`AdoroCinema: buscando "${imdbData.title}" [${imdbData.type ?? '?'}]`);
    const adoroCard = await searchAdoroCinema(imdbData.title);
    if (adoroCard) {
      const adoroPage = await scrapeAdoroPage(adoroCard.href);
      if (adoroPage) {
        const allTitles = [normalizeTitle(adoroPage.titlePt)];
        if (adoroPage.originalTitle) {
          const normOrig = normalizeTitle(adoroPage.originalTitle);
          if (!allTitles.includes(normOrig)) allTitles.push(normOrig);
        }

        const result: ImdbTitles = {
          originalTitle: adoroPage.originalTitle
            ? normalizeTitle(adoroPage.originalTitle)
            : normalizeTitle(adoroPage.titlePt),
          portugueseTitle: normalizeTitle(adoroPage.titlePt),
          portugueseTitleRaw: adoroPage.titlePt,
          allTitles,
          foundInPortuguese: true,
          year: adoroPage.year,
          mediaType: adoroPage.mediaType,
          portuguesePriority: true,
        };

        const duration = Date.now() - startTime;
        logger.info(`TmdbHtmlScraper: "${adoroPage.titlePt}" [${adoroPage.mediaType}] (${adoroPage.year ?? '?'}) via AdoroCinema em ${duration}ms`);
        return result;
      }
      logger.debug(`AdoroCinema: página ${adoroCard.href} não raspou, caindo pro TMDB HTML`);
    } else {
      logger.debug(`AdoroCinema: sem match exato para "${imdbData.title}", caindo pro TMDB HTML`);
    }

    // ═══ PASSO 3: TMDB search HTML (fallback original) ═══
    const searchResults = await searchTmdbHtmlAll(imdbData.title);
    if (searchResults.length === 0) {
      logger.warn(`TmdbHtmlScraper: TMDB search sem resultados para "${imdbData.title}"`);
      return null;
    }

    let bestResult: TmdbSearchResult | null = null;
    let bestMetadata: any = null;
    for (const r of searchResults) {
      if (imdbData.type && r.mediaType !== imdbData.type) continue;

      const meta = await scrapeTmdbPage(r.tmdbUrl);
      if (!meta) continue;

      if (imdbData.year && meta.year && Math.abs(imdbData.year - meta.year) > 2) {
        logger.debug(`TmdbHtmlScraper: pulando "${meta.originalTitle}" (${meta.year}) — ano diverge do Cinemeta (${imdbData.year})`);
        continue;
      }

      bestResult = r;
      bestMetadata = meta;
      break;
    }

    if (!bestResult || !bestMetadata) {
      const fallback = searchResults[0];
      bestResult = fallback;
      bestMetadata = await scrapeTmdbPage(fallback.tmdbUrl);
      if (!bestMetadata) {
        logger.warn(`TmdbHtmlScraper: TMDB page scrape falhou`);
        return null;
      }
    }

    const metadata = bestMetadata;
    const tmdbResult = bestResult;
    const finalYear = imdbData.year || metadata.year;

    const allTitles = [normalizeTitle(metadata.originalTitle)];
    if (metadata.portugueseTitle) {
      const normPt = normalizeTitle(metadata.portugueseTitle);
      if (!allTitles.includes(normPt)) allTitles.push(normPt);
    }

    const duration = Date.now() - startTime;
    logger.info(`TmdbHtmlScraper: "${metadata.originalTitle}" [${tmdbResult.mediaType}] em ${duration}ms`);

    return {
      originalTitle: metadata.originalTitle,
      portugueseTitle: metadata.portugueseTitle,
      portugueseTitleRaw: metadata.portugueseTitleRaw,
      allTitles,
      foundInPortuguese: !!metadata.portugueseTitle,
      year: finalYear,
      mediaType: tmdbResult.mediaType,
      portuguesePriority: !!metadata.portugueseTitle,
    };
  } catch (err: any) {
    logger.error(`TmdbHtmlScraper erro geral para ${imdbId}: ${err.message}`);
    return null;
  }
}