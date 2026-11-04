"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RescrapeService = void 0;
const models_js_1 = require("../../database/models.js");
const TorrentScraperService_js_1 = require("./TorrentScraperService.js");
const ImdbScraperService_js_1 = require("../../catalogo/ImdbScraperService.js");
const AutoMagnetService_js_1 = require("../../debrid/AutoMagnetService.js");
const logger_js_1 = require("../../utils/logger.js");
const sequelize_1 = require("sequelize");
const logger = new logger_js_1.Logger('RescrapeService');
const SOURCE_PATTERNS = [
    { regex: /\b(bluray|blu-ray|bdrip|brrip|remux|web-dl|web\.dl)\b/i, rank: 9 },
    { regex: /\b(2160p|4k|uhd)\b/i, rank: 10 },
    { regex: /\b(dv|hdr10\+?|dolby\s*vision)\b/i, rank: 10 },
    { regex: /\b(webrip|web\.rip|web\s*rip)\b/i, rank: 7 },
    { regex: /\b(dvdscr|screener|dvd-scr)\b/i, rank: 4 },
    { regex: /\b(hc|hard\s*coded)\b/i, rank: 4 },
    { regex: /\b(hdtv|hd-tv)\b/i, rank: 6 },
    { regex: /\b(hdrip|hd-rip|hd\.rip)\b/i, rank: 6 },
    { regex: /\b(hdcam|hd-cam|hdts|hd-ts|telecine|telesync)\b/i, rank: 2 },
    { regex: /\b(camrip|cam-rip|cam\.rip|cam\b|ts\b|workprint|wp\b)\b/i, rank: 1 },
];
const QUALITY_RANK_EXTRA = {
    '2160p': 10, '4k': 10, 'uhd': 10, 'hdr': 10, 'dv': 10,
    '1080p': 9, '720p': 7, 'hd': 5, 'sd': 2,
};
const CAM_LIKE_REGEX = /\b(cam(?:[\s._-]?rip)?|hdcam|hd[\s._-]?cam|hd[\s._-]?ts|ts[\s._-]?rip|telecine|telesync|workprint)\b/i;
const MAX_RESCRAPE_PER_BATCH = 5;
const MAX_FETCH_DUE = 20;
const DELAY_BETWEEN_RESCRAPES = 20000;
const BOOT_DELAY_MS = 30000;
const MIN_DELAY_MS = 60000;
const MAX_DELAY_MS = 4 * 60 * 60 * 1000;
const SCHEDULE_MARGIN_MS = 30000;
const FALLBACK_DELAY_MS = 60 * 60 * 1000;
class RescrapeService {
    constructor() {
        this.timer = null;
        this.isRunning = false;
        this.isStopping = false;
        this.stats = { totalRescraped: 0, totalNewTorrents: 0, lastRun: '', lastScheduledFor: '' };
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
        this.isStopping = false;
        logger.info('🔁 RescrapeService iniciado (agendamento dinâmico)');
        this.scheduleNext(BOOT_DELAY_MS);
    }
    stop() {
        this.isStopping = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('RescrapeService parado');
    }
    getStats() {
        return { ...this.stats };
    }
    static computeRescrapeAt(title, qualidade) {
        if (!title && !qualidade)
            return null;
        const titleLower = (title || '').toLowerCase();
        if (/\b(bluray|blu-ray|bdrip|brrip|remux|web-dl|web\.dl)\b/i.test(titleLower))
            return null;
        if (/\b(2160p|4k|uhd|hdr10\+?|dolby\s*vision|\bdv\b)\b/i.test(titleLower))
            return null;
        if (qualidade && /\b(2160p|4k|uhd|1080p)\b/i.test(qualidade))
            return null;
        if (/\b(camrip|cam-rip|cam\.rip|hdcam|hd-cam|hdts|hd-ts|ts\b|telecine|telesync|workprint)\b/i.test(titleLower)) {
            return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        }
        if (/\b(hdtv|hd-tv|hdrip|hd-rip|webrip|web\.rip)\b/i.test(titleLower)) {
            return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        }
        if (/\b(1080p|720p)\b/i.test(titleLower)) {
            return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
        }
        return null;
    }
    scheduleNext(delayMs) {
        if (this.isStopping)
            return;
        if (this.timer)
            clearTimeout(this.timer);
        const delayFinal = Math.max(MIN_DELAY_MS, Math.min(delayMs, MAX_DELAY_MS));
        const target = new Date(Date.now() + delayFinal);
        this.stats.lastScheduledFor = target.toISOString();
        logger.debug('⏰ Próximo ciclo agendado', {
            em: `${Math.round(delayFinal / 60000)}min`,
            alvo: target.toISOString(),
        });
        this.timer = setTimeout(() => this.tick(), delayFinal);
    }
    async tick() {
        if (this.isStopping)
            return;
        try {
            await this.runRescrapeCycle();
        }
        catch (err) {
            logger.error('Erro no ciclo', { error: err instanceof Error ? err.message : 'Erro' });
        }
        try {
            const delay = await this.computeNextDelay();
            this.scheduleNext(delay);
        }
        catch (err) {
            logger.warn('Falha ao calcular próximo agendamento, usando fallback', {
                error: err instanceof Error ? err.message : 'Erro',
            });
            this.scheduleNext(FALLBACK_DELAY_MS);
        }
    }
    async computeNextDelay() {
        const next = await models_js_1.Torrent.findOne({
            attributes: ['rescrapeAt'],
            where: {
                rescrapeAt: { [sequelize_1.Op.ne]: null, [sequelize_1.Op.gt]: new Date() },
            },
            order: [['rescrapeAt', 'ASC']],
            raw: true,
        });
        const nextAt = next?.rescrapeAt;
        if (!nextAt)
            return FALLBACK_DELAY_MS;
        const ts = new Date(nextAt).getTime();
        const delay = ts - Date.now() + SCHEDULE_MARGIN_MS;
        logger.debug('📅 Próximo vencimento', {
            em: `${Math.round(delay / 60000)}min`,
            quando: new Date(ts).toISOString(),
        });
        return delay;
    }
    async runRescrapeCycle() {
        if (this.isRunning) {
            logger.debug('Ciclo já em andamento, pulando...');
            return;
        }
        this.isRunning = true;
        const startTime = Date.now();
        try {
            const dueTitles = await this.findTitlesDueForRescrape();
            if (dueTitles.length === 0) {
                logger.debug('Nenhum título vencido');
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
            logger.info(`✅ Ciclo concluído`, {
                processados: batch.length,
                novosTorrents: newTorrentsFound,
                tempo: `${(elapsed / 1000).toFixed(1)}s`,
            });
            this.stats.lastRun = new Date().toISOString();
        }
        finally {
            this.isRunning = false;
        }
    }
    async findTitlesDueForRescrape() {
        const now = new Date();
        const dueTorrents = await models_js_1.Torrent.findAll({
            attributes: ['imdbId', 'type', 'rescrapeAt'],
            where: {
                rescrapeAt: { [sequelize_1.Op.ne]: null, [sequelize_1.Op.lte]: now },
                imdbId: { [sequelize_1.Op.ne]: null },
            },
            order: [['rescrapeAt', 'ASC']],
            limit: MAX_FETCH_DUE,
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
            logger.warn(`Sem títulos TMDB para ${imdbId}`);
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
            logger.debug(`Nenhum resultado para ${imdbId}`);
            await this.updateRescrapeAt(imdbId, new Date(Date.now() + 12 * 60 * 60 * 1000));
            return 0;
        }
        const best = this.findBestResult(allResults);
        const nextRescrape = RescrapeService.computeRescrapeAt(best?.title, best?.quality);
        await this.updateRescrapeAt(imdbId, nextRescrape);
        logger.info(`✅ Re-scrape ${imdbId}: ${newTorrents} novos de ${allResults.length} resultados`);
        return newTorrents;
    }
    async removeCamIfBetterExists(imdbId) {
        const torrents = await models_js_1.Torrent.findAll({
            attributes: ['infoHash', 'title'],
            where: { imdbId },
            raw: true,
        });
        if (torrents.length < 2)
            return 0;
        const cams = torrents.filter((t) => CAM_LIKE_REGEX.test(t.title || ''));
        if (cams.length === 0)
            return 0;
        const nonCams = torrents.filter((t) => !CAM_LIKE_REGEX.test(t.title || ''));
        if (nonCams.length === 0)
            return 0;
        const hashes = cams.map((t) => t.infoHash).filter(Boolean);
        if (hashes.length === 0)
            return 0;
        const destroyed = await models_js_1.Torrent.destroy({
            where: { imdbId, infoHash: { [sequelize_1.Op.in]: hashes } },
        });
        logger.info(`🗑️ Removidos ${destroyed} torrent(s) CAM/TS de ${imdbId}`);
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
