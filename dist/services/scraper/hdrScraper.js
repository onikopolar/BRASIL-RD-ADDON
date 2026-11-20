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
exports.similarity = exports.BREAKER_COOLDOWN_MS = exports.BREAKER_LIMITE_ERROS = exports.BREAKER_JANELA_MS = exports.NEGATIVE_MAX_ENTRIES = exports.NEGATIVE_DEFAULT_TTL_MS = exports.axiosConfig = exports.BROWSER_HEADERS = exports.HDR_BASE = void 0;
exports.truncar = truncar;
exports.negativeCacheKey = negativeCacheKey;
exports.negativeCacheIsBlocked = negativeCacheIsBlocked;
exports.negativeCacheMark = negativeCacheMark;
exports.negativeCacheClear = negativeCacheClear;
exports.negativeCacheStats = negativeCacheStats;
exports.breakerStatus = breakerStatus;
exports.breakerPodeUsar = breakerPodeUsar;
exports.breakerRegistrarSucesso = breakerRegistrarSucesso;
exports.breakerRegistrarFalha = breakerRegistrarFalha;
exports.breakerReset = breakerReset;
exports.breakerStats = breakerStats;
exports.classificarErroFonte = classificarErroFonte;
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
const FONTE = 'hdr';
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
function truncar(texto, max = 40) {
    return texto.substring(0, max);
}
exports.NEGATIVE_DEFAULT_TTL_MS = 30 * 60 * 1000;
exports.NEGATIVE_MAX_ENTRIES = 5000;
const negativeStore = new Map();
function negativeCacheKey(source, query, extra) {
    const q = query.trim().toLowerCase();
    const e = extra ? JSON.stringify(extra) : '';
    return `${source}|${q}|${e}`;
}
function negativeCacheIsBlocked(key) {
    const entry = negativeStore.get(key);
    if (!entry)
        return false;
    if (Date.now() - entry.ts > entry.ttlMs) {
        negativeStore.delete(key);
        return false;
    }
    entry.hits++;
    return true;
}
function negativeCacheMark(key, ttlMs = exports.NEGATIVE_DEFAULT_TTL_MS) {
    if (negativeStore.size >= exports.NEGATIVE_MAX_ENTRIES) {
        const first = negativeStore.keys().next().value;
        if (first)
            negativeStore.delete(first);
    }
    negativeStore.set(key, { ts: Date.now(), ttlMs, hits: 0 });
}
function negativeCacheClear() {
    negativeStore.clear();
}
function negativeCacheStats() {
    const agora = Date.now();
    return {
        size: negativeStore.size,
        maxEntries: exports.NEGATIVE_MAX_ENTRIES,
        defaultTtlMs: exports.NEGATIVE_DEFAULT_TTL_MS,
        entries: Array.from(negativeStore.entries()).map(([key, v]) => ({
            key,
            ageMs: agora - v.ts,
            ttlMs: v.ttlMs,
            expiraEmMs: Math.max(0, v.ttlMs - (agora - v.ts)),
            hits: v.hits,
        })),
    };
}
exports.BREAKER_JANELA_MS = 5 * 60 * 1000;
exports.BREAKER_LIMITE_ERROS = 5;
exports.BREAKER_COOLDOWN_MS = 15 * 60 * 1000;
const breakerStore = new Map();
function getBreaker(fonte) {
    let e = breakerStore.get(fonte);
    if (!e) {
        e = { erros: 0, ultimaFalha: 0, abertoEm: 0, estado: 'closed' };
        breakerStore.set(fonte, e);
    }
    return e;
}
function breakerStatus(fonte) {
    return getBreaker(fonte).estado;
}
function breakerPodeUsar(fonte) {
    const e = getBreaker(fonte);
    if (e.estado === 'closed')
        return true;
    if (e.estado === 'open') {
        if (Date.now() - e.abertoEm > exports.BREAKER_COOLDOWN_MS) {
            e.estado = 'half-open';
            logger.debug(`HDR: circuit breaker half-open | fonte=${fonte}`);
            return true;
        }
        return false;
    }
    return true;
}
function breakerRegistrarSucesso(fonte) {
    const e = getBreaker(fonte);
    if (e.estado !== 'closed') {
        logger.info(`HDR: circuit breaker FECHADO | fonte=${fonte}`);
    }
    e.erros = 0;
    e.estado = 'closed';
    e.abertoEm = 0;
}
function breakerRegistrarFalha(fonte) {
    const e = getBreaker(fonte);
    const agora = Date.now();
    if (agora - e.ultimaFalha > exports.BREAKER_JANELA_MS)
        e.erros = 0;
    e.erros++;
    e.ultimaFalha = agora;
    if (e.estado === 'half-open') {
        e.estado = 'open';
        e.abertoEm = agora;
        logger.warn(`HDR: circuit breaker REABERTO após falha no half-open | fonte=${fonte}`, { erros: e.erros });
        return;
    }
    if (e.erros >= exports.BREAKER_LIMITE_ERROS && e.estado === 'closed') {
        e.estado = 'open';
        e.abertoEm = agora;
        logger.warn(`HDR: circuit breaker ABERTO | fonte=${fonte}`, {
            erros: e.erros,
            cooldownMs: exports.BREAKER_COOLDOWN_MS,
        });
    }
}
function breakerReset(fonte) {
    if (fonte)
        breakerStore.delete(fonte);
    else
        breakerStore.clear();
}
function breakerStats() {
    const agora = Date.now();
    return {
        windowMs: exports.BREAKER_JANELA_MS,
        threshold: exports.BREAKER_LIMITE_ERROS,
        cooldownMs: exports.BREAKER_COOLDOWN_MS,
        entries: Array.from(breakerStore.entries()).map(([fonte, e]) => ({
            fonte,
            estado: e.estado,
            erros: e.erros,
            ultimaFalhaMs: e.ultimaFalha ? agora - e.ultimaFalha : null,
            abertoEmMs: e.abertoEm ? agora - e.abertoEm : null,
            cooldownRestanteMs: e.estado === 'open'
                ? Math.max(0, exports.BREAKER_COOLDOWN_MS - (agora - e.abertoEm))
                : null,
        })),
    };
}
function classificarErroFonte(err) {
    const status = err?.response?.status;
    if (!status)
        return 'fonte';
    if (status >= 500)
        return 'fonte';
    if (status === 403 || status === 429)
        return 'fonte';
    return 'item';
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
function criarMetadadoVazio() {
    return { origem: { title: 'none', year: 'none' } };
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
function aplicarJsonLd(result, jsonLdBlocks) {
    if (!jsonLdBlocks || jsonLdBlocks.length === 0)
        return;
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
function extrairValorDeBold($, el) {
    const html = $(el).parent().html() || '';
    const elHtml = $(el).toString();
    const idx = html.indexOf(elHtml);
    if (idx === -1)
        return null;
    const after = html.substring(idx + elHtml.length);
    const match = after.match(/^[:\s]*(.*?)(?:<br>|<b>|$)/i);
    if (!match)
        return null;
    return match[1].replace(/<[^>]+>/g, '').trim();
}
function aplicarParagrafo(result, $, paragrafo) {
    paragrafo.find('b').each((_i, el) => {
        const rotulo = $(el).text().trim();
        const valor = extrairValorDeBold($, el);
        if (valor === null)
            return;
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
}
function aplicarSpecs(result, specs) {
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
    if (specs['idiomas'])
        result.language = specs['idiomas'];
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
}
function extractHdrMetadata($, jsonLdBlocks) {
    const result = criarMetadadoVazio();
    aplicarJsonLd(result, jsonLdBlocks);
    const paragrafo = $('p').filter((_i, el) => /T[íi]tulo\s+Original/i.test($(el).text())).first();
    if (paragrafo.length) {
        aplicarParagrafo(result, $, paragrafo);
        return result;
    }
    const specs = parseSpecsList($);
    if (Object.keys(specs).length === 0)
        return result;
    aplicarSpecs(result, specs);
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
function detectarSecoes($, html) {
    const secaoHeaders = [];
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
        secaoHeaders.push({ pos, type: tipo });
    });
    secaoHeaders.sort((a, b) => a.pos - b.pos);
    return secaoHeaders;
}
function secaoNaPosicao(pos, secaoHeaders) {
    let secao = 'NONE';
    for (const sh of secaoHeaders) {
        if (pos > sh.pos)
            secao = sh.type;
        else
            break;
    }
    return secao;
}
function montarUrlBusca(query) {
    const termo = encodeURIComponent(query.trim()).replace(/%20/g, '+');
    return `${exports.HDR_BASE}/pesquisa/${termo}/`;
}
async function fetchComSessao(url, tentativa = 0) {
    try {
        const res = await axios_1.default.get(url, {
            ...exports.axiosConfig,
            headers: { ...exports.BROWSER_HEADERS, 'Referer': `${exports.HDR_BASE}/` },
        });
        return res.data;
    }
    catch (err) {
        const status = err.response?.status;
        if (status >= 500 && tentativa === 0) {
            logger.debug('HDR: erro 5xx, retentando');
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
function parsearJsonLdItems(items, tipoEsperado, targetSeason, mediaType) {
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
    return { results, cortadosPorTipo };
}
async function searchHdrLinks(query, targetSeason, mediaType) {
    const t0 = Date.now();
    const q = truncar(query);
    if (!breakerPodeUsar(FONTE)) {
        logger.debug(`HDR: circuit breaker OPEN, pulando searchHdrLinks | "${q}"`);
        return { status: 'blocked', items: [], reason: 'circuit breaker open' };
    }
    try {
        const url = montarUrlBusca(query);
        const html = await fetchComSessao(url);
        const $ = cheerio.load(html);
        const { blocks, malformados } = parseJsonLdBlocks($);
        if (malformados > 0) {
            logger.warn('HDR: JSON-LD malformado', { query: q, malformados });
        }
        const collectionPage = blocks.find(b => b && b['@type'] === 'CollectionPage');
        if (!collectionPage) {
            const tipos = blocks.map(b => b?.['@type']).filter(Boolean);
            const ehHome = tipos.length === 2 && tipos.includes('WebSite') && tipos.includes('Organization');
            if (ehHome) {
                logger.debug(`HDR: query rejeitada (home sem CollectionPage) | "${truncar(query)}"`);
                return { status: 'empty', items: [] };
            }
            logger.warn('HDR: JSON-LD sem CollectionPage', {
                query: truncar(query),
                blocos: tipos.join(','),
            });
            breakerRegistrarFalha(FONTE);
            return { status: 'error', items: [], reason: 'no CollectionPage' };
        }
        const items = collectionPage.mainEntity?.itemListElement;
        if (!Array.isArray(items) || items.length === 0) {
            breakerRegistrarSucesso(FONTE);
            logger.debug(`HDR: CollectionPage vazia | "${q}"`);
            return { status: 'empty', items: [] };
        }
        const tipoEsperado = mapearTipoEsperado(mediaType);
        const { results, cortadosPorTipo } = parsearJsonLdItems(items, tipoEsperado, targetSeason, mediaType);
        breakerRegistrarSucesso(FONTE);
        logger.debug(`HDR: "${q}" JSON-LD | ${items.length} itens, ${cortadosPorTipo} cortados por tipo, ${results.length} pós-temporada (${Date.now() - t0}ms)`);
        return { status: 'ok', items: results.slice(0, 40) };
    }
    catch (err) {
        logger.warn('HDR busca falhou', {
            query: truncar(query, 50),
            status: err.response?.status || '-',
            error: err.message,
        });
        breakerRegistrarFalha(FONTE);
        return { status: 'error', items: [], error: err.message };
    }
}
function coletarRawLinks($, html, secaoHeaders, ctx) {
    const rawLinks = [];
    const totalAnchors = $('a[href^="magnet:"]').length;
    $('a[href^="magnet:"]').each((_i, el) => {
        const href = $(el).attr('href');
        if (!href)
            return;
        const containerText = getContainerText($, el);
        const linkText = $(el).text().trim();
        const posMagnet = html.indexOf($(el).toString());
        const secaoPosicional = posMagnet !== -1 ? secaoNaPosicao(posMagnet, secaoHeaders) : 'NONE';
        if (secaoPosicional === 'LEGENDADO')
            return;
        const isLegendado = /legendado|legendada|legenda/i.test(containerText);
        const isDualOuDublado = /dual\s*áudio|dual\s*audio|dublado|dublada|dublagem|nacional/i.test(containerText);
        if (isLegendado && !isDualOuDublado)
            return;
        if (!passaFiltroTemporada([containerText, ctx.postTitle, ctx.pageTitle], ctx.targetSeason, ctx.mediaType))
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
    return { rawLinks, totalAnchors };
}
async function processarRawLink(raw, ctx) {
    try {
        const hashMatch = raw.href.match(/btih:([a-zA-Z0-9]+)/i);
        let infoHash = hashMatch ? hashMatch[1].toLowerCase() : '';
        if (!infoHash) {
            logger.warn(`HDR: magnet sem infoHash`, { magnet: raw.href.substring(0, 60) });
            return null;
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
        const anosDoMagnet = (0, TechnicalWords_js_1.extrairAno)(raw.containerText);
        const years = (anosDoMagnet && anosDoMagnet.length > 0) ? anosDoMagnet : undefined;
        const year = years ? years[0] : ctx.metadata.year;
        const language = extractLanguage(raw.containerText) || ctx.metadata.language || extractLanguage(ctx.pageTitle);
        const rangeDoEpisodio = detectSeasonRange(raw.containerText);
        const rangeDaTemporada = detectSeasonRange(ctx.postTitle) ??
            detectSeasonRange(ctx.pageTitle);
        const range = (rangeDoEpisodio && rangeDoEpisodio.seasonStart > 0 ? rangeDoEpisodio : null) ??
            rangeDaTemporada ??
            rangeDoEpisodio;
        const rangeEp = (0, TechnicalWords_js_1.extrairRangeEpisodios)(raw.containerText);
        let episodeStart = rangeEp?.episodeStart ?? undefined;
        if (episodeStart === undefined && canonicalName) {
            const rangeCanonical = (0, TechnicalWords_js_1.extrairRangeEpisodios)(canonicalName);
            episodeStart = rangeCanonical?.episodeStart ?? undefined;
        }
        const episode = episodeStart;
        const qualityMatch = raw.qualityMatch || ctx.metadata.quality?.match(/(\d{3,4}p|4K|FullHD|HD)/i)?.[0];
        const sizeMatch = raw.sizeMatch || ctx.metadata.size?.trim();
        const seasonLabel = range && range.seasonStart > 0
            ? (range.seasonStart === range.seasonEnd
                ? `${range.seasonStart}ª Temporada`
                : `${range.seasonStart}ª à ${range.seasonEnd}ª Temporada`)
            : '';
        const magnetTitle = seasonLabel
            ? `${ctx.pageTitle} - ${seasonLabel}${episode ? ` Episódio ${episode}` : ''}${language ? ` [${language}]` : ''}${qualityMatch ? ` ${qualityMatch}` : ''}`
            : [ctx.pageTitle, episode ? `Episódio ${episode}` : '', language ? `[${language}]` : '', qualityMatch].filter(Boolean).join(' ');
        const htmlTitleLimpo = raw.containerText
            .replace(/MAGNET LINK/gi, '')
            .replace(/\s+/g, ' ')
            .trim() || undefined;
        return {
            title: magnetTitle,
            htmlTitle: htmlTitleLimpo,
            magnet: raw.href,
            infoHash,
            seeders: 0,
            size: sizeMatch || '',
            language,
            originalTitle: ctx.tituloDoPost,
            year,
            years,
            canonicalName,
            season: range?.seasonStart && range.seasonStart > 0 ? range.seasonStart : undefined,
            episode,
        };
    }
    catch (err) {
        logger.warn(`HDR: erro ao processar magnet`, { magnet: raw.href.substring(0, 60), error: err.message });
        return null;
    }
}
async function extractMagnetsFromPost(html, postTitle, postUrl, targetSeason, mediaType) {
    const $ = cheerio.load(html);
    const h1Title = $('h1').first().text().replace(/Torrent.*$/i, '').trim();
    const titleTag = $('title').text().replace(/Torrent.*$/i, '').trim();
    const pageTitle = h1Title || titleTag || postTitle;
    const { blocks: jsonLdBlocks } = parseJsonLdBlocks($);
    const metadata = extractHdrMetadata($, jsonLdBlocks);
    const tituloDoPost = (metadata.originalTitle && (0, TechnicalWords_js_1.normalizarTexto)(metadata.originalTitle).length > 0
        ? metadata.originalTitle
        : undefined) ??
        (metadata.originalTitleBruto && (0, TechnicalWords_js_1.normalizarTexto)(metadata.originalTitleBruto).length > 0
            ? metadata.originalTitleBruto
            : undefined) ??
        pageTitle ??
        postTitle;
    const secaoHeaders = detectarSecoes($, html);
    const { rawLinks, totalAnchors } = coletarRawLinks($, html, secaoHeaders, { postTitle, pageTitle, targetSeason, mediaType });
    const ctx = { pageTitle, postTitle, tituloDoPost, metadata, targetSeason, mediaType };
    const results = [];
    for (const raw of rawLinks) {
        const torrent = await processarRawLink(raw, ctx);
        if (torrent)
            results.push(torrent);
    }
    logger.debug(`HDR extract | "${truncar(postTitle)}" | anchors=${totalAnchors} rawLinks=${rawLinks.length} magnets=${results.length}`);
    if (results.length > 0) {
        logger.debug(`HDR post | "${truncar(postTitle)}" | title=${metadata.origem.title} year=${metadata.origem.year} | ${results.length} magnets`);
    }
    return results;
}
function validarImdb(html, imdbId, titulo, mediaType) {
    if (!imdbId)
        return { imdbConfirmed: false, mismatch: false, imdbIdDoPost: null };
    const imdbIdDoPost = html.match(/imdb\.com\/title\/(tt\d+)/i)?.[1] || null;
    if (!imdbIdDoPost)
        return { imdbConfirmed: false, mismatch: false, imdbIdDoPost: null };
    const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(titulo, mediaType);
    if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
        return { imdbConfirmed: false, mismatch: true, imdbIdDoPost };
    }
    return { imdbConfirmed: !isCollection, mismatch: false, imdbIdDoPost };
}
async function processarPostHdr(item, imdbId, targetSeason, mediaType) {
    let html;
    try {
        html = await fetchComSessao(item.postUrl);
    }
    catch (err) {
        const classificacao = classificarErroFonte(err);
        if (classificacao === 'fonte') {
            breakerRegistrarFalha(FONTE);
        }
        logger.debug(`HDR post falhou | "${truncar(item.title)}" | ${classificacao} | ${err.message}`);
        return { torrents: [], imdbConfirmed: false };
    }
    const validacao = validarImdb(html, imdbId, item.title, mediaType);
    if (validacao.mismatch) {
        logger.debug(`HDR imdb mismatch | "${truncar(item.title)}" | post=${validacao.imdbIdDoPost} alvo=${imdbId}`);
        return { torrents: [], imdbConfirmed: false };
    }
    const torrents = await extractMagnetsFromPost(html, item.title, item.postUrl, targetSeason, mediaType);
    if (torrents.length === 0) {
        logger.debug(`HDR post vazio | "${truncar(item.title)}" | html=${html.length}b`);
    }
    return { torrents, imdbConfirmed: validacao.imdbConfirmed };
}
function filtrarPorSimilaridade(links, frases, mediaType) {
    return links.filter(link => {
        const resultado = exports.similarity.preFiltroContem(frases, link.title);
        const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(link.title, mediaType);
        if (!resultado.match && !isCollection) {
            return false;
        }
        return true;
    });
}
function dedupPorPostUrl(items, seen) {
    return items.filter(item => {
        if (seen.has(item.postUrl))
            return false;
        seen.add(item.postUrl);
        return true;
    });
}
async function searchHdr(query, type = 'movie', targetSeason, searchQueries, targetYear, imdbId, mediaType) {
    const startTime = Date.now();
    const qTruncada = truncar(query);
    const queriesParaBusca = searchQueries && searchQueries.length > 0 ? [...searchQueries] : [query];
    const frasesValidas = queriesParaBusca.map(f => (0, TechnicalWords_js_1.normalizarTexto)(f)).filter(Boolean);
    const ncKey = negativeCacheKey(FONTE, query, {
        type,
        season: targetSeason ?? 0,
        mediaType: mediaType ?? null,
    });
    if (negativeCacheIsBlocked(ncKey)) {
        logger.debug(`HDR: negative cache HIT | "${qTruncada}"`);
        return [];
    }
    if (!breakerPodeUsar(FONTE)) {
        logger.debug(`HDR: circuit breaker OPEN, pulando searchHdr | "${qTruncada}"`);
        return [];
    }
    try {
        const allResults = [];
        const seenInfoHashes = new Set();
        const seenPostUrls = new Set();
        let queriesComResultado = 0;
        let houveErro = false;
        let houveSucesso = false;
        for (const q of queriesParaBusca) {
            const t0 = Date.now();
            const qLog = truncar(q);
            const searchResult = await searchHdrLinks(q, targetSeason, mediaType);
            if (searchResult.status === 'blocked') {
                logger.debug(`HDR: breaker abriu no meio do loop | "${qLog}"`);
                break;
            }
            if (searchResult.status === 'error') {
                houveErro = true;
                continue;
            }
            if (searchResult.status === 'empty') {
                houveSucesso = true;
                continue;
            }
            houveSucesso = true;
            const links = searchResult.items;
            if (links.length === 0) {
                logger.debug(`HDR: "${qLog}" | 0 links (${Date.now() - t0}ms)`);
                continue;
            }
            const filtrados = filtrarPorSimilaridade(links, frasesValidas, mediaType);
            if (filtrados.length === 0) {
                logger.debug(`HDR: "${qLog}" | ${links.length} links, 0 relevantes (${Date.now() - t0}ms)`);
                continue;
            }
            const novos = dedupPorPostUrl(filtrados, seenPostUrls);
            if (novos.length === 0) {
                logger.debug(`HDR: "${qLog}" | ${links.length} links, ${filtrados.length} relevantes, 0 novos (${Date.now() - t0}ms)`);
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
            logger.debug(`HDR: "${qLog}" | ${links.length} links, ${filtrados.length} relevantes, ${novos.length} novos, ${magnetsDaQuery} magnets (${Date.now() - t0}ms)`);
        }
        const duration = Date.now() - startTime;
        if (allResults.length === 0 && houveSucesso && !houveErro) {
            negativeCacheMark(ncKey);
            logger.info(`HDR: 0 resultados, cacheado negativo | "${qTruncada}" | ttlMs=${exports.NEGATIVE_DEFAULT_TTL_MS}`);
        }
        logger.info(`HDR: ${allResults.length} magnets em ${duration}ms | queries=${queriesParaBusca.length} comResultado=${queriesComResultado}`);
        return allResults;
    }
    catch (err) {
        logger.error('HDR erro', { query: truncar(query, 50), error: err.message });
        breakerRegistrarFalha(FONTE);
        return [];
    }
}
