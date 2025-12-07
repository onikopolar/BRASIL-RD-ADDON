"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientInfoMiddleware = void 0;
const ua_parser_js_1 = require("ua-parser-js");
const request_ip_1 = __importDefault(require("request-ip"));
const clientInfoMiddleware = () => {
    return (req, res, next) => {
        const clientIp = request_ip_1.default.getClientIp(req) || 'Desconhecido';
        const ipSource = req.clientIpSource || 'direct';
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
            userAgentRaw: userAgent.substring(0, 120)
        };
        req.clientInfo = clientInfo;
        if (process.env.NODE_ENV === 'development' && userAgent) {
            console.log(`[ClientInfo] ${clientIp} - ${clientInfo.browser} ${clientInfo.browserVersion} em ${clientInfo.os} (${deviceType})`);
        }
        next();
    };
};
exports.clientInfoMiddleware = clientInfoMiddleware;
