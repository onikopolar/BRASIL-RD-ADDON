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

// Version: 4.5.2 - FIX: Configuração trust proxy e logs otimizados
logger.info('Brasil RD Server v4.5.2 iniciando - Correção de rate limit e proxy');

// CONFIGURAÇÃO ESSENCIAL DO EXPRESS PARA RAILWAY
app.set('trust proxy', 1); // Confia no proxy do Railway (FIX para rate limit)

// 1. CONFIGURAÇÃO CORS PRINCIPAL
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['Content-Length', 'X-Request-ID']
}));

app.use(express.json());

// 2. MIDDLEWARES DO SISTEMA
app.use(clientInfoMiddleware());
app.use(metricsService.httpMetricsMiddleware());
app.use(createRateLimiter());

// 3. INTERCEPTOR PARA ROTAS TORRENTIO (logs reduzidos)
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        // Log apenas se debug ativado para reduzir volume no Railway
        if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('Rota Torrentio interceptada', {
                path: req.path.substring(0, 80),
                ip: req.clientInfo?.ip || req.ip || 'Desconhecido'
            });
        }
        req._torrentioHandled = true;
    }
    next();
});

// Rota de métricas Prometheus
app.get('/metrics', metricsService.metricsRoute());

// Serviço de vídeos estáticos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

// Inicialização do banco de dados
async function initializeDatabase() {
    try {
        logger.info('Conectando ao banco de dados');
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado', {
            tabelas: ['torrents', 'files', 'subtitles'],
            ambiente: process.env.NODE_ENV || 'producao'
        });
        await sequelize.authenticate();
        logger.info('Conexão com banco de dados validada');
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

// Middleware de cache otimizado
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public, must-revalidate`);
        res.setHeader('Pragma', 'no-cache');
    }
    
    // Headers CORS adicionais para compatibilidade
    if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    next();
});

// Rota de configuração do addon
app.get('/configure', (req: any, res: any) => {
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    logger.debug('Pagina de configuracao acessada', { ip: clientIp });
    
    res.setHeader('content-type', 'text/html');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.end(configureTemplate(manifest));
});

// ROTA TORRENTIO 1: Manifesto dinâmico
app.get('/realdebrid=:apiKey/manifest.json', torrentioRateLimiter, (req: any, res: any) => {
    const { apiKey } = req.params;
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    
    logger.debug('Manifesto Torrentio solicitado', {
        apiKeyPreview: safeKey,
        ip: clientIp
    });
    
    // Headers CORS explícitos
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, X-Request-ID');
    res.json(manifest);
});

// ROTA TORRENTIO 2: Streams (formato corrigido v1.4.0)
app.get('/realdebrid=:apiKey/stream/:type/:id.json', torrentioRateLimiter, async (req: any, res: any) => {
    // Headers CORS definidos no início da rota
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type, Content-Length');

    const startTime = Date.now();
    const clientIp = req.clientInfo?.ip || req.ip || 'Desconhecido';
    const { apiKey, type, id } = req.params;
    const decodedId = decodeURIComponent(id);
    const safeKey = apiKey.substring(0, 4) + '...' + apiKey.substring(apiKey.length - 4);

    logger.debug('Rota Torrentio Stream iniciada', {
        apiKeyPreview: safeKey,
        type: type,
        id: decodedId.substring(0, 30),
        ip: clientIp,
        formato: 'v1.4.0'
    });

    try {
        if (!apiKey || apiKey.length < 10) {
            logger.warn('API Key invalida', { length: apiKey?.length, ip: clientIp });
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

        // Registra métricas de streams
        result.streams.forEach((stream: any) => {
            let quality = 'unknown';
            if (stream.behaviorHints && stream.behaviorHints.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.title) {
                if (stream.title.includes('1080p') || stream.title.includes('1080')) {
                    quality = '1080p';
                } else if (stream.title.includes('720p') || stream.title.includes('720')) {
                    quality = '720p';
                } else if (stream.title.includes('2160p') || stream.title.includes('4K')) {
                    quality = '2160p';
                } else if (stream.title.includes('HD')) {
                    quality = 'HD';
                }
            }
            metricsService.recordStreamReturned(type, quality);
        });

        logger.info('Rota Torrentio Stream finalizada', {
            streamsCount: result.streams.length,
            id: decodedId.substring(0, 20),
            ip: clientIp,
            duration: Date.now() - startTime,
            formato: 'v1.4.0_compativel'
        });

        return res.json(result);

    } catch (error) {
        logger.error('Erro na rota Torrentio Stream', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            ip: clientIp,
            duration: Date.now() - startTime
        });
        return res.json({ streams: [] });
    }
});

// Middleware para pular Stremio Router se rota já tratada
app.use((req: any, res: any, next: any) => {
    if (req._torrentioHandled) {
        if (process.env.LOG_LEVEL === 'debug') {
            logger.debug('Rota Torrentio - pulando Stremio Router');
        }
        return next('route');
    }
    next();
});

// Configuração principal do servidor
async function startServer() {
    try {
        logger.info('Iniciando servidor v4.5.2');
        
        // 1. Inicializa banco de dados
        await initializeDatabase();
        
        // 2. Configura rotas customizadas
        logger.debug('Configurando rotas customizadas');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        
        // 3. Sistema Stremio oficial (apenas para rotas não-Torrentio)
        logger.debug('Inicializando sistema Stremio SDK');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');
        
        // 4. Inicia servidor HTTP/HTTPS
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        // Log de inicialização completa
        logger.info('Servidor Brasil RD v4.5.2 inicializado com sucesso', {
            porta: port,
            ambiente: process.env.NODE_ENV || 'producao',
            recursos: [
                'FIX CORS para Stremio Web',
                'Formato de streams corrigido v1.4.0',
                'Rate Limit corrigido com trust proxy',
                'Sistema de Métricas',
                'Integração Real-Debrid',
                'Rotas Torrentio estilo /realdebrid=APIKEY',
                'Banco de dados SQLite'
            ],
            endpoints: [
                'GET /realdebrid=:apiKey/manifest.json',
                'GET /realdebrid=:apiKey/stream/:type/:id.json',
                'GET /configure',
                'GET /metrics'
            ],
            nota: 'Rate limit corrigido com trust proxy para Railway'
        });
        
    } catch (error) {
        logger.error('Falha na inicializacao do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        process.exit(1);
    }
}

// Inicia o servidor
startServer();

// Log final do módulo
logger.info('Server.ts v4.5.2 carregado - Correção de rate limit e proxy aplicada');