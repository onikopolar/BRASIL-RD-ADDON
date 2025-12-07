import { CuratedMagnetService } from '../services/CuratedMagnetService';
import { QualityDetector } from '../lib/qualityDetector';
import { StreamFormatter } from '../lib/streamFormatter';
import { Stream } from '../types/index';
import { extractHashFromMagnet } from '../lib/magnetHelper';
import { Logger } from '../utils/logger';
import { MetadataExtractor } from '../lib/title-filter/MetadataExtractor';
import { getImdbIdMovieEntries, getImdbIdSeriesEntries } from '../lib/repository';
import { TorrentScraperService } from '../services/scraper/TorrentScraperService';
import { ImdbScraperService, ImdbTitles } from '../services/ImdbScraperService';
import { TitleFilter } from '../lib/titleFilter';
import { AutoMagnetService } from '../services/AutoMagnetService';

interface ScrapedTorrent {
  title: string;
  magnet: string;
  seeders: number;
  leechers: number;
  size: string;
  quality: string;
  provider: string;
  language: string;
  type: 'movie' | 'series';
}

export class CatalogProvider {
  private readonly logger: Logger;
  private readonly qualityDetector: QualityDetector;
  private readonly streamFormatter: StreamFormatter;
  private readonly metadataExtractor: MetadataExtractor;
  private readonly torrentScraper: TorrentScraperService;
  private readonly imdbScraper: ImdbScraperService;
  private readonly titleFilter: TitleFilter;
  private readonly autoMagnetService: AutoMagnetService;

  // Versionamento Semantico v4.3.2 - FIX: Correcao de tipos e propriedades
  private readonly VERSION = '4.3.2';

  // Cache de streams com TTLs otimizados
  private readonly streamCache: Map<string, { streams: Stream[], timestamp: number, isEmpty: boolean }> = new Map();
  private readonly STREAM_TTL = 24 * 60 * 60 * 1000; // 24 horas para resultados com conteudo
  private readonly STREAM_EMPTY_TTL = 60 * 1000; // 1 minuto para resultados vazios
  private readonly CACHE_KEY_SEPARATOR = '|';

  constructor(
    private readonly magnetService: CuratedMagnetService
  ) {
    this.logger = new Logger('CatalogProvider');
    this.qualityDetector = new QualityDetector();
    this.streamFormatter = new StreamFormatter();
    this.metadataExtractor = new MetadataExtractor();
    this.torrentScraper = new TorrentScraperService();
    this.imdbScraper = new ImdbScraperService();
    this.titleFilter = new TitleFilter();
    this.autoMagnetService = new AutoMagnetService();
    
    this.logger.info(`CatalogProvider v${this.VERSION} inicializado - Correcao de tipos`);
  }

