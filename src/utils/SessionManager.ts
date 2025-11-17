import { Logger } from './logger';

interface UserConfig {
    apiKey: string;
    userAgent: string;
    ip: string;
    createdAt: number;
    lastUsed: number;
    requestCount: number;
}

export class SessionManager {
    private readonly sessions: Map<string, UserConfig> = new Map();
    private readonly logger: Logger;
    private readonly sessionCookieName = 'brasilrd_session';
    private readonly sessionMaxAge = 30 * 24 * 60 * 60 * 1000; // 30 dias

    constructor() {
        this.logger = new Logger('SessionManager');
        this.logger.info('SessionManager initialized');
    }

    /**
     * Cria ou recupera uma sessão baseada no request HTTP
     */
    getOrCreateSession(req: any, apiKey: string): string {
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
    getApiKey(sessionId: string): string | null {
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
    private extractSessionId(req: any): string | null {
        // Tentar do cookie primeiro
        if (req.cookies && req.cookies[this.sessionCookieName]) {
            return req.cookies[this.sessionCookieName];
        }

        // Tentar do header
        if (req.headers['x-session-id']) {
            return req.headers['x-session-id'] as string;
        }

        return null;
    }

    /**
     * Gera um novo session ID
     */
    private generateSessionId(): string {
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
    }

    /**
     * Métodos de segurança para logging
     */
    private maskId(id: string): string {
        return id ? `${id.substring(0, 8)}...` : 'unknown';
    }

    private maskUserAgent(ua: string): string {
        if (!ua) return 'unknown';
        return ua.length > 50 ? `${ua.substring(0, 50)}...` : ua;
    }

    private maskIp(ip: string): string {
        if (!ip) return 'unknown';
        // Mask IP for privacy
        return ip.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/, '$1.$2.***.***');
    }

    /**
     * Estatísticas
     */
    getStats(): any {
        const now = Date.now();
        const activeSessions = Array.from(this.sessions.values()).filter(
            session => (now - session.lastUsed) < this.sessionMaxAge
        );

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
