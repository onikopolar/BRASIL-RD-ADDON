"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.torrentioRateLimiter = exports.createRateLimiter = void 0;
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const isDevelopment = process.env.NODE_ENV === 'development';
const createRateLimiter = () => {
    if (isDevelopment) {
        return (req, res, next) => next();
    }
    return (0, express_rate_limit_1.default)({
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
exports.createRateLimiter = createRateLimiter;
const torrentioRateLimiter = (req, res, next) => {
    if (isDevelopment) {
        return next();
    }
    const limiter = (0, express_rate_limit_1.default)({
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
exports.torrentioRateLimiter = torrentioRateLimiter;
