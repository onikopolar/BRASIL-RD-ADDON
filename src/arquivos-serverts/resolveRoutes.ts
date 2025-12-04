import { AutoMagnetService } from '../services/AutoMagnetService';
import { RealDebridService } from '../services/RealDebridService';
import { CacheService } from '../services/CacheService';
import { StaticResponseService, StaticResponse } from '../services/StaticResponseService';
import { Logger } from '../utils/logger';
import { getStatusMessage } from './statusHelpers';

const logger = new Logger('ResolveRoutes');
const autoMagnetService = new AutoMagnetService();
const cacheService = new CacheService();
// Não instanciar StaticResponseService aqui - vamos instanciar dentro das rotas com URL base dinâmica
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

/**
 * Converte uma resposta estática em um objeto Stream para o Stremio
 * Agora com vídeos reais que podem ser reproduzidos
 */
function createStreamFromStaticResponse(
    staticResponseService: StaticResponseService,
    staticResponse: StaticResponse,
    requestId: string,
    season?: number,
    episode?: number
): any {
    // ✅ Usar a nova função que já retorna behaviorHints corretos
    const informativeStream = staticResponseService.createInformativeStream(staticResponse, requestId);
    const infoHash = `info-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Adicionar informação de episódio se for série
    let titleSuffix = '';
    if (season !== undefined && episode !== undefined) {
        titleSuffix = ` S${season.toString().padStart(2, '0')}E${episode.toString().padStart(2, '0')}`;
    }
    
    // ✅ USAR OS behaviorHints DO informativeStream (agora notWebReady: false)
    const stream = {
        title: `${informativeStream.title}${titleSuffix}`,
        name: `${informativeStream.name}${titleSuffix}`,
        description: informativeStream.description,
        url: informativeStream.url,
        behaviorHints: {
            notWebReady: informativeStream.behaviorHints?.notWebReady || false, // ✅ Agora false para vídeos
            bingeGroup: `br-info-${staticResponse}`
        },
        status: 'available',
        infoHash: infoHash,
        magnet: `brasilrd://info/${infoHash}`,
        sources: [`brasilrd://info/${infoHash}`]
    };
    
    logger.info('Stream informativo criado (resolve)', {
        staticResponse,
        requestId,
        videoUrl: stream.url,
        notWebReady: stream.behaviorHints.notWebReady,
        hasSeasonEpisode: season !== undefined
    });
    
    return stream;
}

