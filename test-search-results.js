const axios = require('axios');
const cheerio = require('cheerio');

async function testSearchResults() {
    console.log('��� Testando resultados de busca no Starck Filmes...\n');
    
    // Testar busca por "bom menino"
    const searchQuery = encodeURIComponent('bom menino');
    const searchUrl = `https://www.starckfilmes-v6.com/?s=${searchQuery}`;
    
    console.log(`1. Buscando: "${searchQuery}"`);
    console.log(`   URL: ${searchUrl}\n`);
    
    try {
        const response = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        const $ = cheerio.load(response.data);
        
        // Verificar se há resultados
        const resultsCount = $('article, .post, .item, [class*="post-"]').length;
        console.log(`   Elementos de resultado encontrados: ${resultsCount}`);
        
        // Procurar títulos e links
        const articles = $('article, .post, .item, [class*="post-"]');
        console.log(`\n2. Analisando ${articles.length} resultados...\n`);
        
        articles.each((i, article) => {
            const $article = $(article);
            
            // Tentar encontrar título
            const title = $article.find('h2, h3, .title, .entry-title').text().trim() || 
                         $article.text().substring(0, 100).trim();
            
            // Tentar encontrar link
            let link = '';
            const linkElement = $article.find('a').first();
            if (linkElement.length) {
                link = linkElement.attr('href') || '';
            }
            
            console.log(`   Resultado ${i + 1}:`);
            console.log(`     Título: ${title.substring(0, 80)}...`);
            console.log(`     Link: ${link}`);
            
            // Verificar se é do catálogo
            if (link.includes('/catalog/')) {
                console.log(`     ✅ É link do catálogo!`);
            }
            console.log('');
        });
        
        // Verificar se há mensagem "nada encontrado"
        const noResults = $('body:contains("nada encontrado"), body:contains("nenhum resultado"), body:contains("no results")');
        if (noResults.length) {
            console.log('3. ⚠️  Pode não ter resultados ou a busca não funciona como esperado');
        }
        
        // Ver estrutura da página
        console.log('\n4. Estrutura da página de busca:');
        const uniqueClasses = new Set();
        $('*[class]').each((i, el) => {
            const classes = $(el).attr('class').split(' ');
            classes.forEach(c => uniqueClasses.add(c));
        });
        
        console.log(`   Classes únicas encontradas: ${uniqueClasses.size}`);
        
        // Mostrar algumas classes relevantes
        const relevantClasses = Array.from(uniqueClasses)
            .filter(c => c.includes('post') || c.includes('item') || c.includes('article') || c.includes('movie'))
            .slice(0, 10);
        
        console.log(`   Classes relevantes: ${relevantClasses.join(', ')}`);
        
    } catch (error) {
        console.error('Erro:', error.message);
    }
}

testSearchResults();
