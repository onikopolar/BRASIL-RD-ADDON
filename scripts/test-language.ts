import 'dotenv/config';
import { TitleFilter } from '../src/lib/titleFilter.js';

const f = TitleFilter.getInstance();

const titles = ['Interstellar', 'Interestelar', 'Interstellar 2014', 'Interestelar 2014'];

for (const t of titles) {
  const isPt = f.isPortugueseContent(t);
  console.log(`"${t}" → isPortuguese: ${isPt}`);
}
