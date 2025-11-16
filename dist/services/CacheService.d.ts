export declare class CacheService {
    private cache;
    private logger;
    constructor();
    set<T>(key: string, data: T, ttl?: number): void;
    get<T>(key: string): T | null;
    delete(key: string): boolean;
    clear(): void;
    private startCleanupInterval;
    getStats(): {
        size: number;
        keys: string[];
    };
}
