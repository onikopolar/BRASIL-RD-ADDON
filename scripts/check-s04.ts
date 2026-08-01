import { searchHdr } from '../src/services/scraper/hdrScraper.js';
import { TitleFilter } from '../src/titulos/titleFilter.js';
import { SimilarityCalculator } from '../src/titulos/SimilarityCalculator.js';

async function main() {
  const r = await searchHdr('doctor who', 'series');
  const tf = TitleFilter.getInstance();
  const sc = SimilarityCalculator.getInstance();

  const s04 = r.find(m => {
    const dn = decodeURIComponent((m.magnet.match(/dn=([^&]+)/)?.[1] || ''));
    return dn.includes('Doctor.who.4') && !dn.includes('4k');
  });

  if (s04) {
    const dn = decodeURIComponent((s04.magnet.match(/dn=([^&]+)/)?.[1] || '')).replace(/\+/g, ' ');
    const pt = tf.verificarIdiomaDetalhado(dn);
    // Simula a lógica do catalogProvider
    const tlang = s04.language; // "Dual Áudio"
    const temInternacional = pt.palavrasEn && pt.palavrasEn.length > 0;
    const passaPT = /portugu[eê]s|dual|dublado/i.test(tlang) && !temInternacional;
    
    const sim = await sc.smartTitleContainsCheck(dn, 'tt0436992', { season: 4 });
    console.log('Magnet:', dn);
    console.log('HDR language:', tlang);
    console.log('Passa PT (catalog logic)?', passaPT);
    console.log('Sim:', sim.matches ? 'PASSOU' : 'FALHOU', sim.reason);
  } else {
    console.log('S04 NAO ENCONTRADO!');
    for (const m of r) {
      const dn = decodeURIComponent((m.magnet.match(/dn=([^&]+)/)?.[1] || ''));
      if (dn.toLowerCase().includes('who.4')) console.log('  ', dn.substring(0, 80));
    }
  }
}

main().catch(console.error);
