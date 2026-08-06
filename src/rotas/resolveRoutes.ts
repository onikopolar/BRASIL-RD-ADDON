import { analisarMagnet } from '../magnet/magnetHelper.js';
import { TorboxService } from '../debrid/RealDebridService.js';
import { RdTorrentCacheService } from '../debrid/RdTorrentCacheService.js';
import { CacheService } from '../debrid/CacheService.js';
import { StaticResponseService, StaticResponse } from '../stream/StaticResponseService.js';
import { Logger } from '../utils/logger.js';
import { getStatusMessage } from './statusHelpers.js';
import { StreamHandler } from '../stream/StreamHandler.js';
import { Torrent, ImdbTitleCache } from '../database/models.js';

function sendStatusVideo(res: any, resolveLogger: Logger, requestId: string, videoUrl: string) {
  const filename = videoUrl.split('/').pop() || 'downloading_v2.mp4';
  resolveLogger.info('🎬 ENVIANDO vídeo de status DIRETO (redirect)', { requestId, filename });
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.redirect(302, `/static/videos/${filename}`);
}

const logger = new Logger('ResolveRoutes');
const cacheService = new CacheService();
const rdTorrentCacheService = new RdTorrentCacheService();
const torboxService = TorboxService.getInstance();
const CACHE_TTL = 24 * 60 * 60 * 1000;
const resolveLogger = new Logger('🔄RESOLVE');

const emVoo = new Map<string, Promise<any>>();

// Cache local de títulos por infoHash (evita consultas repetidas ao DB e TMDB)
const titlesCache = new Map<string, string[]>();

// TTL do cache em banco (7 dias) para atualizar títulos periodicamente
const DB_TITLE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

/**
 * Busca títulos enriquecidos (com ano) para um infoHash.
 * Agora aceita imdbId e season externos (vindos da URL) para busca direta,
 * sem depender da tabela Torrent.
 */
