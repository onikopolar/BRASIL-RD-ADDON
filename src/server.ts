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

// Cache para links já resolvidos usando CacheService
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 horas

// Configuração do Express
app.use(cors());
app.use(express.json());

// Servir vídeos informativos da pasta src/videos
const videosPath = path.join(__dirname, 'videos');
app.use('/videos', express.static(videosPath));
app.use('/static/videos', express.static(videosPath));

logger.info('Servindo vídeos informativos', {
  videoPath: videosPath,
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
        
        logger.info('Banco de dados sincronizado com sucesso', {
            tables: ['torrents', 'files', 'subtitles'],
            options: syncOptions,
            environment: process.env.NODE_ENV || 'production'
        });
        
        await sequelize.authenticate();
        logger.info('Conexão com banco de dados estabelecida');
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha crítica na inicialização do banco de dados', {
            error: errorMessage,
            action: 'Verifique as credenciais do banco e se o PostgreSQL está rodando'
        });
        
        if (process.env.NODE_ENV === 'production') {
            logger.warn('Continuando sem banco de dados - funcionalidades limitadas');
        } else {
            throw error;
        }
    }
}

// Middleware de cache para respostas HTTP
const cacheMaxAge = 600; // 10 minutos
app.use((req: any, res: any, next: any) => {
    if (cacheMaxAge && !res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${cacheMaxAge}, public`);
    }
    next();
});

// Rota de configuração HTML
app.get('/configure', (req: any, res: any) => {
    res.setHeader('content-type', 'text/html');
    res.end(configureTemplate(manifest));
});

// Função principal de inicialização
async function startServer() {
    try {
        // 1. Inicializar banco de dados
        await initializeDatabase();
        
        // 2. Configurar sistema Stremio
        const builder = createStremioBuilder(manifest);
        const stremioRouter = getStremioRouter(builder);
        
        // 3. Aplicar rotas Stremio
        app.use(stremioRouter);
        
        // 4. Configurar rotas customizadas
        setupBasicRoutes(app, manifest);
        setupResolveRoutes(app);
        setupStaticRoutes(app);
        // Removido: setupDemoStaticRoutes(app);
        
        // 5. Iniciar servidor HTTP/HTTPS
        const port = process.env.PORT ? parseInt(process.env.PORT) : 7000;
        createServer(app, port);
        
        logger.info('Servidor inicializado com sucesso', {
            port,
            features: [
                'Stremio Addon',
                'Real-Debrid Integration',
                'Static Response System com Vídeos',
                'Database Support',
                'Caching System'
                // Removido: 'Demo Interface'
            ],
            video_endpoints: [
                '/videos/downloading_v2.mp4',
                '/videos/download_failed_v2.mp4',
                '/videos/failed_access_v2.mp4',
                '/static/videos/*.mp4'
            ]
        });
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
        logger.error('Falha na inicialização do servidor', {
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined
        });
        
        process.exit(1);
    }
}

// Iniciar aplicação
startServer();