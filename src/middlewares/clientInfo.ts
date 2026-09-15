import { Request, Response, NextFunction } from 'express';
import { UAParser } from 'ua-parser-js';
import requestIp from 'request-ip';

export interface ClientInfo {
  ip: string;
  ipSource: string;
  browser: string;
  browserVersion: string;
  os: string;
  device: string;
  deviceType: string;
  isBot: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSmartTV: boolean;
  userAgentRaw: string;
}

// Prioriza headers de proxy/CDN antes de cair no request-ip.
export function extrairIp(req: Request | any): { ip: string; source: string } {
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

  const viaRequestIp = requestIp.getClientIp(req);
  if (viaRequestIp && viaRequestIp !== '127.0.0.1' && viaRequestIp !== '::1') {
    return { ip: viaRequestIp, source: 'request-ip' };
  }

  return { ip: viaRequestIp || 'Desconhecido', source: 'socket' };
}

export const clientInfoMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const { ip: clientIp, source: ipSource } = extrairIp(req);

    const userAgent = req.headers['user-agent'] || '';
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    const deviceType = result.device.type || 'desktop';
    const isBotCheck = /bot|crawler|spider|facebookexternalhit|Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou/i.test(userAgent);

    const clientInfo: ClientInfo = {
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

    (req as any).clientInfo = clientInfo;

    if (process.env.NODE_ENV === 'development' && userAgent) {
      console.log(`[ClientInfo] ${clientIp} (${ipSource}) - ${clientInfo.browser} ${clientInfo.browserVersion} em ${clientInfo.os} (${deviceType})`);
    }

    next();
  };
};