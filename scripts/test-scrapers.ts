// scripts/test-scrapers.ts
// Script para testar individualmente os scrapers: Starck, WordPress, BLUDV e HDR.
// Uso: npx tsx scripts/test-scrapers.ts --query="..." --type=series [--season=22] [--scraper=starck|wordpress|bludv|hdr] [--debug]

import axios from 'axios';
import * as cheerio from 'cheerio';
import { searchStarck } from '../src/services/scraper/starckScraper';
import { WordPressScraper } from '../src/services/scraper/wordpressScraper';
import { BludvScraper } from '../src/services/scraper/bludvScraper';
import { searchHdr } from '../src/services/scraper/hdrScraper';
import { extrairRangeEpisodios } from '../src/titulos/TechnicalWords';

// Tipos locais para padronizar a saída
interface ScraperResult {
    title: string;
    season?: number | null;
    episode?: number | null;
    quality?: string;
    language?: string;
    infoHash?: string;
    size?: string;
    magnet?: string; // primeiros 60 chars
}

// ───────────────────────────────────────────────
// Funções auxiliares
// ───────────────────────────────────────────────

function parseArgs(): { query: string; type: 'movie' | 'series'; season?: number; scraper?: string; debug: boolean } {
    const args = process.argv.slice(2);
    const params: any = {};
    for (const arg of args) {
        const [key, ...rest] = arg.split('=');
        const value = rest.join('=');
        if (key.startsWith('--')) params[key.slice(2)] = value;
    }
    const query = params.query;
    if (!query) {
        console.error('Uso: npx tsx scripts/test-scrapers.ts --query="..." [--type=series] [--season=22] [--scraper=...] [--debug]');
        process.exit(1);
    }
    const type = params.type === 'movie' ? 'movie' : 'series';
    const season = params.season ? parseInt(params.season) : undefined;
    const scraper = params.scraper;
    const debug = args.includes('--debug');
    return { query, type, season, scraper, debug };
}

function extractSeasonEpisode(text: string | undefined): { season?: number | null; episode?: number | null } {
    if (!text) return {};
    const range = extrairRangeEpisodios(text);
    let season = range?.season ?? null;
    let episode = range?.episodeStart ?? null;
    if (season === null) {
        // fallback simples
        const m = text.match(/(\d+)\s*ª\s*Temporada/i) || text.match(/Temporada\s+(\d+)/i) || text.match(/Season\s+(\d+)/i);
        if (m) season = parseInt(m[1]);
    }
    if (episode === null) {
        const m = text.match(/Epis[oó]dio\s+(\d+)/i) || text.match(/S\d{1,2}E(\d{1,2})/i) || text.match(/\bE(\d{1,2})\b/i);
        if (m) episode = parseInt(m[1]);
    }
    return { season, episode };
}

function extractQuality(text?: string): string | null {
    if (!text) return null;
    const m = text.match(/\b(\d{3,4}p|4K|HD|FullHD)\b/i);
    return m ? m[1].toLowerCase() : null;
}

function extractLanguage(text?: string): string | null {
    if (!text) return null;
    const lower = text.toLowerCase();
    if (lower.includes('dual') && /áudio|audio/.test(lower)) return 'Dual Áudio';
    if (lower.includes('dublado') || lower.includes('dublad')) return 'Dublado';
    if (lower.includes('legendado') || lower.includes('legenda')) return 'Legendado';
    return null;
}

function truncate(str: string, len: number = 80): string {
    return str.length > len ? str.slice(0, len) + '…' : str;
}

