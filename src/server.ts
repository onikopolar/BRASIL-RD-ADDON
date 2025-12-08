import express from 'express';
import cors from 'cors';
import path from 'path';
import { sequelize } from './database/models';
import { manifest } from './arquivos-serverts/manifest';
import { configureTemplate } from './arquivos-serverts/configureTemplate';
import { createStremioBuilder, getStremioRouter } from './arquivos-serverts/streamHandlerBuilder';
import { setupBasicRoutes } from './arquivos-serverts/basicRoutes';
import { setupResolveRoutes } from './arquivos-serverts/resolveRoutes';
import { setupStaticRoutes } from './arquivos-serverts/staticRoutes';
import { createServer } from './arquivos-serverts/serverFunctions';
import { CacheService } from './services/CacheService';
import { Logger } from './utils/logger';
import { clientInfoMiddleware } from './middlewares/clientInfo';
import { createRateLimiter, torrentioRateLimiter } from './middlewares/rateLimit';
import { metricsService } from './services/MetricsService';

const logger = new Logger('Main');
const cacheService = new CacheService();
const app = express();

// Version: 4.5.0 - FEATURE: Integração completa do FIX CORS com sistema de métricas e rate limiting
logger.info('Brasil RD Server v4.5.0 iniciando - CORS, Métricas e Rate Limit integrados');

// 1. CONFIGURAÇÃO CORS PRINCIPAL (FIX do v4.1.0 - deve vir antes de qualquer rota)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());

// 2. MIDDLEWARES DO REMOTO (v4.4.1)
app.use(clientInfoMiddleware()); // Middleware para IP e User Agent tracking
app.use(metricsService.httpMetricsMiddleware()); // Middleware de métricas HTTP
app.use(createRateLimiter()); // Rate limiting global (exceto rotas Torrentio)

// 3. INTERCEPTOR INTELIGENTE (Combina ambas versões)
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        logger.debug('LOGGER CORS/TORRENTIO: Rota detectada', {
            path: req.path,
            clientOrigin: req.get('Origin') || 'direct',
            ip: req.clientInfo?.ip || req.ip || 'Desconhecido',
            hasCorsHeader: res.get('Access-Control-Allow-Origin') || 'não definido'
        });
        // Marca a requisição (do remoto v4.4.1) para evitar duplicação no Stremio Router
        req._torrentioHandled = true;
    }
    next();
});

// Rota de métricas Prometheus (do remoto v4.4.1)
app.get('/metrics', metricsService.metricsRoute());

// Vídeos estáticos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));
logger.debug('Serviço de vídeos estáticos configurado');

// Banco de dados
async function initializeDatabase() {
    try {
        logger.info('Iniciando conexão com banco de dados...');
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado', {
            tables: ['torrents', 'files', 'subtitles']
        });
        await sequelize.authenticate();
        logger.info('Conexão com banco de dados estabelecida');
    } catch (error) {
        logger.error('Falha na conexão com banco de dados', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando operação sem banco de dados no modo produção');
        } else {
            throw error;
        }
    }
}

