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
exports.similarity = exports.sessaoCache = exports.SESSION_TTL = exports.axiosConfig = exports.BROWSER_HEADERS = exports.HDR_BASE = void 0;
exports.extrairCookies = extrairCookies;
exports.obterSessao = obterSessao;
exports.limparSessao = limparSessao;
exports.detectSeasonRange = detectSeasonRange;
exports.passaFiltroTemporada = passaFiltroTemporada;
exports.extractLanguage = extractLanguage;
exports.parseSpecsList = parseSpecsList;
exports.limparTituloOriginal = limparTituloOriginal;
exports.extrairMetadadosDoJsonLd = extrairMetadadosDoJsonLd;
exports.extractHdrMetadata = extractHdrMetadata;
exports.extrairTituloBasePosImdb = extrairTituloBasePosImdb;
exports.extrairDnDoMagnet = extrairDnDoMagnet;
exports.getContainerText = getContainerText;
exports.classificarSecao = classificarSecao;
exports.montarUrlBusca = montarUrlBusca;
exports.fetchComSessao = fetchComSessao;
exports.parseJsonLdBlocks = parseJsonLdBlocks;
exports.mapearTipoEsperado = mapearTipoEsperado;
exports.searchHdrLinks = searchHdrLinks;
exports.extractMagnetsFromPost = extractMagnetsFromPost;
exports.processarPostHdr = processarPostHdr;
exports.searchHdr = searchHdr;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const logger_js_1 = require("../../utils/logger.js");
const wordpressScraper_js_1 = require("./wordpressScraper.js");
const TechnicalWords_js_1 = require("../../titulos/TechnicalWords.js");
const magnetHelper_js_1 = require("../../magnet/magnetHelper.js");
const SimilarityCalculator_js_1 = require("../../titulos/SimilarityCalculator.js");
const logger = new logger_js_1.Logger('HdrScraper');
exports.HDR_BASE = 'https://hdrtorrents.net';
exports.BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'Cache-Control': 'max-age=0',
    'Connection': 'keep-alive',
};
exports.axiosConfig = {
    timeout: 15000,
    httpsAgent: wordpressScraper_js_1.agenteHttps,
    lookup: wordpressScraper_js_1.lookupCustomizado,
    headers: exports.BROWSER_HEADERS,
};
exports.SESSION_TTL = 30 * 60 * 1000;
exports.sessaoCache = null;
function extrairCookies(setCookie) {
    if (!setCookie)
        return '';
    const lista = Array.isArray(setCookie) ? setCookie : [setCookie];
    return lista.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}
