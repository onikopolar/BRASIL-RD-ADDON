import { AutoMagnetService } from '../services/AutoMagnetService.js';
import { TorboxService } from '../services/RealDebridService.js';
import { RdTorrentCacheService } from '../services/RdTorrentCacheService.js';
import { CacheService } from '../services/CacheService.js';
import { StaticResponseService, StaticResponse } from '../services/StaticResponseService.js';
import { Logger } from '../utils/logger.js';
import { getStatusMessage } from './statusHelpers.js';

const logger = new Logger('ResolveRoutes');
const autoMagnetService = new AutoMagnetService();
const cacheService = new CacheService();
const rdTorrentCacheService = new RdTorrentCacheService();
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
    
    return {
        title: `${informativeStream.title}${titleSuffix}`,
        name: `${informativeStream.name}${titleSuffix}`,
        description: informativeStream.description,
        url: informativeStream.url,
        behaviorHints: { notWebReady: false, bingeGroup: `br-info-${staticResponse}` },
        status: 'pending',
        infoHash: undefined,
        magnet: undefined,
        sources: []
    };
}

function extractMagnetHash(magnet: string): string | null {
    const match = magnet.match(/btih:([a-zA-Z0-9]+)/i);
    return match ? match[1].toLowerCase() : null;
}

// Essa função NUNCA rejeita – sempre retorna um objeto com status
async function processMagnetWithTorbox(
    magnet: string, apiKey: string, season?: number, episode?: number, type: string = 'movie'
): Promise<{ success: boolean; streamLink?: string; status: string; message?: string; torrentId?: string }> {
    const magnetHash = extractMagnetHash(magnet);
    if (!magnetHash) return { success: false, status: 'error', message: 'Magnet link inválido' };

    const isSeries = type === 'series' || season !== undefined;
    const magnetData = {
        imdbId: 'resolve-' + Date.now(),
        title: isSeries ? `Stream S${season || '?'}E${episode || '?'}` : 'Stream Filme',
        magnet, quality: '1080p', seeds: 50,
        category: isSeries ? 'serie' : 'filme', language: 'pt-BR',
        addedAt: new Date().toISOString(), imdbSeason: season, imdbEpisode: episode
    };

    const torboxService = new TorboxService();

    // Tenta buscar no cache / Torbox existente
    try {
        const torrentInfo = await rdTorrentCacheService.getTorrentId(magnetHash, apiKey, torboxService);
        if (torrentInfo.torrentId) {
            const streamLinkResult = await rdTorrentCacheService.getStreamLink(torrentInfo.torrentId, apiKey, season, episode, torboxService);
            const torrentDetails = await torboxService.getTorrentInfo(torrentInfo.torrentId, apiKey);
            if (torrentInfo.status !== torrentDetails.download_state) {
                rdTorrentCacheService.updateTorrentStatus(magnetHash, apiKey, torrentDetails.download_state);
            }
            return {
                success: true,
                status: torrentDetails.download_state,
                streamLink: streamLinkResult.streamLink || undefined,
                message: getStatusMessage(torrentDetails.download_state, Math.round(torrentDetails.progress * 100)),
                torrentId: torrentInfo.torrentId
            };
        }
    } catch (err) {
        // Fallback: tenta adicionar o magnet
    }

    // Tenta adicionar o magnet – nunca deixa a exceção escapar
    try {
        const processResult = await autoMagnetService.processTorboxOnClick(magnetData, apiKey);
        return processResult as any;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        // "Download already queued" = torrent ja esta na fila, tratar como baixando
        if (/already queued|already exists|already added/i.test(errorMessage)) {
            return {
                success: true,
                status: 'queued',
                message: 'Torrent ja esta na fila do Torbox'
            };
        }
        return {
            success: false,
            status: 'error',
            message: errorMessage
        };
    }
}

