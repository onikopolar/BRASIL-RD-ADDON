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

// Version: 4.5.1 - FIX: Removida rota OPTIONS(*) problemática que impedia inicialização
logger.info('Brasil RD Server v4.5.1 iniciando - Correção de inicialização do servidor');

// 1. CONFIGURAÇÃO CORS PRINCIPAL (FIX do v4.1.0)
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

// 3. INTERCEPTOR PARA ROTAS TORRENTIO
app.use((req: any, res: any, next: any) => {
    if (req.path.includes('/realdebrid=')) {
        logger.debug('Interceptado rota Torrentio', {
            path: req.path,
            clientOrigin: req.get('Origin') || 'direct',
            ip: req.clientInfo?.ip || req.ip || 'Desconhecido',
            hasCorsHeader: res.get('Access-Control-Allow-Origin') || 'não definido'
        });
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
logger.debug('Configurado serviço de vídeos estáticos');

// Inicialização do banco de dados
async function initializeDatabase() {
    try {
        logger.info('Iniciando conexão com banco de dados');
        const syncOptions = process.env.NODE_ENV === 'development' ? { alter: true } : {};
        await sequelize.sync(syncOptions);
        logger.info('Banco de dados sincronizado com sucesso', {
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

// Middleware de cache otimizado
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public, must-revalidate`);
        res.setHeader('Pragma', 'no-cache');
    }
    
    // Headers CORS adicionais para garantir compatibilidade
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
    logger.debug('Página de configuração acessada', {
        ip: clientIp,
        userAgent: req.clientInfo?.browser || 'Desconhecido'
    });
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
        ip: clientIp,
        browser: req.clientInfo?.browser || 'Desconhecido'
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

    logger.debug('Rota Torrentio Stream iniciada - Formato v1.4.0', {
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

        // Registra métricas de streams (extrai qualidade dos behaviorHints)
        result.streams.forEach((stream: any) => {
            let quality = 'unknown';
            if (stream.behaviorHints && stream.behaviorHints.streamQuality) {
                quality = stream.behaviorHints.streamQuality;
            } else if (stream.title) {
                // Fallback: tenta extrair do título
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
            id: decodedId,
            ip: clientIp,
            formatoStream: 'v1.4.0_compativel',
            duration: Date.now() - startTime
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
        logger.debug('Rota já tratada pelo Torrentio - pulando Stremio Router');
        return next('route');
    }
    next();
});

// Configuração principal do servidor
async function startServer() {
    try {
        logger.info('Inicialização do servidor v4.5.1 em andamento');
        
        // 1. Inicializa banco de dados
        await initializeDatabase();
        
        // 2. Configura rotas customizadas
        logger.debug('Configurando rotas customizadas do sistema');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        
        // 3. Sistema Stremio oficial (apenas para rotas não-Torrentio)
        logger.debug('Inicializando sistema Stremio Addon SDK');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        app.use(stremioRouter);
        logger.debug('Router do Stremio SDK configurado para rotas padrão');
        
        // 4. Inicia servidor HTTP/HTTPS
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        // Log de inicialização completa
        logger.info('Servidor Brasil RD v4.5.1 inicializado com sucesso', {
            porta: port,
            ambiente: process.env.NODE_ENV || 'desenvolvimento',
            recursosAtivos: [
                'FIX CORS para Stremio Web (v4.1.0)',
                'Formato de streams corrigido (v1.4.0)',
                'Rate Limiting Inteligente (v4.4.1)',
                'Sistema de Métricas Completo (v4.4.1)',
                'Integração Real-Debrid funcional',
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
            notaCorrecao: 'Removida rota OPTIONS(*) problemática que causava erro de inicialização'
        });
        
    } catch (error) {
        logger.error('Falha crítica na inicialização do servidor', {
            error: error instanceof Error ? error.message : 'Erro desconhecido',
            motivo: 'Verifique configurações de banco, porta ou variáveis de ambiente'
        });
        process.exit(1);
    }
}

// Inicia o servidor
startServer();

// Log final do módulo
logger.info('Módulo server.ts v4.5.1 carregado - Correção de inicialização aplicada');