async function debugSearchLinks(scraperName: string, query: string): Promise<void> {
    let url: string;
    switch (scraperName.toLowerCase()) {
        case 'starck':
            url = `https://www.starck-oficial.com/?s=${encodeURIComponent(query)}`;
            break;
        case 'wordpress/comando':
            url = `https://comando1.com/?s=${encodeURIComponent(query)}`;
            break;
        case 'bludv':
            url = `https://bludvfilmes1.xyz/?s=${encodeURIComponent(query)}`;
            break;
        case 'hdr':
            url = `https://hdrtorrent.com/index.php?s=${encodeURIComponent(query)}`;
            break;
        default:
            return;
    }

    try {
        const res = await axios.get(url, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        const $ = cheerio.load(res.data);
        console.log(`\n🔍 DEBUG ${scraperName} — links brutos para "${query}":\n`);
        let count = 0;
        $('a[href]').each((_i, el) => {
            const href = ($(el).attr('href') || '').trim();
            const text = ($(el).text() || '').trim();
            if (text.length >= 10) {
                console.log(`${count++}. ${text} => ${href}`);
            }
        });
        console.log(`\nTotal de links com texto >= 10: ${count}\n`);
    } catch (err: any) {
        console.log(`DEBUG ${scraperName} erro: ${err.message}`);
    }
}

// ───────────────────────────────────────────────
// Execução de um scraper
// ───────────────────────────────────────────────

let parseArgsQuery: string;
let parseArgsType: 'movie' | 'series';
let parseArgsSeason: number | undefined;

async function runScraper(
    name: string,
    fn: (query: string, type: 'movie' | 'series', season?: number) => Promise<any[]>
): Promise<{ name: string; count: number; results: ScraperResult[]; duration: number; error?: string }> {
    const start = Date.now();
    try {
        const rawResults = await fn(parseArgsQuery, parseArgsType, parseArgsSeason);
        const duration = Date.now() - start;
        const results: ScraperResult[] = rawResults.map(r => {
            const title = r.title || r.canonicalName || r.name || '';
            const infoHash = r.infoHash || (r.magnet ? r.magnet.match(/btih:([a-zA-Z0-9]{40})/)?.[1] : undefined);
            const magnet = r.magnet || '';
            const seasonEp = extractSeasonEpisode(title + ' ' + (r.canonicalName || ''));
            return {
                title: truncate(title, 80),
                season: r.season ?? seasonEp.season,
                episode: r.episode ?? seasonEp.episode,
                quality: r.quality || extractQuality(title + ' ' + (r.qualityHint || '')),
                language: r.language || extractLanguage(title + ' ' + (r.qualityHint || '')),
                infoHash: infoHash?.toLowerCase(),
                size: r.size || '',
                magnet: magnet.substring(0, 60),
            };
        });
        return { name, count: results.length, results, duration };
    } catch (err: any) {
        return { name, count: 0, results: [], duration: Date.now() - start, error: err.message };
    }
}

// ───────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────

async function main() {
    const { query, type, season, scraper, debug } = parseArgs();
    parseArgsQuery = query;
    parseArgsType = type;
    parseArgsSeason = season;

    console.log('\n🔎 Testando scrapers para:', query, `(tipo: ${type}, temporada: ${season ?? 'não especificada'})\n`);

    const scrapers: { name: string; fn: (q: string, t: 'movie' | 'series', s?: number) => Promise<any[]> }[] = [];

    if (!scraper || scraper === 'starck') {
        scrapers.push({ name: 'Starck', fn: (q, t) => searchStarck(q, t) });
    }
    if (!scraper || scraper === 'wordpress') {
        const wp = new WordPressScraper();
        scrapers.push({ name: 'WordPress/Comando', fn: (q, t, s) => wp.search(q, t, s) });
    }
    if (!scraper || scraper === 'bludv') {
        const bludv = new BludvScraper();
        scrapers.push({ name: 'BLUDV', fn: (q, t, s) => bludv.search(q, t, s) });
    }
    if (!scraper || scraper === 'hdr') {
        scrapers.push({ name: 'HDR', fn: (q, t, s) => searchHdr(q, t, s) });
    }

    if (debug) {
        for (const s of scrapers) {
            await debugSearchLinks(s.name, query);
        }
    }

    for (const s of scrapers) {
        const result = await runScraper(s.name, s.fn);
        console.log(`\n════════════════════════════════════════`);
        console.log(`📦 ${result.name} → ${result.count} resultado(s) em ${result.duration}ms`);
        if (result.error) {
            console.log(`  ❌ Erro: ${result.error}`);
            continue;
        }
        if (result.results.length === 0) {
            console.log('  (nenhum resultado)');
            continue;
        }
        result.results.forEach((r, idx) => {
            console.log(`  ${idx + 1}. ${r.title}`);
            console.log(`     S${r.season ?? '?'}E${r.episode ?? '?'} | Qualidade: ${r.quality ?? '?'} | Idioma: ${r.language ?? '?'}`);
            if (r.infoHash) console.log(`     infoHash: ${r.infoHash}`);
            if (r.size) console.log(`     Tamanho: ${r.size}`);
            if (r.magnet) console.log(`     Magnet: ${truncate(r.magnet, 60)}`);
        });
    }
    console.log('\n✅ Teste concluído.\n');
}

main().catch(console.error);