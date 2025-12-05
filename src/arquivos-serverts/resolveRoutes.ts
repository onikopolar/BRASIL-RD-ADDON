import { AutoMagnetService } from '../services/AutoMagnetService';
import { RealDebridService } from '../services/RealDebridService';
import { CacheService } from '../services/CacheService';
import { StaticResponseService, StaticResponse } from '../services/StaticResponseService';
import { Logger } from '../utils/logger';
import { getStatusMessage } from './statusHelpers';

const logger = new Logger('ResolveRoutes');
const autoMagnetService = new AutoMagnetService();
const cacheService = new CacheService();
const CACHE_TTL = 24 * 60 * 60 * 1000;

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
        videoUrl: stream.url,
        hasSeasonEpisode: season !== undefined
    });
    
    return stream;
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
            logger.info('Cache HIT', {
                cacheKey,
                season,
                episode,
                type
            });
            return res.redirect(302, cachedDirectLink);
        }

        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            
            logger.info('Resolvendo magnet', {
                magnet: magnet.substring(0, 100) + '...',
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

            const rdResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);
            
            logger.info('rdResult recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                success: rdResult.success,
                message: rdResult.message,
                season,
                episode,
                type
            });

            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }

            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                logger.info('Stream instantâneo', {
                    season,
                    episode,
                    type,
                    isSeries: isSeries ? 'SIM' : 'NÃO'
                });

                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                return res.redirect(302, rdResult.streamLink);

            } else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                logger.info('TESTE: Retornando REDIRECT direto para vídeo', {
                    status: rdResult.status,
                    season,
                    episode,
                    type
                });

                // TESTE: URL do vídeo público
                const testVideoUrl = 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4';

                return res.redirect(302, testVideoUrl);

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
                logger.error('Status não reconhecido', {
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
            logger.error('Erro na resolução', {
                error: error instanceof Error ? error.message : 'Unknown error',
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
                    error: 'API key do Real-Debrid é obrigatória'
                });
            }

            const rdService = new RealDebridService();
            const magnetHash = magnet.match(/btih:([a-zA-Z0-9]+)/i)?.[1];
            
            if (!magnetHash) {
                return res.status(400).json({
                    success: false,
                    error: 'Magnet link inválido'
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
                    message: 'Torrent não encontrado no Real-Debrid',
                    isSeries: season !== undefined,
                    targetSeason: season,
                    targetEpisode: episode
                });
            }

        } catch (error) {
            logger.error('Erro status', {
                error: error instanceof Error ? error.message : 'Unknown error',
                season,
                episode
            });
            
            res.status(500).json({
                success: false,
                error: 'Falha: ' + (error instanceof Error ? error.message : 'Unknown error'),
                isSeries: season !== undefined,
                targetSeason: season,
                targetEpisode: episode
            });
        }
    });

    logger.info('Rotas configuradas', {
        endpoints: [
            'GET /resolve/{magnet}?apiKey={key}&[season]&[episode]&[type]',
            'GET /resolve/{magnet}/status?apiKey={key}&[season]&[episode]'
        ],
        features: [
            'Cache 24h',
            'Suporte a filmes e séries',
            'Status em tempo real'
        ]
    });
};