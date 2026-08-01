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
 *
 * LÓGICA:
 * - CAM/TS/Workprint → 3 dias (filmado no cinema, releases melhores saem rápido)
 * - HDCAM/HDTS/Telecine → 5 dias
 * - HDTV/HDRip → 7 dias
 * - DVDSCR/SCREENER/HC → 10 dias
 * - WEBRip → 14 dias (rip de streaming, já é decente mas pode sair Web-DL/BluRay)
 * - BluRay/WEB-DL/Remux/2160p → NUNCA (qualidade final)
 * - Sem padrão conhecido → 7 dias (conservador)
 */
const SOURCE_PATTERNS: Array<{ regex: RegExp; days: number | null }> = [
  // Qualidades FINAIS (null = nunca re-scrape)
  { regex: /\b(bluray|blu-ray|bdrip|brrip|remux|web-dl|web\.dl)\b/i, days: null },
  { regex: /\b(2160p|4k|uhd)\b/i, days: null },
  { regex: /\b(dv|hdr10\+?|dolby\s*vision)\b/i, days: null },

  // Qualidades INTERMEDIÁRIAS
  { regex: /\b(webrip|web\.rip|web\s*rip)\b/i, days: 14 },
  { regex: /\b(dvdscr|screener|dvd-scr|dvdscr)\b/i, days: 10 },
  { regex: /\b(hc|hard\s*coded)\b/i, days: 10 },

  // Qualidades BAIXAS
  { regex: /\b(hdtv|hd-tv)\b/i, days: 7 },
  { regex: /\b(hdrip|hd-rip|hd\.rip)\b/i, days: 7 },
  { regex: /\b(hdcam|hd-cam|hdts|hd-ts|telecine|telesync)\b/i, days: 5 },
  { regex: /\b(camrip|cam-rip|cam\.rip|cam\b|ts\b|workprint|wp\b)\b/i, days: 3 },
];

/** Delay entre cada re-scrape (evita flood nos scrapers) */
const DELAY_BETWEEN_RESCRAPES = 60000; // 1 min

/** Máximo de títulos por batch (evita sobrecarga) */
const MAX_RESCRAPE_PER_BATCH = 5;

/** Tempo entre execuções do job de verificação (30 minutos) */
const RESCRAPE_CHECK_INTERVAL = 30 * 60 * 1000;

