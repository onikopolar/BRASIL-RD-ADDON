// Script: Deploy da última release do GitHub para produção
// Uso: node scripts/deploy-release.js
// Baixa a release mais recente, instala deps, builda e reinicia PM2

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RELEASE_DIR = path.join(__dirname, '..', 'release');
const REPO = 'onikopolar/BRASIL-RD-ADDON';
const PM2_APP_NAME = 'brasil-rd-addon';

function run(cmd, opts = {}) {
  console.log(`  → ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', ...opts });
}

async function main() {
  console.log('=== DEPLOY RELEASE ===\n');

  // 1. Buscar última release tag do GitHub
  console.log('📡 Buscando última release...');
  const url = `https://api.github.com/repos/${REPO}/releases/latest`;
  let latestTag;
  try {
    const result = execSync(`curl -s ${url}`, { encoding: 'utf8' });
    const release = JSON.parse(result);
    latestTag = release.tag_name;
    console.log(`   Última release: ${latestTag}\n`);
  } catch (e) {
    console.error('❌ Erro ao buscar release do GitHub');
    process.exit(1);
  }

  // 2. Verificar se já está rodando essa versão
  try {
    const pm2Status = execSync(`npx pm2 jlist`, { encoding: 'utf8' });
    const procs = JSON.parse(pm2Status);
    const app = procs.find(p => p.name === PM2_APP_NAME);
    if (app && app.pm2_env && app.pm2_env.version === latestTag) {
      console.log(`✅ Já está rodando ${latestTag}. Nada a fazer.`);
      process.exit(0);
    }
  } catch (e) {
    // PM2 pode não estar rodando, continua
  }

  // 3. Clonar/atualizar release
  if (fs.existsSync(path.join(RELEASE_DIR, '.git'))) {
    console.log('📥 Atualizando release...');
    process.chdir(RELEASE_DIR);
    run('git fetch --tags');
    run(`git checkout -f ${latestTag}`);
  } else {
    console.log('📥 Clonando release...');
    fs.mkdirSync(RELEASE_DIR, { recursive: true });
    // Remove conteúdo antigo se existir (sem .git)
    const files = fs.readdirSync(RELEASE_DIR);
    for (const f of files) {
      fs.rmSync(path.join(RELEASE_DIR, f), { recursive: true, force: true });
    }
    run(`git clone --depth 1 --branch ${latestTag} https://github.com/${REPO}.git ${RELEASE_DIR}`);
  }

  // 4. Instalar dependências (só produção)
  console.log('\n📦 Instalando dependências...');
  process.chdir(RELEASE_DIR);
  run('npm ci --omit=dev');

  // 5. Build
  console.log('\n🔨 Buildando...');
  // Seta NODE_ENV=production pra build de produção
  run('npm run build', { env: { ...process.env, NODE_ENV: 'production' } });

  // 6. Copiar .env se existir
  const rootEnv = path.join(__dirname, '..', '.env');
  const releaseEnv = path.join(RELEASE_DIR, '.env');
  if (fs.existsSync(rootEnv) && !fs.existsSync(releaseEnv)) {
    console.log('\n📋 Copiando .env...');
    fs.copyFileSync(rootEnv, releaseEnv);
  }

  // 7. Reiniciar PM2 (deleta processo antigo e recria do release/)
  console.log('\n🔄 Atualizando PM2...');
  try {
    run(`npx pm2 delete ${PM2_APP_NAME}`);
  } catch (e) {
    // Não existia ainda, OK
  }
  run(`npx pm2 start ecosystem.config.js --update-env`);

  // 8. Salvar PM2 pra persistir no reboot
  run('npx pm2 save');

  console.log(`\n✅ Deploy concluído: ${latestTag}`);
}

main().catch(err => {
  console.error('❌ Falha no deploy:', err.message);
  process.exit(1);
});