  async getStreamsFromCatalog(request: any): Promise<Stream[]> {
    const { season, episode } = this.extractSeasonEpisodeFromRequest(request);
    const cacheKey = this.generateCacheKey(request, season, episode);

    // Verificar cache antes de processar
    const cachedStreams = this.getFromCache(cacheKey);
    if (cachedStreams !== null) {
      this.logger.debug('Resultado obtido do cache', {
        requestId: request.id,
        quantidade: cachedStreams.length,
        cacheKey
      });
      return cachedStreams;
    }

    this.logger.debug('Busca de streams iniciada', {
      requestId: request.id,
      type: request.type,
      temApiKey: !!request.apiKey
    });
    
    const dbStreams = await this.getStreamsFromDatabase(request, season, episode);
    const jsonStreams = await this.getStreamsFromJson(request, season, episode);
    
    const catalogStreams = [...dbStreams, ...jsonStreams];
    
    // VERSÃO 4.3.2: NÃO deduplica mais - mantém todos os streams
    const catalogUniqueStreams = this.removeDuplicateSourcesButKeepQualities(catalogStreams);
    
    this.logger.info('Resultados catalogo obtidos', {
      total: catalogUniqueStreams.length,
      doBanco: dbStreams.length,
      doJson: jsonStreams.length,
      duplicadosRemovidos: catalogStreams.length - catalogUniqueStreams.length
    });
    
    if (catalogUniqueStreams.length > 0) {
      this.saveToCache(cacheKey, catalogUniqueStreams);
      this.logger.debug('Streams encontrados no catalogo, retornando', {
        requestId: request.id,
        quantidade: catalogUniqueStreams.length
      });
      return catalogUniqueStreams;
    }
    
    this.logger.debug('Nenhum stream no catalogo, tentando scraping', {
      requestId: request.id,
      type: request.type
    });
    
    const scrapedStreams = await this.performScrapingFallback(request, season, episode);
    
    // VERSÃO 4.3.2: NÃO deduplica scraping também
    const scrapedUniqueStreams = this.removeDuplicateSourcesButKeepQualities(scrapedStreams);
    
    this.logger.info('Resultados scraping obtidos', {
      total: scrapedUniqueStreams.length,
      fonte: 'scraping',
      duplicadosRemovidos: scrapedStreams.length - scrapedUniqueStreams.length
    });

    // Salvar resultado no cache (mesmo se vazio)
    this.saveToCache(cacheKey, scrapedUniqueStreams);
    
    return scrapedUniqueStreams;
  }

  private generateCacheKey(request: any, season?: number, episode?: number): string {
    const baseId = request.imdbId || request.id;
    const type = request.type || 'unknown';
    const seasonStr = season !== undefined ? `s${season}` : '';
    const episodeStr = episode !== undefined ? `e${episode}` : '';
    
    return `${baseId}${this.CACHE_KEY_SEPARATOR}${type}${this.CACHE_KEY_SEPARATOR}${seasonStr}${episodeStr}`;
  }

  private getFromCache(cacheKey: string): Stream[] | null {
    const cacheEntry = this.streamCache.get(cacheKey);
    if (!cacheEntry) return null;

    const ttl = cacheEntry.isEmpty ? this.STREAM_EMPTY_TTL : this.STREAM_TTL;
    const isExpired = Date.now() - cacheEntry.timestamp > ttl;
    
    if (isExpired) {
      this.streamCache.delete(cacheKey);
      this.logger.debug('Cache expirado', { cacheKey });
      return null;
    }
    
    this.logger.debug('Cache HIT', { 
      cacheKey, 
      streams: cacheEntry.streams.length,
      age: Date.now() - cacheEntry.timestamp
    });
    
    return cacheEntry.streams;
  }

  private saveToCache(cacheKey: string, streams: Stream[]): void {
    const isEmpty = streams.length === 0;
    this.streamCache.set(cacheKey, {
      streams,
      timestamp: Date.now(),
      isEmpty
    });
  }