export const setupResolveRoutes = (app: any) => {
    app.get('/resolve/torbox/:apiKey/:infoHash/null/:fileIndex/:filename', async (req: any, res: any) => {
        const resolveLogger = new Logger('🔄RESOLVE');
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;
        const type = req.query.type as string || (season !== undefined ? 'series' : 'movie');

        // URL base dinamica a partir do request
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;

        resolveLogger.info('═══════════════════════════════════════', {});
        resolveLogger.info('🔄 RESOLVE INICIADO', {
            requestId: req._ultraDebugId,
            apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
            apiKeyLength: apiKey?.length || 0,
            infoHash,
            fileIndex,
            filename: filename?.substring(0, 80),
            season,
            episode,
            type,
            client: req.headers['user-agent']?.substring(0, 80),
            origin: req.get('origin'),
            host: req.get('host'),
        });

        const cacheKey = `resolve:torrentio:${apiKey}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get<string>(cacheKey);
        if (cachedDirectLink) {
            resolveLogger.info('✅ RESOLVE CACHE HIT - Redirecionando para link em cache', {
                requestId: req._ultraDebugId,
                cacheKey,
                streamLinkPreview: cachedDirectLink.substring(0, 80) + '...',
            });
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            return res.redirect(302, cachedDirectLink);
        }

        resolveLogger.info('🔄 RESOLVE CACHE MISS - Processando magnet no Torbox', {
            requestId: req._ultraDebugId,
            infoHash,
        });

        // Fallback de segurança: sempre teremos um stream para retornar
        let streamResponse: any = null;

        try {
            if (!apiKey || apiKey.length < 10 || !infoHash || infoHash.length < 40) {
                throw new Error('Parâmetros inválidos');
            }

            const magnetLink = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
            const tbResult = await processMagnetWithTorbox(magnetLink, apiKey, season, episode, type);

            resolveLogger.info('📊 RESULTADO TORBOX', {
                requestId: req._ultraDebugId,
                success: tbResult.success,
                status: tbResult.status,
                hasStreamLink: !!tbResult.streamLink,
                message: tbResult.message?.substring(0, 150),
            });

            // Tratar o resultado – NUNCA mais lançar exceção
            if (tbResult.success) {
                if ((tbResult.status === 'ready' || tbResult.status === 'completed' || tbResult.status === 'cached') && tbResult.streamLink) {
                    cacheService.set(cacheKey, tbResult.streamLink, CACHE_TTL);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, tbResult.streamLink);
                }

                // Estados de progresso/espera (case-insensitive)
                const progressStatuses = ['downloading', 'stalled', 'metadl', 'queued', 'checkingresumedata', 'paused', 'uploading', 'checking']; 
                const statusLower = tbResult.status?.toLowerCase() || '';
                if (progressStatuses.some(s => statusLower.includes(s))) {
                    // usando baseUrl do topo
                    const staticResponseService = new StaticResponseService(baseUrl);
                    const response = staticResponseService.getResponseForTorboxStatus(tbResult.status) || StaticResponse.DOWNLOADING;
                    streamResponse = createStreamFromStaticResponse(staticResponseService, response, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus: ${tbResult.status}`;
                } else if (['error', 'dead', 'missingfiles'].some(s => statusLower.includes(s))) {
                    // usando baseUrl do topo
                    const staticResponseService = new StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_DOWNLOAD, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nDetalhes: ${tbResult.message || tbResult.status}`;
                } else {
                    // Status desconhecido (ainda não é erro fatal)
                    // usando baseUrl do topo
                    const staticResponseService = new StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus desconhecido: ${tbResult.status}`;
                }
            } else {
                // Falha tratada como erro
                // usando baseUrl do topo
                const staticResponseService = new StaticResponseService(baseUrl);
                const errorMessage = tbResult.message || 'Falha no Torbox';

                let staticResponse = StaticResponse.FAILED_UNEXPECTED;
                let extraInfo = '';

                if (errorMessage.includes('infringing')) {
                    staticResponse = StaticResponse.FAILED_INFRINGEMENT;
                    extraInfo = '\nConteúdo bloqueado (direitos autorais)';
                } else if (errorMessage.includes('hoster_unavailable')) {
                    staticResponse = StaticResponse.FAILED_DOWNLOAD;
                    extraInfo = '\nServidor RD indisponível';
                } else {
                    logger.error('Erro na resolução', { error: errorMessage, infoHash });
                    resolveLogger.error('❌ ERRO NA RESOLUÇÃO', {
                        requestId: req._ultraDebugId,
                        errorMessage,
                        infoHash,
                    });
                    extraInfo = `\nErro: ${errorMessage}`;
                }

                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += extraInfo;
            }
        } catch (error) {
            // Captura qualquer erro inesperado (não deve acontecer, mas seguro)
            // usando baseUrl do topo
            const staticResponseService = new StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Exceção inesperada', { error: errorMessage, infoHash });

            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }

        // Garantir que sempre retornamos um JSON
        if (!streamResponse) {
            // usando baseUrl do topo
            const staticResponseService = new StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }

        return res.json({ streams: [streamResponse] });
    });

    // Rota original (magnet em base64)
    app.get('/resolve/:magnet', async (req: any, res: any) => {
        const apiKey = req.query.apiKey as string;
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;
        const type = req.query.type as string || (season !== undefined ? 'series' : 'movie');

        // URL base dinamica
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;

        let streamResponse: any = null;

        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            if (!apiKey) throw new Error('API key obrigatória');

            const tbResult = await processMagnetWithTorbox(magnet, apiKey, season, episode, type);

            if (tbResult.success) {
                if ((tbResult.status === 'ready' || tbResult.status === 'completed' || tbResult.status === 'cached') && tbResult.streamLink) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, tbResult.streamLink);
                }

                // usando baseUrl do topo
                const staticResponseService = new StaticResponseService(baseUrl);
                let staticResponse = StaticResponse.DOWNLOADING;
                if (tbResult.status === 'error' || tbResult.status === 'dead') staticResponse = StaticResponse.FAILED_DOWNLOAD;
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += `\nStatus: ${tbResult.status}`;
            } else {
                // usando baseUrl do topo
                const staticResponseService = new StaticResponseService(baseUrl);
                const errorMessage = tbResult.message || 'Falha no Torbox';

                let staticResponse = StaticResponse.FAILED_UNEXPECTED;
                let extraInfo = '';
                if (errorMessage.includes('infringing')) {
                    staticResponse = StaticResponse.FAILED_INFRINGEMENT;
                    extraInfo = '\nConteúdo bloqueado';
                } else if (errorMessage.includes('hoster_unavailable')) {
                    staticResponse = StaticResponse.FAILED_DOWNLOAD;
                    extraInfo = '\nServidor RD indisponível';
                } else {
                    logger.error('Erro na resolução', { error: errorMessage });
                    extraInfo = `\nErro: ${errorMessage}`;
                }

                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += extraInfo;
            }
        } catch (error) {
            // usando baseUrl do topo
            const staticResponseService = new StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }

        if (!streamResponse) {
            // usando baseUrl do topo
            const staticResponseService = new StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }

        return res.json({ streams: [streamResponse] });
    });

    app.get('/resolve/:magnet/status', async (req: any, res: any) => {
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            const apiKey = req.query.apiKey as string;
            if (!apiKey) return res.status(400).json({ success: false, error: 'API key obrigatória' });

            const torboxService = new TorboxService();
            const magnetHash = extractMagnetHash(magnet);
            if (!magnetHash) return res.status(400).json({ success: false, error: 'Magnet inválido' });

            const existing = await torboxService.findExistingTorrent(magnetHash, apiKey);
            if (!existing?.id) return res.json({ success: true, status: 'not_found', progress: 0, downloaded: false, message: 'Não encontrado' });

            const info = await torboxService.getTorrentInfo(String(existing.id), apiKey);
            const ready = info.download_state === 'completed' || info.download_state === 'cached';
            return res.json({ success: true, status: info.download_state, progress: Math.round(info.progress * 100), downloaded: ready, message: getStatusMessage(info.download_state, Math.round(info.progress * 100)), torrentId: existing.id });
        } catch (error) {
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Erro' });
        }
    });

    app.get('/resolve/cache/stats', async (req: any, res: any) => {
        res.json({ success: true, serviceVersion: '2.0.0', cacheStats: rdTorrentCacheService.getStats() });
    });
};