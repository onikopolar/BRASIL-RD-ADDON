const puppeteer = require('puppeteer');

async function scrapePopTorrent(searchTerm) {
    console.log(`Ì¥ç Buscando "${searchTerm}" no poptorrent.org...`);
    
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    
    try {
        await page.setViewport({ width: 1366, height: 768 });
        
        // 1. Buscar
        const searchUrl = `https://poptorrent.org/?s=${encodeURIComponent(searchTerm)}`;
        console.log(`Ìºê Acessando: ${searchUrl}`);
        
        await page.goto(searchUrl, { waitUntil: 'networkidle2' });
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // 2. Extrair resultados
        const searchResults = await page.evaluate(() => {
            const results = [];
            // Procurar elementos comuns
            const items = document.querySelectorAll('article, .post, .item, [class*="post-"]');
            
            items.forEach(item => {
                const link = item.querySelector('a');
                const title = item.querySelector('h2, h3, .title, .entry-title');
                
                if (link && title && link.href.includes('poptorrent.org')) {
                    results.push({
                        title: title.innerText.trim(),
                        url: link.href,
                        snippet: item.innerText.substring(0, 150) + '...'
                    });
                }
            });
            
            return results;
        });
        
        console.log(`\nÌ≥ä Encontrados ${searchResults.length} resultados:`);
        searchResults.forEach((item, i) => {
            console.log(`${i + 1}. ${item.title}`);
            console.log(`   ${item.url}`);
        });
        
        // 3. Se tiver resultados, pegar magnet do primeiro
        if (searchResults.length > 0) {
            console.log(`\nÌ∑≤ Acessando: ${searchResults[0].title}`);
            await page.goto(searchResults[0].url, { waitUntil: 'networkidle2' });
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Extrair magnet
            const magnet = await page.evaluate(() => {
                const magnetLink = document.querySelector('a[href^="magnet:"]');
                return magnetLink ? magnetLink.href : null;
            });
            
            if (magnet) {
                console.log(`‚úÖ Magnet encontrado!`);
                console.log(`   ${magnet.substring(0, 80)}...`);
                
                // Extrair info hash
                const infoHash = magnet.match(/btih:([a-f0-9]{40})/i);
                if (infoHash) {
                    console.log(`   Info Hash: ${infoHash[1]}`);
                }
            } else {
                console.log('‚ùå Nenhum magnet encontrado nesta p√°gina');
            }
        }
        
        // 4. Salvar screenshot
        await page.screenshot({ path: 'poptorrent-result.png' });
        console.log('\nÌ≥∏ Screenshot salvo: poptorrent-result.png');
        
        return {
            success: true,
            results: searchResults
        };
        
    } catch (error) {
        console.error('‚ùå Erro:', error.message);
        return { success: false, error: error.message };
    } finally {
        console.log('\n‚ö†Ô∏è  Navegador aberto para inspe√ß√£o.');
    }
}

// Executar
scrapePopTorrent('stranger things');
