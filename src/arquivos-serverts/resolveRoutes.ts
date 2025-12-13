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

// Versionamento Semantico v1.5.2 - Proxy otimizado para todos os clientes
const VERSION = '1.5.2';

// Funcao para criar URL de proxy CORS
function createProxyUrl(baseUrl: string, targetUrl: string): string {
    const encodedUrl = encodeURIComponent(targetUrl);
    return `${baseUrl}/proxy/${encodedUrl}`;
}

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
    
    logger.debug('Stream informativo criado', {
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

// Processa magnet com Real-Debrid (reutilizavel)
async function processMagnetWithRealDebrid(
    magnet: string,
    apiKey: string,
    season?: number,
    episode?: number,
    type: string = 'movie'
): Promise<RdProcessResult> {
    const magnetHash = extractMagnetHash(magnet);
    
    if (!magnetHash) {
        return {
            success: false,
            status: 'error',
            message: 'Magnet link invalido - sem info hash'
        };
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
    
    const rdService = new RealDebridService();
    
    // Camada 1: Buscar torrent ID no cache ou RD
    const torrentInfo = await rdTorrentCacheService.getTorrentId(magnetHash, apiKey, rdService);
    
    if (torrentInfo.fromCache) {
        logger.debug('Cache de torrent HIT - Camada 1', {
            magnetHash,
            torrentId: torrentInfo.torrentId,
            status: torrentInfo.status
        });
    }
    
    if (torrentInfo.torrentId) {
        // Camada 2: Buscar stream link no cache ou RD
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
        
        logger.debug('Resultado do cache inteligente', {
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
        rdResult = processResult as RdProcessResult;
        
        // Se foi adicionado com sucesso, salvar no cache
        if (processResult.success && (processResult as any).torrentId) {
            const torrentId = (processResult as any).torrentId;
            rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, processResult.status);
            logger.debug('Novo torrent salvo no cache', {
                magnetHash,
                torrentId,
                status: processResult.status
            });
        }
    }
    
    return rdResult;
}

export const setupResolveRoutes = (app: any) => {
    // ROTA DE PROXY CORS OTIMIZADO
    app.get('/proxy/:encodedUrl', async (req: any, res: any) => {
        const startTime = Date.now();
        const targetUrl = decodeURIComponent(req.params.encodedUrl);
        
        logger.debug('Proxy CORS otimizado iniciado', {
            targetUrlPreview: targetUrl.substring(0, 80),
            method: req.method,
            client: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 60) : 'desconhecido'
        });

        // Verifica se e uma URL do Real-Debrid
        if (!targetUrl.includes('real-debrid.com') && !targetUrl.includes('realdebrid.com')) {
            logger.warn('URL de proxy nao autorizada', { 
                targetUrl: targetUrl.substring(0, 100) 
            });
            return res.status(400).json({ error: 'URL nao permitida' });
        }

        // Headers CORS otimizados
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Accept-Encoding, Origin, User-Agent');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
        res.setHeader('Access-Control-Max-Age', '86400'); // Cache de 24h para preflight
        
        // Preflight OPTIONS - resposta rapida
        if (req.method === 'OPTIONS') {
            logger.debug('Preflight OPTIONS respondido rapidamente', { duration: Date.now() - startTime });
            return res.status(200).end();
        }

        try {
            // Headers otimizados para o Real-Debrid
            const headers: any = {
                'Accept-Encoding': 'identity' // Forca sem compressao para streaming
            };
            
            const rangeHeader = req.get('Range');
            if (rangeHeader) {
                headers['Range'] = rangeHeader;
                logger.debug('Range request detectado', { range: rangeHeader });
            }
            
            // Timeout otimizado para streaming
            const fetchOptions = {
                headers,
                signal: AbortSignal.timeout(30000) // 30 segundos timeout
            };
            
            // Faz a requisicao para o Real-Debrid
            const proxyResponse = await fetch(targetUrl, fetchOptions);
            
            if (!proxyResponse.ok) {
                logger.warn('Resposta do Real-Debrid nao OK', {
                    status: proxyResponse.status,
                    targetUrl: targetUrl.substring(0, 80)
                });
                return res.status(proxyResponse.status).end();
            }

            // Copia headers do Real-Debrid de forma eficiente
            const headersToCopy = [
                'Content-Type',
                'Content-Length', 
                'Content-Range',
                'Accept-Ranges',
                'Content-Disposition',
                'Last-Modified',
                'ETag'
            ];
            
            let hasContentDispositionAttachment = false;
            let contentType = '';
            
            // Processa headers em um unico loop
            for (const headerName of headersToCopy) {
                const headerValue = proxyResponse.headers.get(headerName);
                if (headerValue) {
                    if (headerName === 'Content-Disposition' && headerValue.includes('attachment')) {
                        hasContentDispositionAttachment = true;
                        // NAO envia este header - permite reproducao
                        continue;
                    }
                    
                    if (headerName === 'Content-Type') {
                        contentType = headerValue;
                        // Mantem o Content-Type original - Stremio detecta formato
                        res.setHeader(headerName, headerValue);
                    } else {
                        res.setHeader(headerName, headerValue);
                    }
                }
            }
            
            // Headers otimizados para streaming
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            
            // Status code
            res.status(proxyResponse.status);

            logger.debug('Proxy otimizado configurado', {
                contentType,
                contentDispositionRemoved: hasContentDispositionAttachment,
                contentLength: proxyResponse.headers.get('Content-Length'),
                hasRange: !!rangeHeader,
                durationSetup: Date.now() - startTime
            });

            // Stream otimizado - pipe direto se possivel
            if (proxyResponse.body) {
                // Pipe direto para melhor performance
                const reader = proxyResponse.body.getReader();
                let bytesStreamed = 0;
                
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        
                        bytesStreamed += value.length;
                        res.write(value);
                    }
                } finally {
                    reader.releaseLock();
                }
                
                logger.debug('Streaming finalizado com sucesso', {
                    bytesStreamed,
                    targetUrl: targetUrl.substring(0, 60),
                    durationTotal: Date.now() - startTime
                });
            }
            
            res.end();

        } catch (error) {
            // Verifica se e um erro de timeout ou abort
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            const errorName = error instanceof Error ? error.name : 'UnknownError';
            
            if (errorName === 'TimeoutError' || errorName === 'AbortError') {
                logger.warn('Timeout no proxy CORS', {
                    targetUrl: targetUrl.substring(0, 60),
                    duration: Date.now() - startTime
                });
                res.status(504).json({ error: 'Timeout do proxy' });
            } else {
                logger.error('Erro no proxy CORS otimizado', {
                    error: errorMessage,
                    targetUrl: targetUrl.substring(0, 60),
                    duration: Date.now() - startTime
                });
                res.status(500).json({ error: 'Falha no proxy' });
            }
        }
    });

    // ROTA TORRENTIO FORMAT: /resolve/realdebrid/:apiKey/:infoHash/null/:fileIndex/:filename
    app.get('/resolve/realdebrid/:apiKey/:infoHash/null/:fileIndex/:filename', async (req: any, res: any) => {
        const startTime = Date.now();
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        
        // Extrai parametros opcionais da query string
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;
        const type = req.query.type as string || (season !== undefined ? 'series' : 'movie');
        
        logger.info('Rota Torrentio format iniciada', {
            apiKeyPreview: apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4),
            infoHash,
            fileIndex,
            filename,
            season,
            episode,
            type,
            formato: 'torrentio_v' + VERSION,
            client: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 60) : 'desconhecido'
        });

        // Cache key para esta solicitacao
        const cacheKey = `resolve:torrentio:${apiKey}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        
        const cachedDirectLink = cacheService.get<string>(cacheKey);
        
        if (cachedDirectLink) {
            logger.info('Cache HIT - Rota Torrentio', {
                cacheKey: cacheKey.substring(0, 60) + '...',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });
            
            // Sempre usa proxy para consistencia entre clientes
            const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, cachedDirectLink);
            return res.redirect(302, proxyUrl);
        }

        try {
            // Valida parametros obrigatorios
            if (!apiKey || apiKey.length < 10) {
                logger.warn('API Key invalida', { 
                    length: apiKey?.length,
                    infoHash
                });
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid invalida'
                });
            }

            if (!infoHash || infoHash.length < 40) {
                logger.warn('Info hash invalido', { 
                    infoHash,
                    length: infoHash?.length
                });
                return res.status(400).json({
                    success: false,
                    error: 'Info hash invalido'
                });
            }

            // Constrói magnet link do info hash
            const magnetLink = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
            
            logger.debug('Magnet construido', {
                magnetPreview: magnetLink.substring(0, 80),
                infoHash,
                season,
                episode
            });

            // Processa com Real-Debrid
            const rdResult = await processMagnetWithRealDebrid(
                magnetLink,
                apiKey,
                season,
                episode,
                type
            );
            
            logger.info('Resultado Real-Debrid recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                success: rdResult.success,
                torrentId: rdResult.torrentId || 'none',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });

            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }

            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                logger.info('Stream direto disponivel - Proxy otimizado para todos clientes', {
                    season,
                    episode,
                    type,
                    isSeries: type === 'series' ? 'SIM' : 'NAO',
                    clientType: req.headers['user-agent'] ? 'identificado' : 'desconhecido',
                    duration: `${Date.now() - startTime}ms`
                });

                // Salvar no cache
                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                
                // SEMPRE usa proxy para consistencia entre Web/Desktop/Android
                const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, rdResult.streamLink);
                return res.redirect(302, proxyUrl);

            } else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                logger.info('Retornando stream informativo - Download em progresso', {
                    status: rdResult.status,
                    season,
                    episode,
                    type,
                    duration: `${Date.now() - startTime}ms`
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
            logger.error('Erro na resolucao Torrentio format', {
                error: error instanceof Error ? error.message : 'Erro desconhecido',
                infoHash,
                fileIndex,
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
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

    // ROTA ORIGINAL: /resolve/:magnet (base64 encoded)
    app.get('/resolve/:magnet', async (req: any, res: any) => {
        const startTime = Date.now();
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
                type,
                duration: `${Date.now() - startTime}ms`
            });
            
            // Sempre usa proxy para consistencia
            const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, cachedDirectLink);
            return res.redirect(302, proxyUrl);
        }

        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            const magnetHash = extractMagnetHash(magnet);
            
            logger.info('Resolvendo magnet', {
                magnetHash: magnetHash?.substring(0, 16) || 'unknown',
                apiKey: apiKey ? apiKey.substring(0, 8) + '...' : 'none',
                season,
                episode,
                type,
                client: req.headers['user-agent'] ? req.headers['user-agent'].substring(0, 60) : 'desconhecido'
            });

            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid e obrigatoria'
                });
            }

            // Processa com Real-Debrid
            const rdResult = await processMagnetWithRealDebrid(
                magnet,
                apiKey,
                season,
                episode,
                type
            );
            
            logger.info('Resultado RD recebido', {
                status: rdResult.status,
                hasStreamLink: !!rdResult.streamLink,
                success: rdResult.success,
                torrentId: rdResult.torrentId || 'none',
                season,
                episode,
                type,
                duration: `${Date.now() - startTime}ms`
            });

            if (!rdResult.success) {
                throw new Error(rdResult.message || 'Falha ao processar com Real-Debrid');
            }

            if ((rdResult.status === 'ready' || rdResult.status === 'downloaded') && rdResult.streamLink) {
                logger.info('Stream instantaneo disponivel - Proxy universal', {
                    season,
                    episode,
                    type,
                    isSeries: type === 'series' ? 'SIM' : 'NAO',
                    clientType: req.headers['user-agent'] ? 'identificado' : 'desconhecido',
                    duration: `${Date.now() - startTime}ms`
                });

                // Salvar na camada 3 (cache completo como fallback)
                cacheService.set(cacheKey, rdResult.streamLink, CACHE_TTL);
                
                // SEMPRE usa proxy para funcionar em todos clientes
                const proxyUrl = createProxyUrl(`${req.protocol}://${req.get('host')}`, rdResult.streamLink);
                return res.redirect(302, proxyUrl);

            } else if (rdResult.status === 'downloading' || rdResult.status === 'queued' || rdResult.status === 'magnet_conversion') {
                logger.info('Retornando stream informativo (download em progresso)', {
                    status: rdResult.status,
                    season,
                    episode,
                    type,
                    duration: `${Date.now() - startTime}ms`
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
                    message: rdResult.message,
                    duration: `${Date.now() - startTime}ms`
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
                    type,
                    duration: `${Date.now() - startTime}ms`
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
                type,
                duration: `${Date.now() - startTime}ms`
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
        const startTime = Date.now();
        const encodedMagnet = req.params.magnet;
        const apiKey = req.query.apiKey as string;
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;

        try {
            const magnet = Buffer.from(encodedMagnet, 'base64').toString();
            
            if (!apiKey) {
                return res.status(400).json({
                    success: false,
                    error: 'API key do Real-Debrid e obrigatoria'
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
                
                logger.debug('Status do torrent obtido', {
                    magnetHash: magnetHash.substring(0, 16),
                    status: torrentInfo.status,
                    progress: torrentInfo.progress,
                    duration: `${Date.now() - startTime}ms`
                });
                
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
                logger.debug('Torrent nao encontrado no RD', {
                    magnetHash: magnetHash?.substring(0, 16),
                    duration: `${Date.now() - startTime}ms`
                });
                
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
                episode,
                duration: `${Date.now() - startTime}ms`
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

    logger.info(`ResolveRoutes v${VERSION} - Proxy otimizado universal para todos clientes`, {
        mudancasPrincipais: [
            'PROXY UNIVERSAL: Funciona igual para Web/Desktop/Android',
            'OTIMIZACAO: Headers CORS melhorados com cache de preflight',
            'PERFORMANCE: Timeout configurado e streaming com pipe direto',
            'CONSISTENCIA: Mesmo comportamento para todos os clientes',
            'ROBUSTEZ: Tratamento de erros melhorado com fallbacks'
        ],
        analiseTecnica: 'Proxy necessario para CORS no Web e consistencia entre plataformas',
        vantagens: [
            'Web funciona sem problemas de CORS',
            'Desktop/Android tem experiencia consistente',
            'Performance otimizada com menos overhead',
            'Codigo unificado e mais facil de manter'
        ],
        compatibilidadeGarantida: '100% com Stremio Web, Desktop e Android'
    });
};