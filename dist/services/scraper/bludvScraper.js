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
const BASE_URL = 'https://bludvfilmes1.xyz';
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
                const posts = await this.searchPosts(q, targetSeason, frasesBusca, mediaType);
                for (const post of posts) {
                    if (!seenUrls.has(post.url)) {
                        seenUrls.add(post.url);
                        allPosts.push(post);
                    }
                }
                if (allPosts.length > 0) {
                    logger.debug(`[BLUDV] "${q}" → ${posts.length} posts`);
                    break;
                }
                logger.debug(`[BLUDV] "${q}" → 0`);
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
        const tokensRuido = (0, TechnicalWords_js_1.calcularTokensRuido)(items.map(i => i.title));
        const filtrados = items
            .filter(item => this.postRelevante(item, targetSeason, frasesBusca, tokensRuido, mediaType))
            .slice(0, 5);
        logger.debug(`[BLUDV] "${truncar(query, 40)}" | cat=${catId ?? 'all'} candidatos=${items.length} filtrados=${filtrados.length}`);
        return filtrados;
    }
    postRelevante(item, targetSeason, frasesBusca, tokensRuido, mediaType) {
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
        const tituloLimpo = (0, TechnicalWords_js_1.limparPorRaridade)(item.title, tokensRuido);
        const resultado = this.similarity.compararComTitulos([...frasesBusca.frases], tituloLimpo);
        const ehSerie = mediaType === 'series' || mediaType === 'tv';
        const isCollection = !ehSerie && (0, TechnicalWords_js_1.isCollectionTitle)(item.title, mediaType);
        if (!resultado.match && !isCollection) {
            logger.debug(`[BLUDV] ignorado (${resultado.score.toFixed(2)} ${resultado.nivel}): "${truncar(item.title, 55)}"`);
            return false;
        }
        if (!resultado.match && isCollection) {
            logger.debug(`[BLUDV] aceito coleção: "${truncar(item.title, 60)}" mediaType=${mediaType ?? '-'}`);
        }
        else {
            logger.debug(`[BLUDV] aceito (${resultado.nivel} ${resultado.score.toFixed(2)}): "${truncar(item.title, 60)}"`);
        }
        return true;
    }
    async scrapePost(postUrl, type, targetSeason, imdbId, mediaType) {
        const res = await axios_1.default.get(postUrl, AXIOS_OPTS);
        const $ = cheerio.load(res.data);
        const contentHtml = $('.content').html() || $('body').html() || '';
        if (!contentHtml) {
            logger.debug(`[BLUDV] post sem .content: ${postUrl}`);
            return [];
        }
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
        const sections = this.findSections($, contentHtml, postTitle);
        logger.debug(`[BLUDV] seções | ${sections.map(s => `${s.type}[${s.start}-${s.end}]`).join(' ')}`);
        const temDual = sections.some(s => s.type === 'DUAL');
        const tituloDeclaraDual = /\bdual\b|\bdublado\b|\bdublada\b|\bnacional\b/i.test(postTitle);
        const metadataDeclaraDual = !!metadata.language
            && /dual|dublado|dublagem|nacional|portugu[eê]s\s*\|\s*ingl[eê]s/i.test(metadata.language);
        const usarFallbackDual = !temDual && (tituloDeclaraDual || metadataDeclaraDual);
        if (!temDual && !usarFallbackDual) {
            this.logarDiagnosticoSemDual($, contentHtml, postTitle, metadata);
            return [];
        }
        if (usarFallbackDual) {
            logger.debug(`[BLUDV] FALLBACK_DUAL | sem seção, assumindo DUAL | "${truncar(postTitle, 55)}" ` +
                `| titulo=${tituloDeclaraDual} metadata=${metadataDeclaraDual}`);
        }
        const sectionsEfetivas = temDual
            ? sections
            : [{ type: 'DUAL', start: 0, end: contentHtml.length }];
        const directMagnets = this.extractDirectMagnets($, contentHtml, sectionsEfetivas, postTitle);
        const protectorLinks = this.extractProtectorLinks($, contentHtml, sectionsEfetivas, postTitle);
        const dirDual = directMagnets.filter(m => m.secao === 'DUAL').length;
        const proDual = protectorLinks.filter(l => l.secao === 'DUAL').length;
        const protectorMagnets = await this.resolverMagnetsDoProtetor(protectorLinks);
        const allMagnets = dedupByMagnet([...directMagnets, ...protectorMagnets]);
        if (allMagnets.length === 0) {
            logger.debug(`[BLUDV] magnet DUAL diretos=${dirDual} protetores=${proDual} → 0 válidos`);
            return [];
        }
        const analyzedMagnets = await Promise.all(allMagnets.map(async ({ magnet, link, secao }) => {
            let canonicalName;
            try {
                const dados = await (0, magnetHelper_js_1.analisarMagnet)(magnet);
                canonicalName = dados?.nome || undefined;
            }
            catch { }
            return { magnet, link, canonicalName, secao };
        }));
        const results = [];
        const magnetsVistos = new Set();
        const cleanTitleFromPost = this.extractTitleFromPostTitle(postTitle);
        for (const { magnet, link, canonicalName, secao } of analyzedMagnets) {
            if (magnetsVistos.has(magnet))
                continue;
            magnetsVistos.add(magnet);
            const { qualidade: quality } = this.resolverQualidadeComFonte(canonicalName, link, postTitle, metadata.quality);
            const { episode, episodeRangeText } = this.resolverEpisodio(canonicalName, link);
            const language = this.resolverIdioma(secao, metadata.language);
            const dnColecao = canonicalName && (0, TechnicalWords_js_1.isCollectionTitle)(canonicalName, mediaType) ? canonicalName : null;
            const originalTitleFinal = dnColecao || metadata.originalTitle || cleanTitleFromPost;
            const displayTitle = originalTitleFinal || canonicalName || postTitle;
            const canonicalFinal = canonicalName || this.sintetizarCanonicalName(originalTitleFinal || postTitle, metadata.years, quality);
            const size = metadata.size
                || this.extrairTamanhoDoContexto(link.fullContextText)
                || this.extrairTamanhoDoContexto(link.parentText)
                || 'Desconhecido';
            const cleanedHtmlTitle = episodeRangeText
                ? `${episodeRangeText}: ${quality}`
                : this.cleanHtmlTitle(link.fullContextText || link.linkText, link.linkText, quality);
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
    logarDiagnosticoSemDual($, contentHtml, postTitle, metadata) {
        const strongs = $('.content strong, .content b').toArray();
        const totalStrongs = strongs.length;
        const totalMagnetAnchors = $('a[href^="magnet:"]').length;
        const totalProtetores = $('a[href*="systemads1.com"]').length;
        logger.debug(`[BLUDV] SEM_DUAL | "${truncar(postTitle, 60)}" | ` +
            `strongs=${totalStrongs} magnetAnchors=${totalMagnetAnchors} protetores=${totalProtetores} | ` +
            `lang="${metadata.language || '-'}" quality="${metadata.quality || '-'}" ` +
            `original="${truncar(metadata.originalTitle || '-', 40)}"`);
        const amostra = strongs.slice(0, 8).map((el) => {
            const texto = $(el).text().trim();
            if (!texto)
                return '(vazio)';
            const diag = this.diagnosticarSecao(texto);
            return `"${truncar(texto, 30)}"→${diag.tipo}:${diag.motivo}`;
        });
        logger.debug(`[BLUDV] SEM_DUAL amostra strongs | ${amostra.join(' | ') || '(nenhum)'}`);
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
    findSections($, contentHtml, postTitle) {
        const strongEls = $('.content strong, .content b').toArray();
        const headers = [];
        const descartados = [];
        for (const el of strongEls) {
            const texto = $(el).text().trim();
            if (!texto)
                continue;
            const diag = this.diagnosticarSecao(texto);
            if (diag.tipo === 'NONE') {
                const potencial = texto.length <= 60 && (diag.flags.dual || diag.flags.dublado || diag.flags.nacional || diag.flags.legendado || !diag.flags.ruido);
                if (potencial)
                    descartados.push({ texto, tipo: diag.tipo, motivo: diag.motivo });
                continue;
            }
            const pos = contentHtml.indexOf($(el).toString());
            if (pos === -1)
                continue;
            headers.push({ pos, type: diag.tipo });
        }
        headers.sort((a, b) => a.pos - b.pos);
        if (headers.length === 0 && strongEls.length > 0) {
            const amostra = descartados.slice(0, 8).map(d => `"${truncar(d.texto, 30)}"→${d.tipo}:${d.motivo}`);
            logger.debug(`[BLUDV] sem headers | strongs=${strongEls.length} descartados=${descartados.length} | ` +
                `amostra: ${amostra.join(' | ') || '(nenhum relevante)'}`);
        }
        const contentLength = contentHtml.length;
        const sections = [];
        if (headers.length === 0) {
            return [{ type: 'NONE', start: 0, end: contentLength }];
        }
        if (headers[0].pos > 0) {
            sections.push({ type: 'NONE', start: 0, end: headers[0].pos });
        }
        for (let i = 0; i < headers.length; i++) {
            const start = headers[i].pos;
            const end = i + 1 < headers.length ? headers[i + 1].pos : contentLength;
            sections.push({ type: headers[i].type, start, end });
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
    extractDirectMagnets($, contentHtml, sections, postTitle) {
        const resultados = [];
        const stats = { DUAL: 0, LEGENDADO: 0, NONE: 0 };
        const centerSpanCache = new Map();
        for (const centerEl of $('center').toArray()) {
            centerSpanCache.set(centerEl, $(centerEl).find('span').first().text().trim());
        }
        const allMagnetAnchors = $('a[href^="magnet:"]').toArray();
        for (const el of allMagnetAnchors) {
            const magnet = $(el).attr('href')?.trim();
            if (!magnet)
                continue;
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
            const $el = $(el);
            const closestCenter = $el.closest('center').get(0);
            const spanText = closestCenter ? (centerSpanCache.get(closestCenter) ?? '') : '';
            const ctx = this.buildLinkContext($, el);
            resultados.push({
                magnet,
                link: {
                    linkText: ctx.linkText,
                    parentText: ctx.parentText,
                    fullContextText: spanText || ctx.fullContextText,
                },
                secao,
            });
        }
        if (allMagnetAnchors.length > 0) {
            logger.debug(`[BLUDV] magnets brutos=${allMagnetAnchors.length} | DUAL=${stats.DUAL} LEGENDADO=${stats.LEGENDADO} NONE=${stats.NONE}`);
        }
        return resultados;
    }
    extractProtectorLinks($, contentHtml, sections, postTitle) {
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
                secao,
                ...this.buildLinkContext($, el),
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
                return {
                    magnet,
                    link: {
                        linkText: link.linkText,
                        parentText: link.parentText,
                        fullContextText: link.fullContextText,
                    },
                    secao: link.secao,
                };
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
    resolverQualidadeComFonte(canonicalName, link, postTitle, metadataQuality) {
        if (canonicalName) {
            const q = this.qualityDetector.extractBestQuality(canonicalName);
            if (q && this.qualityDetector.isValidQuality(q))
                return { qualidade: q, fonte: 'canonicalName' };
        }
        if (link.fullContextText) {
            const q = this.qualityDetector.extractBestQuality(link.fullContextText);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'fullContextText' };
        }
        if (link.linkText) {
            const q = this.qualityDetector.extractBestQuality(link.linkText);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'linkText' };
        }
        if (link.parentText) {
            const q = this.qualityDetector.extractBestQuality(link.parentText);
            if (q && this.qualityDetector.isValidQuality(q) && q !== 'HD')
                return { qualidade: q, fonte: 'parentText' };
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
    resolverQualidade(canonicalName, link, postTitle, metadataQuality) {
        return this.resolverQualidadeComFonte(canonicalName, link, postTitle, metadataQuality).qualidade;
    }
    resolverEpisodio(canonicalName, link) {
        if (canonicalName) {
            const r = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(canonicalName));
            if (r)
                return r;
        }
        const contexto = link.fullContextText || link.linkText;
        const r = this.formatarRange((0, TechnicalWords_js_1.extrairRangeEpisodios)(contexto));
        if (r)
            return r;
        const epMatch = contexto.match(/EPISÓDIO\s*(\d+)/i);
        if (epMatch) {
            const ep = parseInt(epMatch[1], 10);
            return { episode: ep, episodeRangeText: `Episódio ${pad2(ep)}` };
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
    buildLinkContext($, el) {
        const $el = $(el);
        return {
            linkText: $el.text().trim(),
            parentText: $el.parent().text().trim(),
            fullContextText: this.getFullContextText($el),
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
    getFullContextText($el) {
        const prevSpan = $el.parent().prev('span');
        if (prevSpan.length) {
            const text = prevSpan.text().trim();
            if (text)
                return text;
        }
        let current = $el.parent();
        for (let depth = 0; depth < 4; depth++) {
            const text = current.text().trim();
            if (text.length > 10) {
                const matches = text.match(/\b(2160p|1080p|720p|480p|4K|HD)\b/gi);
                if (matches && matches.length === 1)
                    return text;
            }
            current = current.parent();
        }
        return $el.parent().text().trim();
    }
    cleanHtmlTitle(contextText, linkText, qualityOverride) {
        const epPatterns = [
            /EPIS[OÓ]DIO\s+\d{1,3}\s+AO?\s+\d{1,3}/i,
            /EPIS[OÓ]DIO\s+\d{1,3}/i,
            /\bS\d{1,2}\s*E\d{1,3}/i,
            /\bE\d{1,3}/i
        ];
        let episode = '';
        for (const pattern of epPatterns) {
            const match = contextText.match(pattern);
            if (match) {
                episode = match[0];
                break;
            }
        }
        if (!episode)
            return '';
        let quality = qualityOverride || null;
        if (!quality) {
            quality = this.qualityDetector.extractBestQuality(linkText) || this.qualityDetector.extractBestQuality(contextText);
        }
        return quality ? `${episode}: ${quality}` : episode;
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
