"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRandomProxy = exports.proxyConfig = void 0;
exports.proxyConfig = [
    {
        host: 'proxy.scraperapi.com',
        port: 8000,
        protocol: 'http',
        username: 'SUA_API_KEY',
        password: ''
    }
];
const getRandomProxy = () => {
    if (exports.proxyConfig.length === 0)
        return null;
    const randomIndex = Math.floor(Math.random() * exports.proxyConfig.length);
    return exports.proxyConfig[randomIndex];
};
exports.getRandomProxy = getRandomProxy;
