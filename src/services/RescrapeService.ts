import { Torrent } from '../database/models.js';
import { TorrentScraperService } from '../services/scraper/TorrentScraperService.js';
import { ImdbScraperService, ImdbTitles } from '../catalogo/ImdbScraperService.js';
import { AutoMagnetService } from '../debrid/AutoMagnetService.js';
import { Logger } from '../utils/logger.js';
import { Op } from 'sequelize';

const logger = new Logger('RescrapeService');

/**
 * Intervalos de re-scraping por tipo de fonte no título.
 * Detectado via regex no nome do torrent (dn do magnet).
 * Agora cada entrada também carrega um `rank` para ordenação de melhor resultado.
 *
 * LÓGICA:
 * - CAM/TS/Workprint → 3 dias
 * - HDCAM/HDTS/Telecine → 5 dias
 * - HDTV/HDRip → 7 dias
 * - DVDSCR/SCREENER/HC → 10 dias
 * - WEBRip → 14 dias
 * - BluRay/WEB-DL/Remux/2160p → NUNCA (final)
 * - Sem padrão conhecido → 7 dias (conservador)
 */
const SOURCE_PATTERNS: Array<{ regex: RegExp; days: number | null; rank: number }> = [
  // Qualidades FINAIS (null = nunca re-scrape)
  { regex: /\b(bluray|blu-ray|bdrip|brrip|remux|web-dl|web\.dl)\b/i, days: null, rank: 9 },
  { regex: /\b(2160p|4k|uhd)\b/i, days: null, rank: 10 },
  { regex: /\b(dv|hdr10\+?|dolby\s*vision)\b/i, days: null, rank: 10 },

  // Qualidades INTERMEDIÁRIAS
  { regex: /\b(webrip|web\.rip|web\s*rip)\b/i, days: 14, rank: 7 },
  { regex: /\b(dvdscr|screener|dvd-scr|dvdscr)\b/i, days: 10, rank: 4 },
  { regex: /\b(hc|hard\s*coded)\b/i, days: 10, rank: 4 },

  // Qualidades BAIXAS
  { regex: /\b(hdtv|hd-tv)\b/i, days: 7, rank: 6 },
  { regex: /\b(hdrip|hd-rip|hd\.rip)\b/i, days: 7, rank: 6 },
  { regex: /\b(hdcam|hd-cam|hdts|hd-ts|telecine|telesync)\b/i, days: 5, rank: 2 },
  { regex: /\b(camrip|cam-rip|cam\.rip|cam\b|ts\b|workprint|wp\b)\b/i, days: 3, rank: 1 },
];

/**
 * Ranking adicional para strings de qualidade que podem vir no campo `quality`,
 * sem correspondência direta nas fontes acima.
 */
