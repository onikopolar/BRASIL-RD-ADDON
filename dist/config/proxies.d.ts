export interface ProxyConfig {
    host: string;
    port: number;
    protocol?: string;
    username?: string;
    password?: string;
}
export declare const proxyConfig: ProxyConfig[];
export declare const getRandomProxy: () => ProxyConfig | null;
