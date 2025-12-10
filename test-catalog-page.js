const axios = require('axios');
const cheerio = require('cheerio');

async function testCatalogPage() {
    console.log('��� Testando extração de magnet links das páginas do catálogo...\n');
    
    // Usar a URL do seu teste anterior
    const catalogUrl = 'https://www.starckfilmes-v6.com/catalog/bom-menino-2025-26-10-2025/';
    
    console.log(`1. Acessando página do catálogo: ${catalogUrl}\n`);
    
    try {
        const response = await axios.get(catalogUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        // 1. Procurar magnet links diretamente
        console.log('2. Buscando magnet links diretamente no HTML...');
        const magnetLinks = [];
        
        $('a[href^="magnet:"]').each((i, element) => {
            const magnetUrl = $(element).attr('href');
            const text = $(element).text().trim() || 'Sem texto';
            magnetLinks.push({ url: magnetUrl, text: text.substring(0, 100) });
        });
        
        console.log(`   Magnet links encontrados: ${magnetLinks.length}`);
        magnetLinks.forEach((link, i) => {
            console.log(`   Magnet ${i + 1}: ${link.text}`);
            console.log(`        URL: ${link.url.substring(0, 80)}...`);
        });
        
        // 2. Procurar botões ou elementos de download
        console.log('\n3. Procurando botões/links de download...');
        const downloadElements = $('a, button, div').filter((i, el) => {
            const text = $(el).text().toLowerCase();
            const href = $(el).attr('href') || '';
            return text.includes('download') || 
                   text.includes('baixar') || 
                   text.includes('magnet') || 
                   text.includes('torrent') ||
                   href.includes('download') ||
                   href.includes('magnet');
        });
        
        console.log(`   Elementos de download suspeitos: ${downloadElements.length}`);
        downloadElements.slice(0, 5).each((i, el) => {
            const text = $(el).text().trim().substring(0, 100);
            const href = $(el).attr('href') || 'N/A';
            console.log(`   Elemento ${i + 1}: "${text}" -> ${href.substring(0, 80)}`);
        });
        
        // 3. Verificar estrutura da página
        console.log('\n4. Analisando estrutura da página...');
        
        // Título
        const title = $('title').text() || 
                     $('h1').text() || 
                     $('h2').first().text();
        console.log(`   Título: ${title.substring(0, 100)}`);
        
        // Container principal
        const mainContent = $('.entry-content, .post-content, .content, article').first();
        console.log(`   Conteúdo principal: ${mainContent.length ? 'Encontrado' : 'Não encontrado'}`);
        
        // Verificar se há iframes (geralmente ads)
        const iframes = $('iframe');
        console.log(`   Iframes encontrados: ${iframes.length}`);
        
        // 4. Verificar todo o texto da página por magnet patterns
        console.log('\n5. Buscando padrões magnet no texto completo...');
        const fullHtml = response.data;
        const magnetRegex = /magnet:\?xt=urn:btih:[a-fA-F0-9]{40}[^"\s]*/g;
        const foundMagnets = fullHtml.match(magnetRegex) || [];
        
        console.log(`   Magnets via regex: ${foundMagnets.length}`);
        foundMagnets.slice(0, 3).forEach((magnet, i) => {
            console.log(`   Magnet regex ${i + 1}: ${magnet.substring(0, 80)}...`);
        });
        
        // 5. Qualidade e informação
        console.log('\n6. Extraindo informações de qualidade...');
        const bodyText = $('body').text();
        const qualityMatches = bodyText.match(/\d{3,4}p|HD|FHD|UHD|4K|1080|720|480/gi) || [];
        console.log(`   Qualidades encontradas: ${[...new Set(qualityMatches)].join(', ')}`);
        
        // Tamanho
        const sizeMatches = bodyText.match(/\d+\.?\d*\s*(GB|MB|GiB|MiB)/gi) || [];
        console.log(`   Tamanhos encontrados: ${[...new Set(sizeMatches)].join(', ')}`);
        
    } catch (error) {
        console.error('Erro:', error.message);
    }
}

testCatalogPage();
