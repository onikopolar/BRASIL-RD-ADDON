import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger';
import crypto from 'crypto';

const logger = new Logger('ULTRA-DEBUG');

// Máscara valores sensíveis (API keys, tokens)
function maskSensitive(obj: any, depth: number = 0): any {
    if (depth > 5) return '[MAX_DEPTH]';
    if (!obj || typeof obj !== 'object') {
        if (typeof obj === 'string' && obj.length > 30) {
            return obj.substring(0, 8) + '...' + obj.substring(obj.length - 8);
        }
        return obj;
    }
    if (Array.isArray(obj)) return obj.map((i: any) => maskSensitive(i, depth + 1));
    const masked: any = {};
    for (const [k, v] of Object.entries(obj)) {
        const keyLower = k.toLowerCase();
        if (['apikey', 'api_key', 'token', 'authorization', 'password', 'secret', 'rd_key', 'torbox'].some(s => keyLower.includes(s))) {
            masked[k] = typeof v === 'string' ? (v.substring(0, 4) + '***MASKED***' + v.substring(v.length - 4)) : '***MASKED***';
        } else {
            masked[k] = maskSensitive(v, depth + 1);
        }
    }
    return masked;
}

// Pega headers relevantes
function getRelevantHeaders(req: Request): Record<string, string> {
    const relevant = [
        'host', 'origin', 'referer', 'user-agent',
        'content-type', 'accept', 'x-forwarded-for',
        'x-real-ip', 'x-request-id', 'cf-connecting-ip',
        'cf-ray', 'x-forwarded-proto', 'authorization',
        'cookie', 'stremio-addon-collection'
    ];
    const headers: Record<string, string> = {};
    for (const h of relevant) {
        const val = req.headers[h];
        if (val) {
            const valStr = Array.isArray(val) ? val.join(', ') : val;
            headers[h] = h === 'authorization' || h === 'cookie'
                ? valStr.substring(0, 15) + '***MASKED***'
                : valStr.substring(0, 150);
        }
    }
    return headers;
}

// Gera ID único por request
function generateRequestId(): string {
    return crypto.randomUUID().substring(0, 8);
}

export const ultraDebugMiddleware = () => {
    return (req: any, res: any, next: NextFunction) => {
        const requestId = generateRequestId();
        req._ultraDebugId = requestId;
        const startTime = Date.now();

        // Pula health checks e metrics para não poluir
        const skipPaths = ['/health', '/metrics', '/favicon.ico', '/cache/status'];
        const shouldSkip = skipPaths.some(p => req.path === p || req.path.startsWith(p));

        if (!shouldSkip) {
            // ═══════════════════════════════════════════
            // LOG DE ENTRADA - REQUEST COMPLETO
            // ═══════════════════════════════════════════
            const entryLog = {
                requestId,
                timestamp: new Date().toISOString(),
                method: req.method,
                fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
                path: req.path,
                query: maskSensitive(req.query),
                params: maskSensitive(req.params),
                headers: getRelevantHeaders(req),
                ip: req.ip || req.connection?.remoteAddress || 'unknown',
                clientInfo: (req as any)._clientInfo || null,
                body: req.body && Object.keys(req.body).length > 0 ? maskSensitive(req.body) : undefined,
            };

            logger.info(`▶ REQUEST #${requestId} ${req.method} ${req.path}`, entryLog);
        }

        // ═══════════════════════════════════════════
        // Intercepta a resposta para log de saída
        // ═══════════════════════════════════════════
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);
        const originalRedirect = res.redirect.bind(res);
        const originalEnd = res.end.bind(res);

        res.json = function (body: any) {
            const responseTime = Date.now() - startTime;
            if (!shouldSkip) {
                const bodyStr = JSON.stringify(body);
                const truncated = bodyStr.length > 500 ? bodyStr.substring(0, 500) + `... [TRUNCATED ${bodyStr.length} chars]` : bodyStr;
                logger.info(`◀ RESPONSE #${requestId} ${res.statusCode} (${responseTime}ms) JSON`, {
                    requestId,
                    statusCode: res.statusCode,
                    responseTimeMs: responseTime,
                    path: req.path,
                    bodySize: bodyStr.length,
                    bodyPreview: truncated,
                    headers: res.getHeaders ? {
                        'content-type': res.getHeader('content-type'),
                        'content-length': res.getHeader('content-length'),
                        'cache-control': res.getHeader('cache-control'),
                        'access-control-allow-origin': res.getHeader('access-control-allow-origin'),
                    } : undefined,
                });
            }
            return originalJson(body);
        };

        res.send = function (body: any) {
            const responseTime = Date.now() - startTime;
            if (!shouldSkip) {
                const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
                const truncated = bodyStr.length > 300 ? bodyStr.substring(0, 300) + `... [${bodyStr.length} chars]` : bodyStr;
                logger.info(`◀ RESPONSE #${requestId} ${res.statusCode} (${responseTime}ms) SEND`, {
                    requestId,
                    statusCode: res.statusCode,
                    responseTimeMs: responseTime,
                    path: req.path,
                    contentType: res.getHeader('content-type'),
                    bodyPreview: truncated,
                });
            }
            return originalSend(body);
        };

        res.redirect = function (url: string | number, statusOrUrl?: string | number) {
            const responseTime = Date.now() - startTime;
            let redirectUrl: string;
            let statusCode: number;
            if (typeof url === 'number') {
                statusCode = url;
                redirectUrl = String(statusOrUrl || '');
            } else {
                statusCode = typeof statusOrUrl === 'number' ? statusOrUrl : 302;
                redirectUrl = url;
            }
            if (!shouldSkip) {
                logger.info(`◀ RESPONSE #${requestId} ${statusCode} (${responseTime}ms) REDIRECT → ${redirectUrl}`, {
                    requestId,
                    statusCode,
                    responseTimeMs: responseTime,
                    path: req.path,
                    redirectTo: redirectUrl,
                });
            }
            if (statusCode === 302) {
                return originalRedirect(redirectUrl);
            }
            return originalRedirect(statusCode, redirectUrl);
        };

        next();
    };
};

