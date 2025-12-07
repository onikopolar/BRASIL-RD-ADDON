import { AutoMagnetService } from '../services/AutoMagnetService';
import { RealDebridService } from '../services/RealDebridService';
import { RdTorrentCacheService } from '../services/RdTorrentCacheService';
import { CacheService } from '../services/CacheService';
import { StaticResponseService, StaticResponse } from '../services/StaticResponseService';
import { Logger } from '../utils/logger';
import { getStatusMessage } from './statusHelpers';

const logger = new Logger('ResolveRoutes');
const autoMagnetService = new AutoMagnetService();
const cacheService = new CacheService();
const rdTorrentCacheService = new RdTorrentCacheService();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Versionamento Semantico v1.2.0 - Integra cache inteligente de 2 camadas
const VERSION = '1.2.0';

function createStreamFromStaticResponse(
    staticResponseService: StaticResponseService,
    staticResponse: StaticResponse,
    requestId: string,
    season?: number,
    episode?: number
): any {
    const informativeStream = staticResponseService.createInformativeStream(staticResponse, requestId);
    
    let titleSuffix = '';
    if (season !== undefined && episode !== undefined) {
        titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }
    
    const stream = {
        title: `${informativeStream.title}${titleSuffix}`,
        name: `${informativeStream.name}${titleSuffix}`,
        description: informativeStream.description,
        url: informativeStream.url,
        behaviorHints: {
            notWebReady: false,
            bingeGroup: `br-info-${staticResponse}`
        },
        status: 'pending',
        infoHash: undefined,
        magnet: undefined,
        sources: []
    };
    
    logger.info('Stream informativo criado', {
        staticResponse,
        requestId,
        hasSeasonEpisode: season !== undefined
    });
    
    return stream;
}

// Extrai hash do magnet link
function extractMagnetHash(magnet: string): string | null {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}

// Interface para resultado do RD
interface RdProcessResult {
    success: boolean;
    streamLink?: string;
    status: string;
    message?: string;
    torrentId?: string;
}

