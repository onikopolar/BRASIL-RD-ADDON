import { analisarMagnet } from '../magnet/magnetHelper.js';
import { TorboxService } from '../debrid/RealDebridService.js';
import { RdTorrentCacheService } from '../debrid/RdTorrentCacheService.js';
import { CacheService } from '../debrid/CacheService.js';
import { StaticResponseService, StaticResponse } from '../stream/StaticResponseService.js';
import { Logger } from '../utils/logger.js';
import { getStatusMessage } from './statusHelpers.js';

// Envia video MP4 de status diretamente (sem redirect) para o Stremio Web tocar
function sendStatusVideo(res: any, resolveLogger: Logger, requestId: string, videoUrl: string) {
  const filename = videoUrl.split('/').pop() || 'downloading_v2.mp4';

  resolveLogger.info('🎬 ENVIANDO vídeo de status DIRETO (redirect)', {
    requestId,
    filename,
  });

  // Redirect para o vídeo estático (compatível com Android/Web)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.redirect(302, `/static/videos/${filename}`);
}

const logger = new Logger('ResolveRoutes');
const cacheService = new CacheService();
const rdTorrentCacheService = new RdTorrentCacheService();
const torboxService = new TorboxService(); // singleton — evita recriar HTTP client por request
const CACHE_TTL = 24 * 60 * 60 * 1000;
const resolveLogger = new Logger('🔄RESOLVE'); // singleton — evita recriar Logger por request

// Dedup de requisições em voo: evita que múltiplos RESOLVE simultâneos
// pro mesmo infoHash disparem N chamadas ao Torbox
const emVoo = new Map<string, Promise<any>>();

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

async function extrairInfoHashDoMagnet(magnet: string): Promise<string | null> {
    const dados = await analisarMagnet(magnet);
    return dados ? dados.infoHash : null;
}

