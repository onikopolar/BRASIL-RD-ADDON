"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientInfoMiddleware = void 0;
exports.extrairIp = extrairIp;
const ua_parser_js_1 = require("ua-parser-js");
const request_ip_1 = __importDefault(require("request-ip"));
function extrairIp(req) {
    const cf = req.headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) {
        return { ip: cf.trim(), source: 'cf-connecting-ip' };
    }
    const trueClient = req.headers['true-client-ip'];
    if (typeof trueClient === 'string' && trueClient.trim()) {
        return { ip: trueClient.trim(), source: 'true-client-ip' };
    }
    const xRealIp = req.headers['x-real-ip'];
    if (typeof xRealIp === 'string' && xRealIp.trim()) {
        return { ip: xRealIp.trim(), source: 'x-real-ip' };
    }
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
        const primeiro = xff.split(',')[0].trim();
        if (primeiro && primeiro !== '127.0.0.1' && primeiro !== '::1') {
            return { ip: primeiro, source: 'x-forwarded-for' };
        }
    }
    const viaExpress = req.ip;
    if (typeof viaExpress === 'string' && viaExpress.trim()) {
        return { ip: viaExpress.trim(), source: 'req.ip' };
    }
    const viaRequestIp = request_ip_1.default.getClientIp(req);
    if (viaRequestIp && viaRequestIp !== '127.0.0.1' && viaRequestIp !== '::1') {
        return { ip: viaRequestIp, source: 'request-ip' };
    }
    return { ip: viaRequestIp || 'Desconhecido', source: 'socket' };
}
const clientInfoMiddleware = () => {
    return (req, res, next) => {
        const { ip: clientIp, source: ipSource } = extrairIp(req);
        const userAgent = req.headers['user-agent'] || '';
        const parser = new ua_parser_js_1.UAParser(userAgent);
        const result = parser.getResult();
        const deviceType = result.device.type || 'desktop';
        const isBotCheck = /bot|crawler|spider|facebookexternalhit|Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou/i.test(userAgent);
        const clientInfo = {
            ip: clientIp,
            ipSource: ipSource,
            browser: result.browser.name || 'Desconhecido',
            browserVersion: result.browser.version || 'Desconhecido',
            os: result.os.name || 'Desconhecido',
            device: result.device.model || 'Desconhecido',
            deviceType: deviceType,
            isBot: isBotCheck,
            isMobile: deviceType === 'mobile',
            isTablet: deviceType === 'tablet',
            isDesktop: deviceType === 'desktop' || !deviceType,
            isSmartTV: deviceType === 'smarttv',
            userAgentRaw: userAgent.substring(0, 120),
        };
        req.clientInfo = clientInfo;
        if (process.env.NODE_ENV === 'development' && userAgent) {
            console.log(`[ClientInfo] ${clientIp} (${ipSource}) - ${clientInfo.browser} ${clientInfo.browserVersion} em ${clientInfo.os} (${deviceType})`);
        }
        next();
    };
};
exports.clientInfoMiddleware = clientInfoMiddleware;
