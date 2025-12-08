"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userAgentMiddleware = void 0;
const ua_parser_js_1 = require("ua-parser-js");
const userAgentMiddleware = () => {
    return (req, res, next) => {
        const userAgent = req.headers['user-agent'] || '';
        const parser = new ua_parser_js_1.UAParser(userAgent);
        const result = parser.getResult();
        const deviceType = result.device.type || 'desktop';
        const isBotCheck = /bot|crawler|spider|facebookexternalhit|Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou/i.test(userAgent);
        const uaInfo = {
            browser: result.browser.name || 'Desconhecido',
            version: result.browser.version || 'Desconhecido',
            os: result.os.name || 'Desconhecido',
            device: result.device.model || 'Desconhecido',
            deviceType: deviceType,
            isBot: isBotCheck,
            isMobile: deviceType === 'mobile',
            isTablet: deviceType === 'tablet',
            isDesktop: deviceType === 'desktop' || !deviceType,
            isSmartTV: deviceType === 'smarttv',
            raw: userAgent.substring(0, 100)
        };
        req.userAgent = uaInfo;
        if (process.env.NODE_ENV === 'development' && userAgent) {
            console.log(`[UserAgent] Detectado: ${uaInfo.browser} ${uaInfo.version} em ${uaInfo.os} (${deviceType})`);
        }
        next();
    };
};
exports.userAgentMiddleware = userAgentMiddleware;
