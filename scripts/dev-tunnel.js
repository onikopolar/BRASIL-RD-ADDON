/**
 * dev-tunnel.js
 * Inicia o servidor Node + Cloudflare Tunnel simultaneamente.
 * Uso: npm run dev:tunnel
 *
 * Requer:
 *   - CLOUDFLARED_TOKEN no .env (o token do seu túnel permanente)
 *   - cloudflared instalado (Windows: cloudflared.exe no PATH)
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 7000;
const CLOUDFLARED_TOKEN = process.env.CLOUDFLARED_TOKEN;

// Carrega .env
try {
  const envFile = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (k && v && !process.env[k]) {
      process.env[k] = v;
    }
  }
} catch {}

const TOKEN = process.env.CLOUDFLARED_TOKEN || CLOUDFLARED_TOKEN;

// ── Inicia o servidor Node ──────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  🚀 BRASIL RD ADDON - Modo Dev + Tunnel');
console.log('═══════════════════════════════════════════════');
console.log('');

const serverProc = spawn('node', ['dist/server.js'], {
  cwd: ROOT,
  stdio: 'pipe',
  env: { ...process.env, PORT: String(PORT) },
  shell: true,
});

let serverStarted = false;

serverProc.stdout.on('data', (data) => {
  const msg = data.toString();
  process.stdout.write(`[server] ${msg}`);

  // Detecta quando o servidor está pronto (procura pela mensagem de start)
  if (!serverStarted && (msg.includes('iniciado') || msg.includes('listening') || msg.includes('port'))) {
    serverStarted = true;
    startTunnel();
  }
});

serverProc.stderr.on('data', (data) => {
  process.stderr.write(`[server:err] ${data.toString()}`);
});

serverProc.on('exit', (code) => {
  console.log(`[server] Processo encerrado (exit code: ${code})`);
  process.exit(code);
});

// ── Inicia o Cloudflare Tunnel ──────────────────────────────────────
function startTunnel() {
  if (!TOKEN) {
    console.log('');
    console.log('⚠️  CLOUDFLARED_TOKEN não encontrado no .env');
    console.log('   O servidor está rodando SEM o túnel Cloudflare.');
    console.log('   Adicione CLOUDFLARED_TOKEN=seu-token ao .env para ativar.');
    console.log('');
    return;
  }

  console.log('');
  console.log('🌍 Iniciando Cloudflare Tunnel...');
  console.log('');

  const cloudflaredCmd = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';

  const tunnelProc = spawn(cloudflaredCmd, [
    'tunnel',
    'run',
    '--token', TOKEN,
  ], {
    cwd: ROOT,
    stdio: 'pipe',
    shell: true,
  });

  tunnelProc.stdout.on('data', (data) => {
    const msg = data.toString();
    process.stdout.write(`[tunnel] ${msg}`);
  });

  tunnelProc.stderr.on('data', (data) => {
    const msg = data.toString();
    // cloudflared manda logs normais via stderr também
    process.stdout.write(`[tunnel] ${msg}`);
  });

  tunnelProc.on('exit', (code) => {
    console.log(`[tunnel] Cloudflared encerrado (exit code: ${code})`);
    serverProc.kill();
    process.exit(code);
  });

  tunnelProc.on('error', (err) => {
    console.error(`[tunnel] ERRO ao iniciar cloudflared: ${err.message}`);
    console.error('[tunnel] Verifique se o cloudflared está instalado e no PATH.');
  });
}

// Cleanup ao encerrar
process.on('SIGINT', () => {
  console.log('\n🛑 Encerrando...');
  serverProc.kill();
  process.exit(0);
});

process.on('SIGTERM', () => {
  serverProc.kill();
  process.exit(0);
});
