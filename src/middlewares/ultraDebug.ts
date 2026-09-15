import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/logger.js';
import crypto from 'crypto';
import { extrairIp } from './clientInfo.js';

const logger = new Logger('ULTRA-DEBUG');
const manifestLogger = new Logger('MANIFEST-DEBUG');
const configureLogger = new Logger('CONFIGURE-DEBUG');

const SKIP_PATHS = ['/health', '/metrics', '/favicon.ico', '/cache/status'];

const SENSITIVE_KEY_PATTERNS = [
  'apikey', 'api_key', 'token', 'authorization', 'password', 'secret', 'rd_key', 'torbox',
];

// Módulo: helpers puros, sem estado.

function maskUrl(url: string): string {
  let masked = url.replace(/(\/torbox=)([a-f0-9-]{32,36})(\/|$)/gi, '$1***$3');
  masked = masked.replace(/([?&]token=)([^&\s]+)/gi, '$1***');
  return masked;
}

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
    if (SENSITIVE_KEY_PATTERNS.some(s => keyLower.includes(s))) {
      masked[k] = typeof v === 'string'
        ? v.substring(0, 4) + '***MASKED***' + v.substring(v.length - 4)
        : '***MASKED***';
    } else {
      masked[k] = maskSensitive(v, depth + 1);
    }
  }
  return masked;
}

function getBodyPreview(body: any): string {
  try {
    const str = typeof body === 'string' ? body : JSON.stringify(body);
    return str.length > 200 ? str.substring(0, 200) + '...' : str;
  } catch {
    return '';
  }
}

function getBodySize(body: any): number {
  try {
    return typeof body === 'string' ? body.length : JSON.stringify(body).length;
  } catch {
    return 0;
  }
}

function shouldSkipPath(path: string): boolean {
  return SKIP_PATHS.some(p => path === p || path.startsWith(p));
}

function generateRequestId(): string {
  return crypto.randomUUID().substring(0, 8);
}

// Logger interno: aceita a linha e o campo extra, respeita o skip.
function logResponse(
  requestId: string,
  res: any,
  startTime: number,
  body: any,
  type: 'JSON' | 'SEND',
  shouldSkip: boolean,
): void {
  if (shouldSkip) return;
  const responseTime = Date.now() - startTime;
  const preview = maskUrl(getBodyPreview(body));
  const size = getBodySize(body);
  logger.debug(`◀ RESPONSE #${requestId} ${res.statusCode} (${responseTime}ms) ${type}`, { size, preview });
}

// Fábrica única para os middlewares de log informativo (manifest/configure).
function createInfoMiddleware(log: Logger, mensagem: string) {
  return (req: any, _res: any, next: NextFunction) => {
    log.info(mensagem, {
      requestId: req._ultraDebugId,
      host: req.headers.host,
      userAgent: req.headers['user-agent']?.substring(0, 100),
    });
    next();
  };
}

export const ultraDebugMiddleware = () => {
  return (req: any, res: any, next: NextFunction) => {
    const requestId = generateRequestId();
    req._ultraDebugId = requestId;
    const startTime = Date.now();

    const shouldSkip = shouldSkipPath(req.path);

    if (!shouldSkip) {
      const { ip, source } = extrairIp(req);
      logger.debug(`▶ REQUEST #${requestId} ${req.method} ${maskUrl(req.path)}`, {
        ip,
        ipSource: source,
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
      const isStatusFirst = typeof url === 'number';
      const statusCode = isStatusFirst
        ? url
        : (typeof statusOrUrl === 'number' ? statusOrUrl : 302);
      const redirectUrl = isStatusFirst ? String(statusOrUrl || '') : url;

      if (!shouldSkip) {
        logger.debug(`◀ RESPONSE #${requestId} ${statusCode} (${responseTime}ms) REDIRECT → ${maskUrl(redirectUrl)}`);
      }

      if (isStatusFirst) return originalRedirect(statusCode, redirectUrl);
      return originalRedirect(redirectUrl);
    };

    next();
  };
};

export const manifestDebugMiddleware = () =>
  createInfoMiddleware(manifestLogger, ' MANIFEST SOLICITADO');

export const configureDebugMiddleware = () =>
  createInfoMiddleware(configureLogger, ' PÁGINA DE CONFIGURAÇÃO SOLICITADA');