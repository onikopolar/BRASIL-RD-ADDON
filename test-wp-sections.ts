import axios from 'axios';
import * as cheerio from 'cheerio';
import { WordPressScraper } from './src/services/scraper/wordpressScraper.js';

async function main() {
  const url = process.argv[2] || 'https://comando1.com/ataque-dos-titas-4a-temporada-torrent/';
  console.log(`\n═══ Testando seções do WP ═══\n${url}\n`);

  const res = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
    },
  });

  const $ = cheerio.load(res.data);
  const html = res.data;

  // Post title
  const postTitle = $('h1').first().text().trim() || $('title').first().text().trim();
  console.log(`Título do post: "${postTitle.substring(0, 80)}"`);
  console.log(`Tamanho HTML: ${html.length} chars\n`);

  // Cria instância
  const scraper = new WordPressScraper();

  // 1. Detecta seções
  const secoes = scraper.findSections($, html);
  console.log(`── Seções detectadas: ${secoes.length} ──`);
  for (const s of secoes) {
    console.log(`  ${s.tipo} [${s.start}-${s.end}] (${s.end - s.start} chars)`);
  }

  if (secoes.length === 0) {
    console.log('  Nenhuma seção detectada.');
    return;
  }

  // 2. Conta magnets por seção
  const magnetElements = $('a[href^="magnet:"]').toArray();
  console.log(`\n── Magnets totais no HTML: ${magnetElements.length} ──`);

  const contagem: Record<string, number> = { DUAL: 0, LEGENDADO: 0, NONE: 0 };
  for (const el of magnetElements) {
    const pos = html.indexOf($(el).toString());
    const secao = scraper.findSections($, html).find(s => pos >= s.start && pos < s.end);
    if (!secao) contagem.NONE++;
    else contagem[secao.tipo]++;
  }
  console.log(`  DUAL: ${contagem.DUAL}`);
  console.log(`  LEGENDADO: ${contagem.LEGENDADO}`);
  console.log(`  FORA (NONE): ${contagem.NONE}`);

  // 3. Processa magnets das seções DUAL
  const secoesDual = secoes.filter(s => s.tipo === 'DUAL');
  if (secoesDual.length === 0) {
    console.log('\n  Nenhuma seção DUAL — nada a processar.');
    return;
  }

  // Simula o que scrapePostApi faria: pega magnets das seções DUAL
  const magnetsValidos = magnetElements.filter(el => {
    const pos = html.indexOf($(el).toString());
    return secoesDual.some(s => pos >= s.start && pos < s.end);
  });

  console.log(`\n── Processando ${magnetsValidos.length} magnets da(s) seção(ões) DUAL ──\n`);

  for (let i = 0; i < magnetsValidos.length; i++) {
    const el = magnetsValidos[i];
    const magnet = $(el).attr('href') || '';
    const parentText = $(el).parent().text().trim();
    const linkText = $(el).text().trim();
    const ctxLocal = scraper['extrairContextoLocal']($, el);

    // Chama o método público via cast
    const result = await (scraper as any).processMagnetItem(
      magnet,
      parentText,
      linkText,
      scraper.getFullContextText($(el)),
      ctxLocal,
      postTitle,
      html,
      'test',
      'series',
      undefined,
      undefined,
      undefined
    );

    if (result) {
      console.log(`  [${i + 1}] ✅ ${result.quality} | ${result.canonicalName?.substring(0, 60)}`);
    } else {
      console.log(`  [${i + 1}] ❌ magnet rejeitado`);
    }
  }

  console.log(`\n═══ Fim ═══\n`);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
