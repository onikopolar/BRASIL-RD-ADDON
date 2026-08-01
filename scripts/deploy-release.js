// Deploy: mata PM2 e inicia fresco com o dist atual
// Rode `npm run build` ANTES para compilar o código que quer em produção
const { execSync } = require('child_process');
const path = require('path');

console.log('🚀 Deploy: resetando PM2...\n');

// Mata PM2 completamente (limpa cache de require)
execSync('npx pm2 kill', { stdio: 'inherit' });
console.log('');

// Inicia fresco com o dist atual
execSync('npx pm2 start ecosystem.config.js', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

console.log('\n✅ Deploy concluído! PM2 rodando dist/ atual.');

