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
exports.BludvScraper = exports.AXIOS_OPTS = exports.PROVIDER = exports.BASE_URL = void 0;
exports.bludvNegativeClear = bludvNegativeClear;
exports.bludvNegativeStats = bludvNegativeStats;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const dns_1 = __importDefault(require("dns"));
const https_1 = __importDefault(require("https"));
const tls_1 = __importDefault(require("tls"));
const logger_js_1 = require("../../utils/logger.js");
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
const magnetHelper_js_1 = require("../../magnet/magnetHelper.js");
const TechnicalWords_js_1 = require("../../titulos/TechnicalWords.js");
const SimilarityCalculator_js_1 = require("../../titulos/SimilarityCalculator.js");
const LEGENDADO_REGEX = new RegExp('\\b(' + TechnicalWords_js_1.INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b', 'i');
const logger = new logger_js_1.Logger('BludvScraper');
dns_1.default.setServers(['8.8.8.8', '1.1.1.1']);
class DnsAgent extends https_1.default.Agent {
    createConnection(options, cb) {
        const hostname = options.hostname || options.host || '';
        dns_1.default.resolve4(hostname, (err, addresses) => {
            if (err)
                return cb(err);
            const sock = tls_1.default.connect({
                host: addresses[0],
                port: options.port || 443,
                servername: hostname,
                rejectUnauthorized: false,
            }, () => cb(null, sock));
            sock.on('error', cb);
        });
        return undefined;
    }
}
const dnsAgent = new DnsAgent({ keepAlive: true });
const lookupCustomizado = (hostname, _opts, cb) => {
    dns_1.default.resolve4(hostname, (err, addresses) => {
        if (err)
            return cb(err);
        cb(null, addresses[0], 4);
    });
};
const BASE_URL = 'https://bludvfilmes2.xyz';
exports.BASE_URL = BASE_URL;
const PROVIDER = 'BLUDV Filmes';
exports.PROVIDER = PROVIDER;
const AXIOS_OPTS = {
    timeout: 15000,
    httpsAgent: dnsAgent,
    lookup: lookupCustomizado,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
    },
};
exports.AXIOS_OPTS = AXIOS_OPTS;
const CAT_FILMES = 92;
const CAT_SERIES = 10;
const LYRA_MARK = 'data-lyra-h';
const SECTION_KEYWORDS = /\b(dual|dublado|dublada|dublagem|legendado|legendada|nacional)\b/gi;
const BLUDV_NEGATIVE_TTL_MS = 30 * 60 * 1000;
const BLUDV_NEGATIVE_MAX = 5000;
const bludvNegativeStore = new Map();
function bludvNegativeKey(query, extra) {
    const q = query.trim().toLowerCase();
    return `bludv|${q}|${JSON.stringify(extra)}`;
}
function bludvNegativeIsBlocked(key) {
    const entry = bludvNegativeStore.get(key);
    if (!entry)
        return false;
    if (Date.now() - entry.ts > entry.ttlMs) {
        bludvNegativeStore.delete(key);
        return false;
    }
    entry.hits++;
    return true;
}
function bludvNegativeMark(key, ttlMs = BLUDV_NEGATIVE_TTL_MS) {
    if (bludvNegativeStore.size >= BLUDV_NEGATIVE_MAX) {
        const first = bludvNegativeStore.keys().next().value;
        if (first)
            bludvNegativeStore.delete(first);
    }
    bludvNegativeStore.set(key, { ts: Date.now(), ttlMs, hits: 0 });
}
function bludvNegativeClear() {
    bludvNegativeStore.clear();
}
function bludvNegativeStats() {
    const agora = Date.now();
    return {
        size: bludvNegativeStore.size,
        maxEntries: BLUDV_NEGATIVE_MAX,
        defaultTtlMs: BLUDV_NEGATIVE_TTL_MS,
        entries: Array.from(bludvNegativeStore.entries()).map(([key, v]) => ({
            key,
            ageMs: agora - v.ts,
            ttlMs: v.ttlMs,
            expiraEmMs: Math.max(0, v.ttlMs - (agora - v.ts)),
            hits: v.hits,
        })),
    };
}
function pad2(n) {
    return String(n).padStart(2, '0');
}
function dedupByMagnet(magnets) {
    const vistos = new Set();
    return magnets.filter(m => {
        if (vistos.has(m.magnet))
            return false;
        vistos.add(m.magnet);
        return true;
    });
}
function truncar(s, n = 60) {
    return s.length > n ? s.substring(0, n) + '…' : s;
}
function mapearCategoriaBludv(mediaType) {
    if (mediaType === 'movie')
        return CAT_FILMES;
    if (mediaType === 'series' || mediaType === 'tv')
        return CAT_SERIES;
    return null;
}
class BludvScraper {
    constructor() {
        this.BATCH_SIZE = 5;
        this.qualityDetector = new qualityDetector_js_1.QualityDetector();
        this.similarity = SimilarityCalculator_js_1.SimilarityCalculator.getInstance();
    }
    async search(query, type, targetSeason, searchQueries, imdbId, mediaType) {
        try {
            const queriesParaBusca = searchQueries && searchQueries.length > 0 ? searchQueries : [query];
            const frasesBusca = this.montarFrasesDeBusca(query, searchQueries);
            const allPosts = [];
            const seenUrls = new Set();
            for (const q of queriesParaBusca) {
                const ncKey = bludvNegativeKey(q, {
                    type,
                    season: targetSeason ?? 0,
                    mediaType: mediaType ?? null,
                });
                if (bludvNegativeIsBlocked(ncKey)) {
                    logger.debug(`[BLUDV] negative cache HIT | "${truncar(q)}"`);
                    continue;
                }
                let posts;
                try {
                    posts = await this.searchPosts(q, targetSeason, frasesBusca, mediaType);
                }
                catch (err) {
                    logger.warn(`[BLUDV] "${truncar(q)}" falhou: ${err.code || err.message}`);
                    continue;
                }
                if (posts.length === 0) {
                    bludvNegativeMark(ncKey);
                    logger.info(`[BLUDV] 0 resultados, cacheado negativo | "${truncar(q)}" | ttlMs=${BLUDV_NEGATIVE_TTL_MS}`);
                    logger.debug(`[BLUDV] "${q}" → 0`);
                    continue;
                }
                for (const post of posts) {
                    if (!seenUrls.has(post.url)) {
                        seenUrls.add(post.url);
                        allPosts.push(post);
                    }
                }
                logger.debug(`[BLUDV] "${q}" → ${posts.length} posts`);
                break;
            }
            if (!allPosts.length)
                return [];
            logger.info(`[BLUDV] ${allPosts.length} posts (${queriesParaBusca.length} queries)` +
                (targetSeason !== undefined ? ` season=${targetSeason}` : ''));
            const postResults = await Promise.all(allPosts.map(item => this.scrapePost(item.url, type, targetSeason, imdbId, mediaType).catch(() => [])));
            return postResults.flat();
        }
        catch (err) {
            logger.warn(`[BLUDV] falha na busca: ${err.code || err.message}`);
            return [];
        }
    }
    async searchPosts(query, targetSeason, frasesBusca, mediaType) {
        const catId = mapearCategoriaBludv(mediaType);
        const searchUrl = catId
            ? `${BASE_URL}/?s=${encodeURIComponent(query)}&cat=${catId}`
            : `${BASE_URL}/?s=${encodeURIComponent(query)}`;
        const res = await axios_1.default.get(searchUrl, AXIOS_OPTS);
        const $ = cheerio.load(res.data);
        if ($('body').hasClass('search-no-results'))
            return [];
        const items = [];
        const urlsVistas = new Set();
        $('a[href]').each((_, el) => {
            const href = ($(el).attr('href') || '').trim();
            const text = ($(el).text() || '').trim()
                || ($(el).find('img').attr('alt') || '').trim()
                || ($(el).find('img').attr('title') || '').trim();
            if (!href.includes('bludvfilmes'))
                return;
            let path;
            try {
                path = new URL(href).pathname;
            }
            catch {
                return;
            }
            const segments = path.split('/').filter(Boolean);
            if (segments.length !== 1 || segments[0].length <= 20 || !segments[0].includes('-'))
                return;
            const fullUrl = href.startsWith('http') ? href : `${BASE_URL}/${segments[0]}/`;
            if (urlsVistas.has(fullUrl))
                return;
            urlsVistas.add(fullUrl);
            items.push({ title: text, url: fullUrl });
        });
        const filtrados = items
            .filter(item => this.postRelevante(item, targetSeason, frasesBusca, mediaType))
            .slice(0, 5);
        logger.debug(`[BLUDV] "${truncar(query, 40)}" | cat=${catId ?? 'all'} candidatos=${items.length} filtrados=${filtrados.length}`);
        return filtrados;
    }
    postRelevante(item, targetSeason, frasesBusca, mediaType) {
        const lowerTitle = item.title.toLowerCase();
        if (LEGENDADO_REGEX.test(lowerTitle) && !/dual|dublado|dublada/i.test(lowerTitle)) {
            logger.debug(`[BLUDV] ignorado legendado: "${truncar(item.title, 55)}"`);
            return false;
        }
        if (/\blist[aã]o\b/i.test(lowerTitle))
            return false;
        if (targetSeason !== undefined) {
            const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(item.title);
            if (!(0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, targetSeason))
                return false;
        }
        const resultado = this.similarity.preFiltroContem([...frasesBusca.frases], item.title);
        const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(item.title, mediaType);
        if (!resultado.match && !isCollection) {
            logger.debug(`[BLUDV] ignorado`, { score: resultado.score.toFixed(2), titulo: item.title.substring(0, 60) });
            return false;
        }
        if (!resultado.match && isCollection) {
            logger.debug(`[BLUDV] aceito coleção`, { titulo: item.title.substring(0, 60), mediaType: mediaType ?? '-' });
        }
        else {
            logger.debug(`[BLUDV] aceito`, { score: resultado.score.toFixed(2), frase: resultado.fraseVencedora || '-', titulo: item.title.substring(0, 60) });
        }
        return true;
    }
    async scrapePost(postUrl, type, targetSeason, imdbId, mediaType) {
        const res = await axios_1.default.get(postUrl, AXIOS_OPTS);
        const $ = cheerio.load(res.data);
        const $content = $('.content');
        if (!$content.length) {
            logger.debug(`[BLUDV] post sem .content: ${postUrl}`);
            return [];
        }
        let counter = 0;
        $content.find('*').each((_, el) => {
            $(el).attr(LYRA_MARK, String(counter++));
        });
        const contentHtml = $content.html() || '';
        logger.debug(`[BLUDV] marcados=${counter} contentLen=${contentHtml.length}`);
        const postTitle = $('h1').first().text().trim() ||
            $('title').first().text().trim().replace(/\s*[-–]\s*BLUDV FILMES.*$/, '');
        let imdbConfirmed = false;
        if (imdbId) {
            const imdbIdDoPost = res.data.match(/imdb\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d+)/i)?.[1] || null;
            if (imdbIdDoPost) {
                const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(postTitle, mediaType);
                if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase())
                    return [];
                if (!isCollection)
                    imdbConfirmed = true;
            }
        }
        if (targetSeason !== undefined) {
            const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(postTitle);
            if (!(0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, targetSeason))
                return [];
        }
        const metadata = this.extractPostMetadata($);
        const sections = this.findSections($, contentHtml);
        logger.debug(`[BLUDV] seções | ${sections.map(s => `${s.type}[${s.start}-${s.end}]`).join(' ') || '(nenhuma)'}`);
        const temDual = sections.some(s => s.type === 'DUAL');
        const tituloDeclaraDual = /\bdual\b|\bdublado\b|\bdublada\b|\bnacional\b/i.test(postTitle);
        const metadataDeclaraDual = !!metadata.language
            && /dual|dublado|dublagem|nacional|portugu[eê]s\s*\|\s*ingl[eê]s/i.test(metadata.language);
        const usarFallbackDual = !temDual && (tituloDeclaraDual || metadataDeclaraDual);
        if (!temDual && !usarFallbackDual) {
            logger.debug(`[BLUDV] SEM_DUAL | magnetAnchors=${$('a[href^="magnet:"]').length} ` +
                `lang="${metadata.language || '-'}" original="${truncar(metadata.originalTitle || '-', 40)}"`);
            return [];
        }
        if (usarFallbackDual) {
            logger.debug(`[BLUDV] FALLBACK_DUAL | sem seção, assumindo DUAL | "${truncar(postTitle, 55)}" ` +
                `| titulo=${tituloDeclaraDual} metadata=${metadataDeclaraDual}`);
        }
        const sectionsEfetivas = temDual
            ? sections
            : [{ type: 'DUAL', start: 0, end: contentHtml.length }];
        const directMagnets = this.extractDirectMagnets($, contentHtml, sectionsEfetivas);
        const protectorLinks = this.extractProtectorLinks($, contentHtml, sectionsEfetivas);
        const dirDual = directMagnets.length;
        const proDual = protectorLinks.length;
        const protectorMagnets = await this.resolverMagnetsDoProtetor(protectorLinks);
        const allMagnets = dedupByMagnet([...directMagnets, ...protectorMagnets]);
        if (allMagnets.length === 0) {
            logger.debug(`[BLUDV] magnet DUAL diretos=${dirDual} protetores=${proDual} → 0 válidos`);
            return [];
        }
        const sampleSize = Math.min(3, allMagnets.length);
        for (let i = 0; i < sampleSize; i++) {
            const t = allMagnets[i].tree;
            logger.debug(`[BLUDV] tree #${i + 1} | proprio="${truncar(t.proprio, 30)}" | img="${t.imgAlt || '-'}" | ` +
                `contextoAcima="${truncar(t.contextoAcima, 45)}"`);
        }
        const analyzedMagnets = await Promise.all(allMagnets.map(async ({ magnet, tree, secao }) => {
            let canonicalName;
            try {
                const dados = await (0, magnetHelper_js_1.analisarMagnet)(magnet);
                canonicalName = dados?.nome || undefined;
            }
            catch { }
            return { magnet, tree, canonicalName, secao };
        }));
        const results = [];
        const cleanTitleFromPost = this.extractTitleFromPostTitle(postTitle);
        for (const { magnet, tree, canonicalName, secao } of analyzedMagnets) {
            const { qualidade: quality, fonte: fonteQualidade } = this.resolverQualidade(tree, canonicalName, metadata.quality, postTitle);
            const { episode, episodeRangeText } = this.resolverEpisodio(tree, canonicalName);
            const language = this.resolverIdioma(secao, metadata.language);
            const dnColecao = canonicalName && (0, TechnicalWords_js_1.isCollectionTitle)(canonicalName, mediaType) ? canonicalName : null;
            const originalTitleFinal = dnColecao || metadata.originalTitle || cleanTitleFromPost;
            const displayTitle = originalTitleFinal || postTitle;
            const canonicalFinal = canonicalName || this.sintetizarCanonicalName(originalTitleFinal || postTitle, metadata.years, quality);
            const size = metadata.size
                || this.extrairTamanhoDoContexto(tree.contextoAcima)
                || 'Desconhecido';
            const cleanedHtmlTitle = episodeRangeText
                ? `${episodeRangeText}: ${quality}`
                : undefined;
            logger.debug(`[BLUDV] magnet | qual=${quality}(${fonteQualidade}) | ep=${episode ?? '-'} | ` +
                `ctx="${truncar(tree.contextoAcima, 40)}"`);
            results.push({
                title: this.cleanTitle(displayTitle),
                htmlTitle: cleanedHtmlTitle || undefined,
                magnet,
                seeders: 0,
                leechers: 0,
                size,
                quality,
                provider: PROVIDER,
                language,
                type,
                relevanceScore: 0.85,
                sizeInBytes: this.parseSize(size),
                season: targetSeason,
                episode,
                lastUpdated: new Date(),
                confidence: 0.9,
                originalTitle: originalTitleFinal ?? undefined,
                year: metadata.year,
                years: metadata.years,
                canonicalName: canonicalFinal,
                imdbConfirmed,
            });
        }
        logger.debug(`[BLUDV] "${truncar(postTitle, 55)}" → DUAL diretos=${dirDual} protetores=${proDual} válidos=${results.length}`);
        return results;
    }
    findSections($, contentHtml) {
        const encontrados = new Map();
        const textNodes = />([^<]+)</g;
        let m;
        while ((m = textNodes.exec(contentHtml)) !== null) {
            const texto = m[1];
            const basePos = m.index + 1;
            SECTION_KEYWORDS.lastIndex = 0;
            let km;
            while ((km = SECTION_KEYWORDS.exec(texto)) !== null) {
                const posHtml = basePos + km.index;
                const ultimaMarca = contentHtml.lastIndexOf(`${LYRA_MARK}="`, posHtml);
                if (ultimaMarca === -1)
                    continue;
                const resto = contentHtml.substring(ultimaMarca + LYRA_MARK.length + 2);
                const fimAspas = resto.indexOf('"');
                if (fimAspas === -1)
                    continue;
                const elIdx = resto.substring(0, fimAspas);
                if (!encontrados.has(elIdx)) {
                    encontrados.set(elIdx, { posHtml, texto: texto.trim() });
                }
            }
        }
        logger.debug(`[BLUDV] findSections matches únicos=${encontrados.size}`);
        const candidatos = [];
        const descartados = [];
        for (const [elIdx, info] of encontrados) {
            const $el = $(`[${LYRA_MARK}="${elIdx}"]`);
            if (!$el.length)
                continue;
            const tag = ($el.prop('tagName') || '').toLowerCase();
            const textoEl = $el.text().replace(/\s+/g, ' ').trim();
            const textoCurto = truncar(textoEl, 45);
            const r1MagnetDesc = $el.find('a[href^="magnet:"]').length;
            const r1 = r1MagnetDesc > 0 ? 'REJEITA' : 'passa';
            let r2 = 'passa';
            let r2Detalhe = 'sem-ancestral-com-magnet';
            let $pai = $el.parent();
            for (let nivel = 0; nivel < 3 && $pai.length; nivel++) {
                const qtd = $pai.children('a[href^="magnet:"]').length;
                if (qtd > 0) {
                    r2 = 'REJEITA';
                    const tagPai = ($pai.prop('tagName') || '').toLowerCase();
                    r2Detalhe = `n${nivel + 1}=${tagPai}(${qtd}magnet)`;
                    break;
                }
                $pai = $pai.parent();
            }
            logger.debug(`   [check] <${tag}> "${textoCurto}" | r1=${r1}(desc=${r1MagnetDesc}) | r2=${r2}(${r2Detalhe})`);
            if (tag === 'script' || tag === 'style') {
                descartados.push({ texto: textoEl, motivo: `tag-${tag}` });
                continue;
            }
            if (!textoEl)
                continue;
            if (r1MagnetDesc > 0) {
                descartados.push({ texto: textoEl, motivo: 'r1:magnet-descendente' });
                continue;
            }
            if (r2 === 'REJEITA') {
                descartados.push({ texto: textoEl, motivo: `r2:${r2Detalhe}` });
                continue;
            }
            const diag = this.diagnosticarSecao(textoEl);
            if (diag.tipo === 'NONE') {
                descartados.push({ texto: textoEl, motivo: diag.motivo });
                continue;
            }
            const pos = contentHtml.indexOf($el.toString());
            if (pos === -1) {
                descartados.push({ texto: textoEl, motivo: 'pos-nao-encontrada' });
                continue;
            }
            candidatos.push({ tipo: diag.tipo, pos, texto: textoEl });
        }
        logger.debug(`[BLUDV] findSections candidatos=${candidatos.length} descartados=${descartados.length}`);
        for (const d of descartados.slice(0, 10)) {
            logger.debug(`   [descarte] "${truncar(d.texto, 40)}" → ${d.motivo}`);
        }
        candidatos.sort((a, b) => a.pos - b.pos);
        if (candidatos.length === 0) {
            return [{ type: 'NONE', start: 0, end: contentHtml.length }];
        }
        const sections = [];
        if (candidatos[0].pos > 0) {
            sections.push({ type: 'NONE', start: 0, end: candidatos[0].pos });
        }
        for (let i = 0; i < candidatos.length; i++) {
            const c = candidatos[i];
            const prox = candidatos[i + 1];
            sections.push({
                type: c.tipo,
                start: c.pos,
                end: prox ? prox.pos : contentHtml.length,
            });
        }
        logger.debug(`[BLUDV] findSections secoes=${sections.length}`);
        for (const s of sections) {
            logger.debug(`   [secao] ${s.type} [${s.start}..${s.end}] (len=${s.end - s.start})`);
        }
        return sections;
    }
    findSectionForPosition(pos, sections) {
        for (const s of sections) {
            if (pos >= s.start && pos < s.end)
                return s;
        }
        return null;
    }
    detectSectionType(text) {
        return this.diagnosticarSecao(text).tipo;
    }
    diagnosticarSecao(text) {
        const t = (0, TechnicalWords_js_1.normalizarTexto)(text).trim();
        const flags = {
            vazio: !t,
            ruido: /^(trailer|assistir|baixar|download|ver)\b/i.test(t),
            comprido: t.length > 60,
            dual: /\bdual\b/.test(t) && /\baudio\b/.test(t),
            dublado: /\bdublado\b|\bdublada\b|\bdublagem\b/.test(t),
            nacional: /\bnacional\b/.test(t),
            legendado: /\blegendado\b|\blegendada\b/.test(t),
        };
        if (flags.vazio)
            return { tipo: 'NONE', motivo: 'vazio', flags };
        if (flags.ruido)
            return { tipo: 'NONE', motivo: 'palavra-ruido', flags };
        if (flags.comprido)
            return { tipo: 'NONE', motivo: `len=${t.length}`, flags };
        if (flags.legendado && !flags.dual && !flags.dublado && !flags.nacional) {
            return { tipo: 'LEGENDADO', motivo: 'legendado-only', flags };
        }
        if ((flags.dual || flags.dublado || flags.nacional) && !flags.legendado) {
            const tags = [
                flags.dual && 'dual',
                flags.dublado && 'dublado',
                flags.nacional && 'nacional',
            ].filter(Boolean).join('+');
            return { tipo: 'DUAL', motivo: tags, flags };
        }
        if (flags.legendado && (flags.dual || flags.dublado || flags.nacional)) {
            return { tipo: 'NONE', motivo: 'conflito:dual+legendado', flags };
        }
        return { tipo: 'NONE', motivo: 'sem-indicador', flags };
    }
    extrairTextoDeHtml(html) {
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
    extrairTreeDoMagnet($, el, contextoAcima = '') {
        const $el = $(el);
        const proprio = $el.text().trim().replace(/\s+/g, ' ');
        const filhos = [];
        $el.find('strong, b, span').each((_, child) => {
            const t = $(child).text().trim().replace(/\s+/g, ' ');
            if (t && t !== proprio)
                filhos.push(t);
        });
        const $img = $el.find('img').first();
        const imgAlt = ($img.attr('alt') || $img.attr('title') || '').trim() || null;
        const $pai = $el.parent();
        const $paiClone = $pai.clone();
        $paiClone.find('a').remove();
        const paiTexto = $paiClone.text().trim().replace(/\s+/g, ' ');
        const irmaos = [];
        $pai.children('a').each((_, irmao) => {
            if (irmao === el)
                return;
            const t = $(irmao).text().trim().replace(/\s+/g, ' ');
            if (t)
                irmaos.push(t);
        });
        return { proprio, filhos, imgAlt, paiTexto, irmaos, contextoAcima };
    }
    extractDirectMagnets($, contentHtml, sections) {
        const allMagnetAnchors = $('a[href^="magnet:"]').toArray();
        const stats = { DUAL: 0, LEGENDADO: 0, NONE: 0 };
        const candidatos = [];
        for (const el of allMagnetAnchors) {
            const magnet = $(el).attr('href')?.trim();
            if (!magnet)
                continue;
            const htmlStr = $(el).toString();
            const pos = contentHtml.indexOf(htmlStr);
            if (pos === -1) {
                stats.NONE++;
                continue;
            }
            const section = this.findSectionForPosition(pos, sections);
            const secao = section?.type ?? 'NONE';
            stats[secao]++;
            candidatos.push({ el, magnet, pos, htmlLen: htmlStr.length, secao, section });
        }
        const contextoPorEl = new Map();
        const porSecaoDual = new Map();
        for (const c of candidatos) {
            if (c.secao !== 'DUAL' || !c.section)
                continue;
            if (!porSecaoDual.has(c.section))
                porSecaoDual.set(c.section, []);
            porSecaoDual.get(c.section).push(c);
        }
        for (const [section, mags] of porSecaoDual) {
            mags.sort((a, b) => a.pos - b.pos);
            let prevFim = section.start;
            for (const mag of mags) {
                if (mag.pos > prevFim) {
                    const trecho = contentHtml.substring(prevFim, mag.pos);
                    contextoPorEl.set(mag.el, this.extrairTextoDeHtml(trecho));
                }
                else {
                    contextoPorEl.set(mag.el, '');
                }
                prevFim = mag.pos + mag.htmlLen;
            }
        }
        const resultados = [];
        for (const c of candidatos) {
            if (c.secao !== 'DUAL')
                continue;
            const contextoAcima = contextoPorEl.get(c.el) || '';
            resultados.push({
                magnet: c.magnet,
                tree: this.extrairTreeDoMagnet($, c.el, contextoAcima),
                secao: c.secao,
            });
        }
        if (allMagnetAnchors.length > 0) {
            logger.debug(`[BLUDV] magnets brutos=${allMagnetAnchors.length} | DUAL=${stats.DUAL} LEGENDADO=${stats.LEGENDADO} NONE=${stats.NONE}`);
        }
        return resultados;
    }
    extractProtectorLinks($, contentHtml, sections) {
        const allLinks = $('a[href*="systemads1.com"]').toArray();
        if (!allLinks.length)
            return [];
        const result = [];
        const stats = { DUAL: 0, LEGENDADO: 0, NONE: 0 };
        for (const el of allLinks) {
            const pos = contentHtml.indexOf($(el).toString());
            if (pos === -1) {
                stats.NONE++;
                continue;
            }
            const section = this.findSectionForPosition(pos, sections);
            const secao = section?.type ?? 'NONE';
            stats[secao]++;
            if (secao !== 'DUAL')
                continue;
            result.push({
                url: $(el).attr('href'),
                tree: this.extrairTreeDoMagnet($, el),
                secao,
            });
        }
        logger.debug(`[BLUDV] protetores brutos=${allLinks.length} | DUAL=${stats.DUAL} LEGENDADO=${stats.LEGENDADO} NONE=${stats.NONE}`);
        return result;
    }
    async resolverMagnetsDoProtetor(links) {
        const resultado = [];
        for (let i = 0; i < links.length; i += this.BATCH_SIZE) {
            const batch = links.slice(i, i + this.BATCH_SIZE);
            const batchResults = await Promise.all(batch.map(async (link) => {
                const magnet = await this.extractMagnetFromProtector(link.url);
                if (!magnet)
                    return null;
                return { magnet, tree: link.tree, secao: link.secao };
            }));
            for (const r of batchResults) {
                if (r)
                    resultado.push(r);
            }
        }
        return resultado;
    }
    resolverIdioma(secao, metaLanguage) {
        if (secao === 'DUAL')
            return 'Dual';
        if (secao === 'LEGENDADO')
            return 'Legendado';
        if (!metaLanguage)
            return 'Desconhecido';
        const lower = metaLanguage.toLowerCase();
        if (lower.includes('|'))
            return 'Dual';
        if (lower.includes('nacional'))
            return 'Nacional';
        if (lower.includes('dual'))
            return 'Dual';
        if (lower.includes('dublado') || lower.includes('dublad'))
            return 'Dublado';
        if (LEGENDADO_REGEX.test(lower))
            return 'Legendado';
        return metaLanguage;
    }
    resolverQualidade(tree, canonicalName, metadataQuality, postTitle) {
        if (tree.contextoAcima) {
            const q = this.qualityDetector.extractBestQuality(tree.contextoAcima);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD') {
                return { qualidade: q, fonte: 'contextoAcima' };
            }
        }
        if (tree.proprio) {
            const q = this.qualityDetector.extractBestQuality(tree.proprio);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'proprio' };
        }
        if (tree.imgAlt) {
            const q = this.qualityDetector.extractBestQuality(tree.imgAlt);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'imgAlt' };
        }
        for (const filho of tree.filhos) {
            const q = this.qualityDetector.extractBestQuality(filho);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'filhos' };
        }
        if (tree.paiTexto) {
            const q = this.qualityDetector.extractBestQuality(tree.paiTexto);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'paiTexto' };
        }
        if (canonicalName) {
            const q = this.qualityDetector.extractBestQuality(canonicalName);
            if (q && this.qualityDetector.isValidQuality(q))
                return { qualidade: q, fonte: 'canonicalName' };
        }
        if (metadataQuality) {
            const q = this.qualityDetector.extractBestQuality(metadataQuality);
            if (q && this.qualityDetector.isValidQuality(q))
                return { qualidade: q, fonte: 'metadataQuality' };
        }
        if (postTitle) {
            const q = this.qualityDetector.extractBestQuality(postTitle);
            if (q && this.qualityDetector.isValidQuality(q))
                return { qualidade: q, fonte: 'postTitle' };
        }
        return { qualidade: 'HD', fonte: 'fallback' };
    }
    resolverEpisodio(tree, canonicalName) {
        const r1 = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(tree.proprio));
        if (r1)
            return r1;
        for (const filho of tree.filhos) {
            const r = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(filho));
            if (r)
                return r;
        }
        const epMatch = (tree.proprio + ' ' + tree.filhos.join(' ')).match(/EPIS[OÓ]DIO\s*(\d+)/i);
        if (epMatch) {
            const ep = parseInt(epMatch[1], 10);
            return { episode: ep, episodeRangeText: `Episódio ${pad2(ep)}` };
        }
        if (tree.contextoAcima) {
            const rCtx = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(tree.contextoAcima));
            if (rCtx)
                return rCtx;
            const epCtx = tree.contextoAcima.match(/EPIS[OÓ]DIO\s*(\d+)/i);
            if (epCtx) {
                const ep = parseInt(epCtx[1], 10);
                return { episode: ep, episodeRangeText: `Episódio ${pad2(ep)}` };
            }
        }
        if (tree.paiTexto) {
            const r4 = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(tree.paiTexto));
            if (r4)
                return r4;
        }
        for (const ir of tree.irmaos) {
            const r = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(ir));
            if (r)
                return r;
            const irMatch = ir.match(/EPIS[OÓ]DIO\s*(\d+)/i);
            if (irMatch) {
                const ep = parseInt(irMatch[1], 10);
                return { episode: ep, episodeRangeText: `Episódio ${pad2(ep)}` };
            }
        }
        if (canonicalName) {
            const r6 = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(canonicalName));
            if (r6)
                return r6;
        }
        return {};
    }
    formatarRange(range) {
        if (!range || range.episodeStart <= 0)
            return null;
        const texto = range.episodeEnd > range.episodeStart
            ? `Episódios ${pad2(range.episodeStart)}-${pad2(range.episodeEnd)}`
            : `Episódio ${pad2(range.episodeStart)}`;
        return { episode: range.episodeStart, episodeRangeText: texto };
    }
    montarFrasesDeBusca(query, searchQueries) {
        const allQueries = new Set([query, ...(searchQueries || [])]);
        const frases = new Set();
        for (const q of allQueries) {
            const phrase = (0, TechnicalWords_js_1.normalizarTexto)(q
                .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
                .replace(/\btemporada\s*\d+\b/gi, '')
                .replace(/\bseason\s*\d+\b/gi, '')
                .replace(/\b\d{4}\b/g, ''));
            if (phrase)
                frases.add(phrase);
        }
        logger.debug(`[BLUDV] frases=[${[...frases].join(' | ')}]`);
        return { frases };
    }
    extractTitleFromPostTitle(postTitle) {
        if (!postTitle)
            return null;
        return postTitle
            .replace(/\bTorrent\b.*$/i, '')
            .replace(/\s*[–|-]\s*.*$/, '')
            .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-DL|DUAL|Dublado|Legendado)\b.*$/i, '')
            .trim() || null;
    }
    extractPostMetadata($) {
        const getMetaValue = (fieldName) => {
            const target = fieldName.toLowerCase().replace(/:$/, '').trim();
            const label = $('em, b').toArray().find((el) => {
                const t = $(el).text().trim().toLowerCase().replace(/:$/, '').trim();
                return t === target;
            });
            if (!label)
                return undefined;
            const $label = $(label);
            const parentSpan = $label.closest('span');
            if (parentSpan.length) {
                const fullText = parentSpan.text().trim();
                const prefix = $label.text().trim();
                const idx = fullText.indexOf(prefix);
                if (idx !== -1) {
                    const after = fullText.substring(idx + prefix.length).trim();
                    if (after)
                        return after;
                }
            }
            const $parent = $label.parent();
            const parentHtml = $parent.html() || '';
            const labelHtml = $label.toString();
            const idxHtml = parentHtml.indexOf(labelHtml);
            if (idxHtml !== -1) {
                const after = parentHtml.substring(idxHtml + labelHtml.length);
                const match = after.match(/^[:\s]*(.*?)(?:<br|<b|<\/p|$)/i);
                if (match) {
                    const valor = match[1].replace(/<[^>]+>/g, '').trim();
                    if (valor)
                        return valor;
                }
            }
            return undefined;
        };
        const originalTitleRaw = getMetaValue('Título Original:') || getMetaValue('Titulo Original:');
        let originalTitle;
        if (originalTitleRaw && originalTitleRaw.length >= 3) {
            originalTitle = originalTitleRaw.split('|')[0].replace(/\(\d{4}\)$/, '').trim();
        }
        const yearRaw = getMetaValue('Lançamento:');
        let years = [];
        if (yearRaw) {
            years = yearRaw.match(/\b(19|20)\d{2}\b/g)?.map(y => parseInt(y)) || [];
        }
        const sizeRaw = getMetaValue('Tamanho:');
        let size;
        if (sizeRaw) {
            const tamanhos = sizeRaw.match(/([\d.,]+)\s*(GB|MB|KB)/gi) || [];
            if (tamanhos.length === 1)
                size = tamanhos[0];
        }
        return {
            quality: getMetaValue('Qualidade:'),
            size,
            language: getMetaValue('Áudio:'),
            originalTitle,
            year: years.length > 0 ? years[0] : undefined,
            years,
        };
    }
    async extractMagnetFromProtector(protectorUrl) {
        try {
            const res = await axios_1.default.get(protectorUrl, { ...AXIOS_OPTS, timeout: 8000, maxRedirects: 5 });
            const match = res.data.match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
            return match ? match[1] : null;
        }
        catch (err) {
            logger.warn(`[BLUDV] protetor falhou: ${err.message}`);
            return null;
        }
    }
    extrairTamanhoDoContexto(texto) {
        if (!texto)
            return undefined;
        const m = texto.match(/([\d.,]+)\s*(GB|MB|KB)\b/i);
        return m ? m[0] : undefined;
    }
    sintetizarCanonicalName(base, years, quality) {
        const anos = years && years.length > 0
            ? (years.length === 1
                ? `${years[0]}`
                : `${years[0]}-${years[years.length - 1]}`)
            : null;
        return [base, anos, quality].filter(Boolean).join(' ').trim();
    }
    cleanTitle(title) {
        return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    parseSize(sizeStr) {
        if (!sizeStr || sizeStr === 'Desconhecido' || sizeStr === '–')
            return 0;
        const match = sizeStr.match(/([\d,.]+)\s*(GB|MB|KB)/i);
        if (!match)
            return 0;
        const num = parseFloat(match[1].replace(',', '.'));
        const unit = match[2].toUpperCase();
        if (unit === 'GB')
            return num * 1024 * 1024 * 1024;
        if (unit === 'MB')
            return num * 1024 * 1024;
        if (unit === 'KB')
            return num * 1024;
        return 0;
    }
}
exports.BludvScraper = BludvScraper;
