"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureDebugMiddleware = exports.manifestDebugMiddleware = exports.ultraDebugMiddleware = void 0;
const logger_js_1 = require("../utils/logger.js");
const crypto_1 = __importDefault(require("crypto"));
const clientInfo_js_1 = require("./clientInfo.js");
const logger = new logger_js_1.Logger('ULTRA-DEBUG');
const manifestLogger = new logger_js_1.Logger('MANIFEST-DEBUG');
const configureLogger = new logger_js_1.Logger('CONFIGURE-DEBUG');
const SKIP_PATHS = ['/health', '/metrics', '/favicon.ico', '/cache/status'];
const SENSITIVE_KEY_PATTERNS = [
    'apikey', 'api_key', 'token', 'authorization', 'password', 'secret', 'rd_key', 'torbox',
];
function maskUrl(url) {
    let masked = url.replace(/(\/torbox=)([a-f0-9-]{32,36})(\/|$)/gi, '$1***$3');
    masked = masked.replace(/([?&]token=)([^&\s]+)/gi, '$1***');
    return masked;
}
function maskSensitive(obj, depth = 0) {
    if (depth > 3)
        return '[MAX_DEPTH]';
    if (!obj || typeof obj !== 'object') {
        if (typeof obj === 'string' && obj.length > 30) {
            return obj.substring(0, 8) + '...' + obj.substring(obj.length - 8);
        }
        return obj;
    }
    if (Array.isArray(obj))
        return obj.map((i) => maskSensitive(i, depth + 1));
    const masked = {};
    for (const [k, v] of Object.entries(obj)) {
        const keyLower = k.toLowerCase();
        if (SENSITIVE_KEY_PATTERNS.some(s => keyLower.includes(s))) {
            masked[k] = typeof v === 'string'
                ? v.substring(0, 4) + '***MASKED***' + v.substring(v.length - 4)
                : '***MASKED***';
        }
        else {
            masked[k] = maskSensitive(v, depth + 1);
        }
    }
    return masked;
}
function getBodyPreview(body) {
    try {
        const str = typeof body === 'string' ? body : JSON.stringify(body);
        return str.length > 200 ? str.substring(0, 200) + '...' : str;
    }
    catch {
        return '';
    }
}
function getBodySize(body) {
    try {
        return typeof body === 'string' ? body.length : JSON.stringify(body).length;
    }
    catch {
        return 0;
    }
}
function shouldSkipPath(path) {
    return SKIP_PATHS.some(p => path === p || path.startsWith(p));
}
function generateRequestId() {
    return crypto_1.default.randomUUID().substring(0, 8);
}
function logResponse(requestId, res, startTime, body, type, shouldSkip) {
    if (shouldSkip)
        return;
    const responseTime = Date.now() - startTime;
    const preview = maskUrl(getBodyPreview(body));
    const size = getBodySize(body);
    logger.debug(`◀ RESPONSE #${requestId} ${res.statusCode} (${responseTime}ms) ${type}`, { size, preview });
}
function createInfoMiddleware(log, mensagem) {
    return (req, _res, next) => {
        log.info(mensagem, {
            requestId: req._ultraDebugId,
            host: req.headers.host,
            userAgent: req.headers['user-agent']?.substring(0, 100),
        });
        next();
    };
}
const ultraDebugMiddleware = () => {
    return (req, res, next) => {
        const requestId = generateRequestId();
        req._ultraDebugId = requestId;
        const startTime = Date.now();
        const shouldSkip = shouldSkipPath(req.path);
        if (!shouldSkip) {
            const { ip, source } = (0, clientInfo_js_1.extrairIp)(req);
            logger.debug(`▶ REQUEST #${requestId} ${req.method} ${maskUrl(req.path)}`, {
                ip,
                ipSource: source,
                userAgent: req.headers['user-agent']?.substring(0, 120),
            });
        }
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        const originalRedirect = res.redirect.bind(res);
        res.json = function (body) {
            logResponse(requestId, res, startTime, body, 'JSON', shouldSkip);
            return originalJson(body);
        };
        res.send = function (body) {
            logResponse(requestId, res, startTime, body, 'SEND', shouldSkip);
            return originalSend(body);
        };
        res.redirect = function (url, statusOrUrl) {
            const responseTime = Date.now() - startTime;
            const isStatusFirst = typeof url === 'number';
            const statusCode = isStatusFirst
                ? url
                : (typeof statusOrUrl === 'number' ? statusOrUrl : 302);
            const redirectUrl = isStatusFirst ? String(statusOrUrl || '') : url;
            if (!shouldSkip) {
                logger.debug(`◀ RESPONSE #${requestId} ${statusCode} (${responseTime}ms) REDIRECT → ${maskUrl(redirectUrl)}`);
            }
            if (isStatusFirst)
                return originalRedirect(statusCode, redirectUrl);
            return originalRedirect(redirectUrl);
        };
        next();
    };
};
exports.ultraDebugMiddleware = ultraDebugMiddleware;
const manifestDebugMiddleware = () => createInfoMiddleware(manifestLogger, ' MANIFEST SOLICITADO');
exports.manifestDebugMiddleware = manifestDebugMiddleware;
const configureDebugMiddleware = () => createInfoMiddleware(configureLogger, ' PÁGINA DE CONFIGURAÇÃO SOLICITADA');
exports.configureDebugMiddleware = configureDebugMiddleware;
