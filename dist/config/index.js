"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.config = {
    torbox: {
        apiKey: process.env.TORBOX_API_KEY || '',
        baseUrl: 'https://api.torbox.app/v1/api',
        timeout: 10000
    },
    stremio: {
        cacheMaxAge: 24 * 60 * 60,
        streamTimeout: 30000
    },
    curatedMagnets: {
        updateInterval: 6 * 60 * 60 * 1000,
        maxRetries: 3
    }
};
