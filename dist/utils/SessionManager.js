import { Logger } from './logger';
export class SessionManager {
    constructor() {
        this.sessions = new Map();
        this.sessionCookieName = 'brasilrd_session';
        this.sessionMaxAge = 30 * 24 * 60 * 60 * 1000;
        this.logger = new Logger('SessionManager');
        this.logger.info('SessionManager initialized');
    }
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
    getApiKey(sessionId) {
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }
        session.lastUsed = Date.now();
        session.requestCount++;
        return session.apiKey;
    }
    extractSessionId(req) {
        if (req.cookies && req.cookies[this.sessionCookieName]) {
            return req.cookies[this.sessionCookieName];
        }
        if (req.headers['x-session-id']) {
            return req.headers['x-session-id'];
        }
        return null;
    }
    generateSessionId() {
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
    }
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
        return ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.***.***');
    }
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
export const sessionManager = new SessionManager();
