import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger.js';
import crypto from 'crypto';

const logger = new Logger('ULTRA-DEBUG');

// Redacta API keys de URLs antes de logar
function maskUrl(url: string): string {
  let masked = url.replace(/(\/torbox=)([a-f0-9-]{32,36})(\/|$)/gi, '$1***$3');
  masked = masked.replace(/([?&]token=)([^&\s]+)/gi, '$1***');
  return masked;
}

// Máscara valores sensíveis (API keys, tokens)
function maskSensitive(obj: any, depth: number = 0): any {
  if (depth > 3) return '[MAX_DEPTH]';
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

// Extrai preview de corpo de resposta (string ou objeto)
function getBodyPreview(body: any): string {
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    return str.length > 200 ? str.substring(0, 200) + '...' : str;
  } catch {
    return '';
  }
}

// Calcula tamanho do corpo de resposta
function getBodySize(body: any): number {
  try {
    return typeof body === 'string' ? body.length : JSON.stringify(body).length;
  } catch {
    return 0;
  }
}

// Log centralizado para respostas JSON/SEND
function logResponse(requestId: string, res: any, startTime: number, body: any, type: 'JSON' | 'SEND', shouldSkip: boolean): void {
  if (shouldSkip) return;
  const responseTime = Date.now() - startTime;
  const preview = maskUrl(getBodyPreview(body));
  const size = getBodySize(body);
  logger.debug(`◀ RESPONSE #${requestId} ${res.statusCode} (${responseTime}ms) ${type}`, { size, preview });
}

function generateRequestId(): string {
  return crypto.randomUUID().substring(0, 8);
}

export const ultraDebugMiddleware = () => {
  return (req: any, res: any, next: NextFunction) => {
    const requestId = generateRequestId();
    req._ultraDebugId = requestId;
    const startTime = Date.now();

    // Pula health checks e metrics
    const skipPaths = ['/health', '/metrics', '/favicon.ico', '/cache/status'];
    const shouldSkip = skipPaths.some(p => req.path === p || req.path.startsWith(p));

    if (!shouldSkip) {
      logger.debug(`▶ REQUEST #${requestId} ${req.method} ${maskUrl(req.path)}`, {
        ip: req.ip || req.connection?.remoteAddress || 'unknown',
        userAgent: req.headers['user-agent']?.substring(0, 120),
      });
    }

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const originalRedirect = res.redirect.bind(res);

    res.json = function (body: any) {
      logResponse(requestId, res, startTime, body, 'JSON', shouldSkip);
      return originalJson(body);
    };

    res.send = function (body: any) {
      logResponse(requestId, res, startTime, body, 'SEND', shouldSkip);
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
        logger.debug(`◀ RESPONSE #${requestId} ${statusCode} (${responseTime}ms) REDIRECT → ${maskUrl(redirectUrl)}`);
      }
      if (statusCode === 302) {
        return originalRedirect(redirectUrl);
      }
      return originalRedirect(statusCode, redirectUrl);
    };

    next();
  };
};

export const manifestDebugMiddleware = () => {
  return (req: any, res: any, next: NextFunction) => {
    const loggerManifest = new Logger('MANIFEST-DEBUG');
    loggerManifest.info(' MANIFEST SOLICITADO', {
      requestId: req._ultraDebugId,
      host: req.headers.host,
      userAgent: req.headers['user-agent']?.substring(0, 100),
    });
    next();
  };
};

export const configureDebugMiddleware = () => {
  return (req: any, res: any, next: NextFunction) => {
    const loggerCfg = new Logger('CONFIGURE-DEBUG');
    loggerCfg.info(' PÁGINA DE CONFIGURAÇÃO SOLICITADA', {
      requestId: req._ultraDebugId,
      host: req.headers.host,
      userAgent: req.headers['user-agent']?.substring(0, 100),
    });
    next();
  };
};