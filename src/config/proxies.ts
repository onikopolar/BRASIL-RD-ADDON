export interface ProxyConfig {
    host: string;
    port: number;
    protocol?: string;
    username?: string;
    password?: string;
}

export const proxyConfig: ProxyConfig[] = [
    {
        host: 'proxy.scraperapi.com',
        port: 8000,
        protocol: 'http',
        username: 'SUA_API_KEY',
        password: ''
    }
];

export const getRandomProxy = (): ProxyConfig | null => {
    if (proxyConfig.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * proxyConfig.length);
    return proxyConfig[randomIndex];
};
