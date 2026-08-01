// Deploy: copia dist/ para release/dist/ e reinicia PM2
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RELEASE = path.join(ROOT, 'release');

console.log('🚀 Iniciando deploy...\n');

// 1. Copia dist/
console.log('📦 Copiando dist/ para release/dist/...');
const srcDist = path.join(ROOT, 'dist');
const destDist = path.join(RELEASE, 'dist');

if (fs.existsSync(destDist)) {
  fs.rmSync(destDist, { recursive: true, force: true });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
copyDir(srcDist, destDist);
console.log('   OK\n');

// 2. Reinicia PM2
console.log('🔄 Reiniciando PM2...');
try {
  execSync('npx pm2 restart brasil-rd-addon', { 
    cwd: RELEASE, 
    stdio: 'inherit' 
  });
  console.log('✅ Deploy concluído!');
} catch (err) {
  console.error('❌ Erro ao reiniciar PM2:', err.message);
  process.exit(1);
}
