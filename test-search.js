const axios = require('axios');
const cheerio = require('cheerio');

async function testSearch() {
    console.log('��� Testando busca no Starck Filmes...\n');
    
    // Primeiro, vamos acessar a página inicial para ver se tem barra de busca
    try {
        console.log('1. Acessando página inicial...');
        const response = await axios.get('https://www.starckfilmes-v6.com', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        // Procurar formulários de busca
        const searchForms = $('form[role="search"], form input[name="s"], form input[type="search"]');
        console.log(`   Formulários de busca encontrados: ${searchForms.length}`);
        
        // Mostrar ação dos formulários
        searchForms.each((i, form) => {
            const action = $(form).attr('action') || 'N/A';
            const method = $(form).attr('method') || 'GET';
            console.log(`   Form ${i + 1}: action="${action}", method="${method}"`);
        });
        
        // Procurar campos de busca
        const searchInputs = $('input[type="search"], input[name="s"], input[placeholder*="busca"], input[placeholder*="search"]');
        console.log(`\n   Campos de busca: ${searchInputs.length}`);
        
        // Verificar se há um endpoint de busca comum
        console.log('\n2. Testando endpoints comuns de busca...');
        const commonEndpoints = [
            '/?s=',
            '/search/',
            '/catalog/',
            '/?q=',
            '/busca/'
        ];
        
        for (const endpoint of commonEndpoints) {
            try {
                const testUrl = `https://www.starckfilmes-v6.com${endpoint}teste`;
                console.log(`   Testando: ${testUrl}`);
                const testResp = await axios.get(testUrl, { timeout: 5000 });
                console.log(`     Status: ${testResp.status}`);
            } catch (err) {
                console.log(`     Erro: ${err.message}`);
            }
        }
        
        // Verificar estrutura do catálogo
        console.log('\n3. Analisando estrutura do catálogo...');
        const catalogLinks = $('a[href*="/catalog/"]');
        console.log(`   Links para /catalog/: ${catalogLinks.length}`);
        
        if (catalogLinks.length > 0) {
            catalogLinks.slice(0, 3).each((i, link) => {
                const href = $(link).attr('href');
                const text = $(link).text().trim().substring(0, 50);
                console.log(`   Link ${i + 1}: ${text} -> ${href}`);
            });
        }
        
    } catch (error) {
        console.error('Erro:', error.message);
    }
}

testSearch();