async function getEnrichedTitlesForHash(
    infoHash: string,
    externalImdbId?: string,
    externalSeason?: number
): Promise<string[] | undefined> {
    // Cache local (memória) – rápido, evita até consulta ao banco
    const cached = titlesCache.get(infoHash);
    if (cached !== undefined) {
        resolveLogger.info('💾 TÍTULOS DO CACHE LOCAL (memória)', { infoHash, titles: cached.join(', ') });
        return cached.length > 0 ? cached : undefined;
    }

    try {
        // Determina imdbId e season (prioridade: parâmetros externos > banco Torrent)
        let imdbId: string | undefined = externalImdbId;
        let season: number | undefined = externalSeason;

        if (!imdbId) {
            // Tenta obter do banco Torrent
            const torrent = await Torrent.findOne({
                where: { infoHash: infoHash.toLowerCase() },
                attributes: ['imdbId', 'imdbSeason'],
                raw: true
            });
            if (torrent?.imdbId) {
                imdbId = torrent.imdbId;
                season = torrent.imdbSeason ?? undefined;
                resolveLogger.info('📋 imdbId obtido do banco Torrent', { infoHash, imdbId, season });
            } else {
                // Sem imdbId de qualquer fonte
                titlesCache.set(infoHash, []);
                return undefined;
            }
        } else {
            resolveLogger.info('🎯 imdbId recebido da URL de resolução', { infoHash, imdbId, season });
        }

        // 2. Tenta carregar do cache em banco (ImdbTitleCache)
        const cachedTitle = await ImdbTitleCache.findOne({
            where: { imdbId, season: season ?? null },
            attributes: ['titlesPt', 'titlesEn', 'year', 'updatedAt'],
            raw: true
        });

        // Se existir no banco e ainda não expirou (TTL), usa direto
        if (cachedTitle) {
            const ageMs = Date.now() - new Date(cachedTitle.updatedAt).getTime();
            if (ageMs < DB_TITLE_CACHE_TTL_MS) {
                const titlesPtArr = cachedTitle.titlesPt.split(',').map(s => s.trim()).filter(Boolean);
                const titlesEnArr = cachedTitle.titlesEn.split(',').map(s => s.trim()).filter(Boolean);
                const year = cachedTitle.year;
                const allTitles = [...titlesPtArr, ...titlesEnArr];
                const enriched = year ? allTitles.map(t => `${t} ${year}`) : allTitles;
                titlesCache.set(infoHash, enriched);
                resolveLogger.info('🗄️ TÍTULOS DO BANCO (cache DB)', {
                    infoHash,
                    imdbId,
                    season,
                    titles: enriched.join(', '),
                    age: `${Math.round(ageMs / 3600000)}h`
                });
                return enriched.length > 0 ? enriched : undefined;
            } else {
                resolveLogger.info('⏳ Cache DB expirado, atualizando da API...', { imdbId, season });
            }
        }

        // 3. Cache DB não existe ou expirou → busca da API TMDB
        const streamHandler = StreamHandler.getInstance();
        const tmdbData = await streamHandler.catalog.getTmdbSearchData(imdbId, season);

        const titles = tmdbData.imdbTitles?.allTitles || [];
        const year = tmdbData.imdbTitles?.year;

        if (titles.length === 0) {
            await ImdbTitleCache.upsert({
                imdbId,
                season: season ?? null,
                titlesPt: '',
                titlesEn: '',
                year: year ?? null,
                updatedAt: new Date()
            });
            titlesCache.set(infoHash, []);
            return undefined;
        }

        const allTitlesStr = titles.join(',');
        await ImdbTitleCache.upsert({
            imdbId,
            season: season ?? null,
            titlesPt: allTitlesStr,
            titlesEn: allTitlesStr,
            year: year ?? null,
            updatedAt: new Date()
        });

        const enriched = year ? titles.map(t => `${t} ${year}`) : titles;
        titlesCache.set(infoHash, enriched);
        resolveLogger.info('🌐 TÍTULOS DA API (TMDB) salvos no banco', {
            infoHash,
            imdbId,
            season,
            titles: enriched.join(', ')
        });
        return enriched;
    } catch (error) {
        resolveLogger.error('❌ Erro ao obter títulos enriquecidos', {
            infoHash,
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        titlesCache.set(infoHash, []);
        return undefined;
    }
}

// Essa função NUNCA rejeita – sempre retorna um objeto com status
async function processMagnetWithTorbox(
    magnet: string, apiKey: string, infoHash: string,
    season?: number, episode?: number, type: string = 'movie', quality?: string,
    titles?: string[]
): Promise<{ success: boolean; streamLink?: string; status: string; message?: string; torrentId?: string }> {
    try {
        const cached = await rdTorrentCacheService.getTorrentId(infoHash, apiKey, torboxService);
        if (cached.torrentId) {
            const details = await torboxService.getTorrentInfo(cached.torrentId, apiKey);
            if (titles && titles.length > 0) {
                const link = await torboxService.getStreamLinkForTorrent(
                    cached.torrentId, apiKey, season, episode, quality, details, titles
                );
                return {
                    success: true,
                    status: details.download_state,
                    streamLink: link || undefined,
                    message: getStatusMessage(details.download_state, Math.round(details.progress * 100)),
                    torrentId: cached.torrentId
                };
            }
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
        // Fallback
    }

    try {
        const existing = await torboxService.findExistingTorrent(infoHash, apiKey);
        if (existing?.id) {
            const tid = String(existing.id);
            const details = await torboxService.getTorrentInfo(tid, apiKey);
            let streamLink: string | undefined;
            if (details.download_state === 'completed' || details.download_state === 'cached') {
                if (titles && titles.length > 0) {
                    const link = await torboxService.getStreamLinkForTorrent(
                        tid, apiKey, season, episode, quality, details, titles
                    );
                    streamLink = link || undefined;
                } else {
                    const linkResult = await rdTorrentCacheService.getStreamLink(
                        tid, apiKey, season, episode, torboxService, quality, details
                    );
                    streamLink = linkResult.streamLink || undefined;
                }
            }
            return {
                success: true,
                status: details.download_state,
                streamLink,
                message: getStatusMessage(details.download_state, Math.round(details.progress * 100)),
                torrentId: tid,
            };
        }
    } catch (err) {
        // findExistingTorrent falhou
    }

    try {
        const torrentId = await torboxService.addMagnet(magnet, apiKey);
        try {
            const torrentInfo = await torboxService.getTorrentInfo(torrentId, apiKey);
            const ready = torrentInfo.download_state === 'completed' || torrentInfo.download_state === 'cached';
            let streamLink: string | undefined;
            if (ready) {
                if (titles && titles.length > 0) {
                    const link = await torboxService.getStreamLinkForTorrent(
                        torrentId, apiKey, season, episode, quality, torrentInfo, titles
                    );
                    streamLink = link || undefined;
                } else {
                    const linkResult = await rdTorrentCacheService.getStreamLink(
                        torrentId, apiKey, season, episode, torboxService, quality, torrentInfo
                    );
                    streamLink = linkResult.streamLink || undefined;
                }
            }
            return {
                success: true,
                status: torrentInfo.download_state,
                streamLink,
                message: `Torrent adicionado: ${torrentInfo.download_state}`,
                torrentId,
            };
        } catch (infoErr) {
            return {
                success: true,
                status: 'downloading',
                message: 'Torrent na fila do Torbox, aguardando processamento',
            };
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        if (/already queued|already exists|already added/i.test(errorMessage)) {
            return { success: true, status: 'downloading', message: 'Torrent já está na fila do Torbox' };
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
        const imdbId = req.query.imdbId as string | undefined;   // NOVO: extrai imdbId da URL

        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

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
              
              // Passa imdbId e season externos (da URL) para busca direta
              const titles = await getEnrichedTitlesForHash(infoHash, imdbId, season);
              if (titles) {
                  resolveLogger.info('🔤 Títulos obtidos para seleção de arquivo', {
                      infoHash,
                      titles: titles.join(', '),
                  });
              }

              return await processMagnetWithTorbox(magnetLink, apiKey, infoHash, season, episode, type, quality, titles);
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

            if (tbResult.success) {
                const readyStatuses = ['ready', 'completed', 'cached', 'uploading', 'seeding'];
                if (readyStatuses.some(s => (tbResult.status || '').toLowerCase().includes(s)) && tbResult.streamLink) {
                    cacheService.set(cacheKey, tbResult.streamLink, CACHE_TTL);
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    return res.redirect(302, tbResult.streamLink);
                }

                const progressStatuses = ['downloading', 'stalled', 'metadl', 'queued', 'checkingresumedata', 'paused', 'checking']; 
                const statusLower = tbResult.status?.toLowerCase() || '';
                if (progressStatuses.some(s => statusLower.includes(s))) {
                    const staticResponseService = new StaticResponseService(baseUrl);
                    const response = staticResponseService.getResponseForTorboxStatus(tbResult.status) || StaticResponse.DOWNLOADING;
                    streamResponse = createStreamFromStaticResponse(staticResponseService, response, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus: ${tbResult.status}`;
                } else if (['error', 'dead', 'missingfiles'].some(s => statusLower.includes(s))) {
                    const staticResponseService = new StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_DOWNLOAD, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nDetalhes: ${tbResult.message || tbResult.status}`;
                } else {
                    const staticResponseService = new StaticResponseService(baseUrl);
                    streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
                    streamResponse.description += `\nStatus desconhecido: ${tbResult.status}`;
                }
            } else {
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
            const staticResponseService = new StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            logger.error('Exceção inesperada', { error: errorMessage, infoHash });

            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }

        if (!streamResponse) {
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
        const imdbId = req.query.imdbId as string | undefined;

        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host') || 'localhost:7000';
        const baseUrl = `${protocol}://${host}`;

        let streamResponse: any = null;

        try {
            const magnet = Buffer.from(req.params.magnet, 'base64').toString();
            if (!apiKey) throw new Error('API key obrigatória');

            const magnetHash = await extrairInfoHashDoMagnet(magnet);
            if (!magnetHash) throw new Error('Magnet inválido');

            const titles = await getEnrichedTitlesForHash(magnetHash, imdbId, season);
            const tbResult = await processMagnetWithTorbox(magnet, apiKey, magnetHash, season, episode, type, undefined, titles);

            if (tbResult.success) {
                if ((tbResult.status === 'ready' || tbResult.status === 'completed' || tbResult.status === 'cached') && tbResult.streamLink) {
                    res.setHeader('Access-Control-Allow-Origin', '*');
                    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
                    return res.redirect(302, tbResult.streamLink);
                }

                const staticResponseService = new StaticResponseService(baseUrl);
                let staticResponse = StaticResponse.DOWNLOADING;
                if (tbResult.status === 'error' || tbResult.status === 'dead') staticResponse = StaticResponse.FAILED_DOWNLOAD;
                streamResponse = createStreamFromStaticResponse(staticResponseService, staticResponse, `resolve-${Date.now()}`, season, episode);
                streamResponse.description += `\nStatus: ${tbResult.status}`;
            } else {
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
            const staticResponseService = new StaticResponseService(baseUrl);
            const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
            streamResponse = createStreamFromStaticResponse(staticResponseService, StaticResponse.FAILED_UNEXPECTED, `resolve-${Date.now()}`, season, episode);
            streamResponse.description += `\nErro: ${errorMessage}`;
        }

        if (!streamResponse) {
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