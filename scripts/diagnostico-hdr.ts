// scripts/diagnostico-hdr-delay.ts
// Roda com: npx tsx scripts/diagnostico-hdr-delay.ts

import axios from 'axios';
import * as cheerio from 'cheerio';

const HDR_BASE = 'https://hdrtorrents.net';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  'Connection': 'keep-alive',
};

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function extrairCookies(setCookie: string | string[] | undefined): string {
  if (!setCookie) return '';
  const lista = Array.isArray(setCookie) ? setCookie : [setCookie];
  return lista.map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
}

interface Sessao { token: string; cookie: string }

async function obterSessao(): Promise<Sessao | null> {
  try {
    const res = await axios.get(`${HDR_BASE}/`, { headers: HEADERS, timeout: 15000 });
    const token = res.data.match(/name="token"\s+value="([^"]+)"/)?.[1];
    const cookie = extrairCookies(res.headers['set-cookie']);
    if (!token) return null;
    return { token, cookie };
  } catch {
    return null;
  }
}

interface ResultadoBusca {
  ok: boolean;
  status: number;
  links: number;
  erro?: string;
}

async function buscar(query: string, sessao: Sessao): Promise<ResultadoBusca> {
  const termo = encodeURIComponent(query).replace(/%20/g, '+');
  const url = `${HDR_BASE}/pesquisa/${termo}/?hp_bot_check=&token=${sessao.token}`;

  try {
    const res = await axios.get(url, {
      headers: { ...HEADERS, 'Cookie': sessao.cookie, 'Referer': `${HDR_BASE}/` },
      timeout: 15000,
    });
    const $ = cheerio.load(res.data);
    const links = $('a[href*="/catalog/"]').length;
    return { ok: true, status: res.status, links };
  } catch (err: any) {
    return {
      ok: false,
      status: err.response?.status || 0,
      links: 0,
      erro: err.message,
    };
  }
}

// Testa um cenário: X queries com Y ms de delay entre elas, sessão fixa.
async function testarCenario(nome: string, queries: string[], delayMs: number, reusarSessao: boolean) {
  console.log(`\n=== ${nome} (delay=${delayMs}ms, reusaSessao=${reusarSessao}) ===`);

  let sessao = await obterSessao();
  if (!sessao) {
    console.log('Falha ao obter sessão inicial');
    return;
  }
  console.log(`Sessão inicial: token=${sessao.token.substring(0, 12)}... cookie=${sessao.cookie.substring(0, 40) || 'VAZIO'}`);

  for (let i = 0; i < queries.length; i++) {
    if (i > 0 && delayMs > 0) {
      await sleep(delayMs);
    }

    if (!reusarSessao && i > 0) {
      const nova = await obterSessao();
      if (nova) sessao = nova;
    }

    const r = await buscar(queries[i], sessao);
    const icone = r.ok ? '✓' : '✗';
    console.log(`  ${icone} [${i + 1}/${queries.length}] "${queries[i].substring(0, 35)}" | status=${r.status} | links=${r.links}${r.erro ? ` | ${r.erro.substring(0, 50)}` : ''}`);
  }
}

async function main() {
  console.log('Diagnóstico HDR com delay —', new Date().toISOString());

  const queries = [
    'rick and morty',
    'rick e morty',
    'modern family',
    'the big bang theory',
  ];

  // Cenário 1: sem delay, mesma sessão.
  await testarCenario('Cenário 1 — sem delay, sessão fixa', queries.slice(0, 2), 0, true);

  await sleep(10000);

  // Cenário 2: 2s entre queries, sessão fixa.
  await testarCenario('Cenário 2 — 2s entre queries, sessão fixa', queries, 2000, true);

  await sleep(10000);

  // Cenário 3: 3s entre queries, renovando sessão a cada uma.
  await testarCenario('Cenário 3 — 3s entre queries, renova sessão', queries, 3000, false);

  await sleep(10000);

  // Cenário 4: 5s entre queries, sessão fixa.
  await testarCenario('Cenário 4 — 5s entre queries, sessão fixa', queries, 5000, true);

  console.log('\nFim');
}

main().catch(console.error);