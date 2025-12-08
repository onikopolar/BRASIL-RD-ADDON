import rateLimit from 'express-rate-limit';
import { Request } from 'express';

// Em desenvolvimento, desabilita rate limiting
const isDevelopment = process.env.NODE_ENV === 'development';

// Rate limit global
export const createRateLimiter = () => {
  if (isDevelopment) {
    return (req: Request, res: any, next: any) => next();
  }

  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: {
      error: 'Muitas requisições. Tente novamente em 15 minutos.',
      retryAfter: '15 minutos'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
  });
};

// Rate limit específico para rotas Torrentio - INSTÂNCIA ÚNICA PRÉ-CRIADA
export const torrentioRateLimiter = (() => {
  if (isDevelopment) {
    return (req: Request, res: any, next: any) => next();
  }

  // Cria UMA instância na inicialização do módulo
  const limiterInstance = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    message: {
      error: 'Limite de requisições Torrentio excedido. Aguarde 15 minutos.',
      retryAfter: '15 minutos'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false
  });

  // Retorna o middleware que usa a instância única
  return (req: Request, res: any, next: any) => {
    limiterInstance(req, res, next);
  };
})(); // IIFE: Executa imediatamente para criar a instância