export const setupResolveRoutes = (app: any) => {
    // Rota de resolução sob demanda - INTELIGENTE PARA FILMES E SÉRIES
    app.get('/resolve/:magnet', async (req: any, res: any) => {
        const encodedMagnet = req.params.magnet;
        const apiKey = req.query.apiKey as string;
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;
        const type = req.query.type as string || (season !== undefined ? 'series' : 'movie');

        // ✅ Chave de cache única com todos os parâmetros
        const cacheKey = `resolve:${encodedMagnet}:${apiKey}:${season || 'all'}:${episode || 'all'}:${type}`;
            
        const cachedDirectLink = cacheService.get<string>(cacheKey);
        
        if (cachedDirectLink) {
            logger.info('Cache HIT para magnet resolvido', {
                cacheKey,
                directLink: cachedDirectLink.substring(0, 100) + '...',
                season,
                episode,
                type
            });
            return res.redirect(302, cachedDirectLink);
        }

        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            
            logger.info('Iniciando resolução inteligente de magnet', {
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

            // ✅ Cria dados do magnet para o AutoMagnetService
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

            // ✅ PERGUNTA AO REAL-DEBRID
            const rdResult = await autoMagnetService.processRealDebridOnClick(magnetData, apiKey);
            
            logger.info('DEBUG - rdResult recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                streamLinkLength: rdResult.streamLink ? rdResult.streamLink.length : 0,
                success: rdResult.success,
                message: rdResult.message,
                season,
                episode,
                type
            });

            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }

            // ✅ RESPOSTA INTELIGENTE BASEADA NO STATUS
            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                // ✅ JÁ ESTÁ BAIXADO - Stream instantâneo
                logger.info('Stream instantâneo - conteúdo já disponível no Real-Debrid', {
                    streamLink: rdResult.streamLink.substring(0, 100) + '...',
                    season,
                    episode,
                    type,
                    isSeries: isSeries ? 'SIM' : 'NÃO'
                });

                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                return res.redirect(302, rdResult.streamLink);

            } else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                // ⏳ ESTÁ BAIXANDO - Retorna STREAM INFORMATIVO (vídeo real)
                logger.info('Retornando stream informativo - conteúdo em processamento', {
                    status: rdResult.status,
                    season,
                    episode,
                    type,
                    responseType: 'stream_informative_video'
                });

                // Mapear status para resposta estática
                const statusMap: Record<string, StaticResponse> = {
                    'downloading': StaticResponse.DOWNLOADING,
                    'queued': StaticResponse.DOWNLOADING,
                    'magnet_conversion': StaticResponse.DOWNLOADING,
                    'uploading': StaticResponse.DOWNLOADING,
                    'waiting_files_selection': StaticResponse.DOWNLOADING
                };
                
                const staticResponse = statusMap[rdResult.status] || StaticResponse.DOWNLOADING;

                // Criar stream informativo
                const requestId = `resolve-${Date.now()}`;
                
                // Criar StaticResponseService com URL base dinâmica
                const baseUrl = `${req.protocol}://${req.get('host')}`;
                const staticResponseService = new StaticResponseService(baseUrl);
                
                const stream = createStreamFromStaticResponse(
                    staticResponseService,
                    staticResponse, 
                    requestId, 
                    season, 
                    episode
                );
                
                // Adicionar informações extras sobre o status
                stream.description += `\n\nStatus Real-Debrid: ${rdResult.status}`;
                if (rdResult.message) {
                    stream.description += `\nDetalhes: ${rdResult.message}`;
                }

                logger.info('Stream informativo criado (resolve endpoint)', {
                    staticResponse,
                    rdStatus: rdResult.status,
                    title: stream.title,
                    url: stream.url,
                    baseUrl: baseUrl,
                    notWebReady: stream.behaviorHints?.notWebReady,
                    hasSeasonEpisode: season !== undefined
                });

                // ✅ IMPORTANTE: Stremio espera um array de streams
                return res.json({ streams: [stream] });

            } else if (rdResult.status === 'error' || rdResult.status === 'dead') {
                // ❌ ERRO - Retorna stream informativo de erro
                logger.warn('Erro no Real-Debrid - retornando stream informativo de erro', {
                    status: rdResult.status,
                    message: rdResult.message
                });

                const staticResponse = StaticResponse.FAILED_DOWNLOAD;
                const requestId = `resolve-error-${Date.now()}`;
                
                // Criar StaticResponseService com URL base dinâmica
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
                // ❌ STATUS NÃO RECONHECIDO - Stream informativo genérico
                logger.error('Status do Real-Debrid não reconhecido', {
                    status: rdResult.status,
                    streamLinkPresent: !!rdResult.streamLink,
                    season,
                    episode,
                    type
                });

                const requestId = `resolve-unknown-${Date.now()}`;
                
                // Criar StaticResponseService com URL base dinâmica
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
            logger.error('Erro na resolução inteligente de magnet', {
                error: error instanceof Error ? error.message : 'Unknown error',
                encodedMagnet: encodedMagnet.substring(0, 50) + '...',
                season,
                episode,
                type
            });
            
            // Em caso de erro, retornar stream informativo de erro
            const requestId = `resolve-catch-${Date.now()}`;
            
            // Criar StaticResponseService com URL base dinâmica
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

    // ✅ Rota para verificar status de um magnet específico
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

            // Busca torrent existente no Real-Debrid
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
            logger.error('Erro ao verificar status do magnet', {
                error: error instanceof Error ? error.message : 'Unknown error',
                season,
                episode
            });
            
            res.status(500).json({
                success: false,
                error: 'Falha ao verificar status: ' + (error instanceof Error ? error.message : 'Unknown error'),
                isSeries: season !== undefined,
                targetSeason: season,
                targetEpisode: episode
            });
        }
    });

    logger.info('Rotas de resolução configuradas', {
        endpoints: [
            'GET /resolve/{magnet}?apiKey={key}&[season]&[episode]&[type]',
            'GET /resolve/{magnet}/status?apiKey={key}&[season]&[episode]'
        ],
        features: [
            'Cache inteligente 24h',
            'Streams informativos com vídeos reais (URL base dinâmica)',
            'Suporte a filmes e séries',
            'Verificação de status em tempo real'
        ]
    });
};