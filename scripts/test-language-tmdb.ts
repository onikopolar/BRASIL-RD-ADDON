import 'dotenv/config';
import { TitleFilter } from '../src/lib/titleFilter.js';

const f = TitleFilter.getInstance();

async function test(title: string) {
  const r = await f.doTitlesMatch(title, 'tt0816692'); // Interstellar
  console.log(`"${title}" → ${r.matches ? 'ACEITOU' : 'REJEITOU'} | ${r.reason}`);
}

async function main() {
  console.log('TMDB: Interestelar (PT) vs Interstellar (EN)\n');
  await test('Interstellar');
  await test('Interestelar');
  await test('Interestelar 2014');
  await test('Interstellar 2014');
  await test('Interestelar Dublado 1080p');
  await test('Interstellar Dublado 1080p');
}

main().catch(e => { console.error(e); process.exit(1); });