// ═══════════════════════════════════════════
// Middleware específico para logar MANIFEST
// ═══════════════════════════════════════════
export const manifestDebugMiddleware = () => {
    return (req: any, res: any, next: NextFunction) => {
        const loggerManifest = new Logger('MANIFEST-DEBUG');

        loggerManifest.info('═══════════════════════════════════════', {});
        loggerManifest.info(' MANIFEST SOLICITADO', {
            requestId: req._ultraDebugId,
            method: req.method,
            fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            path: req.path,
            headers: {
                host: req.headers.host,
                origin: req.headers.origin,
                referer: req.headers.referer,
                'user-agent': req.headers['user-agent']?.substring(0, 100),
                'stremio-addon-collection': req.headers['stremio-addon-collection'],
            },
            params: req.params,
            query: req.query,
            clientInfo: (req as any)._clientInfo,
        });
        loggerManifest.info(' CONFIGURATION REQUIRED:', false);
        loggerManifest.info(' COMPORTAMENTO: Addon será detectado automaticamente pelo Stremio Web (configurationRequired: false)');
        loggerManifest.info('═══════════════════════════════════════', {});

        next();
    };
};

// ═══════════════════════════════════════════
// Middleware para logar CONFIGURE
// ═══════════════════════════════════════════
export const configureDebugMiddleware = () => {
    return (req: any, res: any, next: NextFunction) => {
        const loggerCfg = new Logger('CONFIGURE-DEBUG');

        loggerCfg.info('═══════════════════════════════════════', {});
        loggerCfg.info(' PÁGINA DE CONFIGURAÇÃO SOLICITADA', {
            requestId: req._ultraDebugId,
            method: req.method,
            fullUrl: `${req.protocol}://${req.get('host')}${req.originalUrl}`,
            headers: {
                host: req.headers.host,
                origin: req.headers.origin,
                referer: req.headers.referer,
                'user-agent': req.headers['user-agent']?.substring(0, 100),
            },
        });
        loggerCfg.info(' A página configure gera link stremio:// com a API Key do usuário');
        loggerCfg.info(' Sistema Torrentio-style: torbox=API_KEY na URL');
        loggerCfg.info('═══════════════════════════════════════', {});

        next();
    };
};
