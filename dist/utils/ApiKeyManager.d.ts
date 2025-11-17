export declare class ApiKeyManager {
    private readonly sessions;
    private readonly logger;
    private readonly cleanupInterval;
    private readonly maxSessionAge;
    private readonly maxSessions;
    constructor();
    /**
     * Registra uma sessão de usuário com sua API key
     */
    registerSession(sessionId: string, apiKey: string, addonUrl: string): void;
    /**
     * Obtém a API key para uma requisição específica
     */
    getApiKeyForRequest(args: any): string | null;
    /**
     * Extrai session ID dos argumentos do Stremio
     */
    private extractSessionId;
    /**
     * Gera um session ID único a partir de uma string
     */
    private generateSessionId;
    /**
     * Limpa sessões antigas
     */
    private cleanupOldSessions;
    /**
     * Inicia timer de cleanup automático
     */
    private startCleanupTimer;
    /**
     * Métodos de segurança para logging
     */
    private maskSessionId;
    private maskApiKey;
    private maskUrl;
    /**
     * Estatísticas do gerenciador
     */
    getStats(): any;
    /**
     * Limpa todas as sessões (para testes/reset)
     */
    clearAllSessions(): void;
}
export declare const apiKeyManager: ApiKeyManager;
