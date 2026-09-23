"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.etagMiddleware = etagMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const logger_js_1 = require("../utils/logger.js");
const logger = new logger_js_1.Logger('ETag');
function etagMiddleware(options = {}) {
    const { excludePaths = [], defaultMaxAge } = options;
    return (req, res, next) => {
        if (req.method !== 'GET')
            return next();
        const path = req.path || req.url?.split('?')[0] || '';
        if (excludePaths.some(p => path.startsWith(p)))
            return next();
        const chunks = [];
        let bodyCaptured = false;
        let statusCode = 200;
        let contentType = '';
        const originalWrite = res.write.bind(res);
        const originalEnd = res.end.bind(res);
        const originalSetHeader = res.setHeader.bind(res);
        const originalGetHeader = res.getHeader.bind(res);
        const originalStatus = res.status.bind(res);
        res.status = function (code) {
            statusCode = code;
            return originalStatus(code);
        };
        res.write = function (chunk, encoding, cb) {
            if (chunk) {
                bodyCaptured = true;
                if (typeof chunk === 'string') {
                    chunks.push(Buffer.from(chunk, encoding || 'utf-8'));
                }
                else if (Buffer.isBuffer(chunk)) {
                    chunks.push(chunk);
                }
            }
            return originalWrite(chunk, encoding, cb);
        };
        res.end = function (chunk, encoding, cb) {
            if (chunk) {
                bodyCaptured = true;
                if (typeof chunk === 'string') {
                    chunks.push(Buffer.from(chunk, encoding || 'utf-8'));
                }
                else if (Buffer.isBuffer(chunk)) {
                    chunks.push(chunk);
                }
            }
            const cacheControl = originalGetHeader('Cache-Control') || '';
            const isNoStore = /no-store/.test(cacheControl);
            if (res.headersSent || statusCode >= 300 || !bodyCaptured || isNoStore || chunks.length === 0) {
                return originalEnd.call(res, chunk, encoding, cb);
            }
            const body = Buffer.concat(chunks);
            const etag = crypto_1.default.createHash('sha256').update(body).digest('hex').substring(0, 16);
            const etagQuoted = `"${etag}"`;
            const ifNoneMatch = req.headers['if-none-match'];
            if (ifNoneMatch === etagQuoted || ifNoneMatch === etag) {
                logger.debug(`304 ${path}`, { etag: etagQuoted.substring(0, 10), size: body.length });
                res.statusCode = 304;
                res.setHeader('ETag', etagQuoted);
                res.removeHeader('Content-Type');
                res.removeHeader('Content-Length');
                res.removeHeader('Content-Encoding');
                res.removeHeader('Transfer-Encoding');
                return originalEnd.call(res);
            }
            res.setHeader('ETag', etagQuoted);
            if (defaultMaxAge && !originalGetHeader('Cache-Control')) {
                res.setHeader('Cache-Control', `max-age=${defaultMaxAge}, public, must-revalidate`);
            }
            logger.debug(`200 ${path}`, { etag: etagQuoted.substring(0, 10), size: body.length });
            return originalEnd.call(res, chunk, encoding, cb);
        };
        next();
    };
}
