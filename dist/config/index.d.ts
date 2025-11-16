export interface AppConfig {
    realDebrid: {
        apiKey: string;
        baseUrl: string;
        timeout: number;
    };
    stremio: {
        cacheMaxAge: number;
        streamTimeout: number;
    };
    curatedMagnets: {
        updateInterval: number;
        maxRetries: number;
    };
}
export declare const config: AppConfig;
