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

export const clientInfoMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Detecta IP
    const clientIp = requestIp.getClientIp(req) || 'Desconhecido';
    const ipSource = (req as any).clientIpSource || 'direct';
    
    // Detecta User Agent
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
      userAgentRaw: userAgent.substring(0, 120)
    };
    
    // Armazena no request
    (req as any).clientInfo = clientInfo;
    
    // Debug em desenvolvimento
    if (process.env.NODE_ENV === 'development' && userAgent) {
      console.log(`[ClientInfo] ${clientIp} - ${clientInfo.browser} ${clientInfo.browserVersion} em ${clientInfo.os} (${deviceType})`);
    }
    
    next();
  };
};
