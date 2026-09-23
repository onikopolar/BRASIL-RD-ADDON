"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RescrapeService = void 0;
const models_js_1 = require("../../database/models.js");
const TorrentScraperService_js_1 = require("./TorrentScraperService.js");
const ImdbScraperService_js_1 = require("../../catalogo/ImdbScraperService.js");
const AutoMagnetService_js_1 = require("../../debrid/AutoMagnetService.js");
const magnetHelper_js_1 = require("../../magnet/magnetHelper.js");
const logger_js_1 = require("../../utils/logger.js");
const sequelize_1 = require("sequelize");
const logger = new logger_js_1.Logger('RescrapeService');
const SOURCE_PATTERNS = [
    { regex: /\b(bluray|blu-ray|bdrip|brrip|remux|web-dl|web\.dl)\b/i, days: null, rank: 9 },
    { regex: /\b(2160p|4k|uhd)\b/i, days: null, rank: 10 },
    { regex: /\b(dv|hdr10\+?|dolby\s*vision)\b/i, days: null, rank: 10 },
    { regex: /\b(webrip|web\.rip|web\s*rip)\b/i, days: 14, rank: 7 },
    { regex: /\b(dvdscr|screener|dvd-scr|dvdscr)\b/i, days: 10, rank: 4 },
    { regex: /\b(hc|hard\s*coded)\b/i, days: 10, rank: 4 },
    { regex: /\b(hdtv|hd-tv)\b/i, days: 7, rank: 6 },
    { regex: /\b(hdrip|hd-rip|hd\.rip)\b/i, days: 7, rank: 6 },
    { regex: /\b(hdcam|hd-cam|hdts|hd-ts|telecine|telesync)\b/i, days: 5, rank: 2 },
    { regex: /\b(camrip|cam-rip|cam\.rip|cam\b|ts\b|workprint|wp\b)\b/i, days: 3, rank: 1 },
];
const QUALITY_RANK_EXTRA = {
    '2160p': 10,
    '4k': 10,
    'uhd': 10,
    'hdr': 10,
    'dv': 10,
    '1080p': 9,
    '720p': 7,
    'hd': 5,
    'sd': 2,
};
const CAM_LIKE_REGEX = /\b(cam(?:[\s._-]?rip)?|hdcam|hd[\s._-]?cam|hd[\s._-]?ts|ts[\s._-]?rip|telecine|telesync|workprint)\b/i;
const DELAY_BETWEEN_RESCRAPES = 60000;
const MAX_RESCRAPE_PER_BATCH = 5;
const RESCRAPE_CHECK_INTERVAL = 30 * 60 * 1000;
class RescrapeService {
    constructor() {
        this.timer = null;
        this.isRunning = false;
        this.stats = { totalRescraped: 0, totalNewTorrents: 0, lastRun: '' };
        this.torrentScraper = new TorrentScraperService_js_1.TorrentScraperService();
        this.imdbScraper = ImdbScraperService_js_1.ImdbScraperService.getInstance();
        this.autoMagnetService = new AutoMagnetService_js_1.AutoMagnetService();
    }
    static getInstance() {
        if (!RescrapeService.instance) {
            RescrapeService.instance = new RescrapeService();
        }
        return RescrapeService.instance;
    }
    start() {
        if (this.timer) {
            logger.warn('RescrapeService já está rodando');
            return;
        }
        logger.info('🔁 RescrapeService iniciado', {
            intervalo: `${RESCRAPE_CHECK_INTERVAL / 60000}min`,
            maxPorBatch: MAX_RESCRAPE_PER_BATCH,
        });
        setTimeout(() => this.runRescrapeCycle(), 2 * 60 * 1000);
        this.timer = setInterval(() => this.runRescrapeCycle(), RESCRAPE_CHECK_INTERVAL);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            logger.info('RescrapeService parado');
        }
    }
    getStats() {
        return { ...this.stats };
    }
    static computeRescrapeAt(title, qualidade) {
        if (!title && !qualidade)
            return null;
        const titleLower = (title || '').toLowerCase();
        for (const { regex, days } of SOURCE_PATTERNS) {
            if (regex.test(titleLower)) {
                if (days === null)
                    return null;
                return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            }
        }
        if (qualidade) {
            const q = qualidade.toLowerCase();
            if (q === '2160p' || q === '4k')
                return null;
            if (q === '1080p')
                return null;
        }
        return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    async runRescrapeCycle() {
        if (this.isRunning) {
            logger.debug('Ciclo de re-scrape já em andamento, pulando...');
            return;
        }
        this.isRunning = true;
        const startTime = Date.now();
        try {
            const dueTitles = await this.findTitlesDueForRescrape();
            if (dueTitles.length === 0) {
                logger.debug('Nenhum título precisa de re-scrape');
                return;
            }
            logger.info(`🔁 ${dueTitles.length} títulos para re-scrape`, {
                titles: dueTitles.map(t => `${t.imdbId} (${t.type})`),
            });
            const batch = dueTitles.slice(0, MAX_RESCRAPE_PER_BATCH);
            let newTorrentsFound = 0;
            for (let i = 0; i < batch.length; i++) {
                const title = batch[i];
                try {
                    const found = await this.rescrapeTitle(title.imdbId, title.type);
                    newTorrentsFound += found;
                    this.stats.totalRescraped++;
                    this.stats.totalNewTorrents += found;
                }
                catch (err) {
                    logger.error(`Erro no re-scrape de ${title.imdbId}`, {
                        error: err instanceof Error ? err.message : 'Erro',
                    });
                    await this.updateRescrapeAt(title.imdbId, new Date(Date.now() + 6 * 60 * 60 * 1000));
                }
                if (i < batch.length - 1) {
                    await this.sleep(DELAY_BETWEEN_RESCRAPES);
                }
            }
            const elapsed = Date.now() - startTime;
            logger.info(`✅ Ciclo de re-scrape concluído`, {
                processados: batch.length,
                novosTorrents: newTorrentsFound,
                tempo: `${(elapsed / 1000).toFixed(1)}s`,
            });
            this.stats.lastRun = new Date().toISOString();
        }
        catch (error) {
            logger.error('Erro no ciclo de re-scrape', {
                error: error instanceof Error ? error.message : 'Erro',
            });
        }
        finally {
            this.isRunning = false;
        }
    }
    async findTitlesDueForRescrape() {
        const now = new Date();
        const dueTorrents = await models_js_1.Torrent.findAll({
            attributes: ['imdbId', 'type'],
            where: {
                rescrapeAt: { [sequelize_1.Op.ne]: null, [sequelize_1.Op.lte]: now },
                imdbId: { [sequelize_1.Op.ne]: null },
            },
            raw: true,
        });
        const seen = new Set();
        const result = [];
        for (const t of dueTorrents) {
            if (t.imdbId && !seen.has(t.imdbId)) {
                seen.add(t.imdbId);
                result.push({ imdbId: t.imdbId, type: t.type });
            }
        }
        return result;
    }
    async rescrapeTitle(imdbId, type) {
        logger.info(`🔍 Re-scraping: ${imdbId} (${type})`);
        const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
        if (!imdbTitles || !imdbTitles.originalTitle) {
            logger.warn(`Sem títulos TMDB para ${imdbId}, atualizando rescrapeAt`);
            await this.updateRescrapeAt(imdbId, new Date(Date.now() + 24 * 60 * 60 * 1000));
            return 0;
        }
        const searchQuery = imdbTitles.portugueseTitleRaw || imdbTitles.portugueseTitle || imdbTitles.originalTitle;
        const results = await this.torrentScraper.searchTorrents(searchQuery, type, undefined, undefined, imdbId);
        const seen = new Set();
        const allResults = results.filter(r => {
            if (seen.has(r.magnet))
                return false;
            seen.add(r.magnet);
            return true;
        });
        let newTorrents = 0;
        for (const result of allResults) {
            try {
                const magnetResult = await this.autoMagnetService.autoAddMagnet(result.magnet, result.title, imdbId, type, result.seeders || 0, result.quality, result.size, undefined, undefined, undefined, result.provider);
                if (magnetResult.magnetAdded) {
                    newTorrents++;
                    logger.info(`🆕 Novo torrent: ${result.title.substring(0, 60)} (${result.quality})`);
                }
            }
            catch {
            }
        }
        await this.removeCamIfBetterExists(imdbId);
        if (allResults.length === 0) {
            logger.debug(`Nenhum resultado novo para ${imdbId}`);
            await this.updateRescrapeAt(imdbId, new Date(Date.now() + 12 * 60 * 60 * 1000));
            return 0;
        }
        const best = this.findBestResult(allResults);
        const nextRescrape = RescrapeService.computeRescrapeAt(best?.title, best?.quality);
        await this.updateRescrapeAt(imdbId, nextRescrape);
        logger.info(`✅ Re-scrape ${imdbId}: ${newTorrents} novos de ${allResults.length} resultados`);
        return newTorrents;
    }
    async isCamLike(torrent) {
        if (torrent.magnet) {
            const dados = await (0, magnetHelper_js_1.analisarMagnet)(torrent.magnet).catch(() => null);
            if (dados?.nome)
                return CAM_LIKE_REGEX.test(dados.nome);
        }
        return CAM_LIKE_REGEX.test(torrent.title || '');
    }
    async removeCamIfBetterExists(imdbId) {
        const torrents = await models_js_1.Torrent.findAll({
            attributes: ['infoHash', 'title', 'magnet'],
            where: { imdbId },
            raw: true,
        });
        const flags = await Promise.all(torrents.map((t) => this.isCamLike(t)));
        const cams = [];
        const nonCams = [];
        torrents.forEach((t, i) => {
            if (flags[i])
                cams.push(t);
            else
                nonCams.push(t);
        });
        if (cams.length === 0 || nonCams.length === 0)
            return 0;
        const hashes = cams.map((t) => t.infoHash).filter(Boolean);
        if (hashes.length === 0)
            return 0;
        const destroyed = await models_js_1.Torrent.destroy({
            where: { imdbId, infoHash: { [sequelize_1.Op.in]: hashes } },
        });
        logger.info(`🗑️ Removidos ${destroyed} torrent(s) CAM/TS de ${imdbId} — já tem qualidade melhor`);
        return destroyed;
    }
    async updateRescrapeAt(imdbId, rescrapeAt) {
        await models_js_1.Torrent.update({ rescrapeAt }, { where: { imdbId } });
    }
    findBestResult(results) {
        let best;
        let bestRank = -1;
        for (const r of results) {
            const rank = this.getRank(r.title, r.quality);
            if (rank > bestRank) {
                bestRank = rank;
                best = r;
            }
        }
        return best;
    }
    getRank(title, quality) {
        const titleLower = title.toLowerCase();
        let rank = 0;
        for (const { regex, rank: ruleRank } of SOURCE_PATTERNS) {
            if (regex.test(titleLower) && ruleRank > rank) {
                rank = ruleRank;
            }
        }
        if (quality) {
            const q = quality.toLowerCase();
            if (QUALITY_RANK_EXTRA[q] && QUALITY_RANK_EXTRA[q] > rank) {
                rank = QUALITY_RANK_EXTRA[q];
            }
        }
        return rank;
    }
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
exports.RescrapeService = RescrapeService;
exports.default = RescrapeService;
