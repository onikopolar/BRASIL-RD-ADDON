import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

async function testStarckFilmes() {
  console.log('Ìæ¨ TESTANDO STARCKFILMES-V6.COM');
  console.log('='.repeat(50));
  console.log('OBJETIVO: Mapear fluxo de navega√ß√£o at√© magnet link');
  console.log('='.repeat(50));
  
  const browser = await chromium.launch({
    headless: false, // VIS√çVEL para ver tudo
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  });
  
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  
  const page = await context.newPage();
  
  // Monitora TUDO
  page.on('framenavigated', (frame) => {
    if (frame.url() !== 'about:blank') {
      console.log(`‚û°Ô∏è  Navegou para: ${frame.url()}`);
    }
  });
  
  page.on('popup', async (popup) => {
    console.log(`Ì∫ü Popup aberto: ${await popup.url()}`);
    await popup.close();
  });
  
  try {
    console.log('\n1. Ìºê Acessando p√°gina do filme...');
    console.log('   URL: https://www.starckfilmes-v6.com/catalog/bom-menino-2025-26-10-2025/');
    
    await page.goto('https://www.starckfilmes-v6.com/catalog/bom-menino-2025-26-10-2025/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    console.log(`‚úÖ P√°gina carregada!`);
    console.log(`Ì≥Ñ T√≠tulo: ${await page.title()}`);
    console.log(`Ì¥ó URL: ${page.url()}`);
    
    // Screenshot inicial
    const screenshotsDir = path.join(process.cwd(), 'screenshots', 'starck');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    
    const screenshot1 = path.join(screenshotsDir, `initial_${Date.now()}.png`);
    await page.screenshot({ path: screenshot1, fullPage: true });
    console.log(`Ì≥∏ Screenshot: ${screenshot1}`);
    
    // 2. AN√ÅLISE DA P√ÅGINA
    console.log('\n2. Ì¥ç Analisando conte√∫do da p√°gina...');
    
    const pageInfo = await page.evaluate(() => {
      const info = {
        title: document.title,
        url: location.href,
        
        // Bot√µes importantes
        buttons: Array.from(document.querySelectorAll('button')).map(b => ({
          text: b.innerText.trim(),
          id: b.id,
          classes: b.className
        })),
        
        // Links importantes
        links: Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.innerText.trim().substring(0, 50),
          href: a.href,
          isMagnet: a.href.startsWith('magnet:')
        })),
        
        // Textos suspeitos (ads, contadores, etc)
        suspiciousTexts: [] as string[],
        
        // Iframes (geralmente ads)
        iframes: document.querySelectorAll('iframe').length
      };
      
      // Detecta textos suspeitos
      const bodyText = document.body.innerText.toLowerCase();
      const suspiciousKeywords = [
        'aguarde', 'segundos', 'contador', 'timer', 'countdown',
        'skip', 'pular', 'continuar', 'prosseguir', 'gerar',
        'download', 'baixar', 'magnet', 'torrent', 'link'
      ];
      
      suspiciousKeywords.forEach(keyword => {
        if (bodyText.includes(keyword)) {
          info.suspiciousTexts.push(keyword);
        }
      });
      
      return info;
    });
    
    console.log('\nÌ≥ä AN√ÅLISE DA P√ÅGINA:');
    console.log(`   - Bot√µes: ${pageInfo.buttons.length}`);
    if (pageInfo.buttons.length > 0) {
      console.log(`   - Textos dos bot√µes: ${pageInfo.buttons.map(b => b.text).filter(t => t).join(', ')}`);
    }
    
    console.log(`   - Links: ${pageInfo.links.length}`);
    console.log(`   - Iframes: ${pageInfo.iframes}`);
    console.log(`   - Textos suspeitos: ${pageInfo.suspiciousTexts.join(', ')}`);
    
    // 3. VERIFICA MAGNETS DIRETOS
    const directMagnets = pageInfo.links.filter(l => l.isMagnet);
    if (directMagnets.length > 0) {
      console.log('\nÌæâ MAGNETS ENCONTRADOS DIRETAMENTE!');
      directMagnets.forEach((magnet, i) => {
        console.log(`   ${i + 1}. ${magnet.text || 'Sem texto'} -> ${magnet.href.substring(0, 80)}...`);
      });
    } else {
      console.log('\nÌ¥ç Nenhum magnet link direto encontrado na p√°gina');
    }
    
    // 4. PROCURA BOT√ïES DE DOWNLOAD/GERAR
    console.log('\n3. Ì¥é Procurando bot√µes de download/gera√ß√£o...');
    
    const downloadButtons = pageInfo.buttons.filter(b => 
      b.text && /download|baixar|gerar|magnet|torrent|link/i.test(b.text)
    );
    
    if (downloadButtons.length > 0) {
      console.log(`   Ì≥å Bot√µes de download encontrados: ${downloadButtons.length}`);
      downloadButtons.forEach((btn, i) => {
        console.log(`   ${i + 1}. "${btn.text}" (id: ${btn.id}, classes: ${btn.classes})`);
      });
      
      // Tenta clicar no primeiro bot√£o
      console.log('\n4. Ì∂±Ô∏è  Testando clique no primeiro bot√£o...');
      
      const firstButton = downloadButtons[0];
      let selector = firstButton.id ? `#${firstButton.id}` : 
                    `button:has-text("${firstButton.text}")`;
      
      try {
        await page.click(selector);
        console.log(`   ‚úÖ Clicou em: "${firstButton.text}"`);
        
        // Espera por navega√ß√£o/redirecionamento
        await page.waitForTimeout(3000);
        
        // Verifica se mudou algo
        const newUrl = page.url();
        if (newUrl !== pageInfo.url) {
          console.log(`   Ì¥Ñ Nova URL: ${newUrl}`);
          
          // Procura magnets na nova p√°gina
          const newMagnets = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a'))
              .map(a => a.href)
              .filter(href => href.startsWith('magnet:'));
          });
          
          if (newMagnets.length > 0) {
            console.log(`   ÔøΩÔøΩ Magnets na nova p√°gina: ${newMagnets.length}`);
          }
        }
        
      } catch (error) {
        console.log(`   ‚ùå N√£o conseguiu clicar no bot√£o: ${error.message}`);
      }
    }
    
    // 5. AGUARDA PARA VER COMPORTAMENTO
    console.log('\n5. Ì±Ä Observando comportamento por 15 segundos...');
    console.log('   - Observe se aparecem popups, redirecionamentos');
    console.log('   - Veja se algum elemento muda dinamicamente\n');
    
    for (let i = 1; i <= 15; i++) {
      process.stdout.write(`${i}s `);
      await page.waitForTimeout(1000);
      
      // Screenshot a cada 5 segundos
      if (i % 5 === 0) {
        const obsScreenshot = path.join(screenshotsDir, `obs_${i}s_${Date.now()}.png`);
        await page.screenshot({ path: obsScreenshot });
      }
    }
    
    // 6. VERIFICA√á√ÉO FINAL
    console.log('\n\n6. Ì≥ã Verifica√ß√£o final...');
    
    const finalMagnets = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href.startsWith('magnet:'));
    });
    
    console.log(`   Magnets totais encontrados: ${finalMagnets.length}`);
    if (finalMagnets.length > 0) {
      console.log(`   Primeiro magnet: ${finalMagnets[0].substring(0, 100)}...`);
    }
    
    // 7. MANT√âM ABERTO PARA VOC√ä EXPLORAR
    console.log('\n7. ÌµµÔ∏è  MODO EXPLORA√á√ÉO MANUAL');
    console.log('='.repeat(50));
    console.log('O navegador vai ficar aberto por 60 segundos.');
    console.log('VOC√ä PODE:');
    console.log('1. Navegar manualmente na p√°gina');
    console.log('2. Clicar em bot√µes que parecem promissores');
    console.log('3. Ver onde est√£o os magnet links');
    console.log('4. Observar sequ√™ncia de an√∫ncios/redirecionamentos');
    console.log('\n‚ö†Ô∏è  IMPORTANTE: Anote EXATAMENTE:');
    console.log('   - Qual bot√£o voc√™ clicou?');
    console.log('   - Quantos redirecionamentos?');
    console.log('   - Onde apareceu o magnet link?');
    console.log('='.repeat(50));
    
    await page.waitForTimeout(60000);
    
    console.log('\n‚úÖ Teste conclu√≠do!');
    
  } catch (error) {
    console.error('\nÌ≤• ERRO:', error.message);
  } finally {
    await browser.close();
    console.log('\nÌ∑π Navegador fechado');
  }
}

testStarckFilmes();
