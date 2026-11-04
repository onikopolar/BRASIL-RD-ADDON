import { Op } from 'sequelize';
import { Torrent, sequelize } from '../../database/models.js';
import { Logger } from '../../utils/logger.js';

const logger = new Logger('CamCleanupService');

// Regex SQL do Postgres. `\y` = word boundary (equivalente ao \b do JS).
// `~*` no WHERE faz case-insensitive.
const CAM_REGEX_SQL = '\\y(cam([\\s._-]?rip)?|hdcam|hd[\\s._-]?cam|hd[\\s._-]?ts|ts[\\s._-]?rip|telecine|telesync|workprint)\\y';

// Vida útil de um CAM no banco. Após isso, é removido pelo cleanup.
const CAM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Primeira execução: 5min após o boot (DB aquece).
const BOOT_DELAY_MS = 5 * 60 * 1000;

// Execuções subsequentes: 1x/dia.
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

export class CamCleanupService {
  private static instance: CamCleanupService;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isStopping = false;
  private stats = {
    totalRemoved: 0,
    lastRun: '',
    lastRemoved: 0,
    lastDurationMs: 0,
  };

  private constructor() {}

  static getInstance(): CamCleanupService {
    if (!CamCleanupService.instance) {
      CamCleanupService.instance = new CamCleanupService();
    }
    return CamCleanupService.instance;
  }

  start(): void {
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

  stop(): void {
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

  // Exposto pra testes ou trigger manual.
  async runOnce(): Promise<{ removed: number; durationMs: number }> {
    return this.runCleanup();
  }

  private async tick(): Promise<void> {
    if (this.isStopping) return;

    try {
      await this.runCleanup();
    } catch (err) {
      logger.error('Erro na faxina de CAM', {
        error: err instanceof Error ? err.message : 'Erro',
      });
    }

    if (!this.isStopping) {
      this.timer = setTimeout(() => this.tick(), CLEANUP_INTERVAL_MS);
    }
  }

  // Apaga todo CAM com mais de 24h de vida. Regra única, sem comparação com outros torrents.
  // Se outro usuário buscar o filme depois, o scraper salva o CAM de novo com uploadDate fresco.
  private async runCleanup(): Promise<{ removed: number; durationMs: number }> {
    if (this.isRunning) return { removed: 0, durationMs: 0 };
    this.isRunning = true;
    const start = Date.now();

    try {
      const cutoff = new Date(Date.now() - CAM_MAX_AGE_MS);

      const removed = await Torrent.destroy({
        where: {
          [Op.and]: [
            sequelize.literal(`title ~* '${CAM_REGEX_SQL}'`),
            { uploadDate: { [Op.lt]: cutoff } },
          ],
        } as any,
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
      } else {
        logger.debug('Nenhum CAM expirado', { durationMs });
      }

      return { removed, durationMs };
    } finally {
      this.isRunning = false;
    }
  }
}

export default CamCleanupService;