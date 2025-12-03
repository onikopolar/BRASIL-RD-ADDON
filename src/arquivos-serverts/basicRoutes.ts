import { CacheService } from '../services/CacheService';
import { Logger } from '../utils/logger';

const logger = new Logger('Routes');
const cacheService = new CacheService();

export const setupBasicRoutes = (app: any, manifest: any) => {
    // Health check
    app.get('/health', (req: any, res: any) => {
        res.json({ 
            status: 'ok', 
            service: 'Brasil RD Addon', 
            mode: 'torrentio-like-dev',
            version: manifest.version,
            features: {
                cache: true,
                lazyStreams: true,
                realDebrid: true,
                optimizations: true
            }
        });
    });

    // Rota para limpar cache
    app.delete('/cache', (req: any, res: any) => {
        cacheService.clear();
        logger.info('Cache limpo manualmente');
        res.json({ 
            success: true, 
            message: 'Cache limpo'
        });
    });

    // Rota para status do cache
    app.get('/cache/status', (req: any, res: any) => {
        res.json({
            status: 'CacheService em uso',
            ttl: 24 * 60 * 60 * 1000 + 'ms', // 24 horas
            feature: 'Cache distribuído por chave'
        });
    });

    // Rota raiz redireciona para configuração
    app.get('/', (req: any, res: any) => {
        res.redirect('/configure');
    });
};
