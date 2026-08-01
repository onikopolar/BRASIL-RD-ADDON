// Deploy: reinicia PM2 direto do dist/ na raiz (sem release/)
const { execSync } = require('child_process');

console.log('🚀 Deploy: reiniciando PM2...\n');

try {
  execSync('npx pm2 restart brasil-rd-addon --update-env', { stdio: 'inherit' });
} catch {
  // Processo não existe ainda, cria do zero
  execSync('npx pm2 start ecosystem.config.js', { stdio: 'inherit' });
}

console.log('\n✅ Deploy concluído!');

