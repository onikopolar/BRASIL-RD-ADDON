import { Logger } from './logger.js';

interface UserSession {
    apiKey: string;
    addonUrl: string;
    createdAt: number;
    lastUsed: number;
    requestCount: number;
}

export class ApiKeyManager {
    private readonly sessions: Map<string, UserSession> = new Map();
    private readonly logger: Logger;
    private readonly cleanupInterval: number = 30 * 60 * 1000; // 30 minutos
    private readonly maxSessionAge: number = 24 * 60 * 60 * 1000; // 24 horas
    private readonly maxSessions: number = 1000;

    constructor() {
        this.logger = new Logger('ApiKeyManager');
        this.startCleanupTimer();
        this.logger.info('ApiKeyManager initialized', {
            maxSessions: this.maxSessions,
            maxSessionAge: `${this.maxSessionAge / 3600000}h`,
            cleanupInterval: `${this.cleanupInterval / 60000}min`
        });
    }

    /**
     * Registra uma sessão de usuário com sua API key
     */
    registerSession(sessionId: string, apiKey: string, addonUrl: string): void {
        const now = Date.now();
        
        const session: UserSession = {
            apiKey,
            addonUrl,
            createdAt: now,
            lastUsed: now,
            requestCount: 0
        };

        this.sessions.set(sessionId, session);

        this.logger.debug('Nova sessão registrada', {
            sessionId: this.maskSessionId(sessionId),
            addonUrl: this.maskUrl(addonUrl),
            apiKey: this.maskApiKey(apiKey),
            totalSessions: this.sessions.size
        });

        // Limitar número máximo de sessões
        if (this.sessions.size > this.maxSessions) {
            this.cleanupOldSessions(true);
        }
    }

    /**
     * Obtém a API key para uma requisição específica
     */
    getApiKeyForRequest(args: any): string | null {
        const sessionId = this.extractSessionId(args);
        if (!sessionId) {
            return null;
        }

        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }

        // Atualizar uso
        session.lastUsed = Date.now();
        session.requestCount++;

        this.logger.debug('API key recuperada para requisição', {
            sessionId: this.maskSessionId(sessionId),
            requestCount: session.requestCount,
            type: args.type,
            id: args.id
        });

        return session.apiKey;
    }

    /**
     * Extrai session ID dos argumentos do Stremio
     */
    private extractSessionId(args: any): string | null {
        // Método 1: Do addonUrl (se disponível)
        if (args.extra?.addonUrl) {
            return this.generateSessionId(args.extra.addonUrl);
        }

        // Método 2: Da combinação de informações únicas da requisição
        // Usamos um hash do user agent + IP (se disponível) + addon identifier
        const requestFingerprint = [
            args.extra?.userAgent,
            args.extra?.ip,
            args.id,
            args.type
        ].filter(Boolean).join('|');

        if (requestFingerprint) {
            return this.generateSessionId(requestFingerprint);
        }

        return null;
    }

    /**
     * Gera um session ID único a partir de uma string
     */
    private generateSessionId(input: string): string {
        // Hash simples para criar session ID
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `session_${Math.abs(hash).toString(16)}`;
    }

    /**
     * Limpa sessões antigas
     */
    private cleanupOldSessions(force: boolean = false): void {
        const now = Date.now();
        let removedCount = 0;

        for (const [sessionId, session] of this.sessions.entries()) {
            const sessionAge = now - session.lastUsed;
            
            if (sessionAge > this.maxSessionAge) {
                this.sessions.delete(sessionId);
                removedCount++;

                this.logger.debug('Sessão expirada removida', {
                    sessionId: this.maskSessionId(sessionId),
                    age: `${sessionAge / 3600000}h`,
                    requestCount: session.requestCount
                });
            }
        }

        if (removedCount > 0 || force) {
            this.logger.info('Cleanup de sessões concluído', {
                removedCount,
                remainingSessions: this.sessions.size,
                forced: force
            });
        }
    }

    /**
     * Inicia timer de cleanup automático
     */
    private startCleanupTimer(): void {
        setInterval(() => {
            this.cleanupOldSessions();
        }, this.cleanupInterval);
    }

    /**
     * Métodos de segurança para logging
     */
    private maskSessionId(sessionId: string): string {
        return sessionId ? `${sessionId.substring(0, 8)}...` : 'unknown';
    }

    private maskApiKey(apiKey: string): string {
        return apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'unknown';
    }

    private maskUrl(url: string): string {
        if (!url) return 'unknown';
        
        try {
            const urlObj = new URL(url);
            // Mantém apenas o hostname e caminho, remove query params sensíveis
            return `${urlObj.origin}${urlObj.pathname}?***`;
        } catch {
            return 'invalid_url';
        }
    }

    /**
     * Estatísticas do gerenciador
     */
    getStats(): any {
        const now = Date.now();
        const activeSessions = Array.from(this.sessions.values()).filter(
            session => (now - session.lastUsed) < this.maxSessionAge
        );

        return {
            totalSessions: this.sessions.size,
            activeSessions: activeSessions.length,
            maxSessions: this.maxSessions,
            maxSessionAge: this.maxSessionAge,
            averageRequestsPerSession: activeSessions.length > 0 
                ? activeSessions.reduce((sum, session) => sum + session.requestCount, 0) / activeSessions.length 
                : 0,
            memoryUsage: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`
        };
    }

    /**
     * Limpa todas as sessões (para testes/reset)
     */
    clearAllSessions(): void {
        const count = this.sessions.size;
        this.sessions.clear();
        this.logger.info('Todas as sessões removidas', { removedCount: count });
    }
}

// Singleton global
export const apiKeyManager = new ApiKeyManager();
