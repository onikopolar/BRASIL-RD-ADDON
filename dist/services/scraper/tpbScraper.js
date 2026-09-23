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
exports.searchTpb = searchTpb;
const axios_1 = __importDefault(require("axios"));
const cheerio = __importStar(require("cheerio"));
const dns_1 = __importDefault(require("dns"));
const https_1 = __importDefault(require("https"));
const tls_1 = __importDefault(require("tls"));
const logger_js_1 = require("../../utils/logger.js");
const logger = new logger_js_1.Logger('TPBScraper');
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
const MIRRORS = [
    { url: 'https://www4.thepiratebay3.co', priority: 1 },
    { url: 'https://piratebay.live', priority: 2 },
    { url: 'https://1.piratebays.to', priority: 3 },
    { url: 'https://tpb.party', priority: 4 },
];
async function searchTpb(query, type = 'movie') {
    const words = query.split(' ').filter(w => w.length > 1);
    const queriesToTry = [query];
    if (words.length > 3)
        queriesToTry.push(words.slice(0, 3).join(' '));
    if (words.length > 2)
        queriesToTry.push(words.slice(0, 2).join(' '));
    for (const q of queriesToTry) {
        const isFallback = q !== query;
        for (const mirror of MIRRORS.sort((a, b) => a.priority - b.priority)) {
            try {
                const results1 = await scrapeMirror(mirror.url, q, 'search');
                if (results1.length > 0) {
                    if (isFallback)
                        logger.debug(`TPB fallback "${q}" → ${results1.length} torrents (${mirror.url})`);
                    return results1;
                }
                const results2 = await scrapeMirror(mirror.url, q, 's');
                if (results2.length > 0) {
                    if (isFallback)
                        logger.debug(`TPB fallback "${q}" → ${results2.length} torrents (${mirror.url})`);
                    return results2;
                }
            }
            catch (err) {
                logger.warn(`TPB mirror ${mirror.url} falhou: ${err.code || err.message}`);
            }
        }
    }
    return [];
}
async function scrapeMirror(baseUrl, query, format) {
    const encoded = encodeURIComponent(query);
    const searchUrl = format === 'search'
        ? `${baseUrl}/search/${encoded}/1/99/0`
        : `${baseUrl}/s/?q=${encoded}&category=0`;
    const res = await axios_1.default.get(searchUrl, {
        timeout: 15000,
        httpsAgent: dnsAgent,
        lookup: lookupCustomizado,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
        },
    });
    const $ = cheerio.load(res.data);
    const torrents = [];
    const decode = (s) => cheerio.load(`<span>${s}</span>`)('span').text();
    const rows = $('table tr').toArray().filter(row => $(row).find('td').length >= 3);
    for (const row of rows) {
        const tds = $(row).find('td');
        if (tds.length < 3)
            continue;
        let title = '';
        let magnetLink = '';
        for (let i = 0; i < tds.length; i++) {
            const magA = $(tds[i]).find('a[href^="magnet:"]').first().attr('href');
            if (magA) {
                magnetLink = magA;
                title = decode($(tds[i]).find('a').first().text().trim());
                if (!title)
                    title = decode($(tds[i]).text().trim().split('\n')[0].trim());
                break;
            }
        }
        if (!title || !magnetLink)
            continue;
        const infoHashMatch = magnetLink.match(/btih:([a-fA-F0-9]{40})/i);
        if (!infoHashMatch)
            continue;
        const infoHash = infoHashMatch[1].toLowerCase();
        let seeders = 0, leechers = 0;
        for (let i = tds.length - 1; i >= 1; i--) {
            const val = parseInt($(tds[i]).text().trim());
            if (!isNaN(val) && val > 0) {
                if (!leechers) {
                    leechers = val;
                }
                else {
                    seeders = val;
                    break;
                }
            }
        }
        torrents.push({ title, magnet: magnetLink, seeders, leechers, size: 'N/A', infoHash });
    }
    if (torrents.length > 0) {
        logger.debug(`TPB ${baseUrl}: ${torrents.length} torrents`, { query: query.substring(0, 40), format });
    }
    return torrents;
}
