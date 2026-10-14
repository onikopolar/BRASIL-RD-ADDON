// Testa os mecanismos internos do HdrScraper de forma isolada.
// Uso: node scripts/test-hdr-mecanismos.mjs

const c = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const section = t => console.log(`\n${c.bold}${c.cyan}══ ${t} ══${c.reset}`);
const ok = t => console.log(`${c.green}✅ ${t}${c.reset}`);
const fail = t => console.log(`${c.red}❌ ${t}${c.reset}`);
const info = (k, v) => console.log(`   ${c.dim}${k}:${c.reset} ${typeof v === 'object' ? JSON.stringify(v) : v}`);

(async () => {
  console.log(`${c.bold}${c.magenta}🧪 Teste dos mecanismos HdrScraper${c.reset}`);

  let hdr;
  try {
    hdr = await import('../dist/services/scraper/hdrScraper.js');
  } catch (e) {
    fail(`Não consegui importar do dist. Roda 'npm run build' antes.`);
    console.error(e.message);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════
  section('1) Negative Cache');
  // ═══════════════════════════════════════════════════════════════════

  hdr.negativeCacheClear();
  info('stats inicial', hdr.negativeCacheStats().size);

  const key = hdr.negativeCacheKey('hdr', 'filme inexistente 12345', { season: 0, type: 'movie' });
  info('chave gerada', key);

  info('isBlocked antes', hdr.negativeCacheIsBlocked(key));
  hdr.negativeCacheMark(key, 60_000);
  info('isBlocked depois', hdr.negativeCacheIsBlocked(key));
  info('isBlocked de novo (deve incrementar hits)', hdr.negativeCacheIsBlocked(key));
  info('stats', hdr.negativeCacheStats());

  // Simula expiração
  hdr.negativeCacheClear();
  hdr.negativeCacheMark(key, 1);
  await new Promise(r => setTimeout(r, 10));
  info('após expirar (1ms)', hdr.negativeCacheIsBlocked(key));

  // ═══════════════════════════════════════════════════════════════════
  section('2) Circuit Breaker — ciclo completo');
  // ═══════════════════════════════════════════════════════════════════

  hdr.breakerReset();
  info('estado inicial', hdr.breakerStatus('hdr'));

  for (let i = 0; i < hdr.BREAKER_LIMITE_ERROS; i++) {
    hdr.breakerRegistrarFalha('hdr');
  }
  info(`após ${hdr.BREAKER_LIMITE_ERROS} falhas`, hdr.breakerStatus('hdr'));
  info('podeUsar com OPEN', hdr.breakerPodeUsar('hdr'));

  // Força vencimento do cooldown
  const stats = hdr.breakerStats().entries[0];
  info('cooldown restante', stats.cooldownRestanteMs + 'ms');

  // Reset pra simular cooldown vencido — testamos half-open manual
  hdr.breakerReset();
  // Simula 1 falha após um "sucesso" (volta ao closed)
  hdr.breakerRegistrarFalha('hdr');
  info('1 falha (não abre)', hdr.breakerStatus('hdr'));
  hdr.breakerRegistrarSucesso('hdr');
  info('após sucesso', hdr.breakerStatus('hdr'));
  info('stats finais', hdr.breakerStats());

  // ═══════════════════════════════════════════════════════════════════
  section('3) Classificação de erro → fonte vs item');
  // ═══════════════════════════════════════════════════════════════════

  const casos = [
    { nome: '403 Forbidden',    err: { response: { status: 403 } },     esperado: 'fonte' },
    { nome: '429 Rate Limit',   err: { response: { status: 429 } },     esperado: 'fonte' },
    { nome: '500 Server Error', err: { response: { status: 500 } },     esperado: 'fonte' },
    { nome: '502 Bad Gateway',  err: { response: { status: 502 } },     esperado: 'fonte' },
    { nome: 'Network error',    err: new Error('ECONNRESET'),           esperado: 'fonte' },
    { nome: '404 Not Found',    err: { response: { status: 404 } },     esperado: 'item' },
    { nome: '410 Gone',         err: { response: { status: 410 } },     esperado: 'item' },
    { nome: '200 sem erro',     err: {},                                esperado: 'item' },
  ];

  let passou = 0;
  for (const c of casos) {
    const r = hdr.classificarErroFonte(c.err);
    if (r === c.esperado) { ok(`${c.nome} → ${r}`); passou++; }
    else fail(`${c.nome} → ${r} (esperado ${c.esperado})`);
  }
  info('total', `${passou}/${casos.length}`);

  console.log(`\n${c.bold}${c.magenta}🏁 Fim${c.reset}\n`);
})();
