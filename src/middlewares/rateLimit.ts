import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Em desenvolvimento, desabilita rate limiting
const isDevelopment = process.env.NODE_ENV === 'development';

// Rate limit diferenciado por tipo de cliente
export const createRateLimiter = () => {
  if (isDevelopment) {
    // Em desenvolvimento, retorna middleware que não faz nada
    return (req: Request, res: any, next: any) => next();
  }

  return rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 300, // Limite padrão
    message: {
      error: 'Muitas requisições. Tente novamente em 15 minutos.',
      retryAfter: '15 minutos'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
  });
};

// Rate limit específico para rotas Torrentio
export const torrentioRateLimiter = (req: Request, res: any, next: any) => {
  if (isDevelopment) {
    return next();
  }
  
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: {
      error: 'Limite de requisições Torrentio excedido. Aguarde 15 minutos.',
      retryAfter: '15 minutos'
    },
    standardHeaders: true,
    legacyHeaders: false
  });
  
  return limiter(req, res, next);
};