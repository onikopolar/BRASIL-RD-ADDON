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
//  PASSO 1: Pega título via OMDB API (gratuita, sem key obrigatória)
// ═══════════════════════════════════════════════════════════════════════

async function getOmdbTitle(imdbId: string): Promise<{ title: string; year?: number } | null> {
  try {
    const url = `http://www.omdbapi.com/?i=${imdbId}&apikey=trilogy`;
    const res = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'BrasilRD/1.0' },
    });
    const data = res.data;
    if (!data || data.Response === 'False' || !data.Title) {
      logger.warn(`OMDB: sem resultados para ${imdbId}`);
      return null;
    }
    const title = data.Title;
    const year = data.Year ? parseInt(data.Year) : undefined;
    logger.debug(`OMDB: "${title}" (${year || '?'})`);
    return { title, year };
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

async function searchTmdbHtml(query: string, year?: number): Promise<TmdbSearchResult | null> {
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

    if (unique.length === 0) return null;

    // Se tem year, tenta casar
    if (year) {
      const yearMatch = unique.find(r => r.year === year);
      if (yearMatch) return yearMatch;
    }

    // Pega o primeiro resultado
    return unique[0];
  } catch (err: any) {
    logger.warn(`TMDB search HTML falhou para "${query}": ${err.message}`);
    return null;
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
    // Busca páginas em pt-BR e en EM PARALELO
    const [resPt, resEn] = await Promise.all([
      axios.get(tmdbUrl, axiosConfig),
      axios.get(tmdbUrl, axiosConfigEn).catch(() => null),
    ]);

    const $pt = cheerio.load(resPt.data);

    // Extrai título da página pt-BR
    const ptTitleRaw = $pt('title').text()
      .replace(/\s*—\s*The Movie Database.*$/i, '')
      .replace(/\s*\(\d{4}\)\s*$/, '')
      .trim();
    const yearMatch = $pt('title').text().match(/\((\d{4})\)/);
    const year = yearMatch ? parseInt(yearMatch[1]) : undefined;

    // Título original: da página EN (fallback: mesmo que PT)
    let originalTitle = ptTitleRaw;
    if (resEn) {
      const $en = cheerio.load(resEn.data);
      const enTitleRaw = $en('title').text()
        .replace(/\s*—\s*The Movie Database.*$/i, '')
        .replace(/\s*\(\d{4}\)\s*$/, '')
        .trim();
      if (enTitleRaw && enTitleRaw !== ptTitleRaw) {
        originalTitle = enTitleRaw;
      }
    }

    // Verifica se PT ≠ original
    const normalize = (t: string) =>
      t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

    const normPt = normalize(ptTitleRaw);
    const normOrig = normalize(originalTitle);
    const isDifferent = normPt !== normOrig;

    logger.debug(`TMDB HTML: PT="${ptTitleRaw}" | ORIG="${originalTitle}" | year=${year} | diff=${isDifferent}`);

    return {
      originalTitle,
      portugueseTitle: isDifferent ? ptTitleRaw : null,
      portugueseTitleRaw: isDifferent ? ptTitleRaw : null,
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
      logger.warn(`TmdbHtmlScraper: OMDB falhou para ${imdbId}`);
      return null;
    }

    // PASSO 2: Busca no TMDB via search HTML
    const tmdbResult = await searchTmdbHtml(imdbData.title, imdbData.year);
    if (!tmdbResult) {
      logger.warn(`TmdbHtmlScraper: TMDB search sem resultados para "${imdbData.title}"`);
      return null;
    }

    // PASSO 3: Extrai metadados da página do TMDB
    const metadata = await scrapeTmdbPage(tmdbResult.tmdbUrl);
    if (!metadata) {
      logger.warn(`TmdbHtmlScraper: TMDB page scrape falhou`);
      return null;
    }

    // OMDB é a fonte mais confiável para o ano
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