// Middleware de cache otimizado (do seu v4.1.0 com ajustes)
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public, must-revalidate`);
        res.setHeader('Pragma', 'no-cache');
    }
    // Headers CORS adicionais (FIX do seu v4.1.0)
    if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    next();
});

// Rota de configuração (combina ambas versões)
app.get('/configure', (req: any, res: any) => {
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Página de configuração acessada', {
        ip: clientIp,
        userAgent: req.clientInfo?.browser || 'Desconhecido'
    });
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(configureTemplate(manifest));
});

// ROTA TORRENTIO 1: Manifesto dinâmico (com rate limit específico do remoto)
app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, (req: any, res: any) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Manifesto Torrentio solicitado', {
        apiKeyPreview: safeKey,
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido'
    });
    // HEADERS CORS EXPLÍCITOS (FIX do seu v4.1.0)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// ROTA TORRENTIO 2: Streams (FIX CORS + rate limit + métricas)
app.get('/realdebrid=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    // HEADERS CORS DEFINIDOS NO INÍCIO (FIX CRÍTICO do seu v4.1.0)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    const startTime = Date.now();
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);

    logger.debug('Rota Torrentio Stream iniciada - CORS ATIVO', {
        apiKeyPreview: safeKey,
        type: type,
        id: decodedId,
        ip: clientIp,
        clientOrigin: req.get('Origin') || 'direct',
        hasCorsHeaders: true
    });

    try {
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key do Real-Debrid inválida', { length: apiKey?.length, ip: clientIp });
            return res.json({ streams: [] });
        }

        const { StreamHandler } = await import('./services/StreamHandler');
        const streamHandler = new StreamHandler();
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

        // Registra métricas de streams (do remoto v4.4.1)
        result.streams.forEach((stream: any) => {
            let quality = 'unknown';
            if (stream.behaviorHints && stream.behaviorHints.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.name) {
                if (stream.name.includes('1080p') || stream.name.includes('1080')) {
                    quality = '1080p';
                } else if (stream.name.includes('720p') || stream.name.includes('720')) {
                    quality = '720p';
                } else if (stream.name.includes('2160p') || stream.name.includes('4K')) {
                    quality = '2160p';
                } else if (stream.name.includes('HD')) {
                    quality = 'HD';
                }
            }
            metricsService.recordStreamReturned(type, quality);
        });

        logger.info('Rota Torrentio Stream finalizada com sucesso', {
            streamsCount: result.streams.length,
            id: decodedId,
            ip: clientIp,
            statusCors: 'headers aplicados',
            duration: Date.now() - startTime
        });

        return res.json(result);

    } catch (error) {
        logger.error('Erro crítico na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            ip: clientIp,
            duration: Date.now() - startTime
        });
        return res.json({ streams: [] });
    }
});

// Middleware OPTIONS para requisições preflight CORS (FIX do seu v4.1.0 - CRÍTICO)
app.options('*', (req: any, res: any) => {
    logger.debug('Requisição preflight OPTIONS recebida', {
        origin: req.get('Origin'),
        method: req.get('Access-Control-Request-Method')
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    res.setHeader('Access-Control-Max-Age', '86400');
    res.status(204).end();
});

// Middleware para pular Stremio Router se rota já tratada (do remoto v4.4.1)
app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        logger.debug('Rota já tratada pelo Torrentio - pulando Stremio Router');
        return next('route');
    }
    next();
});

// Configuração do sistema Stremio (para rotas não-Torrentio)
async function startServer() {
    try {
        logger.info('Inicialização do servidor v4.5.0 em andamento...');
        await initializeDatabase();
        logger.debug('Configurando rotas customizadas do sistema');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        logger.debug('Inicializando sistema Stremio Addon SDK');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        app.use(stremioRouter);
        logger.debug('Router do Stremio SDK configurado para rotas padrão');
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        logger.info('Servidor Brasil RD v4.5.0 inicializado com sucesso', {
            port,
            features: [
                'FIX CORS para Stremio Web (v4.1.0)',
                'Rate Limiting Inteligente (v4.4.1)',
                'Sistema de Métricas Completo (v4.4.1)',
                'Client Info Tracking (v4.4.1)',
                'Integração Real-Debrid',
                'Rotas Torrentio estilo /realdebrid=APIKEY',
                'Banco de dados SQLite'
            ],
            endpointsPrincipais: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json',
                'GET /configure',
                'GET /metrics',
                'TODAS rotas Stremio SDK padrão'
            ],
            notaFixa: 'Headers CORS e rota OPTIONS aplicados para compatibilidade total com Stremio Web'
        });
    } catch (error) {
        logger.error('Falha crítica na inicialização do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

// Inicia o servidor
startServer();
logger.info('Módulo server.ts v4.5.0 carregado - CORS, Métricas e Rate Limit integrados');