async function obterSessao(forcar = false) {
    if (!forcar && exports.sessaoCache && (Date.now() - exports.sessaoCache.criadaEm) < exports.SESSION_TTL) {
        return exports.sessaoCache;
    }
    const res = await axios_1.default.get(`${exports.HDR_BASE}/`, {
        ...exports.axiosConfig,
        headers: exports.BROWSER_HEADERS,
    });
    const token = res.data.match(/name="token"\s+value="([^"]+)"/)?.[1];
    if (!token) {
        throw new Error('HDR: token CSRF não encontrado na home');
    }
    const cookie = extrairCookies(res.headers['set-cookie']);
    exports.sessaoCache = { token, cookie, criadaEm: Date.now() };
    logger.debug('HDR: sessão renovada', {
        token: token.substring(0, 8) + '...',
        temCookie: !!cookie,
    });
    return exports.sessaoCache;
}
function limparSessao() {
    exports.sessaoCache = null;
}
exports.similarity = SimilarityCalculator_js_1.SimilarityCalculator.getInstance();
function detectSeasonRange(text) {
    const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(text);
    if (range)
        return range;
    const seasonMatch = text.match(/(\d+)\s*ª\s*TEMPORADA/i) || text.match(/Season\s+(\d+)/i);
    if (seasonMatch) {
        const s = parseInt(seasonMatch[1]);
        return { seasonStart: s, seasonEnd: s, episodeStart: 0, episodeEnd: 0 };
    }
    return null;
}
function passaFiltroTemporada(textos, targetSeason, mediaType) {
    if (targetSeason === undefined)
        return true;
    for (const t of textos) {
        if (!t)
            continue;
        const range = detectSeasonRange(t);
        if (range)
            return (0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, targetSeason);
    }
    return textos.some(t => (0, TechnicalWords_js_1.isCollectionTitle)(t, mediaType));
}
function extractLanguage(parentText) {
    const t = parentText.toLowerCase();
    if (t.includes('dual') && /áudio|audio/.test(t))
        return 'Dual Áudio';
    if (/dublado|dublada|dublagem/.test(t))
        return 'Dublado';
    if (/legendado|legendada/.test(t))
        return 'Legendado';
    if (/nacional/.test(t))
        return 'Nacional';
    return '';
}
function parseSpecsList($) {
    const specs = {};
    $('dl.item-specs > div').each((_i, el) => {
        const dt = $(el).find('dt').first();
        const dd = $(el).find('dd').first();
        if (!dt.length || !dd.length)
            return;
        const rotulo = (0, TechnicalWords_js_1.normalizarTexto)(dt.text().trim());
        const valor = dd.text().replace(/\s+/g, ' ').trim();
        if (rotulo && valor)
            specs[rotulo] = valor;
    });
    return specs;
}
function limparTituloOriginal(titulo) {
    return titulo
        .replace(/\s*[-–—]\s*(complete|completa?)\s*s\d{1,2}$/i, '')
        .replace(/\s*temporada\s+completa\s*(s\d{1,2})?$/i, '')
        .replace(/\s*complete\s+season\s*\d*$/i, '')
        .replace(/\s*s\d{1,2}$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function extrairMetadadosDoJsonLd(blocks) {
    const meta = blocks.find(b => b && (b['@type'] === 'TVSeries' || b['@type'] === 'Movie'));
    if (!meta)
        return {};
    const out = {};
    if (typeof meta.alternateName === 'string' && meta.alternateName.trim()) {
        out.originalTitleBruto = meta.alternateName.trim();
    }
    if (typeof meta.datePublished === 'string') {
        const y = meta.datePublished.match(/\b(19|20)\d{2}\b/);
        if (y)
            out.year = parseInt(y[0]);
    }
    return out;
}
function extractHdrMetadata($, jsonLdBlocks) {
    const result = { origem: { title: 'none', year: 'none' } };
    if (jsonLdBlocks && jsonLdBlocks.length > 0) {
        const meta = extrairMetadadosDoJsonLd(jsonLdBlocks);
        if (meta.originalTitleBruto) {
            result.originalTitleBruto = meta.originalTitleBruto;
            result.originalTitle = limparTituloOriginal(meta.originalTitleBruto);
            result.origem.title = 'jsonld';
        }
        if (meta.year) {
            result.year = meta.year;
            result.origem.year = 'jsonld';
        }
    }
    const paragrafo = $('p').filter((_i, el) => /T[íi]tulo\s+Original/i.test($(el).text())).first();
    if (paragrafo.length) {
        paragrafo.find('b').each((_i, el) => {
            const rotulo = $(el).text().trim();
            const html = $(el).parent().html() || '';
            const elHtml = $(el).toString();
            const idx = html.indexOf(elHtml);
            if (idx === -1)
                return;
            const after = html.substring(idx + elHtml.length);
            const match = after.match(/^[:\s]*(.*?)(?:<br>|<b>|$)/i);
            if (!match)
                return;
            const valor = match[1].replace(/<[^>]+>/g, '').trim();
            if (/t[íi]tulo\s+original/i.test(rotulo) && !result.originalTitleBruto) {
                result.originalTitleBruto = valor;
                result.originalTitle = limparTituloOriginal(valor);
                result.origem.title = 'html';
            }
            else if (/lan[çc]amento/i.test(rotulo) && result.year === undefined) {
                const yearMatch = valor.match(/\b(19|20)\d{2}\b/);
                if (yearMatch) {
                    result.year = parseInt(yearMatch[0]);
                    result.origem.year = 'html';
                }
            }
            else if (/idiomas?/i.test(rotulo)) {
                result.language = valor;
            }
        });
        if (!result.originalTitle) {
            const tituloBase = extrairTituloBasePosImdb($, paragrafo);
            const originalFinal = tituloBase || result.originalTitleBruto;
            if (originalFinal) {
                result.originalTitle = limparTituloOriginal(originalFinal);
                result.origem.title = 'html';
            }
        }
        const specsFallback = parseSpecsList($);
        result.quality = result.quality || specsFallback['qualidade'];
        result.size = result.size || specsFallback['tamanho'];
        result.format = result.format || specsFallback['formato'];
        result.duration = result.duration || specsFallback['duracao'] || specsFallback['duração'];
        return result;
    }
    const specs = parseSpecsList($);
    if (Object.keys(specs).length === 0)
        return result;
    if (specs['titulo original'] && !result.originalTitleBruto) {
        result.originalTitleBruto = specs['titulo original'];
        result.originalTitle = limparTituloOriginal(specs['titulo original']);
        result.origem.title = 'html';
    }
    if (specs['lancamento'] && result.year === undefined) {
        const yearMatch = specs['lancamento'].match(/\b(19|20)\d{2}\b/);
        if (yearMatch) {
            result.year = parseInt(yearMatch[0]);
            result.origem.year = 'html';
        }
    }
    if (specs['idiomas']) {
        result.language = specs['idiomas'];
    }
    if (specs['qualidade'])
        result.quality = specs['qualidade'];
    if (specs['tamanho'])
        result.size = specs['tamanho'].trim();
    if (specs['formato'])
        result.format = specs['formato'];
    if (specs['duracao'])
        result.duration = specs['duracao'];
    if (specs['duração'])
        result.duration = specs['duração'];
    return result;
}
function extrairTituloBasePosImdb($, paragrafo) {
    const imdbLink = paragrafo.find('a[href*="imdb.com/title/"]').first();
    if (!imdbLink.length)
        return null;
    const parentHtml = paragrafo.html() || '';
    const imdbHtml = imdbLink.toString();
    const idxImdb = parentHtml.indexOf(imdbHtml);
    if (idxImdb === -1)
        return null;
    const afterImdb = parentHtml.substring(idxImdb + imdbHtml.length);
    const nextLinkMatch = afterImdb.match(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (nextLinkMatch) {
        return nextLinkMatch[2].trim();
    }
    return null;
}
function extrairDnDoMagnet(magnet) {
    const m = magnet.match(/[&?]dn=([^&]+)/i);
    if (!m)
        return undefined;
    try {
        return decodeURIComponent(m[1].replace(/\+/g, ' '));
    }
    catch {
        return m[1];
    }
}
function getContainerText($, el) {
    const row = $(el).closest('.download-row');
    if (row.length) {
        const nome = row.find('.download-name').first().text().trim();
        return nome || row.text().replace(/\s+/g, ' ').trim();
    }
    const parentP = $(el).closest('p');
    if (parentP.length)
        return parentP.text().trim();
    return $(el).text().trim();
}
function classificarSecao(texto) {
    const t = (0, TechnicalWords_js_1.normalizarTexto)(texto).trim();
    if (!t || t.length > 60)
        return 'NONE';
    if (/^(trailer|assistir|baixar|download|ver)\b/i.test(t))
        return 'NONE';
    const temDual = /\bdual\b/.test(t) && /\baudio\b/.test(t);
    const temDublado = /\bdublado\b|\bdublada\b|\bdublagem\b|\bnacional\b/.test(t);
    const temLegendado = /\blegendado\b|\blegendada\b/.test(t);
    if (temLegendado && !temDual && !temDublado)
        return 'LEGENDADO';
    if ((temDual || temDublado) && !temLegendado)
        return 'DUAL';
    return 'NONE';
}
function montarUrlBusca(query, token) {
    const termo = encodeURIComponent(query.trim()).replace(/%20/g, '+');
    return `${exports.HDR_BASE}/pesquisa/${termo}/?hp_bot_check=&token=${token}`;
}
async function fetchComSessao(url, tentativa = 0) {
    const sessao = await obterSessao(tentativa > 0);
    try {
        const res = await axios_1.default.get(url, {
            ...exports.axiosConfig,
            headers: {
                ...exports.BROWSER_HEADERS,
                'Cookie': sessao.cookie,
                'Referer': `${exports.HDR_BASE}/`,
            },
        });
        return res.data;
    }
    catch (err) {
        const status = err.response?.status;
        if (status === 403 && tentativa === 0) {
            logger.debug('HDR: 403 detectado, renovando sessão e retentando');
            exports.sessaoCache = null;
            return fetchComSessao(url, 1);
        }
        throw err;
    }
}
function parseJsonLdBlocks($) {
    const blocks = [];
    let malformados = 0;
    $('script[type="application/ld+json"]').each((_i, el) => {
        const raw = $(el).text().trim();
        if (!raw)
            return;
        try {
            blocks.push(JSON.parse(raw));
        }
        catch {
            malformados++;
        }
    });
    return { blocks, malformados };
}
function mapearTipoEsperado(mediaType) {
    if (mediaType === 'series' || mediaType === 'tv')
        return 'TVSeries';
    if (mediaType === 'movie')
        return 'Movie';
    return null;
}
async function searchHdrLinks(query, targetSeason, mediaType) {
    const t0 = Date.now();
    try {
        const sessao = await obterSessao();
        const url = montarUrlBusca(query, sessao.token);
        const html = await fetchComSessao(url);
        const $ = cheerio.load(html);
        const { blocks, malformados } = parseJsonLdBlocks($);
        if (malformados > 0) {
            logger.warn('HDR: JSON-LD malformado', { query: query.substring(0, 40), malformados });
        }
        const collectionPage = blocks.find(b => b && b['@type'] === 'CollectionPage');
        if (!collectionPage) {
            logger.warn('HDR: JSON-LD sem CollectionPage', {
                query: query.substring(0, 40),
                blocos: blocks.map(b => b?.['@type'] ?? '?').join(','),
            });
            return [];
        }
        const items = collectionPage.mainEntity?.itemListElement;
        if (!Array.isArray(items) || items.length === 0) {
            logger.warn('HDR: CollectionPage sem itens', { query: query.substring(0, 40) });
            return [];
        }
        const tipoEsperado = mapearTipoEsperado(mediaType);
        const results = [];
        const seen = new Set();
        let cortadosPorTipo = 0;
        for (const entry of items) {
            const title = entry?.item?.name || entry?.name;
            const rawUrl = entry?.item?.url || entry?.url;
            if (!title || !rawUrl)
                continue;
            if (tipoEsperado && entry?.item?.['@type'] !== tipoEsperado) {
                cortadosPorTipo++;
                continue;
            }
            const absoluteHref = rawUrl.startsWith('http') ? rawUrl : `${exports.HDR_BASE}${rawUrl}`;
            if (seen.has(absoluteHref))
                continue;
            seen.add(absoluteHref);
            if (!passaFiltroTemporada([title], targetSeason, mediaType))
                continue;
            results.push({ title, postUrl: absoluteHref });
        }
        logger.debug(`HDR: "${query.substring(0, 40)}" JSON-LD | ${items.length} itens, ${cortadosPorTipo} cortados por tipo, ${results.length} pós-temporada (${Date.now() - t0}ms)`);
        return results.slice(0, 40);
    }
    catch (err) {
        logger.warn('HDR busca falhou', {
            query: query.substring(0, 50),
            status: err.response?.status || '-',
            error: err.message,
        });
        return [];
    }
}
async function extractMagnetsFromPost(html, postTitle, postUrl, targetSeason, mediaType) {
    const $ = cheerio.load(html);
    const results = [];
    const h1Title = $('h1').first().text().replace(/Torrent.*$/i, '').trim();
    const titleTag = $('title').text().replace(/Torrent.*$/i, '').trim();
    const pageTitle = h1Title || titleTag || postTitle;
    const { blocks: jsonLdBlocks } = parseJsonLdBlocks($);
    const metadata = extractHdrMetadata($, jsonLdBlocks);
    const tituloDoPost = metadata.originalTitle || metadata.originalTitleBruto;
    const sectionHeaders = [];
    $('h1, h2, h3, h4, h5, h6, strong, b').each((_i, el) => {
        const texto = $(el).text().trim();
        if (!texto)
            return;
        const tipo = classificarSecao(texto);
        if (tipo === 'NONE')
            return;
        const pos = html.indexOf($(el).toString());
        if (pos === -1)
            return;
        sectionHeaders.push({ pos, type: tipo });
    });
    sectionHeaders.sort((a, b) => a.pos - b.pos);
    const detectarSecaoPorPosicao = (pos) => {
        let secao = 'NONE';
        for (const sh of sectionHeaders) {
            if (pos > sh.pos)
                secao = sh.type;
            else
                break;
        }
        return secao;
    };
    const rawLinks = [];
    const totalAnchors = $('a[href^="magnet:"]').length;
    $('a[href^="magnet:"]').each((_i, el) => {
        const href = $(el).attr('href');
        if (!href)
            return;
        const containerText = getContainerText($, el);
        const linkText = $(el).text().trim();
        const posMagnet = html.indexOf($(el).toString());
        const secaoPosicional = posMagnet !== -1 ? detectarSecaoPorPosicao(posMagnet) : 'NONE';
        if (secaoPosicional === 'LEGENDADO')
            return;
        const isLegendado = /legendado|legendada|legenda/i.test(containerText);
        const isDualOuDublado = /dual\s*áudio|dual\s*audio|dublado|dublada|dublagem|nacional/i.test(containerText);
        if (isLegendado && !isDualOuDublado)
            return;
        if (!passaFiltroTemporada([containerText, postTitle, pageTitle], targetSeason, mediaType))
            return;
        const qualityMatch = containerText.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
        let sizeMatch = containerText.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];
        if (!sizeMatch) {
            const dn = extrairDnDoMagnet(href);
            if (dn)
                sizeMatch = dn.match(/(\d+(?:[.,]\d+)?)\s*(GB|MB)/i)?.[0];
        }
        rawLinks.push({ href, containerText, linkText, qualityMatch, sizeMatch });
    });
    for (const raw of rawLinks) {
        try {
            const hashMatch = raw.href.match(/btih:([a-zA-Z0-9]+)/i);
            let infoHash = hashMatch ? hashMatch[1].toLowerCase() : '';
            if (!infoHash) {
                logger.warn(`HDR: magnet sem infoHash`, { magnet: raw.href.substring(0, 60) });
                continue;
            }
            let canonicalName;
            try {
                const dados = await (0, magnetHelper_js_1.analisarMagnet)(raw.href);
                canonicalName = dados?.nome ?? undefined;
                if (dados?.infoHash && dados.infoHash.toLowerCase() !== infoHash) {
                    infoHash = dados.infoHash.toLowerCase();
                }
            }
            catch {
                canonicalName = undefined;
            }
            const originalTitle = tituloDoPost;
            const anosDoMagnet = (0, TechnicalWords_js_1.extrairAno)(raw.containerText);
            const years = (anosDoMagnet && anosDoMagnet.length > 0) ? anosDoMagnet : undefined;
            const year = years ? years[0] : metadata.year;
            const language = extractLanguage(raw.containerText) || metadata.language || extractLanguage(pageTitle);
            const range = detectSeasonRange(raw.containerText) ??
                detectSeasonRange(postTitle) ??
                detectSeasonRange(pageTitle);
            const rangeEp = (0, TechnicalWords_js_1.extrairRangeEpisodios)(raw.containerText);
            let episodeStart = rangeEp?.episodeStart ?? undefined;
            if (episodeStart === undefined && canonicalName) {
                const rangeCanonical = (0, TechnicalWords_js_1.extrairRangeEpisodios)(canonicalName);
                episodeStart = rangeCanonical?.episodeStart ?? undefined;
            }
            const episode = episodeStart;
            const qualityMatch = raw.qualityMatch || metadata.quality?.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
            const sizeMatch = raw.sizeMatch || metadata.size?.trim();
            const seasonLabel = range && range.seasonStart > 0
                ? (range.seasonStart === range.seasonEnd
                    ? `${range.seasonStart}ª Temporada`
                    : `${range.seasonStart}ª à ${range.seasonEnd}ª Temporada`)
                : '';
            const magnetTitle = seasonLabel
                ? `${pageTitle} - ${seasonLabel}${episode ? ` Episódio ${episode}` : ''}${language ? ` [${language}]` : ''}${qualityMatch ? ` ${qualityMatch}` : ''}`
                : [pageTitle, episode ? `Episódio ${episode}` : '', language ? `[${language}]` : '', qualityMatch].filter(Boolean).join(' ');
            const htmlTitleLimpo = raw.containerText
                .replace(/MAGNET LINK/gi, '')
                .replace(/\s+/g, ' ')
                .trim() || undefined;
            results.push({
                title: magnetTitle,
                htmlTitle: htmlTitleLimpo,
                magnet: raw.href,
                infoHash,
                seeders: 0,
                size: sizeMatch || '',
                language,
                originalTitle,
                year,
                years,
                canonicalName,
                season: range?.seasonStart && range.seasonStart > 0 ? range.seasonStart : undefined,
                episode,
            });
        }
        catch (err) {
            logger.warn(`HDR: erro ao processar magnet`, { magnet: raw.href.substring(0, 60), error: err.message });
        }
    }
    logger.debug(`HDR extract | "${postTitle.substring(0, 40)}" | anchors=${totalAnchors} rawLinks=${rawLinks.length} magnets=${results.length}`);
    if (results.length > 0) {
        logger.debug(`HDR post | "${postTitle.substring(0, 40)}" | title=${metadata.origem.title} year=${metadata.origem.year} | ${results.length} magnets`);
    }
    return results;
}
async function processarPostHdr(item, imdbId, targetSeason, mediaType) {
    limparSessao();
    let html;
    try {
        html = await fetchComSessao(item.postUrl);
    }
    catch (err) {
        logger.debug(`HDR post falhou | "${item.title.substring(0, 40)}" | ${err.message}`);
        return { torrents: [], imdbConfirmed: false };
    }
    let imdbConfirmed = false;
    if (imdbId) {
        const imdbIdDoPost = html.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
        if (imdbIdDoPost) {
            const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(item.title, mediaType);
            if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
                logger.debug(`HDR imdb mismatch | "${item.title.substring(0, 40)}" | post=${imdbIdDoPost} alvo=${imdbId}`);
                return { torrents: [], imdbConfirmed: false };
            }
            if (!isCollection) {
                imdbConfirmed = true;
            }
        }
    }
    const torrents = await extractMagnetsFromPost(html, item.title, item.postUrl, targetSeason, mediaType);
    if (torrents.length === 0) {
        logger.debug(`HDR post vazio | "${item.title.substring(0, 40)}" | html=${html.length}b`);
    }
    return { torrents, imdbConfirmed };
}
async function searchHdr(query, type = 'movie', targetSeason, searchQueries, targetYear, imdbId, mediaType) {
    const startTime = Date.now();
    const queriesParaBusca = searchQueries && searchQueries.length > 0 ? [...searchQueries] : [query];
    const frasesValidas = queriesParaBusca.map(f => (0, TechnicalWords_js_1.normalizarTexto)(f)).filter(Boolean);
    try {
        const allResults = [];
        const seenInfoHashes = new Set();
        const seenPostUrls = new Set();
        let queriesComResultado = 0;
        for (const q of queriesParaBusca) {
            const t0 = Date.now();
            limparSessao();
            const links = await searchHdrLinks(q, targetSeason, mediaType);
            if (links.length === 0) {
                logger.debug(`HDR: "${q.substring(0, 40)}" | 0 links (${Date.now() - t0}ms)`);
                continue;
            }
            const tokensRuido = (0, TechnicalWords_js_1.calcularTokensRuido)(links.map(l => l.title));
            const ehSerie = mediaType === 'series' || mediaType === 'tv';
            const filtrados = links.filter(link => {
                const tituloLimpo = (0, TechnicalWords_js_1.limparPorRaridade)(link.title, tokensRuido);
                const resultado = exports.similarity.compararComTitulos(frasesValidas, tituloLimpo);
                const isCollection = !ehSerie && (0, TechnicalWords_js_1.isCollectionTitle)(link.title, mediaType);
                if (!resultado.match && !isCollection) {
                    logger.debug(`HDR rejeitado | "${link.title.substring(0, 50)}" | score=${resultado.score.toFixed(2)} nivel=${resultado.nivel}`);
                    return false;
                }
                return true;
            });
            if (filtrados.length === 0) {
                logger.debug(`HDR: "${q.substring(0, 40)}" | ${links.length} links, 0 relevantes (${Date.now() - t0}ms)`);
                continue;
            }
            const novos = filtrados.filter(item => {
                if (seenPostUrls.has(item.postUrl))
                    return false;
                seenPostUrls.add(item.postUrl);
                return true;
            });
            if (novos.length === 0) {
                logger.debug(`HDR: "${q.substring(0, 40)}" | ${links.length} links, ${filtrados.length} relevantes, 0 novos (${Date.now() - t0}ms)`);
                continue;
            }
            const respostas = await Promise.all(novos.map(item => processarPostHdr(item, imdbId, targetSeason, mediaType)));
            let magnetsDaQuery = 0;
            for (const { torrents, imdbConfirmed } of respostas) {
                for (const r of torrents) {
                    if (imdbConfirmed)
                        r.imdbConfirmed = true;
                    if (!seenInfoHashes.has(r.infoHash)) {
                        seenInfoHashes.add(r.infoHash);
                        allResults.push(r);
                        magnetsDaQuery++;
                    }
                }
            }
            if (magnetsDaQuery > 0)
                queriesComResultado++;
            logger.debug(`HDR: "${q.substring(0, 40)}" | ${links.length} links, ${filtrados.length} relevantes, ${novos.length} novos, ${magnetsDaQuery} magnets (${Date.now() - t0}ms)`);
        }
        const duration = Date.now() - startTime;
        logger.info(`HDR: ${allResults.length} magnets em ${duration}ms | queries=${queriesParaBusca.length} comResultado=${queriesComResultado}`);
        return allResults;
    }
    catch (err) {
        logger.error('HDR erro', { query: query.substring(0, 50), error: err.message });
        return [];
    }
}
