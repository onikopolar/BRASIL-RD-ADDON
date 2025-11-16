"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
exports.config = {
    realDebrid: {
        apiKey: process.env.REAL_DEBRID_API_KEY || '',
        baseUrl: 'https://api.real-debrid.com/rest/1.0',
        timeout: 10000
    },
    stremio: {
        cacheMaxAge: 24 * 60 * 60, // 24 horas
        streamTimeout: 30000
    },
    curatedMagnets: {
        updateInterval: 6 * 60 * 60 * 1000, // 6 horas
        maxRetries: 3
    }
};
//# sourceMappingURL=index.js.map