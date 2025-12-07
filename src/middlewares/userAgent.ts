import { Request, Response, NextFunction } from 'express';
import { UAParser } from 'ua-parser-js';

export interface UserAgentInfo {
  browser: string;
  version: string;
  os: string;
  device: string;
  deviceType: string;
  isBot: boolean;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isSmartTV: boolean;
  raw: string;
}

export const userAgentMiddleware = () => {
  return (req: Request, res: Response, next: NextFunction) => {
    const userAgent = req.headers['user-agent'] || '';
    const parser = new UAParser(userAgent);
    const result = parser.getResult();
    
    const deviceType = result.device.type || 'desktop';
    const isBotCheck = /bot|crawler|spider|facebookexternalhit|Googlebot|Bingbot|Slurp|DuckDuckBot|Baiduspider|YandexBot|Sogou/i.test(userAgent);
    
    const uaInfo: UserAgentInfo = {
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
    
    (req as any).userAgent = uaInfo;
    
    // Debug somente em desenvolvimento
    if (process.env.NODE_ENV === 'development' && userAgent) {
      console.log(`[UserAgent] Detectado: ${uaInfo.browser} ${uaInfo.version} em ${uaInfo.os} (${deviceType})`);
    }
    
    next();
  };
};