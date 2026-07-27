import 'dotenv/config';
import { TitleFilter } from '../src/lib/titleFilter.js';

const f = TitleFilter.getInstance();

async function main() {
  // Netflix movie tt18259538 vs series torrent → deve REJEITAR
  const r1 = await f.doTitlesMatch(
    'Avatar: O Ultimo Mestre do Ar 2 Temporada WEB-DL 1080p Dual Audio 2026',
    'tt18259538'
  );
  console.log('Serie torrent vs Movie IMDB:', r1.matches ? '❌ ACEITOU (errado)' : '✅ REJEITOU (certo)', '|', r1.reason);

  // Movie torrent vs movie → deve ACEITAR
  const r2 = await f.doTitlesMatch(
    'Avatar O Ultimo Mestre do Ar 2026 Dublado 1080p',
    'tt18259538'
  );
  console.log('Movie torrent vs Movie IMDB:', r2.matches ? '✅ ACEITOU (certo)' : '❌ REJEITOU (errado)', '|', r2.reason);

  // Aang series → deve ACEITAR (não quebrar o que funciona)
  const r3 = await f.doTitlesMatch(
    'Avatar A Lenda de Aang 1 Temporada Dublado',
    'tt0417299', 1
  );
  console.log('Aang series vs Aang IMDB:', r3.matches ? '✅ ACEITOU (certo)' : '❌ REJEITOU (errado)', '|', r3.reason);

  // Korra vs Aang → deve REJEITAR
  const r4 = await f.doTitlesMatch(
    'Avatar A Lenda de Korra 3 Temporada Dublado',
    'tt0417299', 3
  );
  console.log('Korra vs Aang IMDB:', r4.matches ? '❌ ACEITOU (errado)' : '✅ REJEITOU (certo)', '|', r4.reason);
}

main().catch(e => { console.error(e); process.exit(1); });
