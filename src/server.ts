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

// Version: 4.4.1 - Corrigido extração de qualidade do Stream para métricas
logger.info('Brasil RD Server v4.4.1 iniciando - Correção de métricas de qualidade');

// Interceptor para capturar rotas Torrentio ANTES de tudo
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        logger.debug('INTERCEPTOR: Rota Torrentio detectada', {
            path: req.path,
            method: req.method,
            originalUrl: req.originalUrl
        });

        req._torrentioHandled = true;
    }
    next();
});

// Configuração Express
app.use(cors());
app.use(express.json());
app.use(clientInfoMiddleware()); // Middleware para IP e User Agent tracking

// Middleware de métricas HTTP
app.use(metricsService.httpMetricsMiddleware());

// Rate limiting global (exceto rotas Torrentio que têm rate limit próprio)
app.use(createRateLimiter());

// Rota de métricas Prometheus
app.get('/metrics', metricsService.metricsRoute());

// Vídeos estáticos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

logger.debug('Vídeos estáticos configurados');

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
            logger.warn('Continuando operação sem banco de dados');
        } else {
            throw error;
        }
    }
}

// Middleware cache
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public`);
    }
    next();
});

// Rota configuração (sem rate limit)
app.get('/configure', (req: any, res: any) => {
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Página de configuração acessada', { 
        ip: clientIp,
        userAgent: req.clientInfo?.browser || 'Desconhecido'
    });
    res.setHeader('content-type', 'text/html');
    res.end(configureTemplate(manifest));
});

// ROTA 1: Manifest Torrentio com rate limit específico
app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, (req: any, res: any) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';

    logger.debug('Rota Manifest Torrentio acessada', { 
        apiKey: safeKey,
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido',
        os: req.clientInfo?.os || 'Desconhecido',
        device: req.clientInfo?.deviceType || 'desktop'
    });
    res.json(manifest);
});

// ROTA 2: Stream Torrentio com rate limit específico
app.get('/realdebrid=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    const startTime = Date.now();
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    const { apiKey, type, id } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);

    logger.debug('Rota Torrentio Stream iniciada', {
        apiKey: safeKey,
        type,
        id,
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido',
        os: req.clientInfo?.os || 'Desconhecido',
        device: req.clientInfo?.deviceType || 'desktop',
        isBot: req.clientInfo?.isBot || false
    });

    try {
        // Valida API Key
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key inválida rejeitada', { ip: clientIp });
            return res.json({ streams: [] });
        }

        // Import dinâmico
        const { StreamHandler } = await import('./services/StreamHandler');
        const streamHandler = new StreamHandler();

        // Cria request
        const streamRequest = {
            type: type as 'movie' | 'series',
            id: decodeURIComponent(id),
            apiKey: apiKey,
            config: {
                quality: 'Todas as Qualidades',
                language: 'pt-BR',
                streamType: 'direct',
                maxResults: '25'
            }
        };

        // Processa
        const result = await streamHandler.handleStreamRequest(streamRequest);

        // Registra métricas de streams (correção: extrai qualidade corretamente)
        result.streams.forEach(stream => {
            // Extrai qualidade do behaviorHints.streamQuality ou do nome
            let quality = 'unknown';
            
            if (stream.behaviorHints && stream.behaviorHints.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.name) {
                // Tenta extrair do nome do stream
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

        logger.info('Rota Torrentio Stream finalizada', {
            streamsCount: result.streams.length,
            id: id,
            ip: clientIp,
            deviceType: req.clientInfo?.deviceType || 'desktop',
            isBot: req.clientInfo?.isBot || false,
            requestTime: startTime,
            duration: Date.now() - startTime
        });

        return res.json(result);

    } catch (error) {
        logger.error('Erro na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            ip: clientIp,
            id: req.params?.id || 'Desconhecido',
            duration: Date.now() - startTime
        });
        return res.json({ streams: [] });
    }
});

// Middleware para pular Stremio Router se rota já tratada
app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        logger.debug('Rota já tratada pelo Torrentio - pulando Stremio Router');
        return next('route');
    }
    next();
});

// Função principal
async function startServer() {
    try {
        logger.info('Iniciando servidor v4.4.1...');

        // 1. Banco de dados
        await initializeDatabase();

        // 2. Rotas customizadas
        logger.debug('Configurando rotas customizadas');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);

        // 3. Sistema Stremio
        logger.debug('Configurando sistema Stremio');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);

        // 4. Aplica Stremio Router
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');

        // 5. Inicia servidor
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);

        logger.info('Servidor v4.4.1 inicializado com sucesso', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Web Auth System',
                'Database Support',
                'Caching System',
                'Torrentio Route Fix',
                'Client Info Tracking',
                'IP Detection',
                'User Agent Parsing',
                'Rate Limiting Inteligente',
                'Sistema de Métricas Completo'
            ],
            rotasTorrentio: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json'
            ],
            endpointsMonitoramento: [
                'GET /metrics - Métricas Prometheus',
                'GET /configure - Página configuração'
            ],
            configurePage: 'GET /configure',
            rateLimits: {
                global: '300 req/15min (desktop), 200 req/15min (mobile), 50 req/15min (bot)',
                torrentio: '500 req/15min',
                excluded: ['/configure', '/', '/metrics']
            },
            metricsEnabled: metricsService.isReady()
        });

    } catch (error) {
        logger.error('Falha na inicialização do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

// Inicia
startServer();

logger.debug('Server.ts v4.4.1 exportado - Correção de extração de qualidade para métricas');