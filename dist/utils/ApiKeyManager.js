"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyManager = exports.ApiKeyManager = void 0;
const logger_1 = require("./logger");
class ApiKeyManager {
    constructor() {
        this.sessions = new Map();
        this.cleanupInterval = 30 * 60 * 1000;
        this.maxSessionAge = 24 * 60 * 60 * 1000;
        this.maxSessions = 1000;
        this.logger = new logger_1.Logger('ApiKeyManager');
        this.startCleanupTimer();
        this.logger.info('ApiKeyManager initialized', {
            maxSessions: this.maxSessions,
            maxSessionAge: `${this.maxSessionAge / 3600000}h`,
            cleanupInterval: `${this.cleanupInterval / 60000}min`
        });
    }
    registerSession(sessionId, apiKey, addonUrl) {
        const now = Date.now();
        const session = {
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
        if (this.sessions.size > this.maxSessions) {
            this.cleanupOldSessions(true);
        }
    }
    getApiKeyForRequest(args) {
        const sessionId = this.extractSessionId(args);
        if (!sessionId) {
            return null;
        }
        const session = this.sessions.get(sessionId);
        if (!session) {
            return null;
        }
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
    extractSessionId(args) {
        if (args.extra?.addonUrl) {
            return this.generateSessionId(args.extra.addonUrl);
        }
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
    generateSessionId(input) {
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return `session_${Math.abs(hash).toString(16)}`;
    }
    cleanupOldSessions(force = false) {
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
    startCleanupTimer() {
        setInterval(() => {
            this.cleanupOldSessions();
        }, this.cleanupInterval);
    }
    maskSessionId(sessionId) {
        return sessionId ? `${sessionId.substring(0, 8)}...` : 'unknown';
    }
    maskApiKey(apiKey) {
        return apiKey ? `${apiKey.substring(0, 8)}...${apiKey.substring(apiKey.length - 4)}` : 'unknown';
    }
    maskUrl(url) {
        if (!url)
            return 'unknown';
        try {
            const urlObj = new URL(url);
            return `${urlObj.origin}${urlObj.pathname}?***`;
        }
        catch {
            return 'invalid_url';
        }
    }
    getStats() {
        const now = Date.now();
        const activeSessions = Array.from(this.sessions.values()).filter(session => (now - session.lastUsed) < this.maxSessionAge);
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
    clearAllSessions() {
        const count = this.sessions.size;
        this.sessions.clear();
        this.logger.info('Todas as sessões removidas', { removedCount: count });
    }
}
exports.ApiKeyManager = ApiKeyManager;
exports.apiKeyManager = new ApiKeyManager();
