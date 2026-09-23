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
exports.searchRargb = searchRargb;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const logger_js_1 = require("../../utils/logger.js");
const wordpressScraper_js_1 = require("./wordpressScraper.js");
const qualityDetector_js_1 = require("../../lib/qualityDetector.js");
const scraperConfigs_js_1 = require("./scraperConfigs.js");
const magnetHelper_js_1 = require("../../magnet/magnetHelper.js");
const TechnicalWords_js_1 = require("../../titulos/TechnicalWords.js");
const logger = new logger_js_1.Logger('RargbScraper');
const RARGB_BASE = 'https://rargb.to';
const PROVIDER = 'RARBG';
const DELAY_BETWEEN_REQUESTS_MS = 1000;
const MAX_DETAIL_PAGES = 5;
const MAX_SEARCH_RESULTS = 15;
const REQUEST_TIMEOUT_MS = 15000;
const axiosConfig = {
    timeout: REQUEST_TIMEOUT_MS,
    httpsAgent: wordpressScraper_js_1.agenteHttps,
    lookup: wordpressScraper_js_1.lookupCustomizado,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
    },
};
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
function cleanText(text) {
    return cheerio.load(`<span>${text}</span>`)('span').text().trim();
}
function parseSizeToBytes(sizeStr) {
    if (!sizeStr)
        return 0;
    const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB)/i);
    if (!match)
        return 0;
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    if (unit === 'GB')
        return Math.floor(value * 1024 ** 3);
    if (unit === 'MB')
        return Math.floor(value * 1024 ** 2);
    if (unit === 'KB')
        return Math.floor(value * 1024);
    return 0;
}
function isTorrentLink(href) {
    return /^\/torrent\/.+\.html$/i.test(href);
}
function extrairCampoTabela($, label) {
    let valor;
    $('tr').each((_i, row) => {
        const header = $(row).find('td.header2').first().text().trim();
        if (header.toLowerCase() === label.toLowerCase()) {
            valor = $(row).find('td.lista').first().text().trim();
        }
    });
    return valor;
}
function detectarIdiomaRargb($) {
    const languageField = extrairCampoTabela($, 'Language');
    const description = extrairCampoTabela($, 'Description') || '';
    const lowerDesc = description.toLowerCase();
    const temPortugues = /portug[uê]s|portuguese|pt-br|ptbr/i.test(lowerDesc);
    const temIngles = /english|eng\b/i.test(lowerDesc);
    const audioFormats = description.match(/Audio Format\s*:.*$/gim) || [];
    const temMultiplosIdiomas = audioFormats.filter(line => /english|portuguese/i.test(line)).length > 1;
    if (temMultiplosIdiomas)
        return 'Dual Áudio';
    if (temPortugues && !temIngles)
        return 'Dublado';
    if (temIngles && !temPortugues)
        return 'Legendado';
    if (languageField?.toLowerCase().includes('portuguese'))
        return 'Dublado';
    if (languageField?.toLowerCase().includes('english'))
        return 'Legendado';
    const pageTitle = $('title').text().toLowerCase();
    if (pageTitle.includes('dublado'))
        return 'Dublado';
    if (pageTitle.includes('dual'))
        return 'Dual Áudio';
    if (pageTitle.includes('nacional'))
        return 'Nacional';
    return 'Legendado';
}
async function searchRargbLinks(query) {
    const searchUrl = `${RARGB_BASE}/search/?search=${encodeURIComponent(query)}`;
    try {
        const res = await axios_1.default.get(searchUrl, axiosConfig);
        const $ = cheerio.load(res.data);
        const results = [];
        const seen = new Set();
        $('a[href]').each((_i, el) => {
            const href = $(el).attr('href') || '';
            if (!isTorrentLink(href))
                return;
            const absoluteHref = href.startsWith('http') ? href : `${RARGB_BASE}${href}`;
            if (seen.has(absoluteHref))
                return;
            seen.add(absoluteHref);
            const title = cleanText($(el).text());
            if (!title || title.length < 3)
                return;
            results.push({ title, detailUrl: absoluteHref });
        });
        logger.debug(`RARGB busca: ${results.length} resultados para "${query.substring(0, 40)}"`);
        return results.slice(0, MAX_SEARCH_RESULTS);
    }
    catch (err) {
        if (err instanceof Error) {
            logger.warn(`RARGB busca falhou: ${err.code || err.message}`);
        }
        return [];
    }
}
async function scrapeRargbDetail(detailUrl, type) {
    try {
        const res = await axios_1.default.get(detailUrl, axiosConfig);
        const $ = cheerio.load(res.data);
        const magnetLink = $('a[href^="magnet:"]').first().attr('href');
        if (!magnetLink)
            return null;
        const dadosMagnet = await (0, magnetHelper_js_1.analisarMagnet)(magnetLink);
        if (!dadosMagnet || !dadosMagnet.infoHash)
            return null;
        const canonicalName = dadosMagnet.nome ?? undefined;
        const infoHash = dadosMagnet.infoHash.toLowerCase();
        const pageTitle = cleanText($('title').first().text().replace(' torrent download', ''));
        const titleFinal = canonicalName || pageTitle || 'RARBG Torrent';
        const sizeField = extrairCampoTabela($, 'Size') || 'N/A';
        const peersField = extrairCampoTabela($, 'Peers') || '';
        const language = detectarIdiomaRargb($);
        let seeders = 0;
        let leechers = 0;
        const seMatch = peersField.match(/Seeders\s*:\s*(\d+)/i);
        const leMatch = peersField.match(/Leechers\s*:\s*(\d+)/i);
        if (seMatch)
            seeders = parseInt(seMatch[1]);
        if (leMatch)
            leechers = parseInt(leMatch[1]);
        if (seeders === 0 && leechers === 0) {
            const bodyText = $('body').text();
            const fallbackSe = bodyText.match(/Seeders\s*:\s*(\d+)/i);
            const fallbackLe = bodyText.match(/Leechers\s*:\s*(\d+)/i);
            if (fallbackSe)
                seeders = parseInt(fallbackSe[1]);
            if (fallbackLe)
                leechers = parseInt(fallbackLe[1]);
        }
        const qualityDetector = qualityDetector_js_1.QualityDetector.getInstance();
        const quality = qualityDetector.extractQualityFromFilename(titleFinal);
        if (!scraperConfigs_js_1.allowedQualities.has(quality)) {
            logger.debug(`RARBG: qualidade "${quality}" não permitida, ignorando ${titleFinal}`);
            return null;
        }
        const range = (0, TechnicalWords_js_1.extrairRangeEpisodios)(titleFinal);
        return {
            title: titleFinal,
            magnet: magnetLink,
            seeders,
            leechers,
            size: sizeField,
            quality,
            provider: PROVIDER,
            language,
            type,
            relevanceScore: 0.75,
            sizeInBytes: parseSizeToBytes(sizeField),
            confidence: 0.75,
            season: range?.season || undefined,
            episode: range && range.episodeStart > 0 ? range.episodeStart : undefined,
            originalTitle: titleFinal,
            year: undefined,
            canonicalName,
            lastUpdated: new Date(),
        };
    }
    catch (err) {
        if (err instanceof Error) {
            logger.warn(`RARGB detail falhou: ${err.code || err.message}`, { url: detailUrl.substring(0, 60) });
        }
        return null;
    }
}
async function searchRargb(query, type = 'movie', targetSeason, searchQueries) {
    const queries = searchQueries && searchQueries.length > 0 ? searchQueries : [query];
    const allResults = [];
    const seenInfoHashes = new Set();
    for (const q of queries) {
        logger.debug(`RARBG: tentando busca com query "${q}"`);
        const links = await searchRargbLinks(q);
        if (links.length === 0) {
            await sleep(500);
            continue;
        }
        const detalhes = links.slice(0, MAX_DETAIL_PAGES);
        for (const item of detalhes) {
            const detalhe = await scrapeRargbDetail(item.detailUrl, type);
            if (detalhe) {
                const hash = detalhe.magnet ? (await (0, magnetHelper_js_1.analisarMagnet)(detalhe.magnet))?.infoHash?.toLowerCase() : undefined;
                if (hash && !seenInfoHashes.has(hash)) {
                    seenInfoHashes.add(hash);
                    allResults.push(detalhe);
                }
            }
            await sleep(DELAY_BETWEEN_REQUESTS_MS);
        }
        if (allResults.length > 0) {
            logger.debug(`RARBG: query "${q}" retornou ${allResults.length} torrents. Encerrando busca.`);
            break;
        }
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
    }
    logger.info(`RARBG: ${allResults.length} torrents válidos para "${query.substring(0, 50)}"`);
    return allResults;
}