// Essa função NUNCA rejeita – sempre retorna um objeto com status
async function processMagnetWithTorbox(
    magnet: string, apiKey: string, infoHash: string,
    season?: number, episode?: number, type: string = 'movie', quality?: string
): Promise<{ success: boolean; streamLink?: string; status: string; message?: string; torrentId?: string }> {
    // Tenta buscar no cache / Torbox existente
    try {
        const cached = await rdTorrentCacheService.getTorrentId(infoHash, apiKey, torboxService);
        if (cached.torrentId) {
            // 1 chamada à API: busca info e reusa no getStreamLink (evita 2ª chamada)
            const details = await torboxService.getTorrentInfo(cached.torrentId, apiKey);
            const linkResult = await rdTorrentCacheService.getStreamLink(
                cached.torrentId, apiKey, season, episode, torboxService, quality, details
            );
            return {
                success: true,
                status: details.download_state,
                streamLink: linkResult.streamLink || undefined,
                message: getStatusMessage(details.download_state, Math.round(details.progress * 100)),
                torrentId: cached.torrentId
            };
        }
    } catch (err) {
        // Fallback: tenta adicionar o magnet
    }

    // Magnet não existe no Torbox → adiciona diretamente
    // (sem passar por processTorboxOnClick que chamaria findExistingTorrent de novo)
    try {
        const torrentId = await torboxService.addMagnet(magnet, apiKey);

        try {
            const torrentInfo = await torboxService.getTorrentInfo(torrentId, apiKey);
            const ready = torrentInfo.download_state === 'completed' || torrentInfo.download_state === 'cached';
            let streamLink: string | undefined;
            if (ready) {
                const linkResult = await rdTorrentCacheService.getStreamLink(
                    torrentId, apiKey, season, episode, torboxService, quality, torrentInfo
                );
                streamLink = linkResult.streamLink || undefined;
            }
            return {
                success: true,
                status: torrentInfo.download_state,
                streamLink,
                message: `Torrent adicionado: ${torrentInfo.download_state}`,
                torrentId,
            };
        } catch (infoErr) {
            // getTorrentInfo falhou → torrent em fila
            return {
                success: true,
                status: 'downloading',
                message: 'Torrent na fila do Torbox, aguardando processamento',
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        if (/already queued|already exists|already added/i.test(errorMessage)) {
            // Tenta achar o torrent existente via cache (já populei com getTorrentId acima? não — ele retornou null)
            // Tenta findExistingTorrent agora (pode ter sido adicionado entre a 1ª tentativa e agora)
            try {
                const existing = await torboxService.findExistingTorrent(infoHash, apiKey);
                if (existing?.id) {
                    const tid = String(existing.id);
                    const details = await torboxService.getTorrentInfo(tid, apiKey);
                    let streamLink: string | undefined;
                    if (details.download_state === 'completed' || details.download_state === 'cached') {
                        const linkResult = await rdTorrentCacheService.getStreamLink(
                            tid, apiKey, season, episode, torboxService, quality, details
                        );
                        streamLink = linkResult.streamLink || undefined;
                    }
                    return {
                        success: true,
                        status: details.download_state,
                        streamLink,
                        message: getStatusMessage(details.download_state, Math.round(details.progress * 100)),
                        torrentId: tid,
                    };
                }
            } catch {}
            return { success: true, status: 'queued', message: 'Torrent já está na fila do Torbox' };
        }
        return { success: false, status: 'error', message: errorMessage };
    }
}

export const setupResolveRoutes = (app: any) => {
    app.get('/resolve/torbox/:apiKey/:infoHash/null/:fileIndex/:filename', async (req: any, res: any) => {
        const apiKey = req.params.apiKey;
        const infoHash = req.params.infoHash;
        const fileIndex = parseInt(req.params.fileIndex) || 0;
        const filename = decodeURIComponent(req.params.filename);
        const season = req.query.season ? parseInt(req.query.season as string) : undefined;
        const episode = req.query.episode ? parseInt(req.query.episode as string) : undefined;
        const quality = req.query.quality as string | undefined;
        const type = req.query.type as string || (season !== undefined ? 'series' : 'movie');

        // URL base dinamica a partir do request
        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;

        // Impede Cloudflare de cachear respostas de resolve
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        // HEAD request: responde imediatamente (Stremio verifica antes do GET)
        if (req.method === 'HEAD') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Type', 'video/mp4');
            return res.status(200).end();
        }

        const cacheKey = `resolve:torrentio:${apiKey.substring(0,8)}:${infoHash}:${fileIndex}:${season || 'all'}:${episode || 'all'}:${type}`;
        const cachedDirectLink = cacheService.get<string>(cacheKey);
        if (cachedDirectLink) {
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.redirect(302, cachedDirectLink);
        }

        // Dedup em voo: se já tem requisição processando o mesmo infoHash, espera ela
        const dedupKey = `${apiKey.substring(0,8)}:${infoHash}`;
        let promiseEmVoo = emVoo.get(dedupKey);
        if (!promiseEmVoo) {
          promiseEmVoo = (async () => {
            try {
              resolveLogger.info('🔄 RESOLVE CACHE MISS - Processando magnet no Torbox', {
                requestId: req._ultraDebugId,
                infoHash,
              });

              if (!apiKey || apiKey.length < 10 || !infoHash || infoHash.length < 40) {
                throw new Error('Parâmetros inválidos');
              }

              const magnetLink = `magnet:?xt=urn:btih:${infoHash.toLowerCase()}`;
              return await processMagnetWithTorbox(magnetLink, apiKey, infoHash, season, episode, type, quality);
            } finally {
              emVoo.delete(dedupKey);
            }
          })();
          emVoo.set(dedupKey, promiseEmVoo);
        } else {
          resolveLogger.info('🔄 RESOLVE DEDUP - Aguardando requisição em voo', {
            requestId: req._ultraDebugId,
            infoHash,
          });
        }

        // Fallback de segurança: sempre teremos um stream para retornar
        let streamResponse: any = null;

        try {
            const tbResult = await promiseEmVoo;

            resolveLogger.info('📊 RESULTADO TORBOX', {
                requestId: req._ultraDebugId,
                success: tbResult.success,
                status: tbResult.status,
                hasStreamLink: !!tbResult.streamLink,
                message: tbResult.message?.substring(0, 150),
            });

            // Tratar o resultado – NUNCA mais lançar exceção
            if (tbResult.success) {
                const readyStatuses = ['ready', 'completed', 'cached', 'uploading', 'seeding'];
                if (readyStatuses.some(s => (tbResult.status || '').toLowerCase().includes(s)) && tbResult.streamLink) {
                    cacheService.set(cacheKey, tbResult.streamLink, CACHE_TTL);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    return res.redirect(302, tbResult.streamLink);
                }

                // Estados de progresso/espera (case-insensitive)
                // NOTA: 'uploading' e 'seeding' são estados PRONTOS, não de progresso
                const progressStatuses = ['downloading', 'stalled', 'metadl', 'queued', 'checkingresumedata', 'paused', 'checking']; 
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

        // Garantir que sempre retornamos um redirect para video de status
        if (!streamResponse) {
            // usando baseUrl do topo
            const staticResponseService = new StaticResponseService(baseUrl);
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-fallback-${Date.now()}`, season, episode);
        }

        return sendStatusVideo(res, resolveLogger, req._ultraDebugId, streamResponse.url);
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

            const magnetHash = await extrairInfoHashDoMagnet(magnet);
            if (!magnetHash) throw new Error('Magnet inválido');

            const tbResult = await processMagnetWithTorbox(magnet, apiKey, magnetHash, season, episode, type);

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

        return sendStatusVideo(res, logger, req._ultraDebugId, streamResponse.url);
    });

    app.get('/resolve/:magnet/status', async (req: any, res: any) => {
        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            const apiKey = req.query.apiKey as string;
            if (!apiKey) return res.status(400).json({ success: false, error: 'API key obrigatória' });

            const magnetHash = await extrairInfoHashDoMagnet(magnet);
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