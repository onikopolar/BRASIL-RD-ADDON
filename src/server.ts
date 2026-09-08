import 'dotenv/config';

import dns from 'dns';
dns.setServers(['8.8.8.8', '1.1.1.1']);

import express from 'express';
import cors from 'cors';
import path from 'path';
import { sequelize } from './database/models.js';
import { manifest } from './rotas/manifest.js';
import { configureTemplate } from './rotas/configureTemplate.js';
import { createStremioBuilder, getStremioRouter } from './rotas/streamHandlerBuilder.js';
import { setupBasicRoutes } from './rotas/basicRoutes.js';
import { setupResolveRoutes } from './rotas/resolveRoutes.js';
import { setupStaticRoutes } from './rotas/staticRoutes.js';
import { createServer } from './rotas/serverFunctions.js';
import { Logger } from './utils/logger.js';
import { clientInfoMiddleware } from './middlewares/clientInfo.js';
import { createRateLimiter, torrentioRateLimiter } from './middlewares/rateLimit.js';
import { metricsService } from './catalogo/MetricsService.js';
import { ultraDebugMiddleware, manifestDebugMiddleware, configureDebugMiddleware } from './middlewares/ultraDebug.js';
import { etagMiddleware } from './middlewares/etag.js';
import { RescrapeService } from './services/scraper/RescrapeService.js';

const logger = new Logger('Main');
const app = express();

app.set('trust proxy', 1);

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());
app.use(ultraDebugMiddleware());
app.use(clientInfoMiddleware());
app.use(metricsService.httpMetricsMiddleware());
app.use(createRateLimiter());

// Interceptor Torrentio
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        req._torrentioHandled = true;
    }
    next();
});

app.get('/metrics', metricsService.metricsRoute());

const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

async function initializeDatabase() {
    try {
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        await sequelize.authenticate();
    } catch (error) {
        logger.error('Falha no banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados em produção');
        } else {
            throw error;
        }
    }
}

// Cache + CORS básicos
app.use((req: any, res: any, next: any) => {
    if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', 'max-age=300, public, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
    }
    if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    next();
});

app.use(etagMiddleware({
    excludePaths: ['/resolve'],
    defaultMaxAge: 300,
}));

// ─── Helpers de resposta para manifest e configure ───

function sendManifest(req: any, res: any, loggerName: string, extraLog: Record<string, any> = {}) {
    const ultraLogger = new Logger(loggerName);
    const apiKey = req.params.apiKey;
    ultraLogger.info('MANIFEST solicitado', {
        requestId: req._ultraDebugId,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        apiKeyLength: apiKey?.length || 0,
        manifestId: manifest.id,
        manifestVersion: manifest.version,
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent')?.substring(0, 80),
        ...extraLog,
    });

    res.setHeader('Cache-Control', 'max-age=86400, public');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID, ETag');
    res.json(manifest);
}

function sendConfigure(req: any, res: any, loggerName: string, extraLog: Record<string, any> = {}) {
  const ultraLogger = new Logger(loggerName);
  const apiKey = req.params.apiKey || '';
  ultraLogger.info('CONFIGURE solicitado', {
    requestId: req._ultraDebugId,
    apiKeyPresent: !!apiKey,
    apiKeyLength: apiKey?.length || 0,
    manifestVersion: manifest.version,
    manifestId: manifest.id,
    host: req.get('host'),
    protocol: req.protocol,
    origin: req.get('origin'),
    ...extraLog,
  });

  res.setHeader('Cache-Control', 'max-age=3600, public');
  res.setHeader('content-type', 'text/html');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(configureTemplate(manifest, apiKey));
}

// ─── Rotas de manifest e configure (compatíveis com Stremio e Nuvio) ───

// Manifest padrão (usado pelo Stremio SDK)
app.get('/manifest.json', manifestDebugMiddleware(), (req: any, res: any) => {
    sendManifest(req, res, 'SDK-MANIFEST');
});

// Manifest via Torbox (formato Torrentio, usado por Stremio e Nuvio)
app.get('/torbox=:apiKey/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    sendManifest(req, res, 'TORBOX-MANIFEST');
});

// Compatibilidade: Manifest via RealDebrid
app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, manifestDebugMiddleware(), (req: any, res: any) => {
    sendManifest(req, res, 'RD-MANIFEST');
});

// Configure padrão (Stremio SDK)
app.get('/configure', configureDebugMiddleware(), (req: any, res: any) => {
    sendConfigure(req, res, 'SDK-CONFIGURE');
});

// Configure via Torbox (Nuvio gera automaticamente /configure a partir da URL base)
app.get('/torbox=:apiKey/configure', configureDebugMiddleware(), (req: any, res: any) => {
    sendConfigure(req, res, 'NUVIO-CONFIGURE');
});

// Compatibilidade: Configure via RealDebrid
app.get('/realdebrid=:apiKey/configure', configureDebugMiddleware(), (req: any, res: any) => {
    sendConfigure(req, res, 'NUVIO-CONFIGURE-RD');
});

// ─── Rota de stream (Torrentio) ───

