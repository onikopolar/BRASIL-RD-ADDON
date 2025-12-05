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
        
        return null;
        
    } catch (error) {
        logger.warn('Erro ao carregar certificados SSL', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        return null;
    }
}

export function logServerStart(port: number, httpsEnabled: boolean) {
    const protocol = httpsEnabled ? 'https' : 'http';

    logger.info('Brasil RD Addon iniciado', {
        port,
        protocol,
        httpsEnabled
    });
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