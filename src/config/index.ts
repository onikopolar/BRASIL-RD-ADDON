export interface AppConfig {
  realDebrid: {
    apiKey: string;
    baseUrl: string;
    timeout: number;
  };
  stremio: {
    cacheMaxAge: number;
    streamTimeout: number;
  };
  curatedMagnets: {
    updateInterval: number;
    maxRetries: number;
  };
}

export const config: AppConfig = {
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