const QUALITY_RANK_EXTRA: Record<string, number> = {
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

/** Delay entre cada re-scrape (evita flood nos scrapers) */
const DELAY_BETWEEN_RESCRAPES = 60000; // 1 min

/** Máximo de títulos por batch (evita sobrecarga) */
const MAX_RESCRAPE_PER_BATCH = 5;

/** Tempo entre execuções do job de verificação (30 minutos) */
const RESCRAPE_CHECK_INTERVAL = 30 * 60 * 1000;

export class RescrapeService {
  private static instance: RescrapeService;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly autoMagnetService: AutoMagnetService;
  private stats = { totalRescraped: 0, totalNewTorrents: 0, lastRun: '' };

  private constructor() {
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = ImdbScraperService.getInstance();
    this.autoMagnetService = new AutoMagnetService();
  }

  static getInstance(): RescrapeService {
    if (!RescrapeService.instance) {
      RescrapeService.instance = new RescrapeService();
    }
    return RescrapeService.instance;
  }

  start(): void {
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

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('RescrapeService parado');
    }
  }

  getStats() {
    return { ...this.stats };
  }

  static computeRescrapeAt(title: string | undefined, qualidade?: string): Date | null {
    if (!title && !qualidade) return null;

    const titleLower = (title || '').toLowerCase();

    // 1. Verifica padrões de fonte no título
    for (const { regex, days } of SOURCE_PATTERNS) {
      if (regex.test(titleLower)) {
        if (days === null) return null;
        return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }
    }

    // 2. Fallback pela qualidade informada
    if (qualidade) {
      const q = qualidade.toLowerCase();
      if (q === '2160p' || q === '4k') return null;
      if (q === '1080p') return null;
    }

    // 3. Desconhecido
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  private async runRescrapeCycle(): Promise<void> {
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
        } catch (err) {
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
    } catch (error) {
      logger.error('Erro no ciclo de re-scrape', {
        error: error instanceof Error ? error.message : 'Erro',
      });
    } finally {
      this.isRunning = false;
    }
  }

  private async findTitlesDueForRescrape(): Promise<Array<{ imdbId: string; type: string }>> {
    const now = new Date();
    const dueTorrents = await Torrent.findAll({
      attributes: ['imdbId', 'type'],
      where: {
        rescrapeAt: { [Op.ne]: null as any, [Op.lte]: now },
        imdbId: { [Op.ne]: null as any },
      },
      raw: true,
    });

    const seen = new Set<string>();
    const result: Array<{ imdbId: string; type: string }> = [];
    for (const t of dueTorrents as any[]) {
      if (t.imdbId && !seen.has(t.imdbId)) {
        seen.add(t.imdbId);
        result.push({ imdbId: t.imdbId, type: t.type });
      }
    }

    return result;
  }

  private async rescrapeTitle(imdbId: string, type: string): Promise<number> {
    logger.info(`🔍 Re-scraping: ${imdbId} (${type})`);

    const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
    if (!imdbTitles || !imdbTitles.originalTitle) {
      logger.warn(`Sem títulos TMDB para ${imdbId}, atualizando rescrapeAt`);
      await this.updateRescrapeAt(imdbId, new Date(Date.now() + 24 * 60 * 60 * 1000));
      return 0;
    }

    const searchQuery = imdbTitles.portugueseTitleRaw || imdbTitles.portugueseTitle || imdbTitles.originalTitle;

    const results = await this.torrentScraper.searchTorrents(
      searchQuery, type as 'movie' | 'series', undefined, undefined, imdbId
    );

    const seen = new Set<string>();
    const allResults = results.filter(r => {
      if (seen.has(r.magnet)) return false;
      seen.add(r.magnet);
      return true;
    });

    if (allResults.length === 0) {
      logger.debug(`Nenhum resultado novo para ${imdbId}`);
      await this.updateRescrapeAt(imdbId, new Date(Date.now() + 12 * 60 * 60 * 1000));
      return 0;
    }

    let newTorrents = 0;
    for (const result of allResults) {
      try {
        const magnetResult = await this.autoMagnetService.autoAddMagnet(
          result.magnet,
          result.title,
          imdbId,
          type as 'movie' | 'series',
          result.seeders || 0,
          result.quality,
          result.size,
          undefined,
          undefined,
          undefined,
          result.provider
        );

        if (magnetResult.magnetAdded) {
          newTorrents++;
          logger.info(`🆕 Novo torrent: ${result.title.substring(0, 60)} (${result.quality})`);
        }
      } catch {
        // continua com o próximo
      }
    }

    const best = this.findBestResult(allResults);
    const nextRescrape = RescrapeService.computeRescrapeAt(best?.title, best?.quality);
    await this.updateRescrapeAt(imdbId, nextRescrape);

    logger.info(`✅ Re-scrape ${imdbId}: ${newTorrents} novos de ${allResults.length} resultados`);
    return newTorrents;
  }

  private async updateRescrapeAt(imdbId: string, rescrapeAt: Date | null): Promise<void> {
    await Torrent.update(
      { rescrapeAt } as any,
      { where: { imdbId } }
    );
  }

  private findBestResult(results: Array<{ title: string; quality?: string }>): { title: string; quality?: string } | undefined {
    let best: { title: string; quality?: string } | undefined;
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

  private getRank(title: string, quality?: string): number {
    const titleLower = title.toLowerCase();
    let rank = 0;

    // Avalia padrões de fonte no título
    for (const { regex, rank: ruleRank } of SOURCE_PATTERNS) {
      if (regex.test(titleLower) && ruleRank > rank) {
        rank = ruleRank;
      }
    }

    // Adiciona ranking extra da qualidade informada
    if (quality) {
      const q = quality.toLowerCase();
      if (QUALITY_RANK_EXTRA[q] && QUALITY_RANK_EXTRA[q] > rank) {
        rank = QUALITY_RANK_EXTRA[q];
      }
    }

    return rank;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default RescrapeService;