app.get('/torbox=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    const ultraLogger = new Logger('STREAM-TORBOX');
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const requestId = req._ultraDebugId || 'no-id';

    let tmdbInfo: any = null;
    const imdbMatch = decodedId.match(/^(tt\d+)/);
    const imdbId = imdbMatch ? imdbMatch[1] : null;
    if (imdbId) {
        try {
            const { StreamHandler } = await import('./stream/StreamHandler.js');
            const streamHandler = StreamHandler.getInstance();
            const seasonMatch = decodedId.match(/^tt\d+:(\d+):(\d+)/);
            const season = seasonMatch ? parseInt(seasonMatch[1]) : undefined;
            const tmdb = await streamHandler.catalog.getTmdbSearchData(imdbId, season);
            tmdbInfo = {
                imdbId,
                searchTitle: tmdb.searchTitle,
                originalTitle: tmdb.imdbTitles?.originalTitle,
                portugueseTitle: tmdb.imdbTitles?.portugueseTitle,
                year: tmdb.imdbTitles?.year,
                mediaType: tmdb.imdbTitles?.mediaType,
                allTitles: tmdb.imdbTitles?.allTitles,
                seasonYear: tmdb.seasonYear,
            };
        } catch (error) {
            tmdbInfo = { error: 'Falha ao obter dados TMDB' };
        }
    }

    ultraLogger.info('═══════════════════════════════════════', {});
    ultraLogger.info(' STREAM SOLICITADO (Torbox route)', {
        requestId,
        type,
        id: decodedId,
        apiKeyPresent: !!apiKey,
        apiKeyLength: apiKey?.length || 0,
        apiKeyPreview: apiKey ? (apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4)) : 'NONE',
        host: req.get('host'),
        origin: req.get('origin'),
        userAgent: req.get('user-agent')?.substring(0, 100),
        clientInfo: (req as any)._clientInfo,
        tmdb: tmdbInfo,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    try {
        if (!apiKey || apiKey.length < 10) {
            ultraLogger.warn(' API Key inválida ou ausente para stream', {
                requestId,
                apiKeyLength: apiKey?.length || 0,
                reason: !apiKey ? 'API Key ausente' : 'API Key muito curta (< 10 chars)',
            });
            return res.json({ streams: [] });
        }

        const { StreamHandler } = await import('./stream/StreamHandler.js');
        const streamHandler = StreamHandler.getInstance();

        const protocol = req.get('x-forwarded-proto') || 'https';
        const host = req.get('host');
        if (host) {
            streamHandler.setStaticResponseBaseUrl(`${protocol}://${host}`);
        }

        const streamRequest = {
            type: type as 'movie' | 'series',
            id: decodedId,
            apiKey: apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };

        const result = await streamHandler.handleStreamRequest(streamRequest);

        ultraLogger.info(' STREAM RESULT retornado', {
            requestId,
            totalStreams: result.streams?.length || 0,
            resumo: result.streams?.slice(0, 8).map((s: any) => {
                const provider = (s.title || '').match(/⚙️\s*([^\n]+)/)?.[1] || '?';
                const quality = s.behaviorHints?.streamQuality || '?';
                const name = (s.title || '').split('\n')[0].substring(0, 50);
                return `${provider} ${quality} | ${name}`;
            }),
        });

        result.streams.forEach((stream: any) => {
            let quality = 'unknown';
            if (stream.behaviorHints?.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.title) {
                if (stream.title.includes('1080p') || stream.title.includes('1080')) quality = '1080p';
                else if (stream.title.includes('720p') || stream.title.includes('720')) quality = '720p';
                else if (stream.title.includes('2160p') || stream.title.includes('4K')) quality = '2160p';
                else if (stream.title.includes('HD')) quality = 'HD';
            }
            metricsService.recordStreamReturned(type, quality);
        });

        return res.json(result);
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Erro desconhecido';
        ultraLogger.error(' ERRO FATAL na rota Torrentio Stream', {
            requestId,
            error: errorMsg,
            stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
            type,
            id: decodedId,
        });
        return res.json({ streams: [] });
    }
});

// ─── Stremio SDK Router (para rotas não cobertas acima) ───

app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        return next('route');
    }
    next();
});

app.use((req: any, res: any, next: any) => {
    const sdkLogger = new Logger('SDK-Router');
    const sdkPaths = ['/manifest.json', '/stream/', '/configure'];
    const isSdkPath = sdkPaths.some(p => req.path === p || req.path.startsWith(p));
    if (isSdkPath) {
        sdkLogger.info(' Rota caiu no Stremio SDK Router', {
            requestId: req._ultraDebugId,
            method: req.method,
            path: req.path,
            originalUrl: req.originalUrl?.substring(0, 200),
            query: req.query,
            params: req.params,
        });
    }
    next();
});

async function startServer() {
    try {
        const startupLogger = new Logger('Startup');
        startupLogger.info(`BRASIL RD Addon starting on port ${process.env.PORT || 7000}`);

        await initializeDatabase();

        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);

        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);

        app.use(stremioRouter);

        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);

        RescrapeService.getInstance().start();
    } catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

startServer();