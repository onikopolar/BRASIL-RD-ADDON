export interface AppConfig {
  torbox: {
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
  torbox: {
    apiKey: process.env.TORBOX_API_KEY || '',
    baseUrl: 'https://api.torbox.app/v1/api',
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
