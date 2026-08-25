// scripts/usage-stats.ts
// Lê o log do PM2 e gera estatísticas de uso do addon.
// Uso: npx tsx scripts/usage-stats.ts [caminho-do-log] [--users]

import fs from 'fs';
import os from 'os';
import path from 'path';

function parseArgs() {
  const args = process.argv.slice(2);
  const defaultLog = path.join(os.homedir(), 'BRASIL-RD-ADDON', 'logs', 'pm2-out.log');
  const logPath = args.find(a => !a.startsWith('--')) || defaultLog;
  const showUsers = args.includes('--users');
  return { logPath, showUsers };
}

function main() {
  const { logPath, showUsers } = parseArgs();

  if (!fs.existsSync(logPath)) {
    console.error(`Arquivo de log não encontrado: ${logPath}`);
    console.error('Uso: npx tsx scripts/usage-stats.ts /caminho/para/log.log [--users]');
    process.exit(1);
  }

  const raw = fs.readFileSync(logPath, 'utf8');

  // Separa em blocos: um novo bloco começa quando a linha tem data/hora e um nível de log.
  const blocks: string[] = [];
  let current = '';

  for (const line of raw.split('\n')) {
    const isNewBlock =
      /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}:/.test(line) &&
      /\[(INFO|DEBUG|WARN|ERROR)\]/.test(line);

    if (isNewBlock) {
      if (current) blocks.push(current);
      current = line;
    } else {
      current += '\n' + line;
    }
  }
  if (current) blocks.push(current);

  const totals = {
    manifest: 0,
    streamSolicitado: 0,
    streamResult: 0,
    resolve: 0,
  };

  const byDay = new Map<string, {
    manifest: number;
    streamSolicitado: number;
    streamResult: number;
    resolve: number;
    uniqueApiKeys: Set<string>;
  }>();

  const userAgents = new Map<string, number>();
  const allApiKeys = new Set<string>();

  for (const block of blocks) {
    const dateMatch = block.match(/(\d{2}\/\d{2}\/\d{4})/);
    if (!dateMatch) continue;
    const day = dateMatch[1];

    if (!byDay.has(day)) {
      byDay.set(day, {
        manifest: 0,
        streamSolicitado: 0,
        streamResult: 0,
        resolve: 0,
        uniqueApiKeys: new Set<string>(),
      });
    }
    const dayStats = byDay.get(day)!;

    if (block.includes('MANIFEST SOLICITADO')) {
      totals.manifest++;
      dayStats.manifest++;
    }
    if (block.includes('STREAM SOLICITADO')) {
      totals.streamSolicitado++;
      dayStats.streamSolicitado++;
    }
    if (block.includes('STREAM RESULT')) {
      totals.streamResult++;
      dayStats.streamResult++;
    }
    if (block.includes('RESOLVE')) {
      totals.resolve++;
      dayStats.resolve++;
    }

    const apiKeyMatch = block.match(/apiKeyPreview:\s*['"]([^'"]+)['"]/);
    if (apiKeyMatch) {
      const key = apiKeyMatch[1];
      allApiKeys.add(key);
      dayStats.uniqueApiKeys.add(key);
    }

    const uaMatch = block.match(/userAgent:\s*['"]([^'"]+)['"]/);
    if (uaMatch) {
      const ua = uaMatch[1];
      userAgents.set(ua, (userAgents.get(ua) || 0) + 1);
    }
  }

  console.log('\n📊 Estatísticas de uso do Addon\n');
  console.log('══════════════════════════════════════');
  console.log(`📥 Manifest solicitado:   ${totals.manifest}`);
  console.log(`📡 Stream solicitado:     ${totals.streamSolicitado}`);
  console.log(`✅ Streams retornados:    ${totals.streamResult}`);
  console.log(`🔗 Resolve chamado:       ${totals.resolve}`);
  console.log('──────────────────────────────────────');
  console.log(`👥 Usuários distintos (total por apiKeyPreview): ${allApiKeys.size}\n`);

  console.log('📅 Requisições por dia (tipo e usuários distintos):\n');
  console.log('Data         | Manifest | Stream Sol. | Stream Res. | Resolve | Usuários');
  console.log('-------------|----------|-------------|-------------|---------|--------');

  const sortedDays = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [day, stats] of sortedDays) {
    console.log(
      `${day} | ${String(stats.manifest).padStart(8)} | ${String(stats.streamSolicitado).padStart(11)} | ` +
      `${String(stats.streamResult).padStart(11)} | ${String(stats.resolve).padStart(7)} | ${String(stats.uniqueApiKeys.size).padStart(6)}`
    );
  }

  console.log('\n📱 User-agents mais frequentes:');
  const sortedUA = [...userAgents.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  for (const [ua, count] of sortedUA) {
    console.log(`   ${count}x ${ua}`);
  }

  if (showUsers) {
    console.log('\n👥 Chaves de API únicas (previews):');
    for (const key of allApiKeys) {
      console.log(`   ${key}`);
    }
  }

  console.log('\n✅ Análise concluída.\n');
}

main();