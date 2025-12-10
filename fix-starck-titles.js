// Teste para ver como extrair títulos corretamente do Starck Filmes
const axios = require('axios');
const cheerio = require('cheerio');

async function testTitleExtraction() {
    console.log('Testando extração de títulos do Starck Filmes...\n');
    
    const searchUrl = 'https://www.starckfilmes-v6.com/?s=bom%20menino';
    
    const response = await axios.get(searchUrl, {
        headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    });
    
    const $ = cheerio.load(response.data);
    
    console.log('1. Buscando com seletor atual (.movies, .slide-item, .post-catalog):');
    $('.movies, .slide-item, .post-catalog').each((i, element) => {
        if (i < 3) {
            const $element = $(element);
            const title = $element.find('a').first().text().trim();
            const href = $element.find('a').first().attr('href');
            
            console.log(`\n   Item ${i + 1}:`);
            console.log(`   Título cru: "${title.substring(0, 100)}..."`);
            console.log(`   Link: ${href}`);
            
            // Tentar limpar o título
            const lines = title.split('\n').filter(line => line.trim());
            const firstLine = lines[0] || title;
            
            console.log(`   Primeira linha: "${firstLine.substring(0, 80)}"`);
            
            // Verificar se é duplicado
            if (title.includes(title.substring(0, 20))) {
                console.log(`   ⚠️  Possível título duplicado`);
                
                // Tentar pegar texto do elemento h2, h3 ou similar
                const h2Text = $element.find('h2').text().trim();
                const h3Text = $element.find('h3').text().trim();
                
                if (h2Text) {
                    console.log(`   H2 encontrado: "${h2Text.substring(0, 80)}"`);
                }
                if (h3Text) {
                    console.log(`   H3 encontrado: "${h3Text.substring(0, 80)}"`);
                }
            }
        }
    });
    
    console.log('\n2. Procurando elementos específicos:');
    
    // Procurar por elementos que parecem ser títulos
    const possibleTitleElements = $('h2, h3, [class*="title"], [class*="name"]');
    console.log(`   Elementos de título possíveis: ${possibleTitleElements.length}`);
    
    possibleTitleElements.slice(0, 5).each((i, element) => {
        const text = $(element).text().trim();
        const parentHtml = $(element).parent().html()?.substring(0, 100) || '';
        
        console.log(`\n   Elemento ${i + 1}:`);
        console.log(`   Texto: "${text.substring(0, 80)}"`);
        console.log(`   Classe: ${$(element).attr('class')}`);
        console.log(`   HTML pai: ${parentHtml}...`);
    });
}

testTitleExtraction();
