export const proxyConfig = [
    {
        host: 'proxy.scraperapi.com',
        port: 8000,
        protocol: 'http',
        username: 'SUA_API_KEY',
        password: ''
    }
];
export const getRandomProxy = () => {
    if (proxyConfig.length === 0)
        return null;
    const randomIndex = Math.floor(Math.random() * proxyConfig.length);
    return proxyConfig[randomIndex];
};
