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

const logger = new Logger('Main');
const cacheService = new CacheService();
const app = express();

// Version: 2.2.0 - Fix ordem das rotas para Web Auth funcionar
logger.info('Brasil RD Server v2.2.0 iniciando - Fix ordem rotas Web Auth');

// Cache para links já resolvidos
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Configuração do Express
app.use(cors());
app.use(express.json());

// Servir vídeos informativos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

logger.debug('Vídeos estáticos configurados', {
    path: videosPath,
    endpoints: ['/videos/*.mp4', '/static/videos/*.mp4']
});

// Inicialização do Banco de Dados
async function initializeDatabase() {
    try {
        logger.info('Iniciando sincronização do banco de dados...');
        
        const syncOptions = process.env.NODE_ENV === 'development' 
            ? { alter: true }
            : {};
            
        await sequelize.sync(syncOptions);
        
        logger.info('Banco de dados sincronizado', {
            tables: ['torrents', 'files', 'subtitles'],
            environment: process.env.NODE_ENV || 'production'
        });
        
        await sequelize.authenticate();
        logger.info('Conexão com banco de dados estabelecida');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha na inicialização do banco de dados', {
            error: errorMessage
        });
        
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados - funcionalidades limitadas');
        } else {
            throw error;
        }
    }
}

// Middleware de cache para respostas HTTP
const cacheMaxAge = 600;
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public`);
    }
    next();
});

// Rota de configuração HTML
app.get('/configure', (req: any, res: any) => {
    logger.debug('Página de configuração solicitada', { ip: req.ip });
    res.setHeader('content-type', 'text/html');
    res.end(configureTemplate(manifest));
});

// Função principal de inicialização
async function startServer() {
    try {
        logger.info('Iniciando servidor Brasil RD v2.2.0...');
        
        // 1. Inicializar banco de dados
        await initializeDatabase();
        
        // 2. Configurar rotas customizadas PRIMEIRO (FIX CRÍTICO)
        // Isso garante que /api/auth funcione antes do Stremio Router capturar tudo
        logger.debug('Configurando rotas customizadas (antes do Stremio Router)');
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        
        // 3. Configurar sistema Stremio
        logger.debug('Configurando sistema Stremio');
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        
        // 4. Aplicar rotas Stremio
        app.use(stremioRouter);
        logger.debug('Stremio Router configurado');
        
        // 5. Iniciar servidor HTTP/HTTPS
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        logger.info('Servidor Brasil RD v2.2.0 inicializado com sucesso', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Web Auth System',
                'Database Support',
                'Caching System'
            ],
            criticalFix: 'Ordem das rotas corrigida - Web Auth agora funciona',
            webAuthEndpoint: 'POST /api/auth',
            configurePage: 'GET /configure'
        });
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha na inicialização do servidor', {
            error: errorMessage
        });
        
        process.exit(1);
    }
}

// Iniciar aplicação
startServer();

// Log de exportação
logger.debug('Server.ts v2.2.0 exportado - Fix ordem rotas aplicado');