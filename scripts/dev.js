// Inicia o servidor + Cloudflare Tunnel (se configurado)
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.PORT || 7000;

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

const TOKEN = process.env.CLOUDFLARED_TOKEN;
let tunnelProc = null;

console.log('BRASIL RD Addon - Development mode');
console.log('');

// ── Servidor Node ──────────────────────────────────────────────────
const proc = spawn('node', ['dist/server.js'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PORT: String(PORT) },
  shell: true,
});

// ── Cloudflare Tunnel ───────────────────────────────────────────────
if (TOKEN) {
  // Pequeno delay pra garantir que o servidor subiu antes do túnel
  setTimeout(() => {
    console.log('Cloudflare Tunnel: https://brasil-rd-oficial.oniko.org');
    console.log('');

    const cmd = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
    tunnelProc = spawn(cmd, ['tunnel', 'run', '--token', TOKEN], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: true,
    });

    tunnelProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log('[tunnel] Cloudflared encerrado (exit code: ' + code + ')');
      }
      proc.kill();
    });
  }, 2000);
} else {
  console.log('💡 Dica: Adicione CLOUDFLARED_TOKEN no .env para ativar o túnel.');
  console.log('');
}

// ── Cleanup ────────────────────────────────────────────────────────
proc.on('exit', (code) => {
  if (tunnelProc) tunnelProc.kill();
  process.exit(code);
});

process.on('SIGINT', () => {
  if (tunnelProc) tunnelProc.kill();
  proc.kill();
  process.exit(0);
});
