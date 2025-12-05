"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSSLOptions = getSSLOptions;
exports.logServerStart = logServerStart;
exports.createServer = createServer;
const https_1 = __importDefault(require("https"));
const fs_1 = __importDefault(require("fs"));
const logger_1 = require("../utils/logger");
const logger = new logger_1.Logger('Server');
function getSSLOptions() {
    try {
        const privateKeyPath = process.env.SSL_PRIVATE_KEY;
        const certificatePath = process.env.SSL_CERTIFICATE;
        if (privateKeyPath && certificatePath &&
            fs_1.default.existsSync(privateKeyPath) && fs_1.default.existsSync(certificatePath)) {
            return {
                key: fs_1.default.readFileSync(privateKeyPath),
                cert: fs_1.default.readFileSync(certificatePath)
            };
        }
        return null;
    }
    catch (error) {
        logger.warn('Erro ao carregar certificados SSL', {
            error: error instanceof Error ? error.message : 'Erro desconhecido'
        });
        return null;
    }
}
function logServerStart(port, httpsEnabled) {
    const protocol = httpsEnabled ? 'https' : 'http';
    logger.info('Brasil RD Addon iniciado', {
        port,
        protocol,
        httpsEnabled
    });
}
function createServer(app, port) {
    const sslOptions = getSSLOptions();
    if (sslOptions) {
        const httpsServer = https_1.default.createServer(sslOptions, app);
        httpsServer.listen(port, '0.0.0.0', () => {
            logServerStart(port, true);
        });
        return httpsServer;
    }
    else {
        return app.listen(port, '0.0.0.0', () => {
            logServerStart(port, false);
        });
    }
}
