import { EpisodeMatcher } from '../src/titulos/episodeMatcher.js';

const em = EpisodeMatcher.getInstance();
const titles = [
  'AZTORRENTS.Doctor.who.4',
  'doctor.who.S6.BluRay.Rip.Dual.',
  'doctor+who+1temporada+web+dl+2005+dublado++NET',
  'Doctor.who.2temporada.WEB-DL.2006.Dublado.comandofilmes.net',
  'Doctor.Who.8 -',
];

for (const t of titles) {
  console.log(`\n${t.substring(0, 70)}`);
  console.log(`  extractSeason: ${em.extractSeasonFromTitle(t)}`);
  console.log(`  temIndicadorTemporada: ${em.temIndicadorTemporada(t)}`);
  console.log(`  temIndicadorEpisodio: ${em.temIndicadorEpisodio(t)}`);
  console.log(`  ehPackTemporadaCompleta: ${em.ehPackTemporadaCompleta(t)}`);
}