/**
 * Serviço de re-scraping periódico.
 *
 * Problema resolvido:
 * - Um filme é lançado como CAM rip → o addon salva no banco
 * - 2 semanas depois, sai release 1080p/2160p nos trackers
 * - Mas o addon NUNCA re-scrapeia esse IMDB porque já tem torrent salvo
 * - O RescrapeService resolve isso: periodicamente, re-scrapeia títulos
 *   com qualidade baixa para achar releases melhores
 */
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

  /**
   * Inicia o job periódico de re-scraping.
   * Chame uma vez no startup do servidor.
   */
  start(): void {
    if (this.timer) {
      logger.warn('RescrapeService já está rodando');
      return;
    }

    logger.info('🔁 RescrapeService iniciado', {
      intervalo: `${RESCRAPE_CHECK_INTERVAL / 60000}min`,
      maxPorBatch: MAX_RESCRAPE_PER_BATCH,
    });

    // Primeira execução: 2 min após startup (espera tudo inicializar)
    setTimeout(() => this.runRescrapeCycle(), 2 * 60 * 1000);

    // Execuções subsequentes: a cada RESCRAPE_CHECK_INTERVAL
    this.timer = setInterval(() => this.runRescrapeCycle(), RESCRAPE_CHECK_INTERVAL);
  }

  /**
   * Para o job periódico.
   */
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

  /**
   * Analisa o TÍTULO do torrent (dn do magnet via parse-torrent)
   * para determinar quando fazer o próximo re-scrape.
   *
   * Retorna uma data futura ou null se for qualidade final.
   *
   * @param title - Título completo do torrent (fonte canônica: dn do magnet)
   * @param qualidade - Resolução detectada (1080p, 2160p, 720p, HD) — fallback
   */
  static computeRescrapeAt(title: string | undefined, qualidade?: string): Date | null {
    if (!title && !qualidade) return null;

    const titleLower = (title || '').toLowerCase();

    // 1. Verifica padrões de FONTE no título (CAMRip, WEBRip, BluRay...)
    for (const { regex, days } of SOURCE_PATTERNS) {
      if (regex.test(titleLower)) {
        if (days === null) return null; // qualidade final
        return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      }
    }

    // 2. Fallback: se qualidade é 1080p ou 2160p, provavelmente é final
    if (qualidade) {
      const q = qualidade.toLowerCase();
      if (q === '2160p' || q === '4k') return null;
      if (q === '1080p') return null; // 1080p sem CAM → provavelmente decente
    }

    // 3. Qualidade desconhecida: 7 dias (conservador)
    return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  /**
   * Ciclo principal: busca títulos vencidos e re-scrapeia.
   */
  private async runRescrapeCycle(): Promise<void> {
    if (this.isRunning) {
      logger.debug('Ciclo de re-scrape já em andamento, pulando...');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      // 1. Busca títulos que precisam de re-scrape
      const dueTitles = await this.findTitlesDueForRescrape();

      if (dueTitles.length === 0) {
        logger.debug('Nenhum título precisa de re-scrape');
        return;
      }

      logger.info(`🔁 ${dueTitles.length} títulos para re-scrape`, {
        titles: dueTitles.map(t => `${t.imdbId} (${t.type})`),
      });

      // 2. Processa cada título (limitado a MAX_RESCRAPE_PER_BATCH)
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
          // Atualiza rescrapeAt mesmo com erro (tenta de novo depois)
          await this.updateRescrapeAt(title.imdbId, new Date(Date.now() + 6 * 60 * 60 * 1000));
        }

        // Delay entre títulos (evita flood)
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

  /**
   * Busca IMDB IDs únicos com rescrapeAt vencido.
   */
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

    // Deduplica por imdbId
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

  /**
   * Re-scrapeia um título específico.
   * Retorna o número de novos torrents encontrados.
   */
  private async rescrapeTitle(imdbId: string, type: string): Promise<number> {
    logger.info(`🔍 Re-scraping: ${imdbId} (${type})`);

    // Busca dados TMDB
    const imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
    if (!imdbTitles || !imdbTitles.originalTitle) {
      logger.warn(`Sem títulos TMDB para ${imdbId}, atualizando rescrapeAt`);
      await this.updateRescrapeAt(imdbId, new Date(Date.now() + 24 * 60 * 60 * 1000));
      return 0;
    }

    const searchQuery = imdbTitles.portugueseTitleRaw || imdbTitles.portugueseTitle || imdbTitles.originalTitle;

    // Chama os scrapers com ambos prioritários e fallbacks
    const resultsPriority = await this.torrentScraper.searchTorrents(
      searchQuery, type as 'movie' | 'series', undefined, undefined, imdbId
    );

    // Merge e deduplica
    const seen = new Set<string>();
    const allResults = [...resultsPriority].filter(r => {
      if (seen.has(r.magnet)) return false;
      seen.add(r.magnet);
      return true;
    });

    if (allResults.length === 0) {
      logger.debug(`Nenhum resultado novo para ${imdbId}`);
      // Atualiza rescrapeAt para +12h (tenta de novo mais tarde, pode ser timing)
      await this.updateRescrapeAt(imdbId, new Date(Date.now() + 12 * 60 * 60 * 1000));
      return 0;
    }

    // Tenta salvar cada torrent via AutoMagnetService
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
          undefined, // season (auto-detect)
          undefined, // episode (auto-detect)
          undefined, // infoHash (extraído do magnet pelo autoAddMagnet)
          result.provider
        );

        if (magnetResult.magnetAdded) {
          newTorrents++;
          logger.info(`🆕 Novo torrent: ${result.title.substring(0, 60)} (${result.quality})`);
        }
      } catch (err) {
        // Continua com o próximo
      }
    }

    // Atualiza rescrapeAt baseado na melhor qualidade/título encontrado
    const bestResult = this.findBestResult(allResults);
    const nextRescrape = RescrapeService.computeRescrapeAt(bestResult?.title, bestResult?.quality);
    await this.updateRescrapeAt(imdbId, nextRescrape);

    logger.info(`✅ Re-scrape ${imdbId}: ${newTorrents} novos de ${allResults.length} resultados`);

    return newTorrents;
  }

  /**
   * Atualiza rescrapeAt para TODOS os torrents de um imdbId.
   */
  private async updateRescrapeAt(imdbId: string, rescrapeAt: Date | null): Promise<void> {
    await Torrent.update(
      { rescrapeAt } as any,
      { where: { imdbId } }
    );
  }

  /**
   * Encontra o melhor resultado (título + qualidade) de uma lista.
   * Prioriza títulos com melhor qualidade de fonte.
   */
  private findBestResult(results: Array<{ title: string; quality?: string }>): { title: string; quality?: string } | undefined {
    const qualityRank: Record<string, number> = {
      '2160p': 10, '4k': 10, 'hdr': 10, 'dv': 10, 'bluray': 9,
      '1080p': 8, 'web-dl': 7,
      '720p': 5, 'hd': 5, 'hdtv': 4,
      'webrip': 3, 'hdrip': 3, 'dvdscr': 2,
      'cam': 1, 'ts': 1, 'hdts': 1, 'hdcam': 1,
    };

    let best: { title: string; quality?: string } | undefined;
    let bestRank = -1;

    for (const r of results) {
      const titleLower = r.title.toLowerCase();
      let rank = 0;

      // Pontua pela qualidade detectada
      if (r.quality) {
        const q = r.quality.toLowerCase();
        for (const [key, score] of Object.entries(qualityRank)) {
          if (q.includes(key) && score > rank) rank = score;
        }
      }

      // Pontua por padrões no título (fonte)
      for (const [key, score] of Object.entries(qualityRank)) {
        if (titleLower.includes(key) && score > rank) rank = score;
      }

      if (rank > bestRank) {
        bestRank = rank;
        best = r;
      }
    }

    return best;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default RescrapeService;
