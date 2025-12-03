import https from 'https';
import fs from 'fs';
import { Logger } from '../utils/logger';

const logger = new Logger('Server');

export function getSSLOptions() {
    try {
        const privateKeyPath = process.env.SSL_PRIVATE_KEY;
        const certificatePath = process.env.SSL_CERTIFICATE;
        
        if (privateKeyPath && certificatePath && 
            fs.existsSync(privateKeyPath) && fs.existsSync(certificatePath)) {
            
            return {
                key: fs.readFileSync(privateKeyPath),
                cert: fs.readFileSync(certificatePath)
            };
        }
        
        logger.info('SSL não configurado - usando HTTP para desenvolvimento');
        return null;
        
    } catch (error) {
        logger.warn('Erro ao carregar certificados SSL', {
            error: error instanceof Error ? error.message : 'Unknown error'
        });
        return null;
    }
}

export function logServerStart(port: number, httpsEnabled: boolean) {
    const protocol = httpsEnabled ? 'https' : 'http';
    const host = process.env.RAILWAY_STATIC_URL ? 
        (process.env.RAILWAY_STATIC_URL.startsWith('http') ? 
            new URL(process.env.RAILWAY_STATIC_URL).hostname : 
            process.env.RAILWAY_STATIC_URL) : 
        `localhost:${port}`;

    logger.info('Brasil RD Addon iniciado com sucesso', {
        port,
        protocol,
        configurable: true,
        environment: process.env.NODE_ENV || 'production',
        cacheEnabled: true,
        httpsEnabled,
        features: ['auto-magnet', 'smart-resolve', 'real-debrid-check']
    });

    console.log('=== BRASIL RD ADDON (MODO INTELIGENTE) ===');
    console.log(`Addon rodando: ${protocol}://${host}/manifest.json`);
    console.log(`Interface de config: ${protocol}://${host}/configure`);
    console.log(`Health check: ${protocol}://${host}/health`);
    console.log(`Rota de resolução: ${protocol}://${host}/resolve/{magnet}?apiKey=...`);
    console.log('');
    console.log('NOVAS FUNCIONALIDADES:');
    console.log('- Auto-salvamento de magnets no catálogo');
    console.log('- Verificação inteligente: "Real-Debrid, você tem este magnet?"');
    console.log('- Stream instantâneo se já estiver baixado');
    console.log('- Status em tempo real se estiver baixando');
    console.log('- Cache inteligente de 24h');
    console.log('');
    console.log('FLUXO INTELIGENTE:');
    console.log('1. Usuário clica no stream → Pergunta ao Real-Debrid');
    console.log('2. Se já tem: Stream instantâneo');
    console.log('3. Se não tem: Adiciona e mostra progresso');
    console.log('4. Próximo usuário: Já está no catálogo');
    console.log('');
    
    if (!httpsEnabled && !process.env.RAILWAY_STATIC_URL) {
        console.log('PARA HTTPS: Defina SSL_PRIVATE_KEY e SSL_CERTIFICATE no .env');
    }
}

export function createServer(app: any, port: number) {
    const sslOptions = getSSLOptions();
    
    if (sslOptions) {
        const httpsServer = https.createServer(sslOptions, app);
        httpsServer.listen(port, '0.0.0.0', () => {
            logServerStart(port, true);
        });
        return httpsServer;
    } else {
        return app.listen(port, '0.0.0.0', () => {
            logServerStart(port, false);
        });
    }
}
