"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CamCleanupService = void 0;
const sequelize_1 = require("sequelize");
const models_js_1 = require("../../database/models.js");
const logger_js_1 = require("../../utils/logger.js");
const logger = new logger_js_1.Logger('CamCleanupService');
const CAM_REGEX_SQL = '\\y(cam([\\s._-]?rip)?|hdcam|hd[\\s._-]?cam|hd[\\s._-]?ts|ts[\\s._-]?rip|telecine|telesync|workprint)\\y';
const CAM_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
class CamCleanupService {
    constructor() {
        this.timer = null;
        this.isRunning = false;
        this.isStopping = false;
        this.stats = {
            totalRemoved: 0,
            lastRun: '',
            lastRemoved: 0,
            lastDurationMs: 0,
        };
    }
    static getInstance() {
        if (!CamCleanupService.instance) {
            CamCleanupService.instance = new CamCleanupService();
        }
        return CamCleanupService.instance;
    }
    start() {
        if (this.timer) {
            logger.warn('CamCleanupService já está rodando');
            return;
        }
        this.isStopping = false;
        logger.info('🧹 CamCleanupService iniciado', {
            intervalo: `${CLEANUP_INTERVAL_MS / (60 * 60 * 1000)}h`,
            primeiroEm: `${BOOT_DELAY_MS / 60000}min`,
            vidaUtilCam: `${CAM_MAX_AGE_MS / (60 * 60 * 1000)}h`,
        });
        this.timer = setTimeout(() => this.tick(), BOOT_DELAY_MS);
    }
    stop() {
        this.isStopping = true;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        logger.info('CamCleanupService parado');
    }
    getStats() {
        return { ...this.stats };
    }
    async runOnce() {
        return this.runCleanup();
    }
    async tick() {
        if (this.isStopping)
            return;
        try {
            await this.runCleanup();
        }
        catch (err) {
            logger.error('Erro na faxina de CAM', {
                error: err instanceof Error ? err.message : 'Erro',
            });
        }
        if (!this.isStopping) {
            this.timer = setTimeout(() => this.tick(), CLEANUP_INTERVAL_MS);
        }
    }
    async runCleanup() {
        if (this.isRunning)
            return { removed: 0, durationMs: 0 };
        this.isRunning = true;
        const start = Date.now();
        try {
            const cutoff = new Date(Date.now() - CAM_MAX_AGE_MS);
            const removed = await models_js_1.Torrent.destroy({
                where: {
                    [sequelize_1.Op.and]: [
                        models_js_1.sequelize.literal(`title ~* '${CAM_REGEX_SQL}'`),
                        { uploadDate: { [sequelize_1.Op.lt]: cutoff } },
                    ],
                },
            });
            const durationMs = Date.now() - start;
            this.stats.totalRemoved += removed;
            this.stats.lastRun = new Date().toISOString();
            this.stats.lastRemoved = removed;
            this.stats.lastDurationMs = durationMs;
            if (removed > 0) {
                logger.info('🧹 CAM expirado removido', {
                    removidos: removed,
                    idadeMinima: `${CAM_MAX_AGE_MS / (60 * 60 * 1000)}h`,
                    durationMs,
                });
            }
            else {
                logger.debug('Nenhum CAM expirado', { durationMs });
            }
            return { removed, durationMs };
        }
        finally {
            this.isRunning = false;
        }
    }
}
exports.CamCleanupService = CamCleanupService;
exports.default = CamCleanupService;