export const setupResolveRoutes = (app: any) => {
    app.get('/resolve/:magnet', async (req: any, res: any) => {
        const encodedMagnet = req.params.magnet;
        const apiKey = req.query.apiKey as string;
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;
        const type = req.query.type as string || (season !== undefined ? 'series' : 'movie');
        
        const cacheKey = `resolve:${encodedMagnet}:${apiKey}:${season || 'all'}:${episode || 'all'}:${type}`;
            
        const cachedDirectLink = cacheService.get<string>(cacheKey);
        
        if (cachedDirectLink) {
            logger.info('Cache HIT - Camada 3', {
                cacheKey: cacheKey.substring(0, 50) + '...',
                season,
                episode,
                type
            });
            return res.redirect(302, cachedDirectLink);
        }

        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            const magnetHash = extractMagnetHash(magnet);
            
            logger.info('Resolvendo magnet', {
                magnetHash: magnetHash?.substring(0, 16) || 'unknown',
                apiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'none',
                season,
                episode,
                type
            });

            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid é obrigatória'
                });
            }

            const isSeries = type === 'series' || season !== undefined;
            const magnetTitle = isSeries 
                ? `Stream S${season || '?'}E${episode || '?'}`
                : 'Stream Filme';
                
            const magnetData = {
                imdbId: 'resolve-' + Date.now(),
                title: magnetTitle,
                magnet: magnet,
                quality: '1080p',
                seeds: 50,
                category: isSeries ? 'serie' : 'filme',
                language: 'pt-BR',
                addedAt: new Date().toISOString(),
                imdbSeason: season,
                imdbEpisode: episode
            };

            let rdResult: RdProcessResult;
            
            if (magnetHash) {
                // Usar cache inteligente de 2 camadas
                const rdService = new RealDebridService();
                
                // CAMADA 1: Buscar torrent ID no cache ou RD
                const torrentInfo = await rdTorrentCacheService.getTorrentId(magnetHash, apiKey, rdService);
                
                if (torrentInfo.fromCache) {
                    logger.debug('Cache de torrent HIT - Camada 1', {
                        magnetHash,
                        torrentId: torrentInfo.torrentId,
                        status: torrentInfo.status
                    });
                }
                
                if (torrentInfo.torrentId) {
                    // CAMADA 2: Buscar stream link no cache ou RD
                    const streamLinkResult = await rdTorrentCacheService.getStreamLink(
                        torrentInfo.torrentId,
                        apiKey,
                        season,
                        episode,
                        rdService
                    );
                    
                    if (streamLinkResult.fromCache) {
                        logger.debug('Cache de stream link HIT - Camada 2', {
                            torrentId: torrentInfo.torrentId,
                            season,
                            episode
                        });
                    }
                    
                    // Obter informacoes atualizadas do torrent
                    const torrentDetails = await rdService.getTorrentInfo(torrentInfo.torrentId, apiKey);
                    
                    // Atualizar status no cache se mudou
                    if (torrentInfo.status !== torrentDetails.status) {
                        rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, torrentDetails.status);
                    }
                    
                    rdResult = {
                        success: true,
                        status: torrentDetails.status,
                        streamLink: streamLinkResult.streamLink || undefined,
                        message: getStatusMessage(torrentDetails.status, torrentDetails.progress),
                        torrentId: torrentInfo.torrentId
                    };
                    
                    logger.info('Resultado do cache inteligente', {
                        magnetHash,
                        torrentId: torrentInfo.torrentId,
                        status: torrentDetails.status,
                        hasStreamLink: !!streamLinkResult.streamLink,
                        fromCacheLevel: streamLinkResult.fromCache ? '2' : '1'
                    });
                    
                } else {
                    // Torrent nao encontrado no cache nem no RD
                    logger.debug('Torrent nao encontrado, processando normalmente', { magnetHash });
                    const processResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);
                    // Cast para garantir tipo correto
                    rdResult = processResult as RdProcessResult;
                    
                    // Se foi adicionado com sucesso, salvar no cache
                    if (processResult.success && (processResult as any).torrentId) {
                        const torrentId = (processResult as any).torrentId;
                        rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, processResult.status);
                        logger.info('Novo torrent salvo no cache', {
                            magnetHash,
                            torrentId,
                            status: processResult.status
                        });
                    }
                }
            } else {
                // Sem hash, processar normalmente
                const processResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);
                rdResult = processResult as RdProcessResult;
            }
            
            logger.info('Resultado RD recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                success: rdResult.success,
                torrentId: rdResult.torrentId || 'none',
                season,
                episode,
                type
            });

            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }

            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                logger.info('Stream instantaneo disponivel', {
                    season,
                    episode,
                    type,
                    isSeries: isSeries ? 'SIM' : 'NAO'
                });

                // Salvar na camada 3 (cache completo como fallback)
                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                return res.redirect(302, rdResult.streamLink);

            } else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                logger.info('Retornando stream informativo (download em progresso)', {
                    status: rdResult.status,
                    season,
                    episode,
                    type
                });

                const requestId = `resolve-downloading-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService(baseUrl);
                
                const staticResponse = staticResponseService.getResponseForRealDebridStatus(rdResult.status);
                const responseToUse = staticResponse || StaticResponse.DOWNLOADING;
                
                const stream = createStreamFromStaticResponse(
                    staticResponseService,
                    responseToUse,
                    requestId,
                    season,
                    episode
                );
                
                stream.description += `\nStatus: ${rdResult.status}`;

                return res.json({ streams: [stream] });

            } else if (rdResult.status === 'error' || rdResult.status === 'dead') {
                logger.warn('Erro no Real-Debrid', {
                    status: rdResult.status,
                    message: rdResult.message
                });

                const staticResponse = StaticResponse.FAILED_DOWNLOAD;
                const requestId = `resolve-error-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService(baseUrl);
                
                const stream = createStreamFromStaticResponse(
                    staticResponseService,
                    staticResponse, 
                    requestId, 
                    season, 
                    episode
                );
                
                if (rdResult.message) {
                    stream.description += `\n\nDetalhes: ${rdResult.message}`;
                }

                return res.json({ streams: [stream] });

            } else {
                logger.error('Status nao reconhecido', {
                    status: rdResult.status,
                    streamLinkPresent: !!rdResult.streamLink,
                    season,
                    episode,
                    type
                });

                const requestId = `resolve-unknown-${Date.now()}`;
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService(baseUrl);
                
                const stream = createStreamFromStaticResponse(
                    staticResponseService,
                    StaticResponse.FAILED_UNEXPECTED,
                    requestId,
                    season,
                    episode
                );
                
                stream.description += `\n\nStatus desconhecido: ${rdResult.status}`;

                return res.json({ streams: [stream] });
            }

        } catch (error) {
            logger.error('Erro na resolucao', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                encodedMagnet: encodedMagnet.substring(0, 50) + '...',
                season,
                episode,
                type
            });
            
            const requestId = `resolve-catch-${Date.now()}`;
            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const staticResponseService = new StaticResponseService(baseUrl);
            
            const stream = createStreamFromStaticResponse(
                staticResponseService,
                StaticResponse.FAILED_UNEXPECTED,
                requestId,
                season,
                episode
            );
            
            if (error instanceof Error) {
                stream.description += `\n\nErro: ${error.message}`;
            }

            return res.json({ streams: [stream] });
        }
    });

    app.get('/resolve/:magnet/status', async (req: any, res: any) => {
        const encodedMagnet = req.params.magnet;
        const apiKey = req.query.apiKey as string;
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;

        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            
            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid é obrigatoria'
                });
            }

            const rdService = new RealDebridService();
            const magnetHash = magnet.match(/btih:([a-zA-Z0-9]+)/i)?.[1];
            
            if (!magnetHash) {
                return res.status(400).json({
                    success: false,
                    error: 'Magnet link invalido'
                });
            }

            const existingTorrent = await rdService.findExistingTorrent(magnetHash, apiKey);
            
            if (existingTorrent && existingTorrent.id) {
                const torrentInfo = await rdService.getTorrentInfo(existingTorrent.id, apiKey);
                
                return res.json({
                    success: true,
                    status: torrentInfo.status,
                    progress: Math.round(torrentInfo.progress),
                    downloaded: torrentInfo.status === 'downloaded',
                    message: getStatusMessage(torrentInfo.status, torrentInfo.progress),
                    torrentId: existingTorrent.id,
                    isSeries: season !== undefined,
                    targetSeason: season,
                    targetEpisode: episode
                });
            } else {
                return res.json({
                    success: true,
                    status: 'not_found',
                    progress: 0,
                    downloaded: false,
                    message: 'Torrent nao encontrado no Real-Debrid',
                    isSeries: season !== undefined,
                    targetSeason: season,
                    targetEpisode: episode
                });
            }

        } catch (error) {
            logger.error('Erro status', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                season,
                episode
            });
            
            res.status(500).json({
                success: false,
                error: 'Falha: ' + (error instanceof Error ? error.message : 'Erro desconhecido'),
                isSeries: season !== undefined,
                targetSeason: season,
                targetEpisode: episode
            });
        }
    });

    app.get('/resolve/cache/stats', async (req: any, res: any) => {
        try {
            const cacheStats = rdTorrentCacheService.getStats();
            res.json({
                success: true,
                serviceVersion: VERSION,
                cacheStats: cacheStats
            });
        } catch (error) {
            logger.error('Erro obtendo estatisticas do cache', {
                error: error instanceof Error ? error.message : 'Erro desconhecido'
            });
            res.status(500).json({
                success: false,
                error: 'Falha ao obter estatisticas do cache'
            });
        }
    });

    logger.info(`ResolveRoutes v${VERSION} - Cache inteligente de 2 camadas integrado`, {
        mudancas: [
            'Integracao com RdTorrentCacheService',
            'Cache de 2 camadas: hash->torrent_id (30 dias) + torrent_id->stream_link (24h)',
            'Reducao drastica de chamadas ao Real-Debrid API',
            'Reutilizacao inteligente de torrents entre usuarios',
            'Cache compartilhado por hash de magnet',
            'Manutencao automatica de cache expirado'
        ],
        recursos: [
            'Camada 1: Cache torrent ID por 30 dias',
            'Camada 2: Cache stream link por 24 horas',
            'Camada 3: Cache completo como fallback',
            'Lock automatico por magnet hash',
            'Estatisticas de cache via /resolve/cache/stats',
            'Videos locais para status downloading/queued',
            'Streams no formato Stremio',
            'Status em tempo real',
            'Suporte a filmes e series'
        ]
    });
};