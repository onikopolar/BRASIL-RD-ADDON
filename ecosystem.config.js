module.exports = {
  apps: [{
    name: 'brasil-rd-addon',
    script: 'dist/server.js',
    cwd: __dirname,
    env: {
      NODE_ENV: 'production',
      LOG_LEVEL: 'info',
      BASE_URL: 'https://brasil-rd-oficial.oniko.org'
    },
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    // Logs
    log_date_format: 'DD/MM/YYYY HH:mm:ss',
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    merge_logs: true,
    // Reiniciar se usar mais de 500MB de RAM
    max_memory_restart: '500M'
  }]
};
