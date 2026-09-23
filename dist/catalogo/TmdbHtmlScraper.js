"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTmdbTitlesViaHtml = getTmdbTitlesViaHtml;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const dns_1 = __importDefault(require("dns"));
const https_1 = __importDefault(require("https"));
const tls_1 = __importDefault(require("tls"));
const logger_js_1 = require("../utils/logger.js");
const logger = new logger_js_1.Logger('TmdbHtmlScraper');
dns_1.default.setServers(['8.8.8.8', '1.1.1.1']);
class DnsAgent extends https_1.default.Agent {
    createConnection(options, cb) {
        const hostname = options.hostname || options.host || '';
        dns_1.default.resolve4(hostname, (err, addresses) => {
            if (err)
                return cb(err);
            const sock = tls_1.default.connect({ host: addresses[0], port: options.port || 443, servername: hostname, rejectUnauthorized: false }, () => cb(null, sock));
            sock.on('error', cb);
        });
        return undefined;
    }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const dnsLookup = (hostname, _opts, cb) => {
    dns_1.default.resolve4(hostname, (err, addresses) => {
        if (err)
            return cb(err);
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
function normalizeTitle(t) {
    return t
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
async function retryAxios(fn, maxRetries, delayMs) {
    let lastErr;
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        }
        catch (err) {
            lastErr = err;
            if (i < maxRetries - 1) {
                await new Promise(r => setTimeout(r, delayMs * (i + 1)));
            }
        }
    }
    throw lastErr;
}
async function getTmdbViaFindEndpoint(imdbId) {
    try {
        const apiKey = process.env.TMDB_API_KEY;
        if (apiKey) {
            const resp = await axios_1.default.get(`https://api.themoviedb.org/3/find/${imdbId}`, {
                params: { api_key: apiKey, external_source: 'imdb_id', language: 'pt-BR' },
                timeout: 10000,
                headers: { 'User-Agent': 'BrasilRD/1.0' },
            });
            const results = resp.data;
            const movie = results?.movie_results?.[0];
            const tv = results?.tv_results?.[0];
            const item = movie || tv;
            if (item) {
                const mediaType = movie ? 'movie' : 'tv';
                const url = `https://www.themoviedb.org/${mediaType}/${item.id}?language=pt-BR`;
                const meta = await scrapeTmdbPage(url);
                if (meta) {
                    const allTitles = [normalizeTitle(meta.originalTitle)];
                    if (meta.portugueseTitle) {
                        const normPt = normalizeTitle(meta.portugueseTitle);
                        if (!allTitles.includes(normPt))
                            allTitles.push(normPt);
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
    }
    catch { }
    try {
        for (const type of ['movie', 'tv']) {
            const url = `https://www.themoviedb.org/${type}/${imdbId}?language=pt-BR`;
            const meta = await scrapeTmdbPage(url);
            if (meta) {
                const allTitles = [normalizeTitle(meta.originalTitle)];
                if (meta.portugueseTitle) {
                    const normPt = normalizeTitle(meta.portugueseTitle);
                    if (!allTitles.includes(normPt))
                        allTitles.push(normPt);
                }
                return {
                    originalTitle: meta.originalTitle,
                    portugueseTitle: meta.portugueseTitle,
                    portugueseTitleRaw: meta.portugueseTitleRaw,
                    allTitles,
                    foundInPortuguese: !!meta.portugueseTitle,
                    year: meta.year,
                    mediaType: type,
                    portuguesePriority: !!meta.portugueseTitle,
                };
            }
        }
    }
    catch { }
    return null;
}
async function getCinemetaTitle(imdbId) {
    for (const tipo of ['series', 'movie']) {
        try {
            const url = `https://v3-cinemeta.strem.io/meta/${tipo}/${imdbId}.json`;
            const res = await retryAxios(() => axios_1.default.get(url, {
                timeout: 10000,
                headers: { 'User-Agent': 'BrasilRD/1.0' },
            }), 3, 1000);
            const meta = res.data?.meta;
            if (!meta?.name)
                continue;
            const title = meta.name;
            const yearStr = String(meta.year ?? '').trim();
            const year = /^\d{4}$/.test(yearStr) ? parseInt(yearStr, 10) : undefined;
            const type = tipo === 'series' ? 'tv' : 'movie';
            logger.debug(`Cinemeta: "${title}" (${yearStr || '?'}) [${type}]`);
            return { title, year, type };
        }
        catch {
        }
    }
    return null;
}
function decodeAdoroClass(cls) {
    if (!cls)
        return null;
    const cleaned = cls.replace(/ACr/g, '');
    try {
        const decoded = Buffer.from(cleaned, 'base64').toString('utf-8');
        const m = decoded.match(/^\/(series\/serie-\d+|filmes\/filme-\d+)\//);
        return m ? `/${m[1]}/` : null;
    }
    catch {
        return null;
    }
}
async function searchAdoroCinema(title) {
    try {
        const url = `https://www.adorocinema.com/pesquisar/?q=${encodeURIComponent(title)}`;
        const res = await axios_1.default.get(url, axiosConfig);
        const $ = cheerio.load(res.data);
        const cards = [];
        $('.card.entity-card').each((_i, el) => {
            const t = $(el).find('.meta-title-link').text().trim();
            const cls = $(el).find('.meta-title-link').attr('class')
                || $(el).find('.thumbnail-container').attr('class')
                || '';
            const href = decodeAdoroClass(cls);
            if (!t || !href)
                return;
            const mediaType = href.includes('/series/') ? 'tv' : 'movie';
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
    }
    catch (err) {
        logger.warn(`AdoroCinema search falhou para "${title}": ${err.message}`);
        return null;
    }
}
async function scrapeAdoroPage(href) {
    try {
        const url = `https://www.adorocinema.com${href}`;
        const res = await axios_1.default.get(url, axiosConfig);
        const $ = cheerio.load(res.data);
        const titlePt = $('h1').first().text().trim();
        if (!titlePt)
            return null;
        let originalTitle = $('.meta-body-original-title strong').text().trim() || null;
        if (!originalTitle) {
            const origWrap = $('.meta-body-item')
                .filter((_i, el) => $(el).find('.light').text().includes('Título original'))
                .first();
            originalTitle = origWrap.find('strong').text().trim() || null;
        }
        const metaInfo = $('.meta-body-info').text().replace(/\s+/g, ' ').trim();
        const year = parseInt(metaInfo.match(/(\d{4})/)?.[1] ?? '', 10) || undefined;
        const mediaType = href.includes('/series/') ? 'tv' : 'movie';
        return { titlePt, originalTitle, year, mediaType };
    }
    catch (err) {
        logger.warn(`AdoroCinema scrape falhou para ${href}: ${err.message}`);
        return null;
    }
}
async function searchTmdbHtmlAll(query) {
    try {
        const searchUrl = `https://www.themoviedb.org/search?query=${encodeURIComponent(query)}`;
        const res = await axios_1.default.get(searchUrl, axiosConfig);
        const $ = cheerio.load(res.data);
        const results = [];
        $('a[href]').each((_i, el) => {
            const href = $(el).attr('href');
            if (!href)
                return;
            const movieMatch = href.match(/^\/(movie)\/(\d+)/);
            const tvMatch = href.match(/^\/(tv)\/(\d+)/);
            const match = movieMatch || tvMatch;
            if (!match)
                return;
            const mediaType = match[1];
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
        const seen = new Set();
        return results.filter(r => {
            if (seen.has(r.tmdbUrl))
                return false;
            seen.add(r.tmdbUrl);
            return true;
        });
    }
    catch (err) {
        logger.warn(`TMDB search HTML falhou para "${query}": ${err.message}`);
        return [];
    }
}
async function scrapeTmdbPage(tmdbUrl) {
    try {
        const urlPt = tmdbUrl.includes('?') ? `${tmdbUrl}&language=pt-BR` : `${tmdbUrl}?language=pt-BR`;
        const urlEn = tmdbUrl.includes('?') ? `${tmdbUrl}&language=en-US` : `${tmdbUrl}?language=en-US`;
        const [resPt, resEn] = await Promise.all([
            axios_1.default.get(urlPt, axiosConfig),
            axios_1.default.get(urlEn, axiosConfigEn).catch(() => null),
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
            if (enTitle && enTitle !== ptTitle)
                originalTitle = enTitle;
        }
        const isDifferent = normalizeTitle(ptTitle) !== normalizeTitle(originalTitle);
        logger.debug(`TMDB HTML: PT="${ptTitle}" | ORIG="${originalTitle}" | year=${year} | diff=${isDifferent}`);
        return {
            originalTitle,
            portugueseTitle: isDifferent ? ptTitle : null,
            portugueseTitleRaw: isDifferent ? ptTitle : null,
            year,
        };
    }
    catch (err) {
        logger.warn(`TMDB page scrape falhou para ${tmdbUrl}: ${err.message}`);
        return null;
    }
}
async function getTmdbTitlesViaHtml(imdbId) {
    const startTime = Date.now();
    try {
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
        logger.debug(`AdoroCinema: buscando "${imdbData.title}" [${imdbData.type ?? '?'}]`);
        const adoroCard = await searchAdoroCinema(imdbData.title);
        if (adoroCard) {
            const adoroPage = await scrapeAdoroPage(adoroCard.href);
            if (adoroPage) {
                const allTitles = [normalizeTitle(adoroPage.titlePt)];
                if (adoroPage.originalTitle) {
                    const normOrig = normalizeTitle(adoroPage.originalTitle);
                    if (!allTitles.includes(normOrig))
                        allTitles.push(normOrig);
                }
                const result = {
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
        }
        else {
            logger.debug(`AdoroCinema: sem match exato para "${imdbData.title}", caindo pro TMDB HTML`);
        }
        const searchResults = await searchTmdbHtmlAll(imdbData.title);
        if (searchResults.length === 0) {
            logger.warn(`TmdbHtmlScraper: TMDB search sem resultados para "${imdbData.title}"`);
            return null;
        }
        let bestResult = null;
        let bestMetadata = null;
        for (const r of searchResults) {
            if (imdbData.type && r.mediaType !== imdbData.type)
                continue;
            const meta = await scrapeTmdbPage(r.tmdbUrl);
            if (!meta)
                continue;
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
            if (!allTitles.includes(normPt))
                allTitles.push(normPt);
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
    }
    catch (err) {
        logger.error(`TmdbHtmlScraper erro geral para ${imdbId}: ${err.message}`);
        return null;
    }
}
