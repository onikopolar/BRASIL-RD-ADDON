import crypto from 'crypto';
import { Logger } from '../utils/logger.js';

const logger = new Logger('ETag');

/**
 * Middleware de ETag inteligente:
 * - Intercepta res.json()/res.send()/res.end() para capturar o body
 * - Calcula hash SHA256 → ETag forte
 * - Se If-None-Match bater, retorna 304 Not Modified (economia de banda)
 * - Pula streaming (Transfer-Encoding: chunked), redirects (3xx), e empty responses
 * - Respeita Cache-Control já definido (não sobrescreve)
 * 
 * Uso: app.use(etagMiddleware({ excludePaths: ['/resolve'] }))
 */
export interface EtagOptions {
  /** Prefixos de path que NÃO devem receber ETag (ex: streaming, SSE) */
  excludePaths?: string[];
  /** Cache-Control padrão se a rota não definir o próprio */
  defaultMaxAge?: number;
}

export function etagMiddleware(options: EtagOptions = {}) {
  const { excludePaths = [], defaultMaxAge } = options;

  return (req: any, res: any, next: () => void) => {
    // Só GET
    if (req.method !== 'GET') return next();

    // Skip paths excluídos
    const path = req.path || req.url?.split('?')[0] || '';
    if (excludePaths.some(p => path.startsWith(p))) return next();

    // ── Intercepta métodos de resposta ──
    const chunks: Buffer[] = [];
    let bodyCaptured = false;
    let statusCode = 200;
    let contentType = '';

    const originalWrite = res.write.bind(res);
    const originalEnd = res.end.bind(res);
    const originalSetHeader = res.setHeader.bind(res);
    const originalGetHeader = res.getHeader.bind(res);
    const originalStatus = res.status.bind(res);

    // Track status code
    res.status = function(code: number) {
      statusCode = code;
      return originalStatus(code);
    };

    // Intercepta write (streaming/chunks)
    res.write = function(chunk: any, encoding?: any, cb?: any) {
      if (chunk) {
        bodyCaptured = true;
        if (typeof chunk === 'string') {
          chunks.push(Buffer.from(chunk, encoding || 'utf-8'));
        } else if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
      }
      return originalWrite(chunk, encoding, cb);
    };

    // Intercepta end — aqui calculamos ETag
    res.end = function(chunk?: any, encoding?: any, cb?: any) {
      // Captura chunk final
      if (chunk) {
        bodyCaptured = true;
        if (typeof chunk === 'string') {
          chunks.push(Buffer.from(chunk, encoding || 'utf-8'));
        } else if (Buffer.isBuffer(chunk)) {
          chunks.push(chunk);
        }
      }

      // Não aplica ETag em:
      // - Respostas já enviadas (headersSent)
      // - Redirects (3xx)
      // - Sem body capturado (pode ser streaming)
      // - Respostas com no-store (resolve)
      const cacheControl = originalGetHeader('Cache-Control') as string || '';
      const isNoStore = /no-store/.test(cacheControl);

      if (res.headersSent || statusCode >= 300 || !bodyCaptured || isNoStore || chunks.length === 0) {
        return originalEnd.call(res, chunk, encoding, cb);
      }

      // ── Computa ETag ──
      const body = Buffer.concat(chunks);
      const etag = crypto.createHash('sha256').update(body).digest('hex').substring(0, 16);
      const etagQuoted = `"${etag}"`;

      // ── Verifica If-None-Match ──
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etagQuoted || ifNoneMatch === etag) {
        // 304 Not Modified — não reenvia o body
        logger.debug(`304 ${path}`, { etag: etagQuoted.substring(0, 10), size: body.length });

        // Limpa headers de conteúdo (304 não deve ter body)
        res.statusCode = 304;
        res.setHeader('ETag', etagQuoted);
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Length');
        res.removeHeader('Content-Encoding');
        res.removeHeader('Transfer-Encoding');

        return originalEnd.call(res);
      }

      // ── Set ETag header ──
      res.setHeader('ETag', etagQuoted);

      // Cache-Control padrão se não definido
      if (defaultMaxAge && !originalGetHeader('Cache-Control')) {
        res.setHeader('Cache-Control', `max-age=${defaultMaxAge}, public, must-revalidate`);
      }

      logger.debug(`200 ${path}`, { etag: etagQuoted.substring(0, 10), size: body.length });
      return originalEnd.call(res, chunk, encoding, cb);
    };

    next();
  };
}
