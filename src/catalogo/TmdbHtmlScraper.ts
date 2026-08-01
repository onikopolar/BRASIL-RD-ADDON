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
//  FALLBACK: TMDB /find/{imdb_id} — converte IMDB ID direto sem OMDB
// ═══════════════════════════════════════════════════════════════════════

async function getTmdbViaFindEndpoint(imdbId: string): Promise<ImdbTitles | null> {
  try {
    // Tenta TMDB API find endpoint (sem key = fallback pra HTML)
    const apiKey = process.env.TMDB_API_KEY;
    if (apiKey) {
      const axios = (await import('axios')).default;
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
          const normalized = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
          const allTitles = [normalized(meta.originalTitle)];
          if (meta.portugueseTitle) {
            const normPt = normalized(meta.portugueseTitle);
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
  
  // Fallback HTML: tenta /movie/{imdbId} ou /tv/{imdbId}
  try {
    for (const type of ['movie', 'tv']) {
      const url = `https://www.themoviedb.org/${type}/${imdbId}?language=pt-BR`;
      const meta = await scrapeTmdbPage(url);
      if (meta) {
        const normalized = (t: string) => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const allTitles = [normalized(meta.originalTitle)];
        if (meta.portugueseTitle) {
          const normPt = normalized(meta.portugueseTitle);
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
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

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
//  PASSO 1: Pega título via OMDB API (gratuita, sem key obrigatória)
// ═══════════════════════════════════════════════════════════════════════

async function getOmdbTitle(imdbId: string): Promise<{ title: string; year?: number; type?: 'tv' | 'movie' } | null> {
  try {
    const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=${process.env.OMDB_API_KEY || 'trilogy'}`;
    const res = await retryAxios(() => axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'BrasilRD/1.0' },
    }), 3, 1000);
    const data = res.data;
    if (!data || data.Response === 'False' || !data.Title) {
      logger.warn(`OMDB: sem resultados para ${imdbId}`);
      return null;
    }
    const title = data.Title;
    const year = data.Year ? parseInt(data.Year) : undefined;
    const type = data.Type === 'series' ? 'tv' as const : data.Type === 'movie' ? 'movie' as const : undefined;
    logger.debug(`OMDB: "${title}" (${year || '?'}) [${type || '?'}]`);
    return { title, year, type };
  } catch (err: any) {
    logger.warn(`OMDB falhou para ${imdbId}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 2: Busca o título no TMDB via search HTML
// ═══════════════════════════════════════════════════════════════════════

interface TmdbSearchResult {
  tmdbUrl: string;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
}

async function searchTmdbHtml(query: string, year?: number, preferType?: 'tv' | 'movie'): Promise<TmdbSearchResult | null> {
  const all = await searchTmdbHtmlAll(query);
  if (all.length === 0) return null;

  if (preferType && year) {
    const best = all.find(r => r.mediaType === preferType && r.year === year);
    if (best) return best;
  }
  if (preferType) {
    const typeMatch = all.find(r => r.mediaType === preferType);
    if (typeMatch) return typeMatch;
  }
  if (year) {
    const yearMatch = all.find(r => r.year === year);
    if (yearMatch) return yearMatch;
  }
  return all[0];
}

/** Retorna TODOS os resultados da busca TMDB (sem filtrar) */
async function searchTmdbHtmlAll(query: string): Promise<TmdbSearchResult[]> {
  try {
    const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`;
    const res = await axios.get(searchUrl, axiosConfig);
    const $ = cheerio.load(res.data);

    const results: TmdbSearchResult[] = [];

    // Pega cards de resultado — links para /movie/ ou /tv/
    $('a[href]').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const movieMatch = href.match(/^\/(movie)\/(\d+)/);
      const tvMatch = href.match(/^\/(tv)\/(\d+)/);
      const match = movieMatch || tvMatch;
      if (!match) return;

      const mediaType = match[1] as 'movie' | 'tv';
      const fullUrl = `https://www.themoviedb.org${href}`;

      // Pega o título do card (elemento h2 ou p próximo)
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

    // Dedup por URL
    const seen = new Set<string>();
    const unique = results.filter(r => {
      if (seen.has(r.tmdbUrl)) return false;
      seen.add(r.tmdbUrl);
      return true;
    });

    return unique;
  } catch (err: any) {
    logger.warn(`TMDB search HTML falhou para "${query}": ${err.message}`);
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  PASSO 3: Extrai metadados da página do TMDB (pt-BR + en)
// ═══════════════════════════════════════════════════════════════════════

async function scrapeTmdbPage(tmdbUrl: string): Promise<{
  originalTitle: string;
  portugueseTitle: string | null;
  portugueseTitleRaw: string | null;
  year?: number;
} | null> {
  try {
    // Busca páginas em pt-BR e EN EM PARALELO (força language=pt-BR na URL)
    const urlPt = tmdbUrl.includes('?') ? `${tmdbUrl}&language=pt-BR` : `${tmdbUrl}?language=pt-BR`;
    const urlEn = tmdbUrl.includes('?') ? `${tmdbUrl}&language=en-US` : `${tmdbUrl}?language=en-US`;
    const [resPt, resEn] = await Promise.all([
      axios.get(urlPt, axiosConfig),
      axios.get(urlEn, axiosConfigEn).catch(() => null),
    ]);

    const $pt = cheerio.load(resPt.data);
    const $en = resEn ? cheerio.load(resEn.data) : null;

    // ═══ H2 é a fonte mais confiável: "Avatar: A Lenda de Aang (2005)" ═══
    const ptH2 = $pt('h2').first().text().trim().replace(/\s+/g, ' ');
    const yearMatch = ptH2.match(/\(\s*(\d{4})\s*\)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : undefined;
    const ptTitle = ptH2.replace(/\s*\(\s*\d{4}\s*\)\s*/, '').trim();
    
    // Título original: H2 da página EN
    let originalTitle = ptTitle;
    if ($en) {
      const enH2 = $en('h2').first().text().trim().replace(/\s+/g, ' ');
      const enTitle = enH2.replace(/\s*\(\s*\d{4}\s*\)\s*/, '').trim();
      if (enTitle && enTitle !== ptTitle) originalTitle = enTitle;
    }
    const normalize = (t: string) =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const isDifferent = normalize(ptTitle) !== normalize(originalTitle);

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
    // PASSO 1: Pega título via OMDB
    const imdbData = await getOmdbTitle(imdbId);
    if (!imdbData) {
      // Fallback: tenta TMDB /find/{imdb_id} direto (sem precisar do título)
      logger.warn(`TmdbHtmlScraper: OMDB falhou, tentando TMDB find direto para ${imdbId}`);
      const directResult = await getTmdbViaFindEndpoint(imdbId);
      if (directResult) {
        const duration = Date.now() - startTime;
        logger.info(`TmdbHtmlScraper: "${directResult.originalTitle}" [${directResult.mediaType}] em ${duration}ms (via find)`);
        return directResult;
      }
      logger.warn(`TmdbHtmlScraper: OMDB falhou para ${imdbId}`);
      return null;
    }

    // PASSO 2: Busca no TMDB via search HTML — itera resultados até achar um compatível com OMDB
    const searchResults = await searchTmdbHtmlAll(imdbData.title);
    if (searchResults.length === 0) {
      logger.warn(`TmdbHtmlScraper: TMDB search sem resultados para "${imdbData.title}"`);
      return null;
    }

    // Tenta cada resultado do TMDB até achar um compatível com OMDB (tipo + ano)
    let bestResult: TmdbSearchResult | null = null;
    let bestMetadata: any = null;
    for (const r of searchResults) {
      // Filtra por tipo se OMDB informou
      if (imdbData.type && r.mediaType !== imdbData.type) continue;

      const meta = await scrapeTmdbPage(r.tmdbUrl);
      if (!meta) continue;

      // Valida ano: se OMDB tem ano e TMDB tem ano diferente (>2 anos), é resultado errado
      if (imdbData.year && meta.year && Math.abs(imdbData.year - meta.year) > 2) {
        logger.debug(`TmdbHtmlScraper: pulando "${meta.originalTitle}" (${meta.year}) — ano diverge do OMDB (${imdbData.year})`);
        continue;
      }

      bestResult = r;
      bestMetadata = meta;
      break;
    }

    if (!bestResult || !bestMetadata) {
      // Fallback: usa o primeiro resultado como antes
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

    // O ano é enviado para o similarity calculator (Condition C) validar.
    // Tolerância de 15 anos para TV cobre séries longas (ex: Rick and Morty 2013-2023)
    // e rejeita adaptações diferentes com mesmo nome (ex: Avatar 2005 vs 2024).
    const finalYear = imdbData.year || metadata.year;

    // Se TMDB achou um filme de ano diferente, usa o título do TMDB mas ano do OMDB
    const normalized = (t: string) =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const allTitles = [normalized(metadata.originalTitle)];
    if (metadata.portugueseTitle) {
      const normPt = normalized(metadata.portugueseTitle);
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
