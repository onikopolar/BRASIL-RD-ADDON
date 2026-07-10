module.exports = {
  apps: [{
    name: 'brasil-rd-addon',
    script: 'dist/server.js',
    cwd: 'C:/Users/sangu/BRASIL-RD-ADDON',
    env: {
      NODE_ENV: 'production'
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
