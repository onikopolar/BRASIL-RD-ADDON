export declare class SessionManager {
    private readonly sessions;
    private readonly logger;
    private readonly sessionCookieName;
    private readonly sessionMaxAge;
    constructor();
    /**
     * Cria ou recupera uma sessão baseada no request HTTP
     */
    getOrCreateSession(req: any, apiKey: string): string;
    /**
     * Obtém a API key para uma sessão
     */
    getApiKey(sessionId: string): string | null;
    /**
     * Extrai session ID do request
     */
    private extractSessionId;
    /**
     * Gera um novo session ID
     */
    private generateSessionId;
    /**
     * Métodos de segurança para logging
     */
    private maskId;
    private maskUserAgent;
    private maskIp;
    /**
     * Estatísticas
     */
    getStats(): any;
}
export declare const sessionManager: SessionManager;
