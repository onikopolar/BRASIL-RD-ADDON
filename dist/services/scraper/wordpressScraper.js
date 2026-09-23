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
exports.WordPressScraper = exports.jsonAxiosConfig = exports.WP_SITES = exports.lookupCustomizado = exports.agenteHttps = void 0;
exports.criarLookup = criarLookup;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const dns_1 = __importDefault(require("dns"));
const https_1 = __importDefault(require("https"));
const tls_1 = __importDefault(require("tls"));
const logger_js_1 = require("../../utils/logger.js");
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
const magnetHelper_js_1 = require("../../magnet/magnetHelper.js");
const CacheService_js_1 = require("../../debrid/CacheService.js");
const TechnicalWords_js_1 = require("../../titulos/TechnicalWords.js");
const SimilarityCalculator_js_1 = require("../../titulos/SimilarityCalculator.js");
const CAT_FILMES = 38;
const CAT_SERIES = 43;
const LEGENDADO_REGEX = new RegExp('\\b(' + TechnicalWords_js_1.INDICADORES_INTERNACIONAL_TORRENTS
    .filter(w => /^leg/i.test(w))
    .join('|') + ')\\b', 'i');
const LEGENDADO_CABECALHO_REGEX = /\blegendad[ao]s?\b/i;
const QUALIDADE_PURA_REGEX = /^\s*(?:qualidade:?\s*)?(\d{3,4}p|4k|uhd|full\s*hd)\s*$/i;
const logger = new logger_js_1.Logger('WordPressScraper');
dns_1.default.setServers(['8.8.8.8', '1.1.1.1']);
function decodeHtmlEntities(texto) {
    if (!texto || (!texto.includes('&') && !texto.includes('&#')))
        return texto;
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
exports.agenteHttps = dnsAgent;
function criarLookup() {
    return (hostname, _opts, cb) => {
        dns_1.default.resolve4(hostname, (err, addresses) => {
            if (err)
                return cb(err);
            cb(null, addresses[0], 4);
        });
    };
}
exports.lookupCustomizado = criarLookup();
exports.WP_SITES = [
    {
        name: 'Comando Torrents',
        baseUrl: 'https://comando1.com',
        priority: 2,
        timeout: 15000,
    },
];
exports.jsonAxiosConfig = {
    timeout: 15000,
    httpsAgent: dnsAgent,
    lookup: exports.lookupCustomizado,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
    },
};
class WordPressScraper {
    constructor() {
        this.POST_BATCH_SIZE = 3;
        this.PROTECTOR_BATCH_SIZE = 5;
        this.MAGNET_CACHE_TTL = 30 * 60 * 1000;
        this.qualityDetector = new qualityDetector_js_1.QualityDetector();
        this.magnetCache = new CacheService_js_1.CacheService();
        this.similarity = SimilarityCalculator_js_1.SimilarityCalculator.getInstance();
    }
    async search(query, type, targetSeason, searchQueries, imdbId, mediaType) {
        const queriesParaBusca = searchQueries && searchQueries.length > 0
            ? searchQueries
            : [query];
        const activeSites = exports.WP_SITES.filter(s => s.priority > 0).sort((a, b) => b.priority - a.priority);
        for (const q of queriesParaBusca) {
            logger.debug(`search query="${q}"`);
            const resultados = await Promise.all(activeSites.map(site => this.searchSite(site, q, type, targetSeason, searchQueries, imdbId, mediaType).catch(err => {
                logger.warn(`site falhou`, { site: site.name, query: q, error: err.code || err.message });
                return [];
            }))).then(arrays => arrays.flat());
            if (resultados.length > 0) {
                logger.debug(`query "${q}" retornou ${resultados.length}`);
                return resultados;
            }
        }
        return [];
    }
    async searchSite(site, query, type, targetSeason, searchQueries, imdbId, mediaType) {
        const searchQuery = query.trim();
        const catId = type === 'movie' ? CAT_FILMES : CAT_SERIES;
        const searchUrl = `${site.baseUrl}/wp-json/wp/v2/posts?search=${encodeURIComponent(searchQuery)}&per_page=20&_fields=id,title,link&categories=${catId}`;
        logger.debug(`GET posts search="${searchQuery}" cat=${catId}`);
        const response = await axios_1.default.get(searchUrl, exports.jsonAxiosConfig);
        const posts = response.data;
        const postItems = [];
        for (const post of posts) {
            if (!post.id || !post.title?.rendered || !post.link)
                continue;
            const titleBruto = post.title.rendered;
            const titleLimpo = decodeHtmlEntities(titleBruto);
            postItems.push({
                id: post.id,
                title: titleLimpo,
                url: post.link,
            });
        }
        const queryRange = (0, TechnicalWords_js_1.extrairRangeEpisodios)(searchQuery);
        const querySeason = targetSeason ?? queryRange?.seasonStart;
        const frases = this.montarFrasesDeBusca(searchQuery, searchQueries);
        const tokensRuido = (0, TechnicalWords_js_1.calcularTokensRuido)(postItems.map(p => p.title));
        const relevantPosts = postItems.filter(post => this.postRelevante(post, querySeason, frases, site.name, tokensRuido, mediaType));
        logger.debug(`posts API=${postItems.length} relevantes=${relevantPosts.length} season=${querySeason ?? '-'}`);
        const results = [];
        for (let i = 0; i < relevantPosts.length; i += this.POST_BATCH_SIZE) {
            const batch = relevantPosts.slice(i, i + this.POST_BATCH_SIZE);
            const batchPromises = batch.map(post => this.scrapePostApi(post.id, post.title, site.name, type, imdbId, mediaType)
                .catch(err => {
                logger.warn(`post falhou`, { post: post.title.substring(0, 50), error: err.message });
                return [];
            }));
            const batchResults = await Promise.all(batchPromises);
            for (const res of batchResults) {
                results.push(...res);
            }
        }
        if (querySeason) {
            for (const r of results) {
                if (r.season === undefined)
                    r.season = querySeason;
            }
        }
        logger.debug(`site=${site.name} total=${results.length}`);
        return results;
    }
    montarFrasesDeBusca(searchQuery, searchQueries) {
        const allQueries = new Set([searchQuery, ...(searchQueries || [])]);
        const frases = new Set();
        for (const q of allQueries) {
            const phrase = (0, TechnicalWords_js_1.normalizarTexto)(q
                .replace(/\b\d+[ªº°]?\s*temporada\b/gi, '')
                .replace(/\btemporada\s*\d+\b/gi, '')
                .replace(/\bseason\s*\d+\b/gi, ''));
            if (phrase)
                frases.add(phrase);
        }
        return frases;
    }
    postRelevante(post, querySeason, frases, siteName, tokensRuido, mediaType) {
        const lowerTitle = post.title.toLowerCase();
        if (/\blist[aã]o\b/i.test(lowerTitle))
            return false;
        if (querySeason) {
            const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(post.title);
            if (!(0, TechnicalWords_js_1.temporadaAlvoNoRange)(range, querySeason))
                return false;
        }
        const tituloLimpo = (0, TechnicalWords_js_1.limparPorRaridade)(post.title, tokensRuido);
        const resultado = this.similarity.compararComTitulos([...frases], tituloLimpo);
        const ehSerie = mediaType === 'series' || mediaType === 'tv';
        const isCollection = !ehSerie && (0, TechnicalWords_js_1.isCollectionTitle)(post.title, mediaType);
        if (!resultado.match && !isCollection) {
            logger.debug(`post rejeitado`, { score: resultado.score.toFixed(2), titulo: post.title.substring(0, 60) });
            return false;
        }
        if (!resultado.match && isCollection) {
            logger.debug(`coleção aceita pré-filtro`, { titulo: post.title.substring(0, 60), mediaType: mediaType ?? '-' });
            return true;
        }
        logger.debug(`post aceito`, { score: resultado.score.toFixed(2), nivel: resultado.nivel, titulo: post.title.substring(0, 60) });
        return true;
    }
    classificarTextoIdioma(texto) {
        const t = (0, TechnicalWords_js_1.normalizarTexto)(texto);
        return {
            temNacional: /\bnacional\b/.test(t),
            temDual: /\bdual\b/.test(t),
            temAudio: /\baudio\b/.test(t),
            temDublado: /\bdublado\b|\bdublada\b|\bdublagem\b/.test(t),
            temLegendado: LEGENDADO_CABECALHO_REGEX.test(texto),
            temLegendaSubstantivo: /\blegenda\b/i.test(texto),
        };
    }
    extractQualityFromText(text) {
        if (!text)
            return null;
        const q = this.qualityDetector.extractBestQuality(text);
        return (q && q !== 'HD') ? q : null;
    }
    getFullContextText($el) {
        let current = $el.parent();
        for (let depth = 0; depth < 4; depth++) {
            const text = current.text().trim();
            if (text.length > 10 && /\b(\d{3,4}p|4k|uhd)\b/i.test(text)) {
                return text;
            }
            current = current.parent();
        }
        return $el.parent().text().trim();
    }
    cleanHtmlTitle(parentText, linkText, qualityOverride) {
        if (!parentText)
            return '';
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
        if (!episode)
            return '';
        let quality = qualityOverride || null;
        if (!quality && linkText) {
            quality = this.extractQualityFromText(linkText);
        }
        return quality ? `${episode}: ${quality}` : episode;
    }
    extrairContextoLocal($, el) {
        const $el = $(el);
        const altDaImg = ($el.find('img').attr('alt') || '').trim() || null;
        let textoIrmaoAnterior = null;
        let tituloIrmaoAnterior = null;
        const $pai = $el.parent();
        const $rotulo = $pai.find('strong, b').first();
        if ($rotulo.length) {
            const idxRotulo = $rotulo.index();
            const idxLink = $el.index();
            if (idxRotulo !== -1 && idxLink !== -1 && idxRotulo < idxLink) {
                const texto = $rotulo.text().replace(/\s+/g, ' ').trim();
                if (texto) {
                    if (QUALIDADE_PURA_REGEX.test(texto))
                        textoIrmaoAnterior = texto;
                    if (this.pareceTituloDeItem(texto))
                        tituloIrmaoAnterior = texto;
                }
            }
        }
        if (!textoIrmaoAnterior && !tituloIrmaoAnterior) {
            let irmao = $pai.prev();
            for (let passo = 0; passo < 3 && irmao.length; passo++) {
                const texto = irmao.text().replace(/\s+/g, ' ').trim();
                if (texto) {
                    if (QUALIDADE_PURA_REGEX.test(texto))
                        textoIrmaoAnterior = texto;
                    if (this.pareceTituloDeItem(texto))
                        tituloIrmaoAnterior = texto;
                    break;
                }
                irmao = irmao.prev();
            }
        }
        return { altDaImg, textoIrmaoAnterior, tituloIrmaoAnterior };
    }
    pareceTituloDeItem(texto) {
        if (texto.length < 3 || texto.length > 150)
            return false;
        if (!/[a-zA-ZÀ-ÿ]/.test(texto))
            return false;
        if (QUALIDADE_PURA_REGEX.test(texto))
            return false;
        if (/^(assistir|baixar|download|ver|trailer|sinopse|informa[çc]|caso haja|k-lite|codec)/i.test(texto))
            return false;
        if (/^\d+\s*(gb|mb|kb|kbps|mbps|gbps)$/i.test(texto))
            return false;
        return true;
    }
    resolverQualidadeEspecifica(canonicalName, ctxLocal, linkText, fullContextText, parentText, postTitle, html) {
        if (canonicalName) {
            const q = this.extractQualityFromText(canonicalName);
            if (q)
                return { qualidade: q, fonte: 'canonicalName' };
        }
        if (ctxLocal.altDaImg) {
            const q = this.extractQualityFromText(ctxLocal.altDaImg);
            if (q)
                return { qualidade: q, fonte: 'altDaImg' };
        }
        if (ctxLocal.textoIrmaoAnterior) {
            const q = this.extractQualityFromText(ctxLocal.textoIrmaoAnterior);
            if (q)
                return { qualidade: q, fonte: 'textoIrmaoAnterior' };
        }
        const qLink = this.extractQualityFromText(linkText);
        if (qLink)
            return { qualidade: qLink, fonte: 'linkText' };
        const qCtx = this.extractQualityFromText(fullContextText);
        if (qCtx)
            return { qualidade: qCtx, fonte: 'fullContextText' };
        const qParent = this.extractQualityFromText(parentText);
        if (qParent)
            return { qualidade: qParent, fonte: 'parentText' };
        const qPost = this.extractQualityFromText(postTitle);
        if (qPost)
            return { qualidade: qPost, fonte: 'postTitle' };
        const qHtml = this.extractQualityFromText(html);
        if (qHtml)
            return { qualidade: qHtml, fonte: 'html' };
        return { qualidade: 'HD', fonte: 'fallback' };
    }
    detectSectionType(text) {
        const t = (0, TechnicalWords_js_1.normalizarTexto)(text).trim();
        if (/^(assistir|baixar|download|ver|trailer)\b/i.test(t))
            return 'OUTRO';
        const pareceCabecalho = /^versao\b/i.test(t) || t.length <= 25;
        if (!pareceCabecalho)
            return 'OUTRO';
        const f = this.classificarTextoIdioma(text);
        const temDualCompleto = f.temDual && f.temAudio;
        const temLegendadoCabecalho = f.temLegendado;
        if (temLegendadoCabecalho && !temDualCompleto && !f.temDublado)
            return 'LEGENDADO';
        if ((temDualCompleto || f.temDublado || f.temNacional) && !temLegendadoCabecalho)
            return 'DUAL';
        return 'OUTRO';
    }
    findSections($, content) {
        const selectors = ['strong', 'b'];
        const cabecalhos = [];
        for (const sel of selectors) {
            const elements = $(sel);
            for (let i = 0; i < elements.length; i++) {
                const text = $(elements[i]).text().trim();
                if (!text)
                    continue;
                const tipo = this.detectSectionType(text);
                if (tipo === 'OUTRO')
                    continue;
                const pos = content.indexOf($(elements[i]).toString());
                if (pos === -1)
                    continue;
                cabecalhos.push({ tipo, pos });
            }
        }
        cabecalhos.sort((a, b) => a.pos - b.pos);
        const secoes = [];
        for (let i = 0; i < cabecalhos.length; i++) {
            const cab = cabecalhos[i];
            const proximo = cabecalhos[i + 1];
            secoes.push({
                tipo: cab.tipo,
                start: cab.pos,
                end: proximo ? proximo.pos : content.length,
            });
        }
        return secoes;
    }
    findSectionBoundaries($, content) {
        const secoes = this.findSections($, content);
        return {
            dualIndex: secoes.find(s => s.tipo === 'DUAL')?.start ?? null,
            legendadoIndex: secoes.find(s => s.tipo === 'LEGENDADO')?.start ?? null,
        };
    }
    secaoDaPosicao(pos, secoes) {
        for (const s of secoes) {
            if (pos >= s.start && pos < s.end)
                return s;
        }
        return null;
    }
    async scrapePostApi(postId, postTitle, provider, type, imdbId, mediaType) {
        const postUrl = `https://comando1.com/wp-json/wp/v2/posts/${postId}?_fields=id,title,link,content`;
        const response = await axios_1.default.get(postUrl, exports.jsonAxiosConfig);
        const post = response.data;
        const titleRenderedBruto = post.title?.rendered || postTitle;
        const titleRendered = decodeHtmlEntities(titleRenderedBruto);
        const contentHtml = post.content?.rendered || '';
        if (!contentHtml) {
            logger.warn(`post sem conteúdo`, { postId });
            return [];
        }
        let imdbConfirmed = false;
        if (imdbId) {
            const imdbIdDoPost = contentHtml.match(/imdb\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?title\/(tt\d+)/i)?.[1] || null;
            if (imdbIdDoPost) {
                const isCollection = (0, TechnicalWords_js_1.isCollectionTitle)(titleRendered, mediaType);
                if (!isCollection && imdbIdDoPost.toLowerCase() !== imdbId.toLowerCase()) {
                    return [];
                }
                if (!isCollection) {
                    imdbConfirmed = true;
                }
            }
        }
        const $ = cheerio.load(contentHtml);
        const html = $.html();
        const infoBlock = this.extractInfoBlock($, html);
        const globalOriginalTitle = infoBlock.translatedTitle || infoBlock.originalTitle || undefined;
        const year = infoBlock.year;
        const years = infoBlock.years || (infoBlock.year ? [infoBlock.year] : undefined);
        logger.debug(`info`, {
            provider,
            postId,
            isCollection: (0, TechnicalWords_js_1.isCollectionTitle)(titleRendered, mediaType),
            originalTitle: globalOriginalTitle || '-',
            year: year ?? '-',
            years: years?.join(',') || '-',
            size: infoBlock.size || '-'
        });
        const secoes = this.findSections($, html);
        logger.debug(`seções`, {
            provider,
            postId,
            mapa: secoes.map(s => `${s.tipo}[${s.start}-${s.end}]`).join(' ') || '(nenhuma)'
        });
        const temDual = secoes.some(s => s.tipo === 'DUAL');
        const temLegendado = secoes.some(s => s.tipo === 'LEGENDADO');
        if (!temDual && temLegendado) {
            logger.debug(`post apenas legendado descartado`, { postId });
            return [];
        }
        const secoesValidas = secoes.filter(s => s.tipo === 'DUAL');
        if (secoesValidas.length === 0) {
            const todos = $('a[href^="magnet:"]').toArray();
            logger.debug(`sem seções, processando todos`, { postId, magnets: todos.length });
            const results = await this.processarMagnets(todos, $, html, titleRendered, provider, type, globalOriginalTitle, year, years, mediaType);
            if (imdbConfirmed)
                for (const r of results)
                    r.imdbConfirmed = true;
            return results;
        }
        const magnetElements = $('a[href^="magnet:"]').toArray();
        const magnetsPorSecao = { DUAL: 0, LEGENDADO: 0, NONE: 0 };
        const magnetsValidos = [];
        for (const el of magnetElements) {
            const pos = html.indexOf($(el).toString());
            if (pos === -1) {
                magnetsPorSecao.NONE++;
                continue;
            }
            const secao = this.secaoDaPosicao(pos, secoes);
            if (!secao) {
                magnetsPorSecao.NONE++;
                continue;
            }
            if (secao.tipo === 'LEGENDADO') {
                magnetsPorSecao.LEGENDADO++;
                continue;
            }
            magnetsPorSecao.DUAL++;
            magnetsValidos.push(el);
        }
        logger.debug(`magnets por seção`, {
            postId,
            DUAL: magnetsPorSecao.DUAL,
            LEGENDADO: magnetsPorSecao.LEGENDADO,
            NONE: magnetsPorSecao.NONE
        });
        const results = await this.processarMagnets(magnetsValidos, $, html, titleRendered, provider, type, globalOriginalTitle, year, years, mediaType);
        if (imdbConfirmed)
            for (const r of results)
                r.imdbConfirmed = true;
        return results;
    }
    async processarMagnets(elements, $, html, postTitle, provider, type, globalOriginalTitle, year, years, mediaType) {
        const results = [];
        const batchSize = 5;
        for (let i = 0; i < elements.length; i += batchSize) {
            const batch = elements.slice(i, i + batchSize);
            const batchPromises = batch.map(async (el) => {
                const magnet = $(el).attr('href');
                if (!magnet)
                    return null;
                const parentText = $(el).parent().text().trim();
                const linkText = $(el).text().trim();
                const fullContextText = this.getFullContextText($(el));
                const ctxLocal = this.extrairContextoLocal($, el);
                return this.processMagnetItem(magnet, parentText, linkText, fullContextText, ctxLocal, postTitle, html, provider, type, globalOriginalTitle, year, years, mediaType);
            });
            const batchResults = await Promise.all(batchPromises);
            for (const r of batchResults) {
                if (r)
                    results.push(r);
            }
        }
        return results;
    }
    async processMagnetItem(magnet, parentText, linkText, fullContextText, ctxLocal, postTitle, html, provider, type, globalOriginalTitle, year, years, mediaType) {
        const dados = await this.analisarMagnetComCache(magnet, provider);
        const canonicalName = dados?.nome ?? null;
        const { qualidade: quality, fonte: fonteQualidade } = this.resolverQualidadeEspecifica(canonicalName, ctxLocal, linkText, fullContextText, parentText, postTitle, html);
        if (!this.qualityDetector.isValidQuality(quality)) {
            logger.warn(`qualidade inválida`, { provider, quality, fonte: fonteQualidade });
            return null;
        }
        const sizeParent = this.extractSize(parentText);
        const sizePost = this.extractSize(postTitle);
        const size = sizeParent || sizePost;
        const language = this.extractLanguage(postTitle) || this.extractLanguage(parentText) || 'Desconhecido';
        const episode = this.extractEpisodeFromText(parentText);
        const cleanedHtmlTitle = this.cleanHtmlTitle(parentText, linkText, quality);
        const isPostCollection = (0, TechnicalWords_js_1.isCollectionTitle)(postTitle, mediaType);
        let originalTitleFinal;
        let displayTitle;
        let fonteOriginal = 'post';
        if (isPostCollection) {
            const ctxOriginal = this.extractOriginalTitleFromContext(parentText);
            if (ctxLocal.tituloIrmaoAnterior) {
                originalTitleFinal = ctxLocal.tituloIrmaoAnterior;
                fonteOriginal = 'html';
            }
            else if (canonicalName?.trim()) {
                originalTitleFinal = canonicalName.trim();
                fonteOriginal = 'dn';
            }
            else if (ctxOriginal) {
                originalTitleFinal = ctxOriginal;
                fonteOriginal = 'html';
            }
            else if (globalOriginalTitle) {
                originalTitleFinal = globalOriginalTitle;
                fonteOriginal = 'html';
            }
            else {
                const pt = this.extractTitleFromPostTitle(postTitle);
                if (pt) {
                    originalTitleFinal = pt;
                    fonteOriginal = 'post';
                }
            }
            displayTitle = originalTitleFinal || postTitle;
        }
        else {
            const ctxOriginal = this.extractOriginalTitleFromContext(parentText);
            if (ctxOriginal) {
                originalTitleFinal = ctxOriginal;
                fonteOriginal = 'html';
            }
            else if (globalOriginalTitle) {
                originalTitleFinal = globalOriginalTitle;
                fonteOriginal = 'html';
            }
            else {
                const pt = this.extractTitleFromPostTitle(postTitle);
                if (pt) {
                    originalTitleFinal = pt;
                    fonteOriginal = 'post';
                }
            }
            displayTitle = this.extractTitleFromPostTitle(postTitle) || canonicalName || postTitle;
        }
        const anosDoItem = originalTitleFinal ? (0, TechnicalWords_js_1.extrairAno)(originalTitleFinal) : undefined;
        const anosDoDnFallback = fonteOriginal !== 'dn' && canonicalName ? (0, TechnicalWords_js_1.extrairAno)(canonicalName) : undefined;
        const anosResolvidos = (anosDoItem && anosDoItem.length > 0) ? anosDoItem :
            (anosDoDnFallback && anosDoDnFallback.length > 0) ? anosDoDnFallback :
                undefined;
        const yearFinal = anosResolvidos ? anosResolvidos[0] : year;
        const yearsFinal = anosResolvidos ?? (yearFinal !== undefined ? [yearFinal] : years);
        const fonteAno = (anosDoItem && anosDoItem.length > 0) ? fonteOriginal :
            (anosDoDnFallback && anosDoDnFallback.length > 0) ? 'dn' :
                year !== undefined ? 'post' : 'nenhum';
        const canonicalFinal = canonicalName || this.sintetizarCanonicalName(originalTitleFinal || postTitle, yearsFinal, quality);
        return {
            title: this.cleanTitle(displayTitle),
            htmlTitle: cleanedHtmlTitle || undefined,
            magnet,
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
    limparTituloBase(titulo) {
        return titulo
            .replace(/[*]+/g, '')
            .replace(/[?!,;:]+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }
    sintetizarCanonicalName(base, years, quality) {
        const baseLimpo = this.limparTituloBase(base);
        const anos = years && years.length > 0
            ? (years.length === 1 ? `${years[0]}` : `${years[0]}-${years[years.length - 1]}`)
            : null;
        return [baseLimpo, anos, quality].filter(Boolean).join(' ').trim();
    }
    extractTitleFromPostTitle(postTitle) {
        if (!postTitle)
            return null;
        const limpo = postTitle
            .replace(/\bTorrent\b.*$/i, '')
            .replace(/\s+[–|-]\s+.*$/, '')
            .replace(/\b(720p|1080p|2160p|4K|BluRay|WEB-DL|DUAL|Dublado|Legendado)\b.*$/i, '')
            .trim();
        return limpo || null;
    }
    extractOriginalTitleFromContext(contextText) {
        const match = contextText.match(/T[ií]tulo\s+Original:\s*([^\n]+)/i);
        if (!match?.[1])
            return null;
        return this.limparTituloBase(match[1].trim()) || null;
    }
    extractInfoBlock($, html) {
        const articleText = $.root().text() || html;
        const titleText = articleText;
        const originalMatch = articleText.match(/T[ií]tulo\s+Original\s*:\s*([^\n]+)/i);
        const translatedMatch = articleText.match(/T[ií]tulo\s+Traduzido\s*:\s*([^\n]+)/i);
        const yearMatch = articleText.match(/Ano de Lançamento\s*:\s*([^\n]+)/i) || articleText.match(/Lançamento\s*:?\s*([^\n]+)/i);
        let years = [];
        if (yearMatch) {
            const rawYears = yearMatch[1].match(/\b(19|20)\d{2}\b/g) || [];
            years = rawYears.map((y) => parseInt(y));
        }
        else {
            const titleYears = titleText.match(/\b(19|20)\d{2}\b/g) || [];
            years = titleYears
                .map((y) => parseInt(y))
                .filter((y) => y >= 1950 && y <= 2030);
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
    escolherOriginalLatino(original, translated, alt) {
        if (this.ehLatino(original))
            return original;
        if (this.ehLatino(translated))
            return translated;
        if (this.ehLatino(alt))
            return alt;
        return original;
    }
    ehLatino(texto) {
        if (!texto)
            return false;
        const letras = texto.replace(/[^a-zA-ZÀ-ÿ]/g, '');
        return letras.length / Math.max(texto.length, 1) > 0.6;
    }
    async extractMagnetFromProtector(protectorUrl) {
        const maxAttempts = 2;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                const res = await axios_1.default.get(protectorUrl, {
                    ...exports.jsonAxiosConfig,
                    timeout: 12000,
                    maxRedirects: 5,
                });
                const html = res.data;
                const match = html.match(/const\s+DEST_URL\s*=\s*"([^"]+)"/);
                if (match)
                    return match[1];
                const altMatch = html.match(/DEST_URL\s*=\s*"([^"]+)"/);
                if (altMatch)
                    return altMatch[1];
            }
            catch (err) {
                if (attempt < maxAttempts - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                    continue;
                }
                logger.warn(`protetor falhou`, { url: protectorUrl.substring(0, 50), error: err.message });
            }
        }
        return null;
    }
    extractCanonicalNameSync(magnet) {
        const dnMatch = magnet.match(/[&?]dn=([^&]+)/i);
        if (dnMatch) {
            try {
                return decodeURIComponent(dnMatch[1].replace(/\+/g, ' '));
            }
            catch {
                return dnMatch[1];
            }
        }
        return null;
    }
    extrairTamanhoNumerico(text) {
        if (!text)
            return null;
        const m = text.match(/([\d,.]+)\s*(GB|MB|KB)/i);
        if (!m)
            return null;
        const valor = parseFloat(m[1].replace(',', '.'));
        if (!Number.isFinite(valor) || valor <= 0)
            return null;
        const unidade = m[2].toUpperCase();
        return { valor, unidade };
    }
    extractSize(text) {
        const t = this.extrairTamanhoNumerico(text);
        if (!t || t.unidade === 'KB')
            return 'Desconhecido';
        return `${t.valor} ${t.unidade}`;
    }
    parseSize(sizeStr) {
        if (!sizeStr || sizeStr === 'Desconhecido' || sizeStr === '–')
            return 0;
        const t = this.extrairTamanhoNumerico(sizeStr);
        if (!t)
            return 0;
        const multiplicador = { GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[t.unidade];
        return Math.round(t.valor * multiplicador);
    }
    extractLanguage(title) {
        if (!title)
            return 'Desconhecido';
        const f = this.classificarTextoIdioma(title);
        if (f.temDual)
            return 'Dual';
        if (f.temDublado)
            return 'Dublado';
        if (f.temNacional)
            return 'Nacional';
        if (f.temLegendado || f.temLegendaSubstantivo)
            return 'Legendado';
        return 'Desconhecido';
    }
    cleanTitle(title) {
        return title.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }
    async analisarMagnetComCache(magnet, provider) {
        const cached = this.magnetCache.get(magnet);
        if (cached)
            return cached;
        try {
            const dados = await (0, magnetHelper_js_1.analisarMagnet)(magnet);
            if (dados) {
                const entry = { nome: dados.nome, infoHash: dados.infoHash };
                this.magnetCache.set(magnet, entry, this.MAGNET_CACHE_TTL);
                return entry;
            }
        }
        catch (err) {
            logger.warn(`magnet análise falhou`, { provider, error: err.message });
        }
        return null;
    }
    extractEpisodeFromText(text) {
        if (!text)
            return undefined;
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(text);
        return range?.episodeStart || undefined;
    }
}
exports.WordPressScraper = WordPressScraper;