  private async getStreamsFromDatabase(request: any, season?: number, episode?: number): Promise<Stream[]> {
    const extractBaseImdbId = (id: string): string => {
      const match = id.match(/^(tt\d+)/);
      return match ? match[1] : id;
    };
    
    const fullId = request.imdbId || request.id;
    const baseImdbId = extractBaseImdbId(fullId);
    
    const finalSeason = season !== undefined ? season : request.season;
    const finalEpisode = episode !== undefined ? episode : request.episode;
    
    this.logger.debug('Buscando no banco de dados', {
      fullId,
      baseImdbId,
      type: request.type,
      temporada: finalSeason,
      episodio: finalEpisode
    });

    try {
      let dbEntries: any[] = [];
      if (request.type === 'movie') {
        dbEntries = await getImdbIdMovieEntries(baseImdbId);
      } else if (request.type === 'series' && finalSeason !== undefined) {
        dbEntries = await getImdbIdSeriesEntries(baseImdbId, finalSeason, finalEpisode);
      }

      this.logger.debug('Resultados banco encontrados', {
        fullId,
        baseImdbId,
        entradasEncontradas: dbEntries.length,
        type: request.type,
        season: finalSeason,
        episode: finalEpisode
      });

      if (dbEntries.length === 0) {
        return [];
      }

      const torrentData = await this.processDatabaseTorrents(dbEntries, request, finalSeason, finalEpisode);
      const sortedTorrents = this.sortTorrentsHierarchically(torrentData);
      const streams = await this.createStreamsFromDbTorrents(sortedTorrents, request, finalSeason, finalEpisode);

      this.logger.info('Streams criados do banco', {
        baseImdbId,
        torrents: torrentData.length,
        streams: streams.length
      });

      return streams;

    } catch (error) {
      this.logger.error('Erro na busca no banco', {
        baseImdbId,
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return [];
    }
  }

  private async processDatabaseTorrents(dbEntries: any[], request: any, season?: number, episode?: number): Promise<any[]> {
    const torrentMap = new Map<string, any>();
    
    this.logger.debug('Processando torrents do banco - Agrupando por hash', {
      totalEntradas: dbEntries.length,
      season,
      episode
    });

    for (const entry of dbEntries) {
      try {
        const torrent = entry.Torrent;
        const magnet = torrent.magnetLink || '';
        const magnetHash = extractHashFromMagnet(magnet);
        
        if (!magnetHash) {
          this.logger.warn('Torrent sem hash valido', { 
            titulo: torrent.title.substring(0, 60) 
          });
          continue;
        }

        if (torrentMap.has(magnetHash)) {
          const existingTorrent = torrentMap.get(magnetHash);
          
          if (!existingTorrent.episodes) {
            existingTorrent.episodes = [];
          }
          
          existingTorrent.episodes.push({
            season: entry.imdbSeason,
            episode: entry.imdbEpisode,
            title: entry.title
          });
          
          continue;
        }

        const metadata = this.metadataExtractor.extractEnhancedMetadata(torrent.title);
        const quality = this.qualityDetector.extractBestQuality(torrent.title) || 'HD';
        const seeds = torrent.seeders || 50;
        const size = torrent.size ? this.formatSize(torrent.size) : 'N/A';
        const language = torrent.languages || 'PT-BR';
        const qualityScore = this.getQualityScore(quality);

        torrentMap.set(magnetHash, {
          torrent,
          metadata,
          quality,
          qualityScore,
          seeds,
          size,
          language,
          magnet,
          magnetHash,
          title: torrent.title,
          requestType: request.type,
          season: season,
          episode: episode,
          episodes: [{
            season: entry.imdbSeason,
            episode: entry.imdbEpisode,
            title: entry.title
          }]
        });

      } catch (error) {
        this.logger.warn('Erro ao processar torrent do banco', {
          error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
      }
    }

    const torrents = Array.from(torrentMap.values());
    
    this.logger.debug('Torrents agrupados por hash', {
      totalEntradas: dbEntries.length,
      torrentsUnicos: torrents.length,
      torrentsComMultiplosEpisodios: torrents.filter(t => t.episodes && t.episodes.length > 1).length
    });
    
    return torrents;
  }

  private async createStreamsFromDbTorrents(torrents: any[], request: any, season?: number, episode?: number): Promise<Stream[]> {
    const streams: Stream[] = [];

    for (const torrentData of torrents) {
      try {
        this.logger.debug('Processando torrent unico do banco', {
          titulo: torrentData.title.substring(0, 80),
          qualidade: torrentData.quality,
          seeds: torrentData.seeds,
          magnetHash: torrentData.magnetHash?.substring(0, 16),
          totalEpisodios: torrentData.episodes?.length || 1,
          season,
          episode
        });

        const formattedTorrent = {
          title: torrentData.title,
          magnet: torrentData.magnet,
          seeders: torrentData.seeds,
          size: torrentData.size,
          quality: torrentData.quality,
          language: torrentData.language
        };
        
        const streamArrays = this.streamFormatter.createMultipleQualityStreams(
          formattedTorrent,
          request,
          null,
          torrentData.requestType,
          season,
          episode,
          undefined
        );

        streams.push(...streamArrays);

      } catch (error) {
        this.logger.error('Erro ao criar stream do banco', {
          titulo: torrentData.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    return streams;
  }

  private sortTorrentsHierarchically(torrents: any[]): any[] {
    return torrents.sort((a, b) => {
      if (b.qualityScore !== a.qualityScore) {
        return b.qualityScore - a.qualityScore;
      }
      
      if (b.seeds !== a.seeds) {
        return b.seeds - a.seeds;
      }
      
      const sizeA = this.parseSizeToBytes(a.size);
      const sizeB = this.parseSizeToBytes(b.size);
      if (sizeB !== sizeA) {
        return sizeB - sizeA;
      }
      
      return a.title.localeCompare(b.title);
    });
  }

  private async getStreamsFromJson(request: any, season?: number, episode?: number): Promise<Stream[]> {
    try {
      const curatedMagnets = this.magnetService.searchMagnets(request);

      this.logger.debug('Resultados JSON obtidos', {
        magnetsEncontrados: curatedMagnets.length,
        imdbId: request.imdbId || request.id
      });

      if (curatedMagnets.length === 0) {
        return [];
      }

      const streams: Stream[] = [];
      
      for (const magnet of curatedMagnets) {
        try {
          const formattedTorrent = {
            title: magnet.title,
            magnet: magnet.magnet || '',
            seeders: magnet.seeds || 0,
            size: magnet.size || 'N/A',
            quality: magnet.quality || 'HD',
            language: magnet.language || 'PT-BR'
          };
          
          const isSeries = request.type === 'series';
          const targetSeason = season !== undefined ? season : magnet.season;
          const targetEpisode = episode !== undefined ? episode : magnet.episode;
          
          const streamArrays = this.streamFormatter.createMultipleQualityStreams(
            formattedTorrent,
            request,
            null,
            isSeries ? 'series' : 'movie',
            targetSeason,
            targetEpisode,
            undefined
          );
          
          if (streamArrays.length > 0) {
            streams.push(...streamArrays);
          }
        } catch (error) {
          this.logger.error('Erro ao processar magnet do JSON', {
            titulo: magnet.title.substring(0, 60),
            error: error instanceof Error ? error.message : 'Erro desconhecido'
          });
        }
      }

      this.logger.info('Streams do JSON criados', {
        quantidade: streams.length
      });

      return streams;

    } catch (error) {
      this.logger.error('Erro na busca no JSON', {
        error: error instanceof Error ? error.message : 'Erro desconhecido'
      });
      return [];
    }
  }

  private async performScrapingFallback(request: any, season?: number, episode?: number): Promise<Stream[]> {
    this.logger.debug('Iniciando scraping como fallback', {
      requestId: request.id,
      type: request.type,
      season: season,
      episode: episode
    });

    try {
      const imdbId = this.extractBaseImdbId(request.id);
      
      if (request.type === 'series') {
        return await this.scrapeSeries(request, imdbId, season, episode);
      } else {
        return await this.scrapeMovie(request, imdbId);
      }
    } catch (error) {
      this.logger.error('Erro no scraping fallback', {
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return [];
    }
  }

  private async scrapeSeries(request: any, imdbId: string | null, season?: number, episode?: number): Promise<Stream[]> {
    const match = request.id.match(/tt\d+:(\d+):(\d+)/);
    
    const finalSeason = season !== undefined ? season : (match ? parseInt(match[1]) : undefined);
    const finalEpisode = episode !== undefined ? episode : (match ? parseInt(match[2]) : undefined);

    if (!finalSeason || !finalEpisode) {
      this.logger.warn('Season ou episode nao definido para scraping serie', {
        imdbId,
        season: finalSeason,
        episode: finalEpisode
      });
      return [];
    }

    this.logger.debug('Scraping serie especifica', {
      imdbId,
      season: finalSeason,
      episode: finalEpisode
    });

    try {
      let imdbTitles: ImdbTitles | null = null;
      if (imdbId) {
        imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId, finalSeason);
      }

      const searchTitle = imdbTitles?.allTitles[0] || 'Serie';
      const searchQuery = `${searchTitle} S${finalSeason.toString().padStart(2, '0')}E${finalEpisode.toString().padStart(2, '0')}`;

      this.logger.debug('Query scraping serie', {
        searchQuery,
        season: finalSeason,
        episode: finalEpisode
      });

      const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'series', finalSeason);
      
      if (torrentResults.length === 0) {
        this.logger.debug('Nenhum torrent encontrado no scraping', { searchQuery });
        return [];
      }

      const validTorrents = await this.filterScrapedTorrents(torrentResults, imdbId, request, finalSeason, finalEpisode, imdbTitles);
      
      if (validTorrents.length === 0) {
        this.logger.debug('Nenhum torrent valido apos filtragem', {
          totalTestados: torrentResults.length
        });
        return [];
      }

      this.logger.debug('Torrents validos encontrados no scraping', {
        total: validTorrents.length,
        torrents: validTorrents.map(t => ({
          titulo: t.title.substring(0, 60),
          seeders: t.seeders,
          qualidade: t.quality
        }))
      });

      await this.saveScrapedTorrentsToCatalog(validTorrents, request, imdbId, finalSeason, finalEpisode);

      const allStreams: Stream[] = [];
      
      for (const torrent of validTorrents) {
        const formattedTorrent = {
          title: torrent.title,
          magnet: torrent.magnet,
          seeders: torrent.seeders,
          size: torrent.size,
          quality: torrent.quality,
          language: torrent.language
        };
        
        const torrentStreams = this.streamFormatter.createMultipleQualityStreams(
          formattedTorrent,
          request,
          null,
          'series',
          finalSeason,
          finalEpisode,
          undefined
        );
        
        allStreams.push(...torrentStreams);
      }

      // VERSÃO 4.3.2: Remove apenas duplicados exatos, mantém qualidades diferentes
      const uniqueStreams = this.removeDuplicateSourcesButKeepQualities(allStreams);

      this.logger.info('Streams criados do scraping', {
        quantidade: uniqueStreams.length,
        fonte: 'scraping',
        torrentsProcessados: validTorrents.length,
        season: finalSeason,
        episode: finalEpisode
      });

      return uniqueStreams;

    } catch (error) {
      this.logger.error('Erro no scraping serie', {
        imdbId,
        season: finalSeason,
        episode: finalEpisode,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return [];
    }
  }

  private async scrapeMovie(request: any, imdbId: string | null): Promise<Stream[]> {
    this.logger.debug('Scraping filme', { imdbId });

    try {
      let imdbTitles: ImdbTitles | null = null;
      if (imdbId) {
        imdbTitles = await this.imdbScraper.getTitlesFromImdbId(imdbId);
      }

      const searchTitle = imdbTitles?.allTitles[0] || 'Filme';
      const searchQuery = searchTitle;

      this.logger.debug('Query scraping filme', { searchQuery });

      const torrentResults = await this.torrentScraper.searchTorrents(searchQuery, 'movie');
      
      if (torrentResults.length === 0) {
        this.logger.debug('Nenhum torrent encontrado no scraping', { searchQuery });
        return [];
      }

      const validTorrents = await this.filterScrapedTorrents(torrentResults, imdbId, request);
      
      if (validTorrents.length === 0) {
        this.logger.debug('Nenhum torrent valido apos filtragem', {
          totalTestados: torrentResults.length
        });
        return [];
      }

      const streams: Stream[] = [];
      for (const torrent of validTorrents) {
        const formattedTorrent = {
          title: torrent.title,
          magnet: torrent.magnet,
          seeders: torrent.seeders,
          size: torrent.size,
          quality: torrent.quality,
          language: torrent.language
        };
        
        const torrentStreams = this.streamFormatter.createMultipleQualityStreams(
          formattedTorrent,
          request,
          null,
          'movie',
          undefined,
          undefined,
          undefined
        );
        
        streams.push(...torrentStreams);
      }

      await this.saveScrapedTorrentsToCatalog(validTorrents, request, imdbId);

      this.logger.info('Streams criados do scraping', {
        quantidade: streams.length,
        fonte: 'scraping',
        torrentsValidos: validTorrents.length
      });

      // VERSÃO 4.3.2: Mantém todas qualidades ao ordenar
      return this.streamFormatter.sortStreamsByQuality(streams);

    } catch (error) {
      this.logger.error('Erro no scraping filme', {
        imdbId,
        error: error instanceof Error ? error.message : 'Erro'
      });
      return [];
    }
  }

  private async filterScrapedTorrents(
    torrents: ScrapedTorrent[],
    imdbId: string | null,
    request: any,
    season?: number,
    episode?: number,
    imdbTitles: ImdbTitles | null = null
  ): Promise<ScrapedTorrent[]> {
    const valid: ScrapedTorrent[] = [];
    
    this.logger.debug('Filtrando torrents do scraping', {
      total: torrents.length,
      imdbId: imdbId,
      season: season,
      episode: episode
    });

    if (!imdbId) {
      return torrents;
    }

    for (const torrent of torrents) {
      try {
        const titleMatchResult = await this.titleFilter.doTitlesMatch(
          torrent.title, 
          imdbId, 
          season, 
          episode
        );
        
        if (titleMatchResult.matches) {
          valid.push(torrent);
        }
      } catch (error) {
        this.logger.debug('Erro filtragem torrent', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    this.logger.debug('Filtragem scraping concluida', {
      total: torrents.length,
      validos: valid.length,
      invalidos: torrents.length - valid.length
    });

    return valid;
  }

  private async saveScrapedTorrentsToCatalog(
    validTorrents: ScrapedTorrent[],
    request: any,
    imdbId: string | null,
    season?: number,
    episode?: number
  ): Promise<void> {
    if (!imdbId || validTorrents.length === 0) {
      return;
    }

    this.logger.debug('Salvando torrents do scraping no catalogo', {
      count: validTorrents.length,
      imdbId: imdbId,
      type: request.type,
      season: season,
      episode: episode
    });

    for (const torrent of validTorrents) {
      try {
        await this.autoMagnetService.autoAddMagnet(
          torrent.magnet,
          torrent.title,
          imdbId,
          request.type,
          torrent.seeders,
          torrent.quality,
          torrent.size,
          season,
          episode
        );
      } catch (error) {
        this.logger.warn('Erro salvar torrent do scraping', {
          title: torrent.title.substring(0, 60),
          error: error instanceof Error ? error.message : 'Erro'
        });
      }
    }

    this.logger.debug('Torrents do scraping salvos', {
      totalProcessados: validTorrents.length
    });
  }

  // VERSÃO 4.3.2: NOVO MÉTODO - Remove apenas duplicados exatos mas mantém qualidades diferentes
  private removeDuplicateSourcesButKeepQualities(streams: Stream[]): Stream[] {
    const seenStreamKeys = new Set<string>();
    const uniqueStreams: Stream[] = [];
    
    for (const stream of streams) {
      // Cria chave única baseada em URL + qualidade
      const streamUrl = stream.sources && stream.sources[0];
      const streamQuality = this.extractStreamQuality(stream);
      
      if (!streamUrl) {
        this.logger.warn('Stream sem URL encontrado', { 
          nome: stream.name,
          titulo: stream.title?.substring(0, 40) 
        });
        continue;
      }
      
      // Chave única: URL + qualidade
      const streamKey = `${streamUrl}|${streamQuality}`;
      
      if (seenStreamKeys.has(streamKey)) {
        // Stream exatamente igual já existe
        continue;
      }
      
      seenStreamKeys.add(streamKey);
      uniqueStreams.push(stream);
    }
    
    if (streams.length !== uniqueStreams.length) {
      this.logger.debug('Streams deduplicados (mantendo qualidades)', {
        antes: streams.length,
        depois: uniqueStreams.length,
        removidos: streams.length - uniqueStreams.length
      });
    }
    
    return uniqueStreams;
  }

  // Extrai qualidade do stream - FIX: Usa type assertion para streamQuality
  private extractStreamQuality(stream: Stream): string {
    // Tenta pegar do behaviorHints primeiro (com type assertion)
    const behaviorHints = stream.behaviorHints as any;
    if (behaviorHints?.streamQuality) {
      return behaviorHints.streamQuality;
    }
    
    // Tenta extrair do título
    const qualityMatch = stream.title?.match(/\((.*?)\)/) || stream.name?.match(/\((.*?)\)/);
    if (qualityMatch) {
      return qualityMatch[1];
    }
    
    // Tenta detectar qualidade
    const qualityFromTitle = this.qualityDetector.extractBestQuality(stream.title || '');
    if (qualityFromTitle && qualityFromTitle !== 'unknown') {
      return qualityFromTitle;
    }
    
    return 'unknown';
  }

  private extractSeasonEpisodeFromRequest(request: any): { season?: number, episode?: number } {
    let season = request.season;
    let episode = request.episode;
    
    if (!season && request.type === 'series' && request.id) {
      const seasonEpisodeMatch = request.id.match(/tt\d+:(\d+):(\d+)/);
      if (seasonEpisodeMatch) {
        season = parseInt(seasonEpisodeMatch[1]);
        episode = parseInt(seasonEpisodeMatch[2]);
      }
    }
    
    return { season, episode };
  }

  private extractBaseImdbId(id: string): string | null {
    const match = id.match(/^(tt\d+)/);
    return match ? match[1] : null;
  }

  private getQualityScore(quality: string): number {
    const scores: Record<string, number> = {
      '2160p': 100,
      '4k': 100,
      '1080p': 80,
      '720p': 60,
      'HD': 40,
      'SD': 20
    };
    return scores[quality] || 30;
  }

  private getQualityDistribution(torrents: any[]): string {
    const count: Record<string, number> = {};
    for (const t of torrents) {
      count[t.quality] = (count[t.quality] || 0) + 1;
    }
    return Object.entries(count)
      .map(([q, c]) => `${q}:${c}`)
      .join(', ');
  }

  private formatLanguage(language: string): string {
    if (!language) return 'PT-BR';
    
    const langMap: Record<string, string> = {
      'pt-BR': 'PT-BR',
      'pt-BR,en': 'Dual',
      'en': 'EN',
      'dual': 'Dual',
      'multi': 'Multi',
      'pt': 'PT-BR',
      'pt-BR,en-US': 'Dual',
      'pt-BR,en-US,ja-JP': 'Multi'
    };
    return langMap[language] || language;
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    } else if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
  }

  private parseSizeToBytes(sizeStr: string): number {
    if (!sizeStr || sizeStr === 'N/A') return 0;
    
    const match = sizeStr.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
    if (!match) return 0;
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    switch (unit) {
      case 'KB': return value * 1024;
      case 'MB': return value * 1024 * 1024;
      case 'GB': return value * 1024 * 1024 * 1024;
      default: return value;
    }
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[<>:"/\\|?*]/g, '_')
      .substring(0, 255);
  }

  getStats() {
    const cacheStats = {
      totalEntries: this.streamCache.size
    };

    return {
      version: this.VERSION,
      fix: 'Correcao de tipos e propriedades - nao deduplica streams por qualidade',
      mudancasPrincipais: [
        'Corrigido typo: seeds -> seeders',
        'Corrigido acesso a streamQuality com type assertion',
        'Nao deduplica streams com qualidades diferentes',
        'Usuario ve 720p e 1080p como opcoes separadas',
        'Mesma magnet pode aparecer multiplas vezes com diferentes qualidades'
      ]
    };
  }
}