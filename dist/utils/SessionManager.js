"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessionManager = exports.SessionManager = void 0;
const logger_1 = require("./logger");
class SessionManager {
    sessions = new Map();
    logger;
    sessionCookieName = 'brasilrd_session';
    sessionMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 dias
    constructor() {
        this.logger = new logger_1.Logger('SessionManager');
        this.logger.info('SessionManager initialized');
    }
    /**
     * Cria ou recupera uma sessão baseada no request HTTP
     */
    getOrCreateSession(req, apiKey) {
        const sessionId = this.extractSessionId(req) || this.generateSessionId();
        const userAgent = req.get('User-Agent') || 'unknown';
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        if (!this.sessions.has(sessionId)) {
            this.sessions.set(sessionId, {
                apiKey,
                userAgent,
                ip,
                createdAt: Date.now(),
                lastUsed: Date.now(),
                requestCount: 0
            });
            this.logger.info('Nova sessão criada', {
                sessionId: this.maskId(sessionId),
                userAgent: this.maskUserAgent(userAgent),
                ip: this.maskIp(ip),
                totalSessions: this.sessions.size
            });
        }
        return sessionId;
    }
    /**
     * Obtém a API key para uma sessão
     */
    getApiKey(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }
        session.lastUsed = Date.now();
        session.requestCount++;
        return session.apiKey;
    }
    /**
     * Extrai session ID do request
     */
    extractSessionId(req) {
        // Tentar do cookie primeiro
        if (req.cookies && req.cookies[this.sessionCookieName]) {
            return req.cookies[this.sessionCookieName];
        }
        // Tentar do header
        if (req.headers['x-session-id']) {
            return req.headers['x-session-id'];
        }
        return null;
    }
    /**
     * Gera um novo session ID
     */
    generateSessionId() {
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
    }
    /**
     * Métodos de segurança para logging
     */
    maskId(id) {
        return id ? `${id.substring(0, 8)}...` : 'unknown';
    }
    maskUserAgent(ua) {
        if (!ua)
            return 'unknown';
        return ua.length > 50 ? `${ua.substring(0, 50)}...` : ua;
    }
    maskIp(ip) {
        if (!ip)
            return 'unknown';
        // Mask IP for privacy
        return ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.***.***');
    }
    /**
     * Estatísticas
     */
    getStats() {
        const now = Date.now();
        const activeSessions = Array.from(this.sessions.values()).filter(session => (now - session.lastUsed) < this.sessionMaxAge);
        return {
            totalSessions: this.sessions.size,
            activeSessions: activeSessions.length,
            averageRequests: activeSessions.length > 0
                ? activeSessions.reduce((sum, session) => sum + session.requestCount, 0) / activeSessions.length
                : 0
        };
    }
}
exports.SessionManager = SessionManager;
exports.sessionManager = new SessionManager();
//# sourceMappingURL=SessionManager